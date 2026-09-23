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

import { MAX_ANSWER_VALUE_LENGTH } from "../../../capabilities.js";
import type { CourseAnswerPractice } from "../../../courses/types.js";
import { gradeAnswers } from "./grade.js";
import { lessonCompletionMode } from "../../../progress/model.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  toLessonCompletionPayload,
} from "../../../routes/progress.js";
import { resolvePractice, type PracticeStrategy } from "../api.js";

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

  // «Показать ответ» — the one door through which an `answer` assignment's
  // reference values leave the backend.
  //
  // The project invariant this narrows used to read "эталоны никогда не
  // покидают backend". What it was actually protecting against is the
  // answer travelling WITH the exercise: a `fields[].expected` riding along
  // in `GET .../lessons/:id` turns every task into a devtools lookup, and
  // nobody chose that. A learner who is stuck and explicitly asks to see
  // the answer is the opposite situation — the reveal IS the feature.
  //
  // So the rule is now "the reference never ships with the task; revealing
  // it is a separate, deliberate request", and this route is the whole of
  // that exception: a different URL, a different verb, nothing automatic.
  // Only `answer` assignments have one — a `sql` assignment's `check` and
  // `expected` are queries, i.e. the solution itself, and stay put.
  //
  // Not gated server-side on having failed first. The UI only offers the
  // button after a wrong submission, but the backend cannot honestly
  // enforce that: no attempt history is stored anywhere (progress/
  // repository.ts — a wrong answer writes nothing at all), so a server-side
  // gate would have to invent state whose only purpose is to be trivially
  // bypassed by calling this URL directly. Guarding a door whose key is
  // published is worse than not pretending to.
  fastify.get<{ Params: { courseId: string; lessonId: string } }>(
    "/courses/:courseId/lessons/:lessonId/practice/answer/solution",
    {
      schema: {
        params: lessonParamsSchema,
        response: {
          200: practiceAnswerSolutionResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resolved = resolvePractice(request, reply, "answer");
      if (resolved === undefined) {
        return reply;
      }
      const practice = resolved.practice as CourseAnswerPractice;
      return {
        fields: practice.fields.map((field) => ({
          id: field.id,
          label: field.label,
          // Stringified here, not on the client: `expected` is a number for
          // a numeric field, and JSON's number type is the same lossy one
          // practice results already stringify around (see
          // `PracticeResultSet`). The learner is shown the course's own
          // value, not a re-formatting of it.
          expected: String(field.expected),
          // Only when it actually widens the answer. `tolerance: 0` is
          // exact equality, and printing "±0" next to a number would read
          // as a property of the answer rather than the absence of one.
          ...(field.tolerance !== undefined && field.tolerance > 0 ? { tolerance: field.tolerance } : {}),
        })),
      };
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

const practiceAnswerSolutionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "expected"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          expected: { type: "string" },
          /** Absent unless the field tolerates a range — see the route. */
          tolerance: { type: "number" },
        },
      },
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
