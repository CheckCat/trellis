import assert from "node:assert/strict";
import test from "node:test";

import {
  completedRecord,
  FIXTURE_CORRECT_OPTION_ID,
  FIXTURE_COURSE_ID,
  FIXTURE_COURSE_VERSION,
  FIXTURE_INCORRECT_EXPLANATION,
  FIXTURE_INCORRECT_OPTION_ID,
  FIXTURE_PRACTICE_LESSON_ID,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_TEXT_LESSON_ID,
  FIXTURE_UNCHECKED_PRACTICE_LESSON_ID,
  withProgressApp,
} from "../../progress/test-support.js";

const ANSWER_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_QUIZ_LESSON_ID}/quiz/answer`;

void test("POST .../quiz/answer with the correct option completes the lesson (happy path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, true);
    assert.equal(body.lesson.id, FIXTURE_QUIZ_LESSON_ID);
    assert.equal(body.lesson.status, "completed");
    assert.equal(body.lesson.completionMode, "quiz");
    assert.equal(typeof body.lesson.completedAt, "string");
    assert.deepEqual(body.course, {
      courseId: FIXTURE_COURSE_ID,
      courseVersion: FIXTURE_COURSE_VERSION,
      totalLessons: 4,
      completedLessons: 1,
      completed: false,
    });

    const stored = progress.records();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.lessonId, FIXTURE_QUIZ_LESSON_ID);
    assert.equal(stored[0]?.courseVersion, FIXTURE_COURSE_VERSION);
  });
});

void test("POST .../quiz/answer with a wrong option explains it, stores nothing, and keeps the lesson open", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, false);
    assert.equal(body.explanation, FIXTURE_INCORRECT_EXPLANATION);
    assert.equal(body.lesson.status, "not_started");
    assert.equal(body.lesson.completedAt, undefined);
    assert.equal(body.course.completedLessons, 0);
    // No attempt history: a wrong answer writes nothing at all.
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer never reveals which option is correct (security)", async () => {
  await withProgressApp(async (app) => {
    const wrong = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    // Raw text, not shape: the correct option's id must not appear anywhere
    // in the response — not in a field, not in a message.
    assert.equal(wrong.body.includes(FIXTURE_CORRECT_OPTION_ID), false);
    assert.equal(wrong.body.includes("The right one"), false);

    const right = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    // The other option's explanation is never handed out either — only the
    // explanation of the option the caller actually chose.
    assert.equal(right.body.includes(FIXTURE_INCORRECT_EXPLANATION), false);
  });
});

void test("POST .../quiz/answer allows unlimited attempts and never un-completes a passed lesson", async () => {
  await withProgressApp(async (app, progress) => {
    const wrongFirst = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(wrongFirst.statusCode, 200);
    assert.equal(wrongFirst.json().correct, false);

    const right = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    const completedAt = right.json().lesson.completedAt;

    // Answering again — wrong, then right — after passing: the status stays
    // completed and the original completion time never moves.
    const wrongAgain = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(wrongAgain.json().correct, false);
    assert.equal(wrongAgain.json().lesson.status, "completed");
    assert.equal(wrongAgain.json().lesson.completedAt, completedAt);

    const rightAgain = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(rightAgain.json().lesson.completedAt, completedAt);
    assert.equal(progress.records().length, 1);
  });
});

void test("POST .../quiz/answer responds 400 for an option id that is not in the quiz (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: "not-an-option" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "unknown_option");
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer rejects a malformed body before reaching the handler (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const missing = await app.inject({ method: "POST", url: ANSWER_URL, payload: {} });
    assert.equal(missing.statusCode, 400);

    const empty = await app.inject({ method: "POST", url: ANSWER_URL, payload: { optionId: "" } });
    assert.equal(empty.statusCode, 400);

    const wrongType = await app.inject({ method: "POST", url: ANSWER_URL, payload: { optionId: 42 } });
    assert.equal(wrongType.statusCode, 400);

    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer ignores unknown body fields instead of acting on them (security)", async () => {
  await withProgressApp(async (app) => {
    // Fastify's schema validation is configured (by its own default) to
    // strip properties the body schema doesn't declare rather than reject
    // the request — so the assertion is that the extra field has no effect
    // and is not echoed anywhere, not that the request fails.
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID, correct: true, adminOverride: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().correct, false);
    assert.equal(response.body.includes("adminOverride"), false);
  });
});

void test("POST .../quiz/answer responds 404 for a lesson without a quiz, and for unknown ids (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const noQuiz = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_TEXT_LESSON_ID}/quiz/answer`,
      payload: { optionId: "whatever" },
    });
    assert.equal(noQuiz.statusCode, 404);
    assert.equal(noQuiz.json().error, "quiz_not_found");

    const unknownCourse = await app.inject({
      method: "POST",
      url: `/courses/no-such-course/lessons/${FIXTURE_QUIZ_LESSON_ID}/quiz/answer`,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(unknownCourse.statusCode, 404);
    assert.equal(unknownCourse.json().error, "course_not_found");

    const unknownLesson = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/no-such-lesson/quiz/answer`,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");

    assert.deepEqual(progress.records(), []);
  });
});

// --- multi-select quizzes (quiz.multiple: true) --------------------------

const MULTI_LESSON_ID = "multiselect-lesson";
const MULTI_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${MULTI_LESSON_ID}/quiz/answer`;
const MULTI_WRONG_EXPLANATION = "K is a consonant, not a vowel.";

/** Same course id/version as the shared fixture, but with a multi-select
 * quiz lesson. A separate manifest (via `withProgressApp`'s override) so the
 * shared fixture's lesson counts, asserted all over this file and
 * progress.test.ts, stay untouched. */
function multiQuizManifestYaml(): string {
  return [
    `id: ${FIXTURE_COURSE_ID}`,
    `version: ${FIXTURE_COURSE_VERSION}`,
    "title: Multi-select fixture course",
    "modules:",
    "  - id: only-module",
    "    title: Only module",
    "    lessons:",
    `      - id: ${FIXTURE_TEXT_LESSON_ID}`,
    "        title: Text lesson",
    `        content: lessons/${FIXTURE_TEXT_LESSON_ID}.md`,
    `      - id: ${MULTI_LESSON_ID}`,
    "        title: Pick-several lesson",
    "        quiz:",
    '          question: "Which of these are vowels?"',
    "          multiple: true",
    "          options:",
    "            - id: opt-a",
    '              text: "A"',
    "              correct: true",
    "            - id: opt-b",
    '              text: "E"',
    "              correct: true",
    "            - id: opt-c",
    '              text: "K"',
    `              explanation: ${MULTI_WRONG_EXPLANATION}`,
    "",
  ].join("\n");
}

const withMultiQuizApp = (run: Parameters<typeof withProgressApp>[0]) =>
  withProgressApp(run, { manifestYaml: multiQuizManifestYaml() });

void test("POST .../quiz/answer with the exact correct set completes a multi-select lesson (happy path)", async () => {
  await withMultiQuizApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionIds: ["opt-a", "opt-b"] },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, true);
    assert.deepEqual(body.options, [
      { id: "opt-a", correct: true },
      { id: "opt-b", correct: true },
    ]);
    assert.equal(body.lesson.status, "completed");
    assert.equal(body.lesson.completionMode, "quiz");
    assert.equal(progress.records().length, 1);
  });
});

