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

void test("runPracticeCheck describes a timestamp verdict as \"a timestamp\", not typeof's generic \"object\" (edge case, task 012)", async () => {
  const timestamp = await check(() => resultSet({ columns: ["passed"], rows: [[new Date("2026-01-01T00:00:00.000Z")]] }));
  assertViolation(timestamp.error, "a timestamp");
});

void test("runPracticeCheck describes an array-typed verdict as \"an array\", not typeof's generic \"object\" (edge case, task 012)", async () => {
  const arrayValue = await check(() => resultSet({ columns: ["passed"], rows: [[[1, 2, 3]]] }));
  assertViolation(arrayValue.error, "an array");
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
