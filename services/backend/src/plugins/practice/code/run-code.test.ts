import assert from "node:assert/strict";
import test from "node:test";

import type { CourseCodePractice } from "../../../courses/types.js";
import { createScriptedCodeRunner, ranWith } from "../test-support.js";
import { isCodeRunnerUnavailableError, isCodeSolutionError } from "./errors.js";
import { runCodePracticeAttempt } from "./run-code.js";
import { createNodeRunner } from "./run-node.js";

const SOLUTION = "export function sum(a, b) { return a + b; }";

function practice(overrides: Partial<CourseCodePractice> = {}): CourseCodePractice {
  return {
    type: "code",
    language: "javascript",
    prompt: "Add.",
    entry: "sum",
    cases: [
      { args: [2, 3], reference: { kind: "expected", value: 5 } },
      { args: [-1, 1], reference: { kind: "expected", value: 0 } },
    ],
    ...overrides,
  };
}

void test("grades every case against its own expected and runs the learner's code once", async () => {
  const { runner, requests } = createScriptedCodeRunner(() => ranWith([5, 1]));
  const attempt = await runCodePracticeAttempt(runner, practice(), "learner code");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.code, "learner code");
  assert.equal(requests[0]?.entry, "sum");
  assert.deepEqual(requests[0]?.cases, [
    [2, 3],
    [-1, 1],
  ]);
  assert.equal(attempt.run.kind, "ran");
  assert.deepEqual(
    attempt.cases.map((c) => c.passed),
    [true, false],
  );
  assert.deepEqual(
    attempt.cases.map((c) => c.value),
    [5, 1],
  );
  assert.deepEqual(
    attempt.cases.map((c) => c.args),
    [
      [2, 3],
      [-1, 1],
    ],
  );
  assert.equal(attempt.allPassed, false);
});

void test("an expected of null is a value, not an absence (Review Focus 4)", async () => {
  const p = practice({ cases: [{ args: [], reference: { kind: "expected", value: null } }] });
  const nullRun = await runCodePracticeAttempt(createScriptedCodeRunner(() => ranWith([null])).runner, p, "x");
  const undefRun = await runCodePracticeAttempt(
    createScriptedCodeRunner(() => ranWith([{ $undefined: true }])).runner,
    p,
    "x",
  );
  assert.equal(nullRun.allPassed, true);
  assert.equal(undefRun.allPassed, false);
});

void test("runs the solution first and takes the reference of a solution-graded case from it", async () => {
  const { runner, requests } = createScriptedCodeRunner((request) =>
    request.code === SOLUTION ? ranWith([5, 99]) : ranWith([5, 15]),
  );
  const p = practice({
    solution: SOLUTION,
    cases: [
      { args: [2, 3], reference: { kind: "solution" } },
      // Both present: the explicit `expected` wins over what the solution returned.
      { args: [10, 5], reference: { kind: "expected", value: 15 } },
    ],
  });
  const attempt = await runCodePracticeAttempt(runner, p, "learner code");

  assert.deepEqual(
    requests.map((r) => r.code),
    [SOLUTION, "learner code"],
  );
  assert.deepEqual(requests[0]?.cases, [
    [2, 3],
    [10, 5],
  ]);
  assert.deepEqual(
    attempt.cases.map((c) => c.passed),
    [true, true],
  );
  assert.equal(attempt.allPassed, true);
});

for (const [label, result] of [
  ["does not load", { kind: "load_failed", durationMs: 1, error: { message: "SyntaxError: boom" } }],
  ["exports no such function", { kind: "entry_missing", durationMs: 1, exported: ["Sum"] }],
  ["times out (Review Focus 5)", { kind: "timeout", durationMs: 1, cases: [] }],
  ["crashes", { kind: "crashed", durationMs: 1, exitCode: 134, signal: null, stderr: "heap out of memory" }],
  [
    "throws on a case",
    { kind: "ran", durationMs: 1, cases: [{ error: { message: "nope" }, output: "", truncated: false }] },
  ],
] as const) {
  void test(`a solution that ${label} is CodeSolutionError, and the learner's code never runs`, async () => {
    const { runner, requests } = createScriptedCodeRunner(() => result);
    const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
    await assert.rejects(runCodePracticeAttempt(runner, p, "learner"), (err) => isCodeSolutionError(err));
    assert.equal(requests.length, 1);
  });
}

