import assert from "node:assert/strict";
import test from "node:test";

import {
  answerManifestYaml,
  ANSWER_FIXTURE_SQL_LESSON_ID,
  ANSWER_LESSON_ID,
  BOTH_MECHANICS_LESSON_ID,
  checkResult,
  connectionError,
  databaseError,
  dualGateManifestYaml,
  DUAL_GATE_LESSON_ID,
  expectedManifestYaml,
  EXPECTED_LESSON_ID,
  FIXTURE_SOLUTION_SQL,
  solutionManifestYaml,
  SOLUTION_LESSON_ID,
  FIXTURE_BOTH_CHECK_SQL,
  FIXTURE_EXPECTED_SQL,
  FIXTURE_ORDERED_EXPECTED_SQL,
  ORDERED_EXPECTED_LESSON_ID,
  resultSet,
  withPracticeApp,
  type ScriptedAnswer,
} from "./test-support.js";
import {
  completedRecord,
  FIXTURE_COURSE_ID,
  FIXTURE_PRACTICE_LESSON_ID,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_UNCHECKED_PRACTICE_LESSON_ID,
} from "../../progress/test-support.js";

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

void test("POST practice/run re-seeds for every attempt and keeps a repeat pass idempotent", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const first = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });
      const firstCompletedAt = first.json().lesson.completedAt;
      const second = await app.inject({ method: "POST", url: RUN_URL, payload: { sql: "select 1" } });

      assert.equal(second.statusCode, 200);
      // One seed per attempt. The old contract was the opposite ("the
      // first run pays for the seed, later ones don't") and it is what let
      // an earlier lesson decide whether a later one passes.
      assert.equal(sandbox.provisionCalls(), 2);
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

// --- The `expected` mechanic (practice/compare.ts) -----------------------

