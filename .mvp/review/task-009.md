# Review: task 009

## Commits (843d7efabf61b7892b2178297f4700a5f4341250..HEAD)


## Diffstat (843d7efabf61b7892b2178297f4700a5f4341250 -> working tree)

 .mvp/ledger.md                         | 2 ++
 services/backend/src/routes/sandbox.ts | 9 +++++++--
 services/backend/src/server.ts         | 2 ++
 services/backend/tsconfig.json         | 3 ++-
 4 files changed, 13 insertions(+), 3 deletions(-)

## Diff (843d7efabf61b7892b2178297f4700a5f4341250 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index 5811e50..94c5cb6 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -2,3 +2,5 @@
   concern (task 007): review split: 2 finding(s) came from a minority of 3 polls — the others approved
   concern (task 007): agentType "backend-implementer" did not dispatch — this task ran on general-purpose, WITHOUT the _common.md contract (boundary rules, report format, blocker protocol) that mvp:bootstrap assembled for it. Agents register at session start, so a bootstrap run in this same session yields files that are not dispatchable until the next one. Restart the session and re-run this task if the role's rules mattered.
 Task 007: complete (711625fa57d7df862e24df53832e6312cea33db8)
+  concern (task 008): `bash .mvp/ci-mirror.sh` → exit 0 (136 tests, 136 pass, 0 fail, 0 skipped). No dependency/lockfile changes; nothing touched outside `services/backend` except the report. Concerns (detail in `.mvp/reports/task-008.md`): 1. No automated live-Postgres test for the sandbox: neither `.github/workflows/ci.yml` nor `.mvp/ci-mirror.sh` exports a `trellis_sandbox` connection string, and both are outside my boundary; a skip-guarded test would also make ci-mirror red (it fails on any skip). Автотесты гоняю review split: 1 finding(s) came from a minority of 3 polls — the others approved agentType "backend-implementer" did not dispatch — this task ran on general-purpose, WITHOUT the _common.md contract (boundary rules, report format, blocker protocol) that mvp:bootstrap assembled for it. Agents register at session start, so a bootstrap run in this same session yields files that are not dispatchable until the next one. Restart the session and re-run this task if the role's rules mattered.
+Task 008: complete (843d7efabf61b7892b2178297f4700a5f4341250)
diff --git a/services/backend/src/routes/sandbox.ts b/services/backend/src/routes/sandbox.ts
index b204214..7af8849 100644
--- a/services/backend/src/routes/sandbox.ts
+++ b/services/backend/src/routes/sandbox.ts
@@ -19,7 +19,7 @@ import { sendCourseNotFound } from "./progress.js";
  * as data (and exhaustive by `Record<SandboxErrorKind, ...>`, so adding a
  * kind without deciding its status is a compile error) rather than a chain
  * of ifs that could quietly answer 500 for a new kind. */
