import assert from "node:assert/strict";
import test from "node:test";

import type { CodeRunRequest, CodeRunResult } from "./run-node.js";
import { createCodePracticeStrategy } from "./route.js";
import {
  codeManifestYaml,
  CODE_LESSON_ID,
  CODE_SOLUTION_LESSON_ID,
  createScriptedCodeRunner,
  FIXTURE_CODE_SOLUTION,
  FIXTURE_CODE_STARTER,
  ranWith,
  withPracticeApp,
  type PracticeAppContext,
} from "../test-support.js";
import { answerPracticeStrategy } from "../answer/index.js";
import { sqlPracticeStrategy } from "../sql/index.js";
import { FIXTURE_COURSE_ID, FIXTURE_PRACTICE_LESSON_ID } from "../../../progress/test-support.js";

const CODE_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_LESSON_ID}/practice/code`;
const SOLUTION_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_SOLUTION_LESSON_ID}/practice/code`;
const LEARNER_CODE = "export function sum(a: number, b: number) { return a + b; }";

interface CodeAppContext extends Pick<PracticeAppContext, "app" | "progress"> {
  readonly requests: CodeRunRequest[];
}

/** The full app over the code fixture, with the code strategy driven by
 * `respond`; the other two strategies are the real ones. */
function withCodeApp(
  respond: (request: CodeRunRequest, index: number) => CodeRunResult,
  run: (context: CodeAppContext) => Promise<void>,
  manifestYaml = codeManifestYaml(),
): Promise<void> {
  const scripted = createScriptedCodeRunner(respond);
  return withPracticeApp(({ app, progress }) => run({ app, progress, requests: scripted.requests }), {
    manifestYaml,
    practiceStrategies: [
      sqlPracticeStrategy,
      answerPracticeStrategy,
      createCodePracticeStrategy({ runner: scripted.runner }),
    ],
  });
}

void test("POST practice/code runs the learner's module on every case and completes the lesson when all pass", async () => {
  await withCodeApp(
    () => ranWith([5, 0]),
    async ({ app, progress, requests }) => {
      const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });

      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.equal(body.passed, true);
      assert.equal(body.failure, undefined);
      assert.deepEqual(body.cases, [
        { args: [2, 3], passed: true, value: 5, output: "", truncated: false },
        { args: [-1, 1], passed: true, value: 0, output: "", truncated: false },
      ]);
      assert.equal(body.lesson.id, CODE_LESSON_ID);
      assert.equal(body.lesson.status, "completed");
      assert.equal(body.lesson.completionMode, "practice");
      assert.equal(body.course.completedLessons, 1);
      assert.equal(progress.records()[0]?.lessonId, CODE_LESSON_ID);

      // No solution declared — exactly one run, with the learner's text
      // untouched and the manifest's cases in order.
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], {
        language: "typescript",
        code: LEARNER_CODE,
        entry: "sum",
        cases: [
          [2, 3],
          [-1, 1],
        ],
      });
    },
  );
});

void test("POST practice/code reports a failed case with the learner's own value and records nothing", async () => {
  await withCodeApp(
    () => ranWith([5, 1]),
    async ({ app, progress }) => {
      const body = (await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } })).json();
      assert.equal(body.ok, true);
      assert.equal(body.passed, false);
      assert.deepEqual(
        body.cases.map((c: { passed: boolean; value: unknown }) => [c.passed, c.value]),
        [
          [true, 5],
          [false, 1],
        ],
      );
      assert.equal(body.lesson.status, "not_started");
      assert.equal(progress.records().length, 0);
      // Neither the expected value nor any hint of it rides along.
      for (const c of body.cases) {
        assert.equal("expected" in c, false);
      }
    },
  );
});