const EXPECTED_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${EXPECTED_LESSON_ID}/practice/run`;
const BOTH_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${BOTH_MECHANICS_LESSON_ID}/practice/run`;
const ORDERED_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${ORDERED_EXPECTED_LESSON_ID}/practice/run`;

/** Two text columns, the shape both the reference query and the learner's
 * statement produce in these tests. */
function pairRows(rows: readonly (readonly unknown[])[]): ReturnType<typeof resultSet> {
  return resultSet({ columns: ["a", "b"], rows, dataTypeIds: [25, 25] });
}

/**
 * Answers the learner's statement with `answer`, the course's reference
 * query with `reference`, its check query with `verdict`, and every
 * transaction-control statement with an empty result.
 */
function expectedScript(
  answer: ScriptedAnswer,
  reference: ScriptedAnswer,
  verdict?: ScriptedAnswer,
): (text: string) => ScriptedAnswer {
  return (text: string) => {
    if (text === FIXTURE_EXPECTED_SQL || text === FIXTURE_ORDERED_EXPECTED_SQL) {
      return reference;
    }
    if (text === FIXTURE_BOTH_CHECK_SQL) {
      return verdict ?? checkResult(false);
    }
    if (text === "rollback" || text === "discard all" || text === "begin transaction read only") {
      return resultSet({ command: text.toUpperCase(), columns: [], rows: [], rowCount: null });
    }
    return answer;
  };
}

void test("POST practice/run grades a SELECT by comparing it with the course's expected query", async () => {
  const rows = [
    ["Война и мир", "Лев Толстой"],
    ["Отцы и дети", "Иван Тургенев"],
  ];
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: EXPECTED_RUN_URL,
        payload: { sql: "select title, author from books" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.ok, true);
      // No check on this lesson — the two mechanics are independent.
      assert.deepEqual(body.check, { present: false });
      assert.deepEqual(body.expected, { present: true, passed: true });
      assert.equal(body.lesson.completionMode, "practice");
      assert.equal(body.lesson.status, "completed");
      assert.equal(progress.records().length, 1);

      // The reference runs FIRST, on its own connection, against the
      // freshly seeded sandbox — before the learner's statement exists to
      // influence it. Run afterwards (as it was until the sandbox began
      // re-seeding per attempt), `delete from books; select * from books;`
      // compared two empty results and passed.
      assert.deepEqual(sandbox.texts(), [
        "begin transaction read only",
        FIXTURE_EXPECTED_SQL,
        "rollback",
        "rollback",
        "discard all",
        "select title, author from books",
        "rollback",
        "rollback",
        "discard all",
      ]);
      assert.equal(sandbox.clientsOpen(), 0);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(pairRows(rows), pairRows(rows)),
    },
  );
});

void test("POST practice/run explains an expected mismatch in counts, without leaking the answer", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const tooManyColumns = await app.inject({
        method: "POST",
        url: EXPECTED_RUN_URL,
        payload: { sql: "select * from books" },
      });
      assert.equal(tooManyColumns.statusCode, 200);
      assert.deepEqual(tooManyColumns.json().expected, {
        present: true,
        passed: false,
        reason: "ожидалось столбцов: 2, получено: 3",
      });
      assert.equal(tooManyColumns.json().lesson.status, "not_started");
      assert.deepEqual(progress.records(), []);
      // Neither the reference query nor its values reach the client.
      assert.doesNotMatch(tooManyColumns.body, /reference_table|Лев Толстой/);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(
        resultSet({ columns: ["a", "b", "c"], rows: [["x", "y", "z"]], dataTypeIds: [25, 25, 25] }),
        pairRows([["Война и мир", "Лев Толстой"]]),
      ),
    },
  );

  await withPracticeApp(
    async ({ app }) => {
      const tooFewRows = await app.inject({
        method: "POST",
        url: EXPECTED_RUN_URL,
        payload: { sql: "select title, author from books limit 1" },
      });
      assert.deepEqual(tooFewRows.json().expected, {
        present: true,
        passed: false,
        reason: "ожидалось строк: 2, получено: 1",
      });
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(
        pairRows([["a", "b"]]),
        pairRows([
          ["a", "b"],
          ["c", "d"],
        ]),
      ),
    },
  );
});

void test("POST practice/run honours ordered: true — the same rows in the wrong order are not accepted", async () => {
  const reference = resultSet({ columns: ["a"], rows: [["1"], ["2"], ["3"]], dataTypeIds: [25] });

  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({
        method: "POST",
        url: ORDERED_RUN_URL,
        payload: { sql: "select a from t" },
      });

      assert.deepEqual(response.json().expected, {
        present: true,
        passed: false,
        reason: "строки различаются (первое расхождение — строка 1)",
      });
      assert.deepEqual(progress.records(), []);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(resultSet({ columns: ["a"], rows: [["2"], ["1"], ["3"]], dataTypeIds: [25] }), reference),
    },
  );

  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({
        method: "POST",
        url: ORDERED_RUN_URL,
        payload: { sql: "select a from t order by a" },
      });

      assert.deepEqual(response.json().expected, { present: true, passed: true });
      assert.equal(progress.records().length, 1);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(resultSet({ columns: ["a"], rows: [["1"], ["2"], ["3"]], dataTypeIds: [25] }), reference),
    },
  );
});

void test("POST practice/run requires BOTH mechanics to pass when the lesson declares both", async () => {
  const rows = [["a", "b"]];
  const cases = [
    { check: true, expected: false, completes: false },
    { check: false, expected: true, completes: false },
    { check: true, expected: true, completes: true },
  ] as const;

  for (const scenario of cases) {
    await withPracticeApp(
      async ({ app, progress }) => {
        const response = await app.inject({ method: "POST", url: BOTH_RUN_URL, payload: { sql: "select a, b from t" } });

        const body = response.json();
        assert.equal(body.check.passed, scenario.check, JSON.stringify(scenario));
        assert.equal(body.expected.passed, scenario.expected, JSON.stringify(scenario));
        assert.equal(body.lesson.status, scenario.completes ? "completed" : "not_started", JSON.stringify(scenario));
        assert.equal(progress.records().length, scenario.completes ? 1 : 0, JSON.stringify(scenario));
      },
      {
        manifestYaml: expectedManifestYaml(),
        respond: expectedScript(
          pairRows(rows),
          pairRows(scenario.expected ? rows : [["different", "rows"]]),
          checkResult(scenario.check),
        ),
      },
    );
  }
});

void test("POST practice/run does not COMPARE against the expected result when the learner's own SQL failed", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: BOTH_RUN_URL,
        payload: { sql: "select * from bookz" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, "42P01");
      // There were no rows to compare: "не сошлось" and "не проверялось"
      // must not look alike, so `passed`/`reason` are absent, not `false`.
      assert.deepEqual(body.expected, { present: true });
      // The check still runs — it grades the sandbox's state, not the
      // statement that failed.
      assert.deepEqual(body.check, { present: true, passed: false });
      // The reference was READ (it always is, before the attempt) — what
      // did not happen is the comparison.
      assert.deepEqual(sandbox.texts(), [
        "begin transaction read only",
        FIXTURE_EXPECTED_SQL,
        "rollback",
        "rollback",
        "discard all",
        "select * from bookz",
        "rollback",
        FIXTURE_BOTH_CHECK_SQL,
        "rollback",
        "discard all",
      ]);
      assert.deepEqual(progress.records(), []);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(
        databaseError('relation "bookz" does not exist', { code: "42P01" }),
        pairRows([["a", "b"]]),
        checkResult(false),
      ),
    },
  );
});


// --- the `solution` mechanic (practice/state.ts) -------------------------

const SOLUTION_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${SOLUTION_LESSON_ID}/practice/run`;
/** A right answer written differently from the course's own solution —
 * deliberately not the same string, so "did the solution run" and "did the
 * learner's statement run" stay distinguishable in the recorded texts. */