-const STATUS_BY_KIND: Record<SandboxErrorKind, number> = {
+export const STATUS_BY_KIND: Record<SandboxErrorKind, number> = {
   course_not_found: 404,
   sandbox_not_found: 404,
   ambiguous_sandbox: 400,
@@ -104,7 +104,12 @@ function toStatusPayload(state: SandboxState | undefined) {
   };
 }
 
-function sendSandboxError(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
+/** Shared with routes/practice.ts (task 009): preparing a course's sandbox
+ * before running practice SQL goes through the same `fastify.sandbox.ensure`
+ * and can fail in exactly the same ways, so both surfaces must answer the
+ * same status and the same body for the same `SandboxError` — a second copy
+ * of this mapping would be free to drift. */
+export function sendSandboxError(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
   if (!isSandboxError(err)) {
     // Not ours to translate — let Fastify's own error handler produce the
     // 500 and log it, rather than dressing an unknown bug up as a tidy
diff --git a/services/backend/src/server.ts b/services/backend/src/server.ts
index 9361d75..0127993 100644
--- a/services/backend/src/server.ts
+++ b/services/backend/src/server.ts
@@ -20,6 +20,7 @@ import coursesRoutes from "./routes/courses.js";
 import progressRoutes from "./routes/progress.js";
 import quizRoutes from "./routes/quiz.js";
 import sandboxRoutes from "./routes/sandbox.js";
+import practiceRoutes from "./routes/practice.js";
 
 export interface BuildServerOptions {
   /**
@@ -211,6 +212,7 @@ export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
   app.register(progressRoutes);
   app.register(quizRoutes);
   app.register(sandboxRoutes);
+  app.register(practiceRoutes);
   return app;
 }
 
diff --git a/services/backend/tsconfig.json b/services/backend/tsconfig.json
index 4af9eb4..eb13bcf 100644
--- a/services/backend/tsconfig.json
+++ b/services/backend/tsconfig.json
@@ -28,6 +28,7 @@
     "src/courses/testSupport.ts",
     "src/db/testSupport.ts",
     "src/progress/testSupport.ts",
-    "src/sandbox/testSupport.ts"
+    "src/sandbox/testSupport.ts",
+    "src/practice/testSupport.ts"
   ]
 }
```

## Untracked files (new, not yet added)

### services/backend/src/practice/check.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import { isPracticeCheckError, PracticeCheckError, runPracticeCheck } from "./check.js";
import {
  checkResult,
  createScriptedSandboxDriver,
  databaseError,
  resultSet,
  type ScriptedAnswer,
} from "./testSupport.js";

const CHECK_SQL = "select count(*) = 1 from expected_table";

async function check(respond: () => ScriptedAnswer): Promise<{ verdict?: boolean; error?: unknown; texts: string[]; rowMode?: string }> {
  const scripted = createScriptedSandboxDriver({ respond });
  try {
    const verdict = await scripted.driver.withClient((client) =>
      runPracticeCheck(client, { sql: CHECK_SQL, courseId: "some-course", lessonId: "some-lesson" }),
    );
    return { verdict: verdict.passed, texts: scripted.texts(), rowMode: scripted.queries[0]?.rowMode };
  } catch (err) {
    return { error: err, texts: scripted.texts(), rowMode: scripted.queries[0]?.rowMode };
  }
}

/** Asserts the thrown error is a contract violation whose message never
 * quotes the check SQL — the check is the answer to the exercise. */
function assertViolation(err: unknown, expectedFragment: string): void {
  assert.ok(isPracticeCheckError(err), `expected a PracticeCheckError, got ${String(err)}`);
  assert.equal(err.kind, "check_contract_violation");
  assert.match(err.message, new RegExp(expectedFragment));
  assert.doesNotMatch(err.message, /count\(\*\)|expected_table/);
}

void test("runPracticeCheck reports the single boolean the check returned, both ways", async () => {
  const passed = await check(() => checkResult(true));
  assert.equal(passed.verdict, true);
  assert.deepEqual(passed.texts, [CHECK_SQL]);
  // Same reason as practice execution: the column COUNT is part of the
  // contract, and object rows would merge two same-named columns into one.
  assert.equal(passed.rowMode, "array");

  const failed = await check(() => checkResult(false));
  assert.equal(failed.verdict, false);
});

void test("runPracticeCheck rejects a check returning no row, or more than one", async () => {
  const none = await check(() => resultSet({ columns: ["passed"], rows: [] }));
  assertViolation(none.error, "returned 0 rows");

  const many = await check(() => resultSet({ columns: ["passed"], rows: [[true], [true]] }));
  assertViolation(many.error, "returned 2 rows");
});

void test("runPracticeCheck rejects a check returning more than one column, or none", async () => {
  const two = await check(() => resultSet({ columns: ["passed", "extra"], rows: [[true, 1]] }));
  assertViolation(two.error, "returned 2 columns");

  const zero = await check(() => resultSet({ command: "CREATE TABLE", columns: [], rows: [], rowCount: null }));
  assertViolation(zero.error, "returned 0 columns");
});

void test("runPracticeCheck rejects a non-boolean verdict and never echoes the value", async () => {
  const text = await check(() => resultSet({ columns: ["passed"], rows: [["yes"]] }));
  assertViolation(text.error, 'a value of type "string"');
  assert.ok(isPracticeCheckError(text.error));
  assert.doesNotMatch(text.error.message, /yes/);

  const nullish = await check(() => resultSet({ columns: ["passed"], rows: [[null]] }));
  assertViolation(nullish.error, "returned null");

  const number = await check(() => resultSet({ columns: ["passed"], rows: [[1]] }));
  assertViolation(number.error, 'a value of type "number"');
});

void test("runPracticeCheck rejects a multi-statement check", async () => {
  const multi = await check(() => [checkResult(true), checkResult(true)]);
  assertViolation(multi.error, "is 2 statements");
});

void test("runPracticeCheck reports a check the database rejected as broken content, verbatim", async () => {
  const broken = await check(() => databaseError('relation "expected_table" does not exist', { code: "42P01" }));

  assert.ok(isPracticeCheckError(broken.error));
  assert.equal(broken.error.kind, "check_failed");
  assert.equal(broken.error.databaseError, 'relation "expected_table" does not exist');
  // Postgres' own words are quoted; the check query itself still isn't.
  assert.match(broken.error.message, /does not exist/);
  assert.doesNotMatch(broken.error.message, /count\(\*\)/);
  assert.match(broken.error.message, /lesson "some-lesson" in course "some-course"/);
});

void test("PracticeCheckError keeps its cause and is recognizable by the route", () => {
  const cause = new Error("root");
  const err = new PracticeCheckError("check_failed", "broken", { cause, databaseError: "root" });
  assert.equal(err.cause, cause);
  assert.equal(err.name, "PracticeCheckError");
  assert.equal(isPracticeCheckError(err), true);
  assert.equal(isPracticeCheckError(new Error("nope")), false);
});
```

### services/backend/src/practice/check.ts

```
// The course's check query — the ONLY grading logic the core has for
// practice.
//
// Project invariant, quoted: "Контракт check-запроса зачёта: возвращает одну
// строку с одним boolean-значением. Никакой другой логики зачёта
// («грейдера») в ядре." So this module does exactly three things: run the
// query the course wrote, verify that its answer is one row × one column ×
// one boolean, and report that boolean. There is no comparison of expected
// result sets, no diffing, no partial credit, no "close enough" — a course
// that wants a different notion of "passed" writes it into its own SQL.
//
// Anything else the query returns is BROKEN COURSE CONTENT, not a failed
// attempt: reporting "не зачтено" for a check that returns two rows would
// tell the learner they got it wrong when in fact the course author did.
// Those two outcomes are kept strictly apart — a wrong verdict is
// `{ passed: false }`, a broken check throws.
//
// The check runs under the sandbox role on the same connection the user's
// own SQL just ran on (project invariant: seed, check and user SQL all run
// as `trellis_sandbox`, never as the application role).

import type { PoolClient } from "pg";

export type PracticeCheckErrorKind =
  /** The database rejected the check query itself (syntax error, missing
   * table, permission). The author's SQL is broken. */
  | "check_failed"
  /** The query ran, but its answer isn't "one row, one boolean". */
  | "check_contract_violation";

export interface PracticeCheckErrorDetails {
  /** Postgres' own message, verbatim — the same rule seed failures follow
   * (sandbox/types.ts): a course author fixing a broken check needs the
   * database's words, not a paraphrase. */
  readonly databaseError?: string;
  readonly cause?: unknown;
}

export class PracticeCheckError extends Error {
  readonly kind: PracticeCheckErrorKind;
  readonly databaseError?: string;

  constructor(kind: PracticeCheckErrorKind, message: string, details: PracticeCheckErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PracticeCheckError";
    this.kind = kind;
    this.databaseError = details.databaseError;
  }
}

export function isPracticeCheckError(err: unknown): err is PracticeCheckError {
  return err instanceof PracticeCheckError;
}

export interface PracticeCheckVerdict {
  /** The single boolean the check query returned. Nothing else about the
   * check — not its text, not its result shape — ever leaves this module. */
  readonly passed: boolean;
}

export interface RunPracticeCheckOptions {
  /** The course's `practice.check` SQL. Never echoed into any message or
   * response: it is the answer to the exercise (routes/courses.ts strips it
   * from the public lesson shape for the same reason). */
  readonly sql: string;
  readonly courseId: string;
  readonly lessonId: string;
}

/**
 * Runs the check and returns its verdict. Throws `PracticeCheckError` when
 * the check is broken rather than unsatisfied — see this file's header.
 */
export async function runPracticeCheck(
  client: PoolClient,
  options: RunPracticeCheckOptions,
): Promise<PracticeCheckVerdict> {
  const subject = `The check query of lesson "${options.lessonId}" in course "${options.courseId}"`;
  const contract = "a check query must return exactly one row with exactly one boolean column";

  let raw: unknown;
  try {
    // Same `rowMode: "array"` as practice execution: the column COUNT is
    // part of the contract, and pg's default object rows collapse two
    // identically named columns into one key — which would let a check
    // returning `select true as ok, false as ok` pass the "exactly one
    // column" test it should fail.
    raw = await client.query({ text: options.sql, rowMode: "array" });
  } catch (err) {
    const databaseError = err instanceof Error ? err.message : String(err);
    throw new PracticeCheckError("check_failed", `${subject} could not be executed: ${databaseError}`, {
      databaseError,
      cause: err,
    });
  }

  if (Array.isArray(raw)) {
    // Several statements in one check — `pg` answers with one result each.
    // Which of them is the verdict is undefined, so there is no honest way
    // to grade it.
    throw violation(`${subject} is ${raw.length} statements, but ${contract}, as a single statement.`);
  }
  const record = isRecord(raw) ? raw : {};
  const fields = Array.isArray(record.fields) ? (record.fields as unknown[]) : [];
  const rows = Array.isArray(record.rows) ? (record.rows as unknown[]) : [];

  if (fields.length !== 1) {
    throw violation(`${subject} returned ${fields.length} columns, but ${contract}.`);
  }
  if (rows.length !== 1) {
    throw violation(`${subject} returned ${rows.length} rows, but ${contract}.`);
  }
  const row = rows[0];
  const value = Array.isArray(row) ? (row as unknown[])[0] : undefined;
  if (typeof value !== "boolean") {
    // The TYPE is named, never the value: a check like `select answer = 42`
    // returning something odd shouldn't hand the learner a fragment of the
    // expected answer through an error message.
    throw violation(`${subject} returned ${describeType(value)} instead of a boolean, but ${contract}.`);
  }
  return { passed: value };
}

function violation(message: string): PracticeCheckError {
  return new PracticeCheckError("check_contract_violation", message);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "no value";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (value instanceof Date) {
    return "a timestamp";
  }
  return `a value of type "${typeof value}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

### services/backend/src/practice/execute.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import type { PoolClient } from "pg";

import {
  executePracticeSql,
  formatCell,
  MAX_RESULT_ROWS,
  resetSandboxSession,
  rollbackOpenTransaction,
  toPracticeSqlError,
  type PracticeExecution,
} from "./execute.js";
import {
  connectionError,
  createScriptedSandboxDriver,
  databaseError,
  resultSet,
  type RecordedQuery,
  type ScriptedAnswer,
} from "./testSupport.js";

/** Runs one statement against a scripted sandbox client, the way the route
 * does (driver-checked-out client, never a pool of its own). */
async function execute(
  respond: (text: string, index: number) => ScriptedAnswer,
  sql = "select 1",
  options: Parameters<typeof executePracticeSql>[2] = {},
): Promise<{ execution: PracticeExecution; queries: RecordedQuery[]; clientsOpen: number }> {
  const scripted = createScriptedSandboxDriver({ respond });
  const execution = await scripted.driver.withClient((client: PoolClient) =>
    executePracticeSql(client, sql, options),
  );
  return { execution, queries: scripted.queries, clientsOpen: scripted.clientsOpen() };
}

void test("executePracticeSql returns the result grid positionally, with the submitted SQL sent unchanged", async () => {
  const sql = "select id, label from widgets order by id";
  const { execution, queries, clientsOpen } = await execute(
    () =>
      resultSet({
        command: "SELECT",
        columns: ["id", "label"],
        dataTypeIds: [23, 25],
        rows: [
          [1, "first"],
          [2, "second"],
        ],
      }),
    sql,
  );

  assert.equal(execution.ok, true);
  assert.ok(execution.ok);
  assert.deepEqual(execution.result, {
    command: "SELECT",
    rowCount: 2,
    columns: [
      { name: "id", dataTypeId: 23 },
      { name: "label", dataTypeId: 25 },
    ],
    rows: [
      ["1", "first"],
      ["2", "second"],
    ],
    truncated: false,
    statementCount: 1,
  });
  // Verbatim: the text Postgres receives is exactly what the user typed.
  assert.deepEqual(queries, [{ text: sql, rowMode: "array" }]);
  assert.equal(clientsOpen, 0);
});

void test("executePracticeSql asks for array rows, so duplicate column names survive", async () => {
  // `select 1 as a, 2 as a` is valid SQL. With pg's default object rows one
  // of the two columns would be lost before this code ever saw it.
  const { execution, queries } = await execute(
    () => resultSet({ columns: ["a", "a"], rows: [[1, 2]] }),
    "select 1 as a, 2 as a",
  );

  assert.equal(queries[0]?.rowMode, "array");
  assert.ok(execution.ok);
  assert.equal(execution.result.columns.length, 2);
  assert.deepEqual(execution.result.rows, [["1", "2"]]);
});

void test("executePracticeSql reports a statement with no result set (INSERT) honestly", async () => {
  const { execution } = await execute(
    () => resultSet({ command: "INSERT", columns: [], rows: [], rowCount: 3 }),
    "insert into widgets values (1), (2), (3)",
  );

  assert.ok(execution.ok);
  assert.equal(execution.result.command, "INSERT");
  assert.equal(execution.result.rowCount, 3);
  assert.deepEqual(execution.result.columns, []);
  assert.deepEqual(execution.result.rows, []);
});

void test("executePracticeSql reports the last result set of a multi-statement submission, and how many there were", async () => {
  const { execution } = await execute(
    () => [
      resultSet({ command: "CREATE TABLE", columns: [], rows: [], rowCount: null }),
      resultSet({ command: "INSERT", columns: [], rows: [], rowCount: 1 }),
      resultSet({ command: "SELECT", columns: ["n"], rows: [[1]] }),
    ],
    "create table t (n int); insert into t values (1); select n from t;",
  );

  assert.ok(execution.ok);
  assert.equal(execution.result.statementCount, 3);
  assert.equal(execution.result.command, "SELECT");
  assert.deepEqual(execution.result.rows, [["1"]]);
});

void test("executePracticeSql truncates oversized results but still reports the real row count", async () => {
  const rows = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, index) => [index]);
  const { execution } = await execute(() => resultSet({ columns: ["n"], rows, rowCount: rows.length }));

  assert.ok(execution.ok);
  assert.equal(execution.result.rows.length, MAX_RESULT_ROWS);
  assert.equal(execution.result.truncated, true);
  assert.equal(execution.result.rowCount, MAX_RESULT_ROWS + 5);
});

void test("executePracticeSql hands back Postgres' own error instead of throwing", async () => {
  const { execution, clientsOpen } = await execute(
    () =>
      databaseError('relation "widgts" does not exist', {
        code: "42P01",
        position: "15",
        hint: "Perhaps you meant to reference the table \"widgets\".",
      }),
    "select * from widgts",
  );

  assert.equal(execution.ok, false);
  assert.ok(!execution.ok);
  assert.deepEqual(execution.error, {
    message: 'relation "widgts" does not exist',
    severity: "ERROR",
    code: "42P01",
    position: "15",
    hint: 'Perhaps you meant to reference the table "widgets".',
  });
  // A failed statement still releases the connection.
  assert.equal(clientsOpen, 0);
});

void test("executePracticeSql propagates a failure that is not the statement's own fault instead of reporting it as a SQL error", async () => {
  const scripted = createScriptedSandboxDriver({ respond: () => connectionError("Connection terminated unexpectedly") });

  // Not a `DatabaseError` (no ErrorResponse ever came back), so this must
  // reject rather than resolve with `{ ok: false }` — see this function's
  // own docstring: only the statement's own fault becomes a reported SQL
  // error, everything else propagates for the route to turn into a
  // sandbox-level answer.
  await assert.rejects(
    scripted.driver.withClient((client: PoolClient) => executePracticeSql(client, "select 1")),
    /Connection terminated unexpectedly/,
  );
  // The connection still comes back to the pool — `withClient`'s `finally`
  // releases it regardless of how the callback failed.
  assert.equal(scripted.clientsOpen(), 0);
});

void test("executePracticeSql measures how long the attempt took, on both paths", async () => {
  let clock = 1000;
  const now = () => {
    const value = clock;
    clock += 7;
    return value;
  };

  const okScripted = createScriptedSandboxDriver({ respond: () => resultSet({ columns: ["n"], rows: [[1]] }) });
  const okExecution = await okScripted.driver.withClient((client) =>
    executePracticeSql(client, "select 1", { now }),
  );
  assert.equal(okExecution.durationMs, 7);

  const failScripted = createScriptedSandboxDriver({ respond: () => databaseError("boom") });
  const failExecution = await failScripted.driver.withClient((client) =>
    executePracticeSql(client, "select 1", { now }),
  );
  assert.equal(failExecution.durationMs, 7);
});

void test("toPracticeSqlError keeps only fields Postgres actually set, and survives non-Error throws", () => {
  assert.deepEqual(toPracticeSqlError(databaseError("syntax error at or near \";\"", { code: "42601" })), {
    message: 'syntax error at or near ";"',
    severity: "ERROR",
    code: "42601",
  });
  assert.deepEqual(toPracticeSqlError(Object.assign(new Error("plain"), { code: "" })), { message: "plain" });
  assert.deepEqual(toPracticeSqlError("not an error at all"), { message: "not an error at all" });
  // A driver reporting `position` as a number must not lose it.
  assert.equal(toPracticeSqlError(Object.assign(new Error("x"), { position: 12 })).position, "12");
});

void test("formatCell renders every Postgres value as display text, never as a lossy JSON value", () => {
  assert.equal(formatCell(null), null);
  assert.equal(formatCell(undefined), null);
  assert.equal(formatCell("text"), "text");
  assert.equal(formatCell(42), "42");
  assert.equal(formatCell(true), "true");
  // bigint/numeric beyond 2^53 — the reason cells are strings at all.
  assert.equal(formatCell(9007199254740993n), "9007199254740993");
  assert.equal(formatCell(new Date("2026-09-16T10:00:00.000Z")), "2026-09-16T10:00:00.000Z");
  assert.equal(formatCell(Buffer.from([0xde, 0xad])), "\\xdead");
  assert.equal(formatCell({ a: 1 }), '{"a":1}');
  assert.equal(formatCell([1, 2]), "[1,2]");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(typeof formatCell(circular), "string");
});

void test("rollbackOpenTransaction always issues a rollback and never propagates its failure", async () => {
  const scripted = createScriptedSandboxDriver({ respond: () => databaseError("no transaction in progress") });
  await scripted.driver.withClient(async (client) => {
    await rollbackOpenTransaction(client);
  });
  assert.deepEqual(scripted.texts(), ["rollback"]);
  assert.equal(scripted.clientsOpen(), 0);
});

void test("resetSandboxSession discards the attempt's session state, rollback first (DISCARD ALL cannot run in a transaction)", async () => {
  const scripted = createScriptedSandboxDriver({ respond: () => databaseError("cleanup failed too") });
  await scripted.driver.withClient(async (client) => {
    // Both statements fail here on purpose: cleanup runs on the way out and
    // must never replace the answer the user is waiting for.
    await resetSandboxSession(client);
  });
  assert.deepEqual(scripted.texts(), ["rollback", "discard all"]);
});
```

### services/backend/src/practice/execute.ts

```
// Running the user's own SQL in the practice sandbox.
//
// The product rule this file exists to honour, literally: "запрос выполняет
// backend в песочнице, результат или ошибка Postgres показываются как есть"
// (docs/product/business-logic.md). So:
//   - the statement text is handed to Postgres unchanged — never parsed,
//     rewritten, wrapped in a transaction, prefixed with a `set`, or
//     inspected for "dangerous" keywords. The sandbox role's own grants are
//     what make that safe (project invariant), not a blocklist here;
//   - a failing statement is NOT an error of this endpoint. It is a normal,
//     expected outcome of practising SQL, and the database's own words for it
//     (message, SQLSTATE `code`, `position`, `detail`, `hint`) are carried
//     out to the client verbatim.
//
// This module never opens a connection: it is handed a client that the
// sandbox driver checked out under the sandbox role (postgres-sandbox.ts's
// `withClient`). That is the only way the application-role pool cannot leak
// into practice execution by accident.

import { DatabaseError, type PoolClient } from "pg";

/** How many rows of a result set are sent to the client. A practice query
 * with a runaway cartesian join is the expected failure mode of a SQL
 * editor, not an edge case: the sandbox role's `statement_timeout` (30s,
 * docker/postgres/init/02-schemas.sql) bounds how long it runs, and this
 * bounds how much comes back. `rowCount` still reports the real total, and
 * `truncated` says out loud that there was more. */
export const MAX_RESULT_ROWS = 200;

export interface PracticeColumn {
  readonly name: string;
  /** Postgres type OID, passed through untouched — the client can use it to
   * right-align numerics and so on. Not translated to a type NAME here: that
   * would need a catalog lookup per query for something purely cosmetic. */
  readonly dataTypeId: number;
}

export interface PracticeResultSet {
  /** `SELECT`, `INSERT`, `CREATE TABLE`, ... as Postgres reports it. */
  readonly command?: string;
  /** Rows returned (SELECT) or affected (INSERT/UPDATE/DELETE) — the real
   * number, independent of `MAX_RESULT_ROWS` truncation below. `null` when
   * the statement has no row count (pg reports it that way for DDL). */
  readonly rowCount: number | null;
  readonly columns: readonly PracticeColumn[];
  /**
   * Rows as ARRAYS of cells, positionally matching `columns`, never objects
   * keyed by column name: `select 1 as a, 2 as a` is valid SQL, and an
   * object would silently drop one of the two columns (pg's default row
   * shape does exactly that). A result grid must show what was actually
   * returned.
   *
   * Every cell is a string, or `null` for SQL NULL — see `formatCell` for
   * why the parsed JS value isn't sent instead.
   */
  readonly rows: readonly (readonly (string | null)[])[];
  /** `true` when the result had more rows than were sent. */
  readonly truncated: boolean;
  /** How many statements the submitted SQL turned out to be. Postgres runs
   * `a; b; c` as one simple query and answers with one result per statement;
   * only the LAST one is reported above (a grid shows one result), and this
   * tells the client the other ones ran too. */
  readonly statementCount: number;
}

/** A Postgres error, as Postgres described it. Field names and values are
 * the driver's own (`pg`'s `DatabaseError`), not a re-interpretation. */
export interface PracticeSqlError {
  readonly message: string;
  readonly severity?: string;
  /** SQLSTATE, e.g. `42P01` for "relation does not exist". */
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
  /** 1-based character offset into the submitted SQL, as a string (that is
   * how the wire protocol and `pg` report it) — an editor uses it to put the
   * caret on the offending token. */
  readonly position?: string;
  readonly where?: string;
}

export type PracticeExecution =
  | { readonly ok: true; readonly result: PracticeResultSet; readonly durationMs: number }
  | { readonly ok: false; readonly error: PracticeSqlError; readonly durationMs: number };

export interface ExecutePracticeSqlOptions {
  readonly maxRows?: number;
  /** Injectable monotonic-ish clock, so a test can assert on `durationMs`
   * without sleeping. */
  readonly now?: () => number;
}

/**
 * Runs `sql` on an already-checked-out sandbox client and returns either the
 * result set or the database's error — this function does not throw for SQL
 * problems. It only propagates failures that are not the statement's fault
 * (the connection dying mid-query, say), which the route turns into a
 * sandbox-level answer.
 *
 * No `statement_timeout` is set here: the sandbox ROLE carries it
 * server-side (02-schemas.sql), so it applies to every connection that role
 * ever opens, including ones this code path knows nothing about. Setting it
 * again per query would be a second source of truth for the same limit.
 */
export async function executePracticeSql(
  client: PoolClient,
  sql: string,
  options: ExecutePracticeSqlOptions = {},
): Promise<PracticeExecution> {
  const maxRows = options.maxRows ?? MAX_RESULT_ROWS;
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();
  try {
    // `rowMode: "array"` — see `PracticeResultSet.rows`. No `values` are
    // passed on purpose: with none, `pg` uses the simple query protocol,
    // which is what lets a user submit several statements at once the way
    // any SQL client would.
    const raw: unknown = await client.query({ text: sql, rowMode: "array" });
    return { ok: true, result: toResultSet(raw, maxRows), durationMs: clock() - startedAt };
  } catch (err) {
    // `DatabaseError` is `pg`'s own class for "the server answered with an
    // ErrorResponse" — a real verdict on the submitted statement (syntax
    // error, missing table, permission). Anything else reaching here (the
    // connection dying mid-query, a timeout, a socket error) is not the
    // statement's fault and must not be dressed up as one: it is rethrown so
    // the caller — which knows it is holding a SANDBOX connection, this
    // function does not — can answer with a sandbox-level failure instead of
    // telling the learner their SQL was wrong.
    if (!(err instanceof DatabaseError)) {
      throw err;
    }
    return { ok: false, error: toPracticeSqlError(err), durationMs: clock() - startedAt };
  }
}

/**
 * Ends any transaction the attempt left behind, so the connection can go
 * back to the pool clean and the next statement on it (the course's check
 * query) starts from a known state.
 *
 * Two cases make this mandatory, not hygiene:
 *   - the user submitted `begin;` without committing — the next user of that
 *     pooled connection would inherit an open transaction;
 *   - the statement failed inside an (implicit or explicit) transaction —
 *     Postgres then rejects EVERY further command with "current transaction
 *     is aborted", including the check query.
 *
 * A bare `rollback` outside a transaction is a no-op that emits a notice,
 * not an error, so this needs no "are we in a transaction?" probe. Failures
 * are swallowed deliberately: this runs on the way out, and its error must
 * never replace the result or the SQL error the user is waiting for.
 */
export async function rollbackOpenTransaction(client: PoolClient): Promise<void> {
  await quietly(client, "rollback");
}

/**
 * Returns a connection to the pool in the state it was handed over in, after
 * the attempt AND the check are done with it.
 *
 * The user's SQL is arbitrary, which includes session-level `SET`s: a
 * submission ending in `set statement_timeout = 0` would otherwise keep that
 * setting on the pooled connection for whoever gets it next — quietly
 * removing the sandbox role's own guard against a runaway query holding a
 * connection forever (docker/postgres/init/02-schemas.sql). `DISCARD ALL`
 * resets exactly that class of leftovers (session settings, prepared
 * statements, temp tables, advisory locks) and is the reason this is not
 * simply another `rollback`.
 *
 * It runs LAST, never between the attempt and the check: the check grades
 * the session the attempt left behind, temp tables included. And it must run
 * outside a transaction block (Postgres rejects `DISCARD ALL` inside one),
 * which is why the rollback comes first.
 */
export async function resetSandboxSession(client: PoolClient): Promise<void> {
  await quietly(client, "rollback");
  await quietly(client, "discard all");
}

/** Runs a cleanup statement whose failure must never replace the result (or
 * the SQL error) the user is waiting for. */
async function quietly(client: PoolClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch {
    // Nothing useful to do: the connection is being released either way.
  }
}

/** `pg`'s error fields, copied out untouched. Anything absent stays absent
 * rather than becoming an empty string, so a client can tell "Postgres said
 * nothing about this" from "Postgres said ''". */
export function toPracticeSqlError(err: unknown): PracticeSqlError {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const fields = err as unknown as Record<string, unknown>;
  const error: { -readonly [K in keyof PracticeSqlError]: PracticeSqlError[K] } = { message: err.message };
  for (const key of ["severity", "code", "detail", "hint", "position", "where"] as const) {
    const value = optionalText(fields[key]);
    if (value !== undefined) {
      error[key] = value;
    }
  }
  return error;
}

/**
 * One cell, rendered for display. Every value becomes a string (or `null`
 * for SQL NULL) instead of being passed through as whatever JS value `pg`
 * parsed it into.
 *
 * Why not the parsed value: JSON has no way to carry most of what Postgres
 * returns without lying about it — a `bigint` beyond 2^53 loses digits as a
 * JSON number, `numeric` already arrives as a string, a `timestamptz`
 * arrives as a `Date` whose JSON form depends on the server's timezone
 * handling, and `bytea` arrives as a Buffer that JSON.stringify turns into
 * `{"type":"Buffer","data":[...]}`. A SQL result grid shows text; making
 * that explicit keeps the wire format honest (and lets the response schema
 * declare it, instead of an untyped "any").
 */
export function formatCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    // Postgres' own `bytea` output format, so it reads the way `psql` would
    // show it.
    return `\\x${value.toString("hex")}`;
  }
  try {
    // json/jsonb columns and Postgres arrays arrive as parsed JS values.
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular/unstringifiable — never let a cell take the whole response
    // down.
    return String(value);
  }
}

/** `pg` answers a multi-statement simple query with an ARRAY of results (one
 * per statement) and a single-statement one with a bare result. Both are
 * normalized here; everything is read defensively, because this is the one
 * place where a driver-shape surprise would otherwise crash a route. */
function toResultSet(raw: unknown, maxRows: number): PracticeResultSet {
  const results = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  const last = results.length === 0 ? undefined : results[results.length - 1];
  const record = isRecord(last) ? last : {};

  const fields = Array.isArray(record.fields) ? (record.fields as unknown[]) : [];
  const columns: PracticeColumn[] = fields.map((field, index) => {
    const fieldRecord = isRecord(field) ? field : {};
    return {
      name: typeof fieldRecord.name === "string" ? fieldRecord.name : `column${index + 1}`,
      dataTypeId: typeof fieldRecord.dataTypeID === "number" ? fieldRecord.dataTypeID : 0,
    };
  });

  const rawRows = Array.isArray(record.rows) ? (record.rows as unknown[]) : [];
  const rows = rawRows
    .slice(0, maxRows)
    .map((row) => (Array.isArray(row) ? (row as unknown[]) : [row]).map(formatCell));

  return {
    ...(typeof record.command === "string" ? { command: record.command } : {}),
    rowCount: typeof record.rowCount === "number" ? record.rowCount : null,
    columns,
    rows,
    truncated: rawRows.length > maxRows,
    statementCount: Math.max(results.length, 1),
  };
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.length === 0 ? undefined : value;
  }
  if (typeof value === "number") {
    // `position` comes back as a string from the wire protocol, but a driver
    // (or a test double) handing over a number must not silently drop it.
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

### services/backend/src/practice/testSupport.ts

```
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
```

### services/backend/src/routes/practice.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import {
  checkResult,
  connectionError,
  databaseError,
  dualGateManifestYaml,
  DUAL_GATE_LESSON_ID,
  resultSet,
  withPracticeApp,
  type ScriptedAnswer,
} from "../practice/testSupport.js";
import {
  completedRecord,
  FIXTURE_COURSE_ID,
  FIXTURE_PRACTICE_LESSON_ID,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_UNCHECKED_PRACTICE_LESSON_ID,
} from "../progress/testSupport.js";

/** The `check` the fixture course declares for its graded practice lesson —
 * the text that must never appear in any response. */
const FIXTURE_CHECK_SQL = "select count(*) = 1 from t";
const RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_PRACTICE_LESSON_ID}/practice/run`;
const SELF_MARKED_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_UNCHECKED_PRACTICE_LESSON_ID}/practice/run`;

/** Answers the user's statement with `answer` and the course's check query
 * with `verdict`; everything else (the `rollback`s) gets an empty result. */
function script(answer: ScriptedAnswer, verdict?: ScriptedAnswer): (text: string) => ScriptedAnswer {
  return (text: string) => {
    if (text === FIXTURE_CHECK_SQL) {
      return verdict ?? checkResult(false);
    }
    if (text === "rollback" || text === "discard all") {
      return resultSet({ command: text.toUpperCase(), columns: [], rows: [], rowCount: null });
    }
    return answer;
  };
}

void test("POST practice/run executes the user's SQL in the sandbox and returns the result grid", async () => {
  await withPracticeApp(
    async ({ app, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: RUN_URL,
        payload: { sql: "select id from t order by id" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.deepEqual(body.result.columns, [{ name: "id", dataTypeId: 23 }]);
      assert.deepEqual(body.result.rows, [["1"]]);
      assert.equal(body.result.rowCount, 1);
      assert.equal(body.result.truncated, false);
      assert.equal(typeof body.durationMs, "number");

      // The sandbox was prepared before the statement ran, and the user's
      // text reached the database unchanged.
      assert.equal(sandbox.provisionCalls(), 1);
      assert.deepEqual(sandbox.texts(), [
        "select id from t order by id",
        // The attempt may have left a transaction open (or aborted) — the
        // check must not inherit it.
        "rollback",
        FIXTURE_CHECK_SQL,
        // Nothing of this request's session state (a `set statement_timeout`
        // the submission ended with, a temp table) rides the pooled
        // connection into the next one.
        "rollback",
        "discard all",
      ]);
      // No sandbox connection left checked out.
      assert.equal(sandbox.clientsOpen(), 0);
    },
    { respond: script(resultSet({ columns: ["id"], rows: [[1]] }), checkResult(true)) },
  );
});

void test("POST practice/run completes the lesson when the course's check passes", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "insert into t values (1)" } });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.deepEqual(body.check, { present: true, passed: true });
      assert.equal(body.lesson.id, FIXTURE_PRACTICE_LESSON_ID);
      assert.equal(body.lesson.status, "completed");
      assert.equal(body.lesson.completionMode, "practice");
      assert.equal(typeof body.lesson.completedAt, "string");
      assert.equal(body.course.completedLessons, 1);
      assert.equal(body.course.totalLessons, 4);
      assert.equal(body.course.completed, false);

      const stored = progress.records();
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.lessonId, FIXTURE_PRACTICE_LESSON_ID);
      assert.equal(stored[0]?.courseVersion, "1.0.0");
    },
    { respond: script(resultSet({ command: "INSERT", columns: [], rows: [], rowCount: 1 }), checkResult(true)) },
  );
});

void test("POST practice/run records nothing when the check says the exercise isn't done", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      const body = response.json();
      assert.deepEqual(body.check, { present: true, passed: false });
      assert.equal(body.lesson.status, "not_started");
      assert.equal(body.course.completedLessons, 0);
      assert.deepEqual(progress.records(), []);
    },
    { respond: script(resultSet({ columns: ["?column?"], rows: [[1]] }), checkResult(false)) },
  );
});

void test("POST practice/run answers 200 with Postgres' own error when the user's SQL is wrong", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select * from widgts" } });

      // A wrong statement is what practising SQL looks like — not an API
      // error (the same call routes/quiz.ts makes for a wrong answer).
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.ok, false);
      assert.equal(body.result, undefined);
      assert.deepEqual(body.error, {
        message: 'relation "widgts" does not exist',
        severity: "ERROR",
        code: "42P01",
        position: "15",
      });
      // The check still runs: it grades the state of the sandbox, not the
      // statement that just failed — and the aborted transaction the failure
      // left behind is rolled back first, or the check could not run at all.
      assert.deepEqual(sandbox.texts(), [
        "select * from widgts",
        "rollback",
        FIXTURE_CHECK_SQL,
        "rollback",
        "discard all",
      ]);
      assert.deepEqual(body.check, { present: true, passed: false });
      assert.deepEqual(progress.records(), []);
    },
    {
      respond: script(
        databaseError('relation "widgts" does not exist', { code: "42P01", position: "15" }),
        checkResult(false),
      ),
    },
  );
});

void test("POST practice/run answers 503 sandbox-unavailable, not a 200 SQL error, when the sandbox connection dies mid-query", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      // A dropped connection is an infrastructure fault, not "practising SQL
      // looks like this" (that is the 200 `ok: false` case, covered above)
      // and not broken course content (422 `check_failed`) — it is answered
      // the same way any other unreachable sandbox is.
      assert.equal(response.statusCode, 503);
      const body = response.json();
      assert.equal(body.error, "unavailable");
      assert.match(body.message, /Connection terminated unexpectedly/);
      // The check query never ran against the dead connection, so it was
      // never at risk of being misreported as the broken thing — only the
      // failed attempt and the unconditional session cleanup (which quietly
      // swallows its own failures) were issued.
      assert.deepEqual(sandbox.texts(), ["select 1", "rollback", "discard all"]);
      assert.deepEqual(progress.records(), []);
    },
    { respond: script(connectionError("Connection terminated unexpectedly")) },
  );
});

void test("POST practice/run on a lesson without a check reports it as self-marked and completes nothing", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: SELF_MARKED_RUN_URL,
        payload: { sql: "select 1" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      // No verdict exists, so `passed` is absent rather than `false`.
      assert.deepEqual(body.check, { present: false });
      assert.equal(body.lesson.completionMode, "manual");
      assert.equal(body.lesson.status, "not_started");
      assert.deepEqual(progress.records(), []);
      // No check query was issued at all — and the session is still reset
      // before the connection goes back to the pool.
      assert.deepEqual(sandbox.texts(), ["select 1", "rollback", "discard all"]);

      // "Задание без check — самоотметка" (project invariant): the existing
      // completion endpoint is what finishes such a lesson, and it accepts.
      const marked = await app.inject({
        method: "POST",
        url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_UNCHECKED_PRACTICE_LESSON_ID}/complete`,
      });
      assert.equal(marked.statusCode, 200);
      assert.equal(marked.json().lesson.status, "completed");
      assert.equal(progress.records().length, 1);
    },
    { respond: script(resultSet({ columns: ["?column?"], rows: [[1]] })) },
  );
});

