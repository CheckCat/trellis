import assert from "node:assert/strict";
import test from "node:test";

import type { CourseSqlPractice } from "../courses/types.js";
import type { FreshSandboxContext } from "../sandbox/types.js";
import { checkResult, createScriptedSandboxDriver, databaseError, resultSet } from "./test-support.js";
import { evaluateSqlPracticeAttempt, runSqlPracticeAttempt, type SqlPracticeAttemptResult } from "./run-sql.js";

const CONTEXT = { courseId: "fixture-course", lessonId: "fixture-lesson" };

function practiceWith(overrides: Partial<CourseSqlPractice>): CourseSqlPractice {
  return { type: "sql", prompt: "Do the thing.", sandbox: "main", ...overrides };
}

/** A `FreshSandboxContext` whose `reseed` is just observable, not a real
 * provisioner — `runSqlPracticeAttempt` never reads `.state`. */
function freshSandboxContext(): FreshSandboxContext & { reseedCalls: number } {
  const ctx = {
    state: {} as FreshSandboxContext["state"],
    reseedCalls: 0,
    async reseed() {
      ctx.reseedCalls += 1;
      return ctx.state;
    },
  };
  return ctx;
}

void test("runSqlPracticeAttempt: no mechanic declared runs the statement and grades nothing", async () => {
  const sandbox = createScriptedSandboxDriver({ respond: () => resultSet({ columns: ["id"], rows: [[1]] }) });
  const fresh = freshSandboxContext();

  const attempt = await runSqlPracticeAttempt(sandbox.driver, practiceWith({}), "select 1", CONTEXT, fresh);

  assert.equal(attempt.executed.ok, true);
  assert.equal(attempt.checked, undefined);
  assert.equal(attempt.compared, undefined);
  assert.equal(attempt.stated, undefined);
  // No reference to read and nothing to grade — just the learner's
  // statement, then the unconditional session reset before the connection
  // goes back to the pool.
  assert.deepEqual(sandbox.texts(), ["select 1", "rollback", "discard all"]);
  assert.equal(fresh.reseedCalls, 0);
  assert.equal(sandbox.clientsOpen(), 0);
});

void test("runSqlPracticeAttempt: check-only reads no reference, rolls back, then runs the check", async () => {
  const CHECK_SQL = "select count(*) = 1 from t";
  const sandbox = createScriptedSandboxDriver({
    respond: (text) => {
      if (text === CHECK_SQL) return checkResult(true);
      if (text === "rollback" || text === "discard all") {
        return resultSet({ command: text.toUpperCase(), columns: [], rows: [], rowCount: null });
      }
      return resultSet({ command: "INSERT", columns: [], rows: [], rowCount: 1 });
    },
  });
  const fresh = freshSandboxContext();

  const attempt = await runSqlPracticeAttempt(
    sandbox.driver,
    practiceWith({ check: CHECK_SQL }),
    "insert into t values (1)",
    CONTEXT,
    fresh,
  );

  assert.equal(attempt.checked?.passed, true);
  assert.equal(attempt.compared, undefined);
  assert.equal(attempt.stated, undefined);
  // The learner's statement first, then a defensive rollback before grading
  // (an aborted/open transaction must not leak into the check), then the
  // check itself, then the unconditional session reset. No reference read
  // happened — `check` alone needs none.
  assert.deepEqual(sandbox.texts(), ["insert into t values (1)", "rollback", CHECK_SQL, "rollback", "discard all"]);
  assert.equal(fresh.reseedCalls, 0);
  assert.equal(sandbox.clientsOpen(), 0);
});

