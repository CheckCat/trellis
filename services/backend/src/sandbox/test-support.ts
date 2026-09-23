// Test-only helpers for the sandbox layer, shared by
// plugins/postgres-sandbox/postgres-sandbox.test.ts, sandbox/provisioner.test.ts and
// routes/sandbox.test.ts. Kept out of the production build exactly like
// courses/test-support.ts, db/test-support.ts and progress/test-support.ts —
// see tsconfig.json's `exclude`.
//
// The recording pool below is what lets the REAL Postgres driver be tested
// without a Postgres: the driver's whole contract is "which statements, in
// which order, inside which transaction", and that is exactly what this
// records. (The driver against a live database under the sandbox role is
// verified manually — see the task-008 report: neither CI nor
// .mvp/ci-mirror.sh hands the test run a SANDBOX_DATABASE_URL today, and
// wiring one up is outside this task's service boundary.)
//
// Every fixture here is synthetic — no real course's ids, titles or SQL.

import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import { createCourseRegistry, type CourseRegistry } from "../courses/registry/index.js";
import { makeTempDir, writeCoursePackage, type FixtureFile } from "../courses/test-support.js";
import type { AppPool } from "../db/pool/index.js";

export interface RecordingPool {
  readonly pool: AppPool;
  /** Every statement the driver issued, in order, including the `BEGIN` /
   * `COMMIT` / `ROLLBACK` this fake emits itself (the real
   * `AppPool#withTransaction` issues them, so a fake that skipped them would
   * hide whether the rebuild is actually transactional). */
  readonly statements: string[];
  /** How many times the pool was asked for a client — `connect()` and
   * `withTransaction()` both count, since both check one out. */
  clientsCheckedOut(): number;
  /** Clients handed out and not yet released — must be 0 after every
   * operation, or the driver leaks pool connections. */
  clientsOpen(): number;
  endCalls(): number;
}

export interface CreateRecordingPoolOptions {
  /** Returns an error to throw instead of executing `sql`, or `undefined` to
   * let it "succeed". This is how a test simulates Postgres rejecting one
   * specific statement (a broken seed, a permission error on DROP SCHEMA). */
  readonly failOn?: (sql: string) => Error | undefined;
  /** Throws instead of ever handing out a client — simulates Postgres being
   * unreachable, including db/pool.ts's own wrapping of connect errors. */
  readonly failToConnect?: () => Error;
  /** Rows `query()` resolves with; the driver only cares that it resolved. */
  readonly rows?: readonly Record<string, unknown>[];
}

/**
 * An `AppPool` that records instead of connecting. `withTransaction`
 * reproduces db/pool.ts's real behaviour — BEGIN, the callback,
 * COMMIT-or-ROLLBACK, release in `finally` — so a test can assert that a
 * failed seed really did roll the rebuild back.
 */
export function createRecordingPool(options: CreateRecordingPoolOptions = {}): RecordingPool {
  const statements: string[] = [];
  let checkedOut = 0;
  let open = 0;
  let ended = 0;

  const run = async (sql: string): Promise<{ rows: readonly Record<string, unknown>[] }> => {
    statements.push(sql);
    const failure = options.failOn?.(sql);
    if (failure !== undefined) {
      throw failure;
    }
    return { rows: options.rows ?? [] };
  };

  const checkOutClient = (): PoolClient => {
    if (options.failToConnect !== undefined) {
      throw options.failToConnect();
    }
    checkedOut += 1;
    open += 1;
    let released = false;
    return {
      query: (text: string) => run(text),
      release: () => {
        if (released) {
          throw new Error("recording pool: the same client was released twice");
        }
        released = true;
        open -= 1;
      },
    } as unknown as PoolClient;
  };

  const pool: AppPool = {
    query: ((text: string) => run(text)) as unknown as AppPool["query"],
    connect: (async () => checkOutClient()) as unknown as AppPool["connect"],
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = checkOutClient();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Same rule as the real pool: a failing ROLLBACK must not replace
          // the error the caller actually needs to see.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async end(): Promise<void> {
      ended += 1;
    },
  };

  return {
    pool,
    statements,
    clientsCheckedOut: () => checkedOut,
    clientsOpen: () => open,
    endCalls: () => ended,
  };
}