void test("POST practice/run never lets the check query out — not on success, not on a broken check", async () => {
  await withPracticeApp(
    async ({ app }) => {
      const ok = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });
      assert.doesNotMatch(ok.body, /count\(\*\)|from t\b/);
    },
    { respond: script(resultSet({ columns: ["n"], rows: [[1]] }), checkResult(true)) },
  );

  await withPracticeApp(
    async ({ app }) => {
      const broken = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      assert.equal(broken.statusCode, 422);
      const body = broken.json();
      assert.equal(body.error, "check_contract_violation");
      assert.match(body.message, /returned 2 rows/);
      assert.doesNotMatch(broken.body, /count\(\*\)|from t\b/);
    },
    {
      respond: script(
        resultSet({ columns: ["n"], rows: [[1]] }),
        resultSet({ columns: ["passed"], rows: [[true], [true]] }),
      ),
    },
  );
});

void test("POST practice/run answers 422 with the database's words when the check query itself is broken", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      assert.equal(response.statusCode, 422);
      const body = response.json();
      assert.equal(body.error, "check_failed");
      assert.equal(body.databaseError, 'relation "t" does not exist');
      assert.deepEqual(progress.records(), []);
    },
    {
      respond: script(
        resultSet({ columns: ["n"], rows: [[1]] }),
        databaseError('relation "t" does not exist', { code: "42P01" }),
      ),
    },
  );
});