void test("POST .../quiz/answer grades a wrong inclusion per chosen option and stores nothing", async () => {
  await withMultiQuizApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionIds: ["opt-a", "opt-c"] },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, false);
    assert.deepEqual(body.options, [
      { id: "opt-a", correct: true },
      { id: "opt-c", correct: false, explanation: MULTI_WRONG_EXPLANATION },
    ]);
    assert.equal(body.lesson.status, "not_started");
    // The unchosen correct option must not appear anywhere in the response.
    assert.equal(response.body.includes("opt-b"), false);
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer fails a correct-but-incomplete set without naming what is missing", async () => {
  await withMultiQuizApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionIds: ["opt-a"] },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    // The one hint the client gets: overall wrong, every chosen one right.
    assert.equal(body.correct, false);
    assert.deepEqual(body.options, [{ id: "opt-a", correct: true }]);
    assert.equal(response.body.includes("opt-b"), false);
    assert.equal(response.body.includes("opt-c"), false);
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer rejects a body whose shape does not match the quiz kind (error path)", async () => {
  await withMultiQuizApp(async (app, progress) => {
    // A multi-select quiz does not take a single optionId...
    const single = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionId: "opt-a" },
    });
    assert.equal(single.statusCode, 400);
    assert.equal(single.json().error, "wrong_answer_shape");

    // ...neither field, or both at once, is malformed for any quiz kind.
    const neither = await app.inject({ method: "POST", url: MULTI_URL, payload: {} });
    assert.equal(neither.statusCode, 400);
    const both = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionId: "opt-a", optionIds: ["opt-a"] },
    });
    assert.equal(both.statusCode, 400);

    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer rejects optionIds against a single-choice quiz (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionIds: [FIXTURE_CORRECT_OPTION_ID] },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "wrong_answer_shape");
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer responds 400 when any submitted id is not in the multi-select quiz (error path)", async () => {
  await withMultiQuizApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionIds: ["opt-a", "not-an-option"] },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "unknown_option");
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer rejects a malformed optionIds body before reaching the handler (error path)", async () => {
  await withMultiQuizApp(async (app, progress) => {
    const empty = await app.inject({ method: "POST", url: MULTI_URL, payload: { optionIds: [] } });
    assert.equal(empty.statusCode, 400);

    const blankEntry = await app.inject({ method: "POST", url: MULTI_URL, payload: { optionIds: [""] } });
    assert.equal(blankEntry.statusCode, 400);

    const duplicate = await app.inject({
      method: "POST",
      url: MULTI_URL,
      payload: { optionIds: ["opt-a", "opt-a"] },
    });
    assert.equal(duplicate.statusCode, 400);

    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer reports the course completed once its last lesson is passed (edge case)", async () => {
  await withProgressApp(
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: ANSWER_URL,
        payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
      });
      assert.equal(response.json().course.completed, true);
      assert.equal(response.json().course.completedLessons, 4);
    },
    {
      seed: [
        completedRecord(FIXTURE_TEXT_LESSON_ID),
        completedRecord(FIXTURE_PRACTICE_LESSON_ID),
        completedRecord(FIXTURE_UNCHECKED_PRACTICE_LESSON_ID),
      ],
    },
  );
});