export const FIXTURE_COURSE_ID = "sandbox-fixture";
export const FIXTURE_SANDBOX_ID = "main";
export const FIXTURE_SEED_SCHEMA = "sandbox/01-schema.sql";
export const FIXTURE_SEED_DATA = "sandbox/02-data.sql";
export const FIXTURE_SEED_SCHEMA_SQL = "create table widgets (id int primary key, label text);";
export const FIXTURE_SEED_DATA_SQL = "insert into widgets (id, label) values (1, 'first'), (2, 'second');";

export interface SandboxFixtureOptions {
  readonly courseId?: string;
  /** Declared sandbox ids, in manifest order. More than one is how the
   * "which sandbox did you mean?" path gets exercised. */
  readonly sandboxIds?: readonly string[];
  /** Package-relative seed paths for the FIRST sandbox, in the order they
   * must be applied. */
  readonly seedPaths?: readonly string[];
}

export interface SandboxFixture {
  readonly coursesDir: string;
  readonly packageDir: string;
  readonly registry: CourseRegistry;
  /** Removes the temp tree — call it in a `finally`. */
  cleanup(): void;
}

/**
 * Writes a synthetic course package declaring one (or several) postgres
 * sandboxes with real seed files on disk, and returns a live registry over
 * it — the same registry type `fastify.courses` serves from, so the
 * provisioner under test resolves seeds exactly the way it does in
 * production.
 */
export function createSandboxFixture(options: SandboxFixtureOptions = {}): SandboxFixture {
  const courseId = options.courseId ?? FIXTURE_COURSE_ID;
  const sandboxIds = options.sandboxIds ?? [FIXTURE_SANDBOX_ID];
  const seedPaths = options.seedPaths ?? [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA];
  const coursesDir = makeTempDir("trellis-sandbox-");

  const lines: string[] = [
    `id: ${courseId}`,
    "version: 1.0.0",
    "title: Sandbox fixture course",
  ];
  if (sandboxIds.length > 0) {
    lines.push("sandboxes:");
    for (const [index, sandboxId] of sandboxIds.entries()) {
      lines.push(`  - id: ${sandboxId}`, "    type: postgres");
      // Only the first sandbox carries seeds: a sandbox with none is a valid
      // manifest and a useful case in its own right (rebuild an empty
      // schema).
      const paths = index === 0 ? seedPaths : [];
      if (paths.length > 0) {
        lines.push("    seed:");
        for (const seedPath of paths) {
          lines.push(`      - ${seedPath}`);
        }
      }
    }
  }
  lines.push("modules:", "  - id: only-module", "    title: Only module", "    lessons:");
  const firstSandboxId = sandboxIds[0];
  if (firstSandboxId === undefined) {
    // A course that declares no sandbox can't have a practice lesson either
    // — `practice.sandbox` must reference a declared sandbox or the whole
    // package is rejected at validation (courses/validate.ts). A quiz lesson
    // keeps the fixture valid for the "this course has no sandbox at all"
    // case.
    lines.push(
      "      - id: quiz-lesson",
      "        title: Quiz lesson",
      "        quiz:",
      '          question: "Which one?"',
      "          options:",
      "            - id: a",
      '              text: "This one"',
      "              correct: true",
      "            - id: b",
      '              text: "Not this one"',
      "              explanation: It is not this one.",
    );
  } else {
    lines.push(
      "      - id: practice-lesson",
      "        title: Practice lesson",
      "        practice:",
      `          sandbox: ${firstSandboxId}`,
      "          prompt: Do the thing.",
    );
  }
  lines.push("");

  const files: FixtureFile[] = seedPaths.map((seedPath) => ({
    path: seedPath,
    content: seedPath === FIXTURE_SEED_DATA ? FIXTURE_SEED_DATA_SQL : FIXTURE_SEED_SCHEMA_SQL,
  }));
  const packageDir = writeCoursePackage(coursesDir, courseId, lines.join("\n"), files);

  return {
    coursesDir,
    packageDir,
    registry: createCourseRegistry(coursesDir),
    cleanup: () => fs.rmSync(coursesDir, { recursive: true, force: true }),
  };
}

/** Absolute path of one of the fixture's files, for tests that delete or
 * rewrite a seed behind the registry's back. */
export function fixtureFilePath(fixture: SandboxFixture, relativePath: string): string {
  return path.join(fixture.packageDir, relativePath);
}