void test("a solution error message never contains the solution's text", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "load_failed",
    durationMs: 1,
    error: { message: "bad" },
  }));
  const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(runner, p, "learner"), (err: Error) => !err.message.includes(SOLUTION));
});

void test("a runner that is unavailable is CodeRunnerUnavailableError for the solution AND for the learner", async () => {
  const unavailable = createScriptedCodeRunner(() => ({
    kind: "unavailable",
    durationMs: 1,
    message: "spawn ENOENT",
  })).runner;
  await assert.rejects(runCodePracticeAttempt(unavailable, practice(), "x"), (err) => isCodeRunnerUnavailableError(err));
  const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(unavailable, p, "x"), (err) => isCodeRunnerUnavailableError(err));
});

void test("a timeout keeps the finished cases' verdicts and fails the rest", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "timeout",
    durationMs: 1,
    cases: [{ value: 5, output: "", truncated: false }],
  }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.equal(attempt.run.kind, "timeout");
  assert.deepEqual(
    attempt.cases.map((c) => c.passed),
    [true, false],
  );
  assert.equal(attempt.cases[1]?.value, undefined);
  assert.equal(attempt.allPassed, false);
});

void test("a learner's module that does not load fails every case without a value", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "load_failed",
    durationMs: 1,
    error: { message: "SyntaxError" },
  }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.equal(attempt.run.kind, "load_failed");
  assert.deepEqual(
    attempt.cases.map((c) => c.passed),
    [false, false],
  );
  assert.equal(attempt.allPassed, false);
});

void test("a case that threw is failed and carries the learner's error", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "ran",
    durationMs: 1,
    cases: [
      { value: 5, output: "hi\n", truncated: false },
      { error: { message: "negative" }, output: "", truncated: false },
    ],
  }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.deepEqual(
    attempt.cases.map((c) => c.passed),
    [true, false],
  );
  assert.equal(attempt.cases[0]?.output, "hi\n");
  assert.equal(attempt.cases[1]?.error?.message, "negative");
});

// --- Final-review finding #1: the real runner must not leak the solution --

void test("a broken solution's 422 message never carries the solution's source, even through node's own text", async () => {
  // Non-erasable TypeScript: node's error message quotes the offending
  // source lines — which, for a solution, is the answer.
  const secret = "enum Secret { AuthorAnswer = 42 }\nexport function sum(a: number, b: number) { return Secret.AuthorAnswer; }";
  const p = practice({ language: "typescript", solution: secret, cases: [{ args: [1, 2], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(createNodeRunner(), p, "export function sum() { return 0; }"), (err: Error) => {
    assert.ok(isCodeSolutionError(err));
    assert.ok(!err.message.includes("Secret"), err.message);
    assert.ok(!err.message.includes("AuthorAnswer"), err.message);
    return true;
  });
});

void test("a solution that crashes the process (stderr path) does not leak its source either", async () => {
  // An uncaught exception from a microtask brings the process down mid-run;
  // node prints the throwing SOURCE LINE with a caret to stderr.
  const secret = "export function sum(a, b) { queueMicrotask(() => { throw new Error('secret author bug'); }); return a + b; }";
  const p = practice({ solution: secret, cases: [{ args: [1, 2], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(createNodeRunner(), p, "export function sum() { return 0; }"), (err: Error) => {
    assert.ok(isCodeSolutionError(err));
    assert.ok(!err.message.includes("secret author bug"), err.message);
    return true;
  });
});
