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
