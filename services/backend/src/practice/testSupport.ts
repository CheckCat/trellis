// Test-only helpers for the practice layer, shared by practice/execute.test.ts,
// practice/check.test.ts and routes/practice.test.ts. Kept out of the
// production build exactly like the other testSupport.ts files — see
// tsconfig.json's `exclude`.
//
// What the scripted driver below buys: practice execution is defined by what
// it sends to a sandbox connection and what it makes of the answer, and that
// is exactly what a test needs to control — including the answers a real
// Postgres makes awkward to produce on demand (a multi-statement result
// array, a check returning two columns, a `bytea` cell, a DatabaseError with
// a `position`). It is a driver-level fake rather than a pool-level one
// (sandbox/testSupport.ts's `createRecordingPool`) because this layer's
// contract is about query CONFIGS and RESULTS, not about statement order
// inside a transaction.
//
// The real driver against a real Postgres under the sandbox role is verified
// manually — see the task-008 report's concern: neither CI nor
// .mvp/ci-mirror.sh hands the test run a SANDBOX_DATABASE_URL, and wiring
// one up is outside this service's boundary.
//
// Every fixture here is synthetic — no real course's ids, titles or SQL.

import fs from "node:fs";

import type { FastifyInstance } from "fastify";
import { DatabaseError, type PoolClient } from "pg";

import { createCourseRegistry } from "../courses/registry.js";
import { makeTempDir, writeCoursePackage } from "../courses/testSupport.js";
import type { ProgressRecord } from "../progress/model.js";
import {
  createInMemoryProgressRepository,
  poolThatMustNotBeUsed,
  progressFixtureFiles,
  progressFixtureManifestYaml,
  type FakeProgressRepository,
} from "../progress/testSupport.js";
import type { PostgresSandboxDriver } from "../sandbox/postgres-sandbox.js";
import { createSandboxProvisioner } from "../sandbox/provisioner.js";
import { buildServer } from "../server.js";

/** One query as the code under test issued it. `rowMode` is recorded because
 * "rows come back positionally, not keyed by column name" is part of both
 * modules' contract, not an implementation detail. */
export interface RecordedQuery {
  readonly text: string;
  readonly rowMode?: string;
}

/** What a scripted responder hands back for one query: a `pg`-shaped result,
 * an array of them (a multi-statement simple query), or an `Error` to throw
 * (`databaseError()` below builds a realistic one). */
export type ScriptedAnswer = unknown;

export interface CreateScriptedSandboxDriverOptions {
  /** Called for every query, in order. Returning an `Error` throws it; the
   * default answers every query with an empty result. */
  readonly respond?: (text: string, index: number) => ScriptedAnswer;
}

export interface ScriptedSandboxDriver {
  readonly driver: PostgresSandboxDriver;
  /** Every query issued through this driver, in order — including the
   * `rollback` the practice route uses to clean up after an attempt. */
  readonly queries: RecordedQuery[];
  /** Query texts only, for quick assertions. */
  texts(): string[];
  provisionCalls(): number;
  /** Clients checked out and not released — must be 0 after every request,
   * or the route leaks sandbox connections. */
  clientsOpen(): number;
}

export function createScriptedSandboxDriver(
  options: CreateScriptedSandboxDriverOptions = {},
): ScriptedSandboxDriver {
  const queries: RecordedQuery[] = [];
  let provisions = 0;
  let open = 0;

  const run = async (config: unknown): Promise<unknown> => {
    const text = typeof config === "string" ? config : String((config as { text?: unknown }).text);
    const rowMode = typeof config === "string" ? undefined : (config as { rowMode?: string }).rowMode;
    queries.push({ text, ...(rowMode === undefined ? {} : { rowMode }) });
    const answer = (options.respond ?? (() => emptyResult()))(text, queries.length - 1);
    if (answer instanceof Error) {
      throw answer;
    }
    return answer === undefined ? emptyResult() : answer;
  };

  const checkOutClient = (): PoolClient => {
    open += 1;
    let released = false;
    return {
      query: (config: unknown) => run(config),
      release: () => {
        if (released) {
          throw new Error("scripted sandbox driver: the same client was released twice");
        }
        released = true;
        open -= 1;
      },
    } as unknown as PoolClient;
  };

  const driver: PostgresSandboxDriver = {
    type: "postgres",
    schema: "sandbox",
    async provision() {
      provisions += 1;
    },
    query: ((text: string) => run(text)) as PostgresSandboxDriver["query"],
    async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = checkOutClient();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },
    async close() {
      // Nothing was ever opened.
    },
  };

  return {
    driver,
    queries,
    texts: () => queries.map((query) => query.text),
    provisionCalls: () => provisions,
    clientsOpen: () => open,
  };
}

export interface ResultSetOptions {
  readonly command?: string;
  readonly rowCount?: number | null;
  /** Column names, in order. `rows` are positional and must match. */
  readonly columns?: readonly string[];
  readonly rows?: readonly (readonly unknown[])[];
  /** Type OIDs, positionally matching `columns` (23 = int4 by default). */
  readonly dataTypeIds?: readonly number[];
}

