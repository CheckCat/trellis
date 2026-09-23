// The `code` practice mechanic: run the learner's exported function in a
// child node process on every case the course declares, compare what it
// returns with the reference, and complete the lesson when every case
// passes.
//
// One request does the whole loop (run solution if any, run the learner,
// grade, record) — same reasoning as the sql strategy: a client must not
// be able to grade without running, or show a result a later verdict
// contradicts.
//
// The three failure classes, in the same statuses the sql strategy uses:
//   - the learner's own doing — module does not load, wrong export, throws,
//     times out, returns the wrong thing: 200 with `ok`/`passed` false and
//     node's own words;
//   - broken course content — the SOLUTION does any of the above: 422
//     `solution_failed`, never a wrong-answer verdict;
//   - this build cannot run code — node did not start: 503 `unavailable`.

import type { FastifyInstance } from "fastify";

import { MAX_PRACTICE_CODE_LENGTH } from "../../../capabilities/index.js";
import type { CourseCodePractice } from "../../../courses/types.js";
import { lessonCompletionMode } from "../../../progress/model/index.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  toLessonCompletionPayload,
} from "../../../routes/progress/index.js";
import { resolvePractice, type PracticeStrategy } from "../api.js";
import { isCodeRunnerUnavailableError, isCodeSolutionError } from "./errors.js";
import { describeFailure, runCodePracticeAttempt, type CodePracticeAttemptResult } from "./run-code.js";
import { createNodeRunner, type CodeRunner } from "./run-node.js";

export interface CreateCodePracticeStrategyOptions {
  readonly runner: CodeRunner;
}

/** The strategy over an injectable runner — tests script the runner
 * instead of spawning node. The shipped one is `codePracticeStrategy`. */
export function createCodePracticeStrategy(options: CreateCodePracticeStrategyOptions): PracticeStrategy {
  const { runner } = options;
  return {
    type: "code",
    register(fastify: FastifyInstance) {
      fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { code: string } }>(
        "/courses/:courseId/lessons/:lessonId/practice/code",
        {
          schema: {
            params: lessonParamsSchema,
            body: practiceCodeBodySchema,
            response: {
              200: practiceCodeResponseSchema,
              400: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
              422: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const resolved = resolvePractice(request, reply, "code");
          if (resolved === undefined) {
            // `resolvePractice` already answered (404/409) — see api.ts.
            return reply;
          }
          const { course, location } = resolved;
          const practice = resolved.practice as CourseCodePractice;

          let attempt: CodePracticeAttemptResult;
          try {
            attempt = await runCodePracticeAttempt(runner, practice, request.body.code);
          } catch (err) {
            if (isCodeSolutionError(err)) {
              request.log.warn({ err }, "code practice solution is broken");
              return reply.code(422).send({ error: err.kind, message: err.message });
            }
            if (isCodeRunnerUnavailableError(err)) {
              request.log.error({ err }, "code runner unavailable");
              return reply.code(503).send({ error: err.kind, message: err.message });
            }
            throw err;
          }

          // A lesson carrying both a quiz and a graded practice is gated by
          // its quiz (progress/model.ts): the verdict is still reported,
          // completing stays the quiz's job.
          if (attempt.allPassed && lessonCompletionMode(location.lesson) === "practice") {
            // Idempotent, and one-way: a repeat pass never moves
            // `completedAt`, a later failure never un-completes.
            await fastify.progress.markLessonCompleted({
              courseId: course.id,
              lessonId: location.lesson.id,
              courseVersion: course.version,
            });
          }

          const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
          const { run } = attempt;
          return {
            ok: run.kind === "ran",
            ...(run.kind === "ran" ? {} : { failure: { kind: run.kind, message: describeFailure(run) } }),
            durationMs: run.durationMs,
            cases: attempt.cases.map((verdict) => ({
              args: verdict.args,
              passed: verdict.passed,
              ...(verdict.value === undefined ? {} : { value: verdict.value }),
              ...(verdict.error === undefined ? {} : { error: { message: verdict.error.message } }),
              output: verdict.output,
              truncated: verdict.truncated,
            })),
            passed: attempt.allPassed,
            ...payload,
          };
        },
      );
    },
  };
}

export const codePracticeStrategy: PracticeStrategy = createCodePracticeStrategy({ runner: createNodeRunner() });

// --- JSON Schemas --------------------------------------------------------

const practiceCodeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    // Same rules as the sql body: no whitespace-only submissions, finite.
    code: { type: "string", pattern: "\\S", minLength: 1, maxLength: MAX_PRACTICE_CODE_LENGTH },
  },
} as const;

const practiceCodeCaseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["args", "passed", "output", "truncated"],
  properties: {
    // Inputs are public; `value` is the learner's OWN return value in the
    // encoded form compare.ts describes. An untyped schema (`{}`) makes
    // fast-json-stringify pass the value through JSON.stringify as-is.
    args: { type: "array" },
    passed: { type: "boolean" },
    value: {},
    error: {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: { message: { type: "string" } },
    },
    output: { type: "string" },
    truncated: { type: "boolean" },
  },
} as const;

const practiceCodeFailureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "message"],
  properties: {
    kind: { type: "string", enum: ["load_failed", "entry_missing", "timeout", "crashed"] },
    message: { type: "string" },
  },
} as const;

const practiceCodeResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "durationMs", "cases", "passed", "lesson", "course"],
  properties: {
    /** The module loaded and every case was called. */
    ok: { type: "boolean" },
    /** Present iff `ok` is false. */
    failure: practiceCodeFailureSchema,
    durationMs: { type: "integer" },
    cases: { type: "array", items: practiceCodeCaseSchema },
    passed: { type: "boolean" },
    // The same `{ lesson, course }` pair every other write endpoint
    // answers with, so one response redraws the lesson's status and the
    // course counters.
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