void test("POST practice/run reports a passing check but does not complete a lesson gated by its quiz", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({
        method: "POST",
        url: `/courses/${FIXTURE_COURSE_ID}/lessons/${DUAL_GATE_LESSON_ID}/practice/run`,
        payload: { sql: "select 1" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      // The verdict is reported honestly...
      assert.deepEqual(body.check, { present: true, passed: true });
      // ...but one lesson has exactly one gate, and this one's is the quiz
      // (progress/model.ts) — the same rule that makes `POST .../complete`
      // answer 409 here.
      assert.equal(body.lesson.completionMode, "quiz");
      assert.equal(body.lesson.status, "not_started");
      assert.deepEqual(progress.records(), []);
    },
    {
      manifestYaml: dualGateManifestYaml(),
      respond: script(resultSet({ columns: ["n"], rows: [[1]] }), checkResult(true)),
    },
  );
});

void test("POST practice/run prepares the sandbox once and keeps a repeat pass idempotent", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const first = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });
      const firstCompletedAt = first.json().lesson.completedAt;
      const second = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      assert.equal(second.statusCode, 200);
      // `ensure()` is idempotent: re-seeding on every run would wipe the
      // tables the learner just created.
      assert.equal(sandbox.provisionCalls(), 1);
      assert.equal(second.json().lesson.completedAt, firstCompletedAt);
      assert.equal(progress.records().length, 1);
      assert.equal(sandbox.clientsOpen(), 0);
    },
    { respond: script(resultSet({ columns: ["n"], rows: [[1]] }), checkResult(true)) },
  );
});

