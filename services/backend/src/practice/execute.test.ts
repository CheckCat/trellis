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
} from "./test-support.js";

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

void test("executePracticeSql retains grading rows only when asked, past the display cap", async () => {
  const rows = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, index) => [index]);
  const answer = (): ScriptedAnswer => resultSet({ columns: ["n"], rows, rowCount: rows.length });

  // Nothing grades this attempt: no rows are kept beyond the grid.
  const ungraded = await execute(answer);
  assert.ok(ungraded.execution.ok);
  assert.equal(ungraded.execution.grading, undefined);

  // With a grading cap, the full result is available to the comparator
  // while the client's grid stays capped at MAX_RESULT_ROWS.
  const graded = await execute(answer, "select n from t", { gradingRows: 1000 });
  assert.ok(graded.execution.ok);
  assert.equal(graded.execution.result.rows.length, MAX_RESULT_ROWS);
  assert.equal(graded.execution.grading?.rows.length, MAX_RESULT_ROWS + 5);
  assert.equal(graded.execution.grading?.totalRows, MAX_RESULT_ROWS + 5);
  assert.deepEqual(graded.execution.grading?.rows[MAX_RESULT_ROWS + 4], [String(MAX_RESULT_ROWS + 4)]);
});

void test("executePracticeSql reports the true row count even when the grading cap truncates", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => [index]);
  const { execution } = await execute(
    () => resultSet({ columns: ["n"], rows, rowCount: rows.length }),
    "select n from t",
    { gradingRows: 5 },
  );

  assert.ok(execution.ok);
  // `totalRows` is what a comparison rejects an oversized result on — it
  // must not be the number of rows that happened to be kept.
  assert.equal(execution.grading?.rows.length, 5);
  assert.equal(execution.grading?.totalRows, 20);
});