const CORRECT_ATTEMPT_SQL = "update fixture_books set in_stock = false where id in (1)";

/** Answers the snapshot queries with `state` for whichever run is in
 * progress, and everything else (the solution, the learner's statement,
 * transaction control) with an empty result. `states` is consumed one
 * snapshot at a time, in the order the route takes them: the solution's
 * first, the learner's second, and — only when those two disagreed — the
 * solution's again. */
function solutionScript(...states: string[]): (text: string) => ScriptedAnswer {
  let taken = 0;
  return (text: string) => {
    if (text.includes("pg_catalog.pg_class")) {
      return { rows: [{ relname: "fixture_books" }] };
    }
    if (text.includes("md5(")) {
      const digest = states[Math.min(taken, states.length - 1)] ?? "";
      taken += 1;
      return { rows: [{ rows: "5", digest }] };
    }
    return resultSet({ command: "UPDATE", columns: [], rows: [], rowCount: 1 });
  };
}

void test("POST practice/run grades a data change by comparing states, and completes the lesson", async () => {
  await withPracticeApp(
    async ({ app, progress, sandbox }) => {
      const response = await app.inject({
        method: "POST",
        url: SOLUTION_RUN_URL,
        payload: { sql: CORRECT_ATTEMPT_SQL },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.deepEqual(body.solution, { present: true, passed: true });
      assert.deepEqual(body.check, { present: false });
      assert.deepEqual(body.expected, { present: false });
      assert.equal(body.lesson.status, "completed");
      assert.equal(progress.records().length, 1);

      // The order is the mechanic. The solution runs on the seeded sandbox
      // and its state is read; the sandbox is seeded AGAIN so the learner
      // inherits none of it; only then does the learner's statement run.
      const texts = sandbox.texts();
      assert.equal(texts[0], FIXTURE_SOLUTION_SQL);
      assert.ok(texts[1]?.includes("pg_catalog.pg_class"), texts.join(" | "));
      assert.ok(
        texts.indexOf(CORRECT_ATTEMPT_SQL) > texts.indexOf(FIXTURE_SOLUTION_SQL),
        "the learner's statement must run after the reference state was taken",
      );
      assert.equal(sandbox.provisionCalls(), 2, "the solution's changes must not be handed to the learner");
      assert.equal(sandbox.clientsOpen(), 0);
    },
    { manifestYaml: solutionManifestYaml(), respond: solutionScript("same-state") },
  );
});

void test("POST practice/run refuses an attempt that also changed what the assignment never mentioned", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      // `update fixture_books set in_stock = false` — no WHERE. The old
      // `check`-based grading passed this: book 1 really is out of stock.
      const response = await app.inject({
        method: "POST",
        url: SOLUTION_RUN_URL,
        payload: { sql: "update fixture_books set in_stock = false" },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.solution.present, true);
      assert.equal(body.solution.passed, false);
      assert.match(body.solution.reason, /fixture_books/);
      assert.equal(body.lesson.status, "not_started");
      assert.deepEqual(progress.records(), []);
      // The solution's text is not in the answer, and neither is a cell of
      // the state it produced.
      assert.doesNotMatch(response.body, /in_stock|where id = 1/);
    },
    {
      manifestYaml: solutionManifestYaml(),
      // Reference state, then the learner's (different), then the
      // reference again — the re-verification a failed attempt triggers.
      respond: solutionScript("reference", "sledgehammer", "reference"),
    },
  );
});