void test("runSqlPracticeAttempt: check-only does not run the check when the learner's statement errored", async () => {
  const CHECK_SQL = "select count(*) = 1 from t";
  let checkRan = false;
  const sandbox = createScriptedSandboxDriver({
    respond: (text) => {
      if (text === CHECK_SQL) {
        checkRan = true;
        return checkResult(true);
      }
      if (text === "rollback" || text === "discard all") {
        return resultSet({ command: text.toUpperCase(), columns: [], rows: [], rowCount: null });
      }
      return databaseError('syntax error at or near "widgts"');
    },
  });
  const fresh = freshSandboxContext();

  const attempt = await runSqlPracticeAttempt(
    sandbox.driver,
    practiceWith({ check: CHECK_SQL }),
    "select * from widgts",
    CONTEXT,
    fresh,
  );

  assert.equal(attempt.executed.ok, false);
  // Grading (the rollback-then-check sequence) still runs even for a wrong
  // statement — `check` answers "did you leave the DATABASE right", which a
  // syntax error trivially can (nothing changed). Only `expected` skips
  // grading on a failed statement, because it has no rows to compare.
  assert.equal(checkRan, true);
  assert.equal(attempt.checked?.passed, true);
});

void test("runSqlPracticeAttempt: expected-only does not compare when the learner's statement errored", async () => {
  const EXPECTED_SQL = "select a from ref";
  const sandbox = createScriptedSandboxDriver({
    respond: (text) => {
      // The reference read wraps in its own read-only transaction
      // (practice/compare.ts) — it must succeed so the failure below is
      // unambiguously the LEARNER's statement, not the reference's.
      if (text === "begin transaction read only") {
        return resultSet({ command: "BEGIN", columns: [], rows: [], rowCount: null });
      }
      if (text === EXPECTED_SQL) return resultSet({ columns: ["a"], rows: [[1]] });
      if (text === "rollback" || text === "discard all") {
        return resultSet({ command: text.toUpperCase(), columns: [], rows: [], rowCount: null });
      }
      return databaseError("syntax error");
    },
  });
  const fresh = freshSandboxContext();

  const attempt = await runSqlPracticeAttempt(
    sandbox.driver,
    practiceWith({ expected: EXPECTED_SQL }),
    "not sql",
    CONTEXT,
    fresh,
  );

  assert.equal(attempt.executed.ok, false);
  // `expected` never reaches a verdict for a statement that produced no
  // result set — "не сошлось" and "не проверялось" must stay distinguishable.
  assert.equal(attempt.compared, undefined);
});

void test("evaluateSqlPracticeAttempt: an assignment with no mechanic is never graded", () => {
  const result = evaluateSqlPracticeAttempt(practiceWith({}), emptyAttempt());
  assert.equal(result.graded, false);
  assert.equal(result.allPassed, false);
});

void test("evaluateSqlPracticeAttempt: a single declared mechanic decides alone", () => {
  const passing = evaluateSqlPracticeAttempt(
    practiceWith({ check: "x" }),
    emptyAttempt({ checked: { passed: true } }),
  );
  assert.equal(passing.graded, true);
  assert.equal(passing.allPassed, true);

  const failing = evaluateSqlPracticeAttempt(
    practiceWith({ check: "x" }),
    emptyAttempt({ checked: { passed: false } }),
  );
  assert.equal(failing.allPassed, false);
});

void test("evaluateSqlPracticeAttempt: both declared mechanics must pass — either one failing fails the attempt", () => {
  const bothPass = evaluateSqlPracticeAttempt(
    practiceWith({ check: "x", expected: "y" }),
    emptyAttempt({ checked: { passed: true }, compared: { passed: true } }),
  );
  assert.equal(bothPass.allPassed, true);

  const onlyCheckPasses = evaluateSqlPracticeAttempt(
    practiceWith({ check: "x", expected: "y" }),
    emptyAttempt({ checked: { passed: true }, compared: { passed: false } }),
  );
  assert.equal(onlyCheckPasses.allPassed, false);

  const noVerdictYet = evaluateSqlPracticeAttempt(
    practiceWith({ check: "x", expected: "y" }),
    emptyAttempt({ checked: { passed: true } }),
  );
  // `expected` never reached a verdict (e.g. the statement errored) —
  // undefined must not be mistaken for "passed".
  assert.equal(noVerdictYet.allPassed, false);
});

function emptyAttempt(overrides: Partial<SqlPracticeAttemptResult> = {}): SqlPracticeAttemptResult {
  return {
    executed: { ok: true, result: { command: "SELECT", rowCount: 0, columns: [], rows: [], truncated: false, statementCount: 1 }, durationMs: 0 },
    ...overrides,
  };
}