/** A `pg` QueryResult as it looks with `rowMode: "array"`. */
export function resultSet(options: ResultSetOptions = {}): Record<string, unknown> {
  const columns = options.columns ?? [];
  const rows = options.rows ?? [];
  return {
    command: options.command ?? "SELECT",
    rowCount: options.rowCount === undefined ? rows.length : options.rowCount,
    fields: columns.map((name, index) => ({ name, dataTypeID: options.dataTypeIds?.[index] ?? 23 })),
    rows: rows.map((row) => [...row]),
  };
}

/** The single-boolean-column answer a well-formed check query gives. */
export function checkResult(passed: boolean): Record<string, unknown> {
  return resultSet({ columns: ["passed"], rows: [[passed]], dataTypeIds: [16] });
}

export function emptyResult(): Record<string, unknown> {
  return resultSet({ command: "SELECT", columns: [], rows: [] });
}

/** A genuine `pg` `DatabaseError` — same class (and, via `Object.assign`,
 * the same fields) a real Postgres ErrorResponse produces. It has to be the
 * real class, not merely shaped like one: execute.ts tells "the statement's
 * own fault" apart from "the connection died" with `instanceof DatabaseError`,
 * so a scripted answer that is not one exercises the propagation path
 * instead of the SQL-error path — see the "connection dying" tests below. */
export function databaseError(message: string, fields: Record<string, string> = {}): DatabaseError {
  return Object.assign(new DatabaseError(message, 0, "error"), { severity: "ERROR", ...fields });
}

/** A failure that is nobody's fault but the sandbox connection's — a socket
 * reset, a dropped connection, a timeout. Deliberately NOT a `DatabaseError`
 * (the real `pg` distinction `databaseError()` above exists to exercise),
 * so scripting this as a query's answer drives the "not the statement's
 * fault" path in execute.ts / routes/practice.ts instead of the ordinary
 * SQL-error path. */
export function connectionError(message = "Connection terminated unexpectedly"): Error {
  return new Error(message);
}

export interface PracticeAppContext {
  readonly app: FastifyInstance;
  readonly progress: FakeProgressRepository;
  readonly sandbox: ScriptedSandboxDriver;
}

export interface WithPracticeAppOptions {
  readonly respond?: (text: string, index: number) => ScriptedAnswer;
  readonly seed?: readonly ProgressRecord[];
  /** Overrides the fixture manifest (e.g. a lesson carrying both a quiz and
   * a checked practice). */
  readonly manifestYaml?: string;
  /** `false` builds the server with no sandbox at all — the production shape
   * of "SANDBOX_DATABASE_URL wasn't provided". */
  readonly configured?: boolean;
}

/**
 * A real server — real routing, real schemas, real provisioner, real
 * progress reconciliation — over the task-007 fixture course (which already
 * carries both a checked and an unchecked practice lesson), with a scripted
 * sandbox driver instead of Postgres and an in-memory progress repository
 * instead of `core.lesson_progress`.
 */
export async function withPracticeApp(
  run: (context: PracticeAppContext) => Promise<void>,
  options: WithPracticeAppOptions = {},
): Promise<void> {
  const coursesDir = makeTempDir("trellis-practice-");
  try {
    writeCoursePackage(
      coursesDir,
      "fixture",
      options.manifestYaml ?? progressFixtureManifestYaml(),
      progressFixtureFiles(),
    );
    const registry = createCourseRegistry(coursesDir);
    const progress = createInMemoryProgressRepository(options.seed ?? []);
    const sandbox = createScriptedSandboxDriver({ respond: options.respond });
    const app = buildServer({
      // The practice routes reach the database only through
      // `fastify.progress` (core) and `fastify.sandbox` (sandbox role) —
      // a pool that throws on any use keeps that honest.
      pool: poolThatMustNotBeUsed(),
      registry,
      progress,
      logger: false,
      ...(options.configured === false
        ? {}
        : { sandbox: createSandboxProvisioner({ courses: registry, driver: sandbox.driver }) }),
    });
    try {
      await run({ app, progress, sandbox });
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
}

/**
 * A fixture manifest whose only practice lesson ALSO carries a quiz — the
 * one case where a passing check must not complete the lesson (the quiz is
 * the gate; progress/model.ts).
 */
export const DUAL_GATE_LESSON_ID = "dual-gate-lesson";

export function dualGateManifestYaml(courseId = "progress-fixture"): string {
  return [
    `id: ${courseId}`,
    "version: 1.0.0",
    "title: Progress fixture course",
    "sandboxes:",
    "  - id: main",
    "    type: postgres",
    "    seed:",
    "      - sandbox/01-schema.sql",
    "modules:",
    "  - id: only-module",
    "    title: Only module",
    "    lessons:",
    `      - id: ${DUAL_GATE_LESSON_ID}`,
    "        title: Quiz and practice lesson",
    "        quiz:",
    '          question: "Which one is right?"',
    "          options:",
    "            - id: opt-right",
    '              text: "The right one"',
    "              correct: true",
    "            - id: opt-wrong",
    '              text: "The wrong one"',
    "              explanation: That option confuses two different things.",
    "        practice:",
    "          sandbox: main",
    "          prompt: Do the checked thing.",
    '          check: "select count(*) = 1 from t"',
    "",
  ].join("\n");
}