void test("POST practice/run answers 422, not a wrong-answer verdict, when the solution is not deterministic", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({
        method: "POST",
        url: SOLUTION_RUN_URL,
        payload: { sql: CORRECT_ATTEMPT_SQL },
      });

      // The learner's attempt may well have been correct — nobody can tell,
      // because the thing it is compared against moves. Telling them "не
      // зачтено" would be blaming them for the author's bug.
      assert.equal(response.statusCode, 422);
      const body = response.json<{ error: string; message: string }>();
      assert.equal(body.error, "solution_nondeterministic");
      assert.match(body.message, /now\(\)\/random\(\)|DEFAULT/);
      assert.doesNotMatch(response.body, /where id = 1/);
      assert.deepEqual(progress.records(), []);
    },
    {
      manifestYaml: solutionManifestYaml(),
      // Every snapshot differs: the first reference, the learner's, and
      // the reference re-taken — which is exactly what a `now()` in the
      // solution (or in the seed's DEFAULT) looks like from here.
      respond: solutionScript("first", "learner", "third"),
    },
  );
});

void test("POST practice/run does not re-verify a solution the learner matched (edge case)", async () => {
  await withPracticeApp(
    async ({ app, sandbox }) => {
      await app.inject({
        method: "POST",
        url: SOLUTION_RUN_URL,
        payload: { sql: CORRECT_ATTEMPT_SQL },
      });

      // Two seeds, not three: an attempt that MATCHED cannot have been
      // graded against a moving target, so the third re-seed (and the
      // second run of the solution) would be spent on nothing.
      assert.equal(sandbox.provisionCalls(), 2);
      assert.equal(sandbox.texts().filter((text) => text === FIXTURE_SOLUTION_SQL).length, 1);
    },
    { manifestYaml: solutionManifestYaml(), respond: solutionScript("stable") },
  );
});

void test("POST practice/run answers 422, never a wrong-answer verdict, when the expected query is broken", async () => {
  await withPracticeApp(
    async ({ app, progress }) => {
      const response = await app.inject({
        method: "POST",
        url: EXPECTED_RUN_URL,
        payload: { sql: "select a, b from t" },
      });

      // Broken course content — the same class (and status) as a broken
      // check or a seed the database rejects.
      assert.equal(response.statusCode, 422);
      const body = response.json();
      assert.equal(body.error, "expected_failed");
      assert.equal(body.databaseError, 'relation "reference_table" does not exist');
      // ...and even then the query's own text stays inside.
      assert.doesNotMatch(body.message, /select a, b from reference_table/);
      assert.deepEqual(progress.records(), []);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(
        pairRows([["a", "b"]]),
        databaseError('relation "reference_table" does not exist', { code: "42P01" }),
      ),
    },
  );
});

void test("POST practice/run compares against the UNtruncated result, not the 200-row display grid", async () => {
  // MAX_RESULT_ROWS caps what the client is shown; it must have no say in
  // grading. Both sides here are 250 identical rows: a comparison run on
  // the truncated grid would still pass, so the assertion that matters is
  // the negative one below — one differing row past row 200 must fail.
  const identical = Array.from({ length: 250 }, (_, index) => [`row-${index}`, "x"]);
  const differingPastTheCap = identical.map((row, index) => (index === 240 ? ["row-different", "x"] : row));

  await withPracticeApp(
    async ({ app }) => {
      const response = await app.inject({
        method: "POST",
        url: EXPECTED_RUN_URL,
        payload: { sql: "select a, b from t" },
      });
      const body = response.json();
      // The grid the learner sees is still capped...
      assert.equal(body.result.rows.length, 200);
      assert.equal(body.result.truncated, true);
      // ...while the comparison saw all 250 and found the difference.
      assert.equal(body.expected.passed, false);
      assert.match(body.expected.reason, /первая строка без пары — строка 241/);
    },
    {
      manifestYaml: expectedManifestYaml(),
      respond: expectedScript(pairRows(differingPastTheCap), pairRows(identical)),
    },
  );
});

// --- type: answer — practice done outside the platform ------------------