void test("POST practice/run never un-completes a lesson a later failing attempt contradicts", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "delete from t" } });

      assert.deepEqual(response.json().check, { present: true, passed: false });
      // Still completed: a passed lesson never un-passes (progress model).
      assert.equal(response.json().lesson.status, "completed");
      assert.equal(progress.records().length, 1);
    },
    {
      seed: [completedRecord(FIXTURE_PRACTICE_LESSON_ID)],
      respond: script(resultSet({ command: "DELETE", columns: [], rows: [], rowCount: 1 }), checkResult(false)),
    },
  );
});

void test("POST practice/run rejects a request that names no practice to run", async () => {
  await withPracticeApp(async ({ app, sandbox }) => {
    const unknownCourse = await app.inject({
      method: "POST",
      url: "/courses/nope/lessons/whatever/practice/run",
      payload: { sql: "select 1" },
    });
    assert.equal(unknownCourse.statusCode, 404);
    assert.equal(unknownCourse.json().error, "course_not_found");

    const unknownLesson = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/nope/practice/run`,
      payload: { sql: "select 1" },
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");

    const noPractice = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_QUIZ_LESSON_ID}/practice/run`,
      payload: { sql: "select 1" },
    });
    assert.equal(noPractice.statusCode, 404);
    assert.equal(noPractice.json().error, "practice_not_found");

    // None of the three reached the sandbox.
    assert.equal(sandbox.provisionCalls(), 0);
    assert.deepEqual(sandbox.texts(), []);
  });
});

