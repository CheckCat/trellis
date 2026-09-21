// The `answer` practice mechanic: the exercise was done outside the
// platform (Excel, a BI dashboard, paper) and the learner types in the
// values they arrived at.
//
// A separate strategy rather than a mode of the `sql` one: the two share
// neither a request body (SQL text vs a map of typed-in answers), a
// response, nor a dependency — this one never touches the sandbox and
// works on a course that declares none at all. Folding them together would
// mean one handler whose every line is behind an `if`.

import type { FastifyInstance } from "fastify";

import { MAX_ANSWER_VALUE_LENGTH } from "../../capabilities.js";
import type { CourseAnswerPractice } from "../../courses/types.js";
import { gradeAnswers } from "../../practice/answer.js";
import { lessonCompletionMode } from "../../progress/model.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  toLessonCompletionPayload,
} from "../progress.js";
import { resolvePractice, type PracticeStrategy } from "./shared.js";

export const answerPracticeStrategy: PracticeStrategy = {
  type: "answer",
  register(fastify: FastifyInstance) {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { answers: Record<string, string> } }>(
    "/courses/:courseId/lessons/:lessonId/practice/answer",
    {
      schema: {
        params: lessonParamsSchema,
        body: practiceAnswerBodySchema,
        response: {
          200: practiceAnswerResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resolved = resolvePractice(request, reply, "answer");
      if (resolved === undefined) {
        // `resolvePractice` already answered (404/409) — see shared.ts.
        return reply;
      }
      const { course, location } = resolved;
      const practice = resolved.practice as CourseAnswerPractice;

      // Pure, and the whole of the grading: no sandbox is prepared, no
      // connection is taken, nothing is executed. An `answer` lesson works
      // in a course with no sandboxes at all, and must not be able to fail
      // because Postgres is busy.
      const verdict = gradeAnswers(practice.fields, request.body.answers);

      if (verdict.ok && lessonCompletionMode(location.lesson) === "practice") {
        // Idempotent, and one-way (task 007): a repeat pass never moves
        // `completedAt`, and a later wrong submission never un-completes —
        // which is also what makes "исправить и отправить снова" safe.
        await fastify.progress.markLessonCompleted({
          courseId: course.id,
          lessonId: location.lesson.id,
          courseVersion: course.version,
        });
      }

      const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
      return { ok: verdict.ok, fields: verdict.fields, ...payload };
    },
  );
  },
};

// --- JSON Schemas --------------------------------------------------------

const practiceAnswerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "object",
      // Field ids are course data, so the keys cannot be enumerated here.
      // `propertyNames` still pins them to the manifest's own id charset
      // (courses/manifest.schema.json's `answerField.id`), and the values
      // are always strings: a form submits text, and reading "18,5" as a
      // number is the backend's job (practice/answer.ts), not the
      // client's — a client that parsed it first would be a second,
      // divergent implementation of the same rule.
      propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
      additionalProperties: { type: "string", maxLength: MAX_ANSWER_VALUE_LENGTH },
    },
  },
} as const;

const practiceAnswerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "fields", "lesson", "course"],
  properties: {
    /** True only when every declared field is correct — see answer.ts. */
    ok: { type: "boolean" },
    fields: {
      type: "object",
      // One entry per DECLARED field, keyed by field id. A boolean each,
      // and nothing else: the expected value, how far off a number was,
      // and in which direction are all parts of the answer.
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["correct"],
        properties: { correct: { type: "boolean" } },
      },
    },
    // The same `{ lesson, course }` pair every other write endpoint
    // answers with, so one response redraws the lesson's status and the
    // course counters.
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