const ANSWER_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${ANSWER_LESSON_ID}/practice/answer`;
const SQL_LESSON_ANSWER_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${ANSWER_FIXTURE_SQL_LESSON_ID}/practice/answer`;
const ANSWER_LESSON_RUN_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${ANSWER_LESSON_ID}/practice/run`;

/** All three fields right, in the plainest spelling. */
const CORRECT_ANSWERS = { headcount: "112", turnover: "18.5", reason: "По собственному желанию" };

async function withAnswerApp(run: Parameters<typeof withPracticeApp>[0]): Promise<void> {
  await withPracticeApp(run, { manifestYaml: answerManifestYaml() });
}

void test("POST practice/answer completes the lesson when every field is right, without touching the sandbox", async () => {
  await withAnswerApp(async ({ app, progress, sandbox }) => {
    const response = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: CORRECT_ANSWERS } });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.fields, {
      headcount: { correct: true },
      turnover: { correct: true },
      reason: { correct: true },
    });
    assert.equal(body.lesson.completionMode, "practice");
    assert.equal(body.lesson.status, "completed");
    assert.equal(progress.records().length, 1);

    // The whole point of this mechanic: no sandbox is prepared, no
    // connection is taken, nothing is executed. An `answer` lesson works
    // in a course with no sandbox at all and cannot fail on Postgres.
    assert.equal(sandbox.provisionCalls(), 0);
    assert.deepEqual(sandbox.texts(), []);
    assert.equal(sandbox.clientsOpen(), 0);
  });
});

void test("POST practice/answer marks each field separately and completes nothing when one is wrong", async () => {
  await withAnswerApp(async ({ app, progress }) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { answers: { ...CORRECT_ANSWERS, turnover: "25" } },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, false);
    // Partial credit is reported honestly — the learner has to know which
    // value to go back and re-derive — but it does not complete anything.
    assert.deepEqual(body.fields, {
      headcount: { correct: true },
      turnover: { correct: false },
      reason: { correct: true },
    });
    assert.equal(body.lesson.status, "not_started");
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST practice/answer reads a comma decimal, spaced thousands and a different letter case", async () => {
  await withAnswerApp(async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: {
        answers: {
          // A person typing a number, not a JSON serializer emitting one.
          headcount: " 112 ",
          // Within the 0.2 tolerance, written with a comma.
          turnover: "18,6",
          reason: "  по собственному ЖЕЛАНИЮ  ",
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true, response.body);
  });
});

void test("POST practice/answer marks a field the learner left out, rather than dropping it", async () => {
  await withAnswerApp(async ({ app }) => {
    const response = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: {} } });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, false);
    // One entry per DECLARED field: the form has to be able to mark every
    // input, including the ones nothing was typed into.
    assert.deepEqual(Object.keys(body.fields).sort(), ["headcount", "reason", "turnover"]);
    assert.equal(body.fields.headcount.correct, false);
  });
});

void test("POST practice/answer never returns the right answers, on any outcome", async () => {
  await withAnswerApp(async ({ app }) => {
    const right = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: CORRECT_ANSWERS } });
    const wrong = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { answers: { headcount: "1", turnover: "2", reason: "нет" } },
    });

    for (const body of [right.body, wrong.body]) {
      // `112` is the learner's own submitted value in the first case, so
      // the assertion is about the fields the RESPONSE is built from: a
      // verdict carries booleans and nothing else.
      assert.doesNotMatch(body, /"expected"|"tolerance"|18\.5|По собственному желанию/);
    }
    // And the wrong submission gets no hint of how far off it was.
    assert.doesNotMatch(wrong.body, /112/);
  });
});

void test("POST practice/answer stays idempotent and never un-completes a lesson", async () => {
  await withAnswerApp(async ({ app, progress }) => {
    const first = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: CORRECT_ANSWERS } });
    const completedAt = first.json().lesson.completedAt;

    const again = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: CORRECT_ANSWERS } });
    assert.equal(again.json().lesson.completedAt, completedAt, "a repeat pass must not move completedAt");

    // "Можно исправить и отправить снова" cuts both ways: a later wrong
    // submission reports itself honestly and leaves the pass alone.
    const wrong = await app.inject({ method: "POST", url: ANSWER_URL, payload: { answers: { headcount: "1" } } });
    assert.equal(wrong.json().ok, false);
    assert.equal(wrong.json().lesson.status, "completed");
    assert.equal(progress.records().length, 1);
  });
});

void test("POST practice/answer and practice/run each refuse the other kind of assignment", async () => {
  await withAnswerApp(async ({ app, progress, sandbox }) => {
    const sqlToAnswer = await app.inject({
      method: "POST",
      url: SQL_LESSON_ANSWER_URL,
      payload: { answers: { headcount: "112" } },
    });
    assert.equal(sqlToAnswer.statusCode, 409);
    assert.equal(sqlToAnswer.json().error, "practice_type_mismatch");
    assert.match(sqlToAnswer.json().message, /practice\/run/);

    const answerToSql = await app.inject({
      method: "POST",
      url: ANSWER_LESSON_RUN_URL,
      payload: { sql: "select 1" },
    });
    assert.equal(answerToSql.statusCode, 409);
    assert.equal(answerToSql.json().error, "practice_type_mismatch");
    assert.match(answerToSql.json().message, /practice\/answer/);

    // Neither mistake reached the sandbox or the progress store.
    assert.equal(sandbox.provisionCalls(), 0);
    assert.deepEqual(sandbox.texts(), []);
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST practice/answer rejects a request that names no answer practice", async () => {
  await withAnswerApp(async ({ app }) => {
    const unknownCourse = await app.inject({
      method: "POST",
      url: "/courses/nope/lessons/whatever/practice/answer",
      payload: { answers: {} },
    });
    assert.equal(unknownCourse.statusCode, 404);
    assert.equal(unknownCourse.json().error, "course_not_found");

    const unknownLesson = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/nope/practice/answer`,
      payload: { answers: {} },
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");
  });
});