void test("POST practice/run validates the submitted SQL before touching the sandbox", async () => {
  await withPracticeApp(async ({ app, sandbox }) => {
    for (const payload of [{}, { sql: "" }, { sql: "   \n\t " }]) {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload });
      assert.equal(response.statusCode, 400, `expected 400 for ${JSON.stringify(payload)}`);
    }
    const tooLong = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "s".repeat(50001) } });
    assert.equal(tooLong.statusCode, 400);
    assert.deepEqual(sandbox.texts(), []);
  });
});

void test("POST practice/run ignores fields the body schema doesn't declare", async () => {
  await withPracticeApp(
    async ({ app, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: RUN_URL,
        // Fastify's ajv runs with `removeAdditional`, so an undeclared field
        // is stripped rather than rejected — what matters is that it never
        // reaches the database.
        payload: { sql: "select 1", check: "select true", sandboxId: "other" },
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(sandbox.texts(), ["select 1", "rollback", FIXTURE_CHECK_SQL, "rollback", "discard all"]);
    },
    { respond: script(resultSet({ columns: ["n"], rows: [[1]] }), checkResult(false)) },
  );
});

void test("POST practice/run answers 503 with a stated reason when no sandbox is configured", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      assert.equal(response.statusCode, 503);
      const body = response.json();
      assert.equal(body.error, "unavailable");
      assert.match(body.message, /not configured/);
      assert.deepEqual(progress.records(), []);
    },
    { configured: false },
  );
});
```

### services/backend/src/routes/practice.ts

```
// Practice API: run the learner's SQL in the course's sandbox and, when the
// course provided a check query, grade the attempt with it.
//
// The whole practice loop is ONE request (business-logic.md: "запрос
// выполняет backend в песочнице, результат или ошибка Postgres показываются
// как есть. Задание может нести check-запрос в manifest'е — после попытки
// движок выполняет его и трактует ответ как «зачтено/не зачтено»"): prepare
// the sandbox, run the user's SQL, run the check, record the completion.
// Splitting it would let a client run the check without an attempt, or show
// a result that a later check contradicts.
//
// Three things this endpoint deliberately does NOT do:
//   - it does not treat a failing statement as an API error. A syntax error
//     is what practising SQL looks like; it comes back 200 with `ok: false`
//     and Postgres' own words (same shape of decision as a wrong quiz
//     answer, which is also a 200);
//   - it does not complete lessons whose gate is not the practice check —
//     see `lessonCompletionMode` below;
//   - it does not expose the check query, its text, or its result shape. The
//     client learns one bit: passed or not.
//
// "Задание без check — самоотметка" (project invariant) needs no code here:
// such a lesson's completion mode is `manual`, so the existing
// `POST /courses/:courseId/lessons/:lessonId/complete` (task 007) is what
// completes it. This endpoint reports `check: { present: false }` so the UI
// knows to offer that button instead of waiting for a verdict.