void test("POST practice/code runs the solution first and grades by it; an explicit expected still wins", async () => {
  await withCodeApp(
    (request) => (request.code === FIXTURE_CODE_SOLUTION ? ranWith([5, 99]) : ranWith([5, 15])),
    async ({ app, requests }) => {
      // Textually different from the fixture's solution: the scripted
      // runner tells the two runs apart by their code.
      const response = await app.inject({
        method: "POST",
        url: SOLUTION_URL,
        payload: { code: "export const sum = (a, b) => a + b;" },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().passed, true);
      assert.equal(requests[0]?.code, FIXTURE_CODE_SOLUTION);
      assert.equal(requests.length, 2);
      assert.equal(response.body.includes(FIXTURE_CODE_SOLUTION), false);
    },
  );
});

for (const [kind, result, pattern] of [
  [
    "load_failed",
    { kind: "load_failed", durationMs: 3, error: { message: "SyntaxError: Unexpected token" } },
    /Unexpected token/,
  ],
  ["entry_missing", { kind: "entry_missing", durationMs: 3, exported: ["Sum"] }, /«sum».*Экспортировано: Sum/],
  ["timeout", { kind: "timeout", durationMs: 10_000, cases: [] }, /10 с/],
  [
    "crashed",
    { kind: "crashed", durationMs: 3, exitCode: 134, signal: null, stderr: "heap out of memory" },
    /heap out of memory/,
  ],
] as const) {
  void test(`POST practice/code answers 200 ok:false with failure "${kind}" — the learner's doing, not an API error`, async () => {
    await withCodeApp(
      () => result,
      async ({ app, progress }) => {
        const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json();
        assert.equal(body.ok, false);
        assert.equal(body.passed, false);
        assert.equal(body.failure.kind, kind);
        assert.match(body.failure.message, pattern);
        assert.deepEqual(
          body.cases.map((c: { passed: boolean }) => c.passed),
          [false, false],
        );
        assert.equal(progress.records().length, 0);
      },
    );
  });
}

void test("POST practice/code answers 422 solution_failed when the solution is broken, without its text", async () => {
  await withCodeApp(
    () => ({ kind: "load_failed", durationMs: 3, error: { message: "SyntaxError: bad" } }),
    async ({ app, requests }) => {
      const response = await app.inject({
        method: "POST",
        url: SOLUTION_URL,
        payload: { code: "export function sum() {}" },
      });
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().error, "solution_failed");
      // A fixed sentence — node's text (which quotes source) stays in the log.
      assert.match(response.json().message, /could not be run \(the module did not load\)/);
      assert.equal(response.body.includes("SyntaxError: bad"), false);
      assert.equal(response.body.includes(FIXTURE_CODE_SOLUTION), false);
      // The learner's code was never run.
      assert.equal(requests.length, 1);
    },
  );
});

void test("POST practice/code answers 503 unavailable when node cannot be started", async () => {
  await withCodeApp(
    () => ({ kind: "unavailable", durationMs: 1, message: "spawn ENOENT" }),
    async ({ app }) => {
      const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().error, "unavailable");
    },
  );
});

void test("POST practice/code answers 409 for a lesson whose practice is sql, pointing at practice/run", async () => {
  await withPracticeApp(async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_PRACTICE_LESSON_ID}/practice/code`,
      payload: { code: LEARNER_CODE },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "practice_type_mismatch");
    assert.match(response.json().message, /practice\/run/);
  });
});

void test("POST practice/code rejects blank and oversized code with 400 before running anything", async () => {
  await withCodeApp(
    () => ranWith([5, 0]),
    async ({ app, requests }) => {
      for (const code of ["", "   \n", "x".repeat(50_001)]) {
        const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code } });
        assert.equal(response.statusCode, 400, `code of length ${code.length}`);
      }
      assert.equal(requests.length, 0);
    },
  );
});

void test("GET lesson exposes the code assignment's public shape only — no cases, no solution", async () => {
  await withCodeApp(
    () => ranWith([]),
    async ({ app }) => {
      const response = await app.inject({
        method: "GET",
        url: `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_LESSON_ID}`,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().practice, {
        type: "code",
        prompt: "Add two numbers.",
        language: "typescript",
        entry: "sum",
        starter: FIXTURE_CODE_STARTER,
      });
      const solutionLesson = await app.inject({
        method: "GET",
        url: `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_SOLUTION_LESSON_ID}`,
      });
      assert.equal(solutionLesson.body.includes(FIXTURE_CODE_SOLUTION), false);
      assert.equal("cases" in solutionLesson.json().practice, false);
    },
  );
});