void test("POST practice/answer validates the body before grading anything", async () => {
  await withAnswerApp(async ({ app }) => {
    for (const payload of [
      {},
      { answers: "112" },
      { answers: { headcount: { nested: "object" } } },
      // Past the per-answer length cap — a form field, not a payload.
      { answers: { headcount: "1".repeat(1001) } },
      // Not a legal field id, so it could never name a declared field.
      { answers: { "not a field id": "112" } },
    ]) {
      const response = await app.inject({ method: "POST", url: ANSWER_URL, payload });
      assert.equal(response.statusCode, 400, `expected 400 for ${JSON.stringify(payload).slice(0, 80)}`);
    }

    // A JSON number where a string was declared is COERCED, not rejected:
    // Fastify's ajv runs with `coerceTypes` (its default, unchanged by
    // this app), so `112` arrives as "112" and grades the same as a form
    // would have sent it. Asserted so the leniency is a stated contract
    // rather than something a config change could silently remove.
    const coerced = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { answers: { ...CORRECT_ANSWERS, headcount: 112 } },
    });
    assert.equal(coerced.statusCode, 200);
    assert.equal(coerced.json().ok, true);
  });
});

void test("GET practice/answer/solution hands back the course's own reference values", async () => {
  await withAnswerApp(async ({ app, progress }) => {
    const response = await app.inject({ method: "GET", url: `${ANSWER_URL}/solution` });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      fields: [
        { id: "headcount", label: "Сколько сотрудников?", expected: "112" },
        // Only this field widens the answer, so only this one says so.
        { id: "turnover", label: "Текучесть, %", expected: "18.5", tolerance: 0.2 },
        { id: "reason", label: "Самая частая причина", expected: "По собственному желанию" },
      ],
    });

    // Looking at the answer is not passing the exercise.
    assert.deepEqual(progress.records(), []);
  });
});

void test("GET practice/answer/solution is the ONLY route that reveals an answer field's value", async () => {
  await withAnswerApp(async ({ app }) => {
    // The lesson as the learner receives it carries the task and nothing
    // else — this is the half of the invariant that did not move.
    const lesson = await app.inject({
      method: "GET",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${ANSWER_LESSON_ID}`,
    });
    assert.equal(lesson.statusCode, 200);
    assert.doesNotMatch(lesson.body, /"expected"|"tolerance"|112|18\.5|По собственному желанию/);
  });
});

void test("GET practice/answer/solution refuses a lesson whose practice is not of the answer kind", async () => {
  await withAnswerApp(async ({ app }) => {
    const wrongKind = await app.inject({ method: "GET", url: `${SQL_LESSON_ANSWER_URL}/solution` });
    assert.equal(wrongKind.statusCode, 409);
    assert.equal(wrongKind.json().error, "practice_type_mismatch");

    const unknownLesson = await app.inject({
      method: "GET",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/nope/practice/answer/solution`,
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");
  });
});