import type { FastifyInstance } from "fastify";

import {
  executePracticeSql,
  resetSandboxSession,
  rollbackOpenTransaction,
  type PracticeExecution,
} from "../practice/execute.js";
import { isPracticeCheckError, runPracticeCheck, type PracticeCheckVerdict } from "../practice/check.js";
import { findLesson, lessonCompletionMode } from "../progress/model.js";
import { isSandboxError, SandboxError } from "../sandbox/types.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  sendCourseNotFound,
  sendLessonNotFound,
  toLessonCompletionPayload,
} from "./progress.js";
import { sendSandboxError } from "./sandbox.js";

export default async function practiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { sql: string } }>(
    "/courses/:courseId/lessons/:lessonId/practice/run",
    {
      schema: {
        params: lessonParamsSchema,
        body: practiceRunBodySchema,
        response: {
          200: practiceRunResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          422: practiceErrorResponseSchema,
          503: practiceErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      const location = findLesson(course, request.params.lessonId);
      if (location === undefined) {
        return sendLessonNotFound(reply, course.id, request.params.lessonId);
      }
      const practice = location.lesson.practice;
      if (practice === undefined) {
        return reply.code(404).send({
          error: "practice_not_found",
          message: `Lesson "${location.lesson.id}" of course "${course.id}" has no practice assignment.`,
        });
      }

      let execution: PracticeExecution;
      let verdict: PracticeCheckVerdict | undefined;
      try {
        // Idempotent: the first practice request of a course pays for the
        // seed, later ones don't — re-seeding on every run would wipe the
        // tables the learner just created, mid-exercise.
        await fastify.sandbox.ensure(course.id, practice.sandbox);

        // One client for the attempt AND the check, so the check grades the
        // session the attempt left behind (temp tables and all) rather than
        // some other pooled connection's view.
        const attempt = await fastify.sandbox.driver.withClient(async (client) => {
          try {
            const executed = await executePracticeSql(client, request.body.sql);
            if (practice.check === undefined) {
              return { executed, checked: undefined };
            }
            // Before the check, not after: an attempt that failed inside a
            // transaction leaves the session in the "current transaction is
            // aborted" state, where the check query cannot run at all, and
            // an attempt that opened a transaction and never closed it must
            // not have its uncommitted work graded as if it were durable.
            await rollbackOpenTransaction(client);
            const checked = await runPracticeCheck(client, {
              sql: practice.check,
              courseId: course.id,
              lessonId: location.lesson.id,
            });
            return { executed, checked };
          } finally {
            // Whatever happened — a broken check throwing included — the
            // connection goes back to the pool carrying none of this
            // request's session state (see `resetSandboxSession`).
            await resetSandboxSession(client);
          }
        });
        execution = attempt.executed;
        verdict = attempt.checked;
      } catch (err) {
        if (isPracticeCheckError(err)) {
          // Broken check query — course content, not a failed attempt. Same
          // class (and status) as a seed file the database rejects.
          request.log.warn({ err }, "practice check query is broken");
          return reply.code(422).send({
            error: err.kind,
            message: err.message,
            ...(err.databaseError === undefined ? {} : { databaseError: err.databaseError }),
          });
        }
        // executePracticeSql (practice/execute.ts) rethrows exactly here:
        // when the failure it caught was not the submitted statement's own
        // fault (its docstring's example is the sandbox connection dying
        // mid-query). Such a failure is not course content and not a wrong
        // answer, so it must not reach the learner as `ok: false` — it is
        // reported the same way any other unreachable sandbox is
        // (`unavailable`, 503), carrying the underlying error's own words.
        const sandboxErr = isSandboxError(err)
          ? err
          : new SandboxError(
              "unavailable",
              `The practice sandbox connection failed: ${err instanceof Error ? err.message : String(err)}.`,
              { cause: err },
            );
        return sendSandboxError(request, reply, sandboxErr);
      }

      // A lesson carrying both a quiz and a checked practice is gated by its
      // quiz (progress/model.ts: one lesson, one gate). The verdict is still
      // reported honestly — the learner sees whether the exercise is right —
      // but completing the lesson stays the quiz's job, exactly as
      // `POST .../complete` refuses to do it by hand.
      if (verdict?.passed === true && lessonCompletionMode(location.lesson) === "practice") {
        // Idempotent (task 007): passing a second time never moves
        // `completedAt`, and a later failed attempt never un-completes.
        await fastify.progress.markLessonCompleted({
          courseId: course.id,
          lessonId: location.lesson.id,
          courseVersion: course.version,
        });
      }

      const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
      return {
        ok: execution.ok,
        ...(execution.ok ? { result: execution.result } : { error: execution.error }),
        durationMs: execution.durationMs,
        check:
          practice.check === undefined
            ? { present: false }
            : { present: true, passed: verdict?.passed === true },
        ...payload,
      };
    },
  );
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const practiceRunBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sql"],
  properties: {
    sql: {
      type: "string",
      // `pattern` is an unanchored search: this rejects whitespace-only
      // submissions (which Postgres would happily accept as an empty
      // command, answering with a resultless result nobody can read) while
      // leaving every real statement alone.
      pattern: "\\S",
      minLength: 1,
      // Generous for a single exercise, finite for a local editor. Well
      // under Fastify's own 1MB body limit, so an oversized submission is
      // rejected as a validation error naming the field rather than as a
      // transport error.
      maxLength: 50000,
    },
  },
} as const;

const practiceColumnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "dataTypeId"],
  properties: { name: { type: "string" }, dataTypeId: { type: "integer" } },
} as const;

const practiceResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rowCount", "columns", "rows", "truncated", "statementCount"],
  properties: {
    command: { type: "string" },
    // Nullable on purpose: Postgres reports no row count for some commands,
    // and `0` would be a different (wrong) claim.
    rowCount: { type: ["integer", "null"] },
    columns: { type: "array", items: practiceColumnSchema },
    // Positional cells, `null` for SQL NULL — see practice/execute.ts's
    // `PracticeResultSet.rows`/`formatCell`.
    rows: { type: "array", items: { type: "array", items: { type: ["string", "null"] } } },
    truncated: { type: "boolean" },
    statementCount: { type: "integer" },
  },
} as const;

const practiceSqlErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string" },
    severity: { type: "string" },
    code: { type: "string" },
    detail: { type: "string" },
    hint: { type: "string" },
    position: { type: "string" },
    where: { type: "string" },
  },
} as const;

const practiceCheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["present"],
  properties: {
    // `false` means the course set no check for this lesson: the lesson is
    // self-marked (invariant), and no verdict exists — which is why `passed`
    // is absent rather than `false` in that case.
    present: { type: "boolean" },
    passed: { type: "boolean" },
  },
} as const;

const practiceRunResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "durationMs", "check", "lesson", "course"],
  properties: {
    ok: { type: "boolean" },
    result: practiceResultSchema,
    error: practiceSqlErrorSchema,
    durationMs: { type: "integer" },
    check: practiceCheckSchema,
    // The same `{ lesson, course }` pair the other write endpoints answer
    // with (routes/progress.ts, routes/quiz.ts), so a client redraws the
    // lesson's status and the course counters from one response.
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;

// `errorResponseSchema` plus the database's own words, for a check query the
// database rejected — the same extra field routes/sandbox.ts exposes for a
// rejected seed. The check's TEXT is never part of it.
const practiceErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    seedFile: { type: "string" },
    databaseError: { type: "string" },
  },
} as const;
```

