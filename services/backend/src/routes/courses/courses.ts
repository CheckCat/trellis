import type { FastifyInstance, FastifyReply } from "fastify";

import { ANSWER_FIELD_KINDS, PRACTICE_TYPES } from "../../capabilities/index.js";
import type { Course, CourseLesson, CoursePractice } from "../../courses/types.js";

/**
 * Course content API — read-only, backed by `fastify.courses` (the in-memory
 * registry decorated in server.ts, see courses/registry.ts). No mutation
 * beyond `POST /courses/rescan`, which just re-triggers the same scan the
 * registry already runs at startup.
 *
 * The one rule enforced consistently across every handler here: quiz
 * correctness and `practice.check` never leave this process — they're the
 * answers to the course's own assignments (task-006 brief). See
 * `toLessonResponse` below for where that's enforced.
 */
export default async function coursesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/courses",
    { schema: { response: { 200: coursesListResponseSchema } } },
    // Object wrapper, not a bare array (fix round 1, coordinator's call):
    // the other three endpoints all return objects, and an object here
    // leaves room to add fields later (e.g. a rejected-package count)
    // without a breaking response-shape change once 013 depends on this.
    async () => ({ courses: fastify.courses.list() }),
  );

  fastify.get<{ Params: { courseId: string } }>(
    "/courses/:courseId",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: courseDetailResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      return toCourseDetailResponse(course);
    },
  );

  fastify.get<{ Params: { courseId: string; lessonId: string } }>(
    "/courses/:courseId/lessons/:lessonId",
    {
      schema: {
        params: lessonParamsSchema,
        response: { 200: lessonResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      const lesson = findLesson(course, request.params.lessonId);
      if (lesson === undefined) {
        return reply.code(404).send({
          error: "lesson_not_found",
          message: `Lesson "${request.params.lessonId}" was not found in course "${course.id}".`,
        });
      }
      return toLessonResponse(lesson);
    },
  );

  fastify.post(
    "/courses/rescan",
    { schema: { response: { 200: rescanResponseSchema } } },
    async () => {
      // Logging a rejected package is the registry's job, not this route's
      // (see courses/registry.ts's `logger.warn` inside `rescan()`) — it
      // already logs one line per rejection on every scan, including this
      // one; logging the same list again here would double it (fix round
      // 1). This handler's only job is to shape the HTTP response.
      const result = fastify.courses.rescan();
      const rejectedCourses = fastify.courses.listRejected();
      // Fix round 2: `scanFailed`/`scanError` must reach the HTTP client,
      // not just the server log — this is a local single-user app, nobody
      // is tailing logs for the person who clicked "rescan". Without this,
      // a failed scan (e.g. COURSES_DIR became unreadable) came back
      // indistinguishable from a genuine successful no-op rescan.
      return {
        accepted: result.accepted,
        rejected: result.rejected,
        rejectedCourses,
        scanFailed: result.scanFailed,
        scanError: result.scanError,
      };
    },
  );
}

function sendCourseNotFound(reply: FastifyReply, courseId: string): FastifyReply {
  return reply.code(404).send({ error: "course_not_found", message: `Course "${courseId}" was not found.` });
}

function findLesson(course: Course, lessonId: string): CourseLesson | undefined {
  for (const module of course.modules) {
    const lesson = module.lessons.find((candidate) => candidate.id === lessonId);
    if (lesson !== undefined) {
      return lesson;
    }
  }
  return undefined;
}

function toCourseDetailResponse(course: Course) {
  return {
    id: course.id,
    version: course.version,
    title: course.title,
    description: course.description,
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        hasContent: lesson.content !== undefined,
        hasQuiz: lesson.quiz !== undefined,
        hasPractice: lesson.practice !== undefined,
      })),
    })),
  };
}

/**
 * Maps a `CourseLesson` to the public lesson shape. This is the one place
 * that must never let a quiz's correct answer or a practice's own answers
 * leak out: quiz options are rebuilt as `{ id, text }` pairs only — dropping
 * `correct` on every option, not just the true one, and dropping
 * `explanation` on every option too. Stripping `correct` alone would still
 * leak the answer indirectly (this project's manifest rule makes
 * `explanation` required on every *incorrect* option and optional on the
 * correct one, so "which option has no explanation" would out it) — see
 * courses/validate.ts's quiz rules and the task-006 brief.
 *
 * The same rebuild-don't-strip rule applies to practice: whichever kind it
 * is, the response is built field by field from the few things a client
 * needs to RENDER the assignment. `check`/`expected`/`ordered` and an
 * answer field's `expected`/`tolerance` are never named here, so a new
 * answer-bearing manifest property cannot start leaking by default.
 */
function toLessonResponse(lesson: CourseLesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    content: lesson.content,
    quiz:
      lesson.quiz === undefined
        ? undefined
        : {
            question: lesson.quiz.question,
            options: lesson.quiz.options.map((option) => ({ id: option.id, text: option.text })),
          },
    practice: lesson.practice === undefined ? undefined : toPublicPractice(lesson.practice),
  };
}

/**
 * The learner-facing shape of one assignment — the place where "what the
 * course wrote" becomes "what the browser is told".
 *
 * Every kind is named and the switch is exhaustive (`never` below), so a
 * practice type added to the domain stops the build here. That matters
 * more than it looks: `publicPracticeSchema` serializes with
 * `additionalProperties: false`, so a kind that fell through to the `sql`
 * branch would not error — it would reach the browser as a prompt with its
 * payload quietly stripped.
 */
function toPublicPractice(practice: CoursePractice) {
  switch (practice.type) {
    case "answer":
      return {
        type: practice.type,
        prompt: practice.prompt,
        fields: practice.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind })),
      };
    case "sql":
      return { type: practice.type, prompt: practice.prompt, sandbox: practice.sandbox };
    default: {
      const unhandled: never = practice;
      throw new Error(`no public shape for practice type ${JSON.stringify((unhandled as { type: string }).type)}`);
    }
  }
}

// --- JSON Schemas (plain JSON Schema, no TypeBox — see task-003 report's
// Deferred decisions on why this codebase doesn't use TypeBox for route
// schemas) --------------------------------------------------------------

const courseSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "title"],
  properties: {
    id: { type: "string" },
    version: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
  },
} as const;

const coursesListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["courses"],
  properties: {
    courses: { type: "array", items: courseSummarySchema },
  },
} as const;

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string" } },
} as const;

const lessonParamsSchema = {
  type: "object",
  required: ["courseId", "lessonId"],
  properties: { courseId: { type: "string" }, lessonId: { type: "string" } },
} as const;

const lessonSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "hasContent", "hasQuiz", "hasPractice"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    hasContent: { type: "boolean" },
    hasQuiz: { type: "boolean" },
    hasPractice: { type: "boolean" },
  },
} as const;

const moduleSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "lessons"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    lessons: { type: "array", items: lessonSummarySchema },
  },
} as const;

const courseDetailResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "title", "modules"],
  properties: {
    id: { type: "string" },
    version: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    modules: { type: "array", items: moduleSummarySchema },
  },
} as const;

const notFoundResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
} as const;

// Public quiz/practice shapes: deliberately narrower than the domain
// CourseQuiz/CoursePractice types (no `correct`/`explanation`/`check`) —
// `additionalProperties: false` here is also a safety net against
// accidentally widening `toLessonResponse` later without updating this
// schema, since Fastify's response serializer drops/rejects fields the
// schema doesn't declare.
const publicQuizOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "text"],
  properties: { id: { type: "string" }, text: { type: "string" } },
} as const;

const publicQuizSchema = {
  type: "object",
  additionalProperties: false,
  required: ["question", "options"],
  properties: {
    question: { type: "string" },
    options: { type: "array", items: publicQuizOptionSchema },
  },
} as const;

/** One input of an `answer` assignment, as the client needs to render it:
 * what to call it and what sort of value to ask for. `expected` and
 * `tolerance` are the answer and stay on the server — same rule as a quiz
 * option's `correct` and a practice's `check`. */
export const publicAnswerFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "kind"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    kind: { type: "string", enum: [...ANSWER_FIELD_KINDS] },
  },
} as const;

/** One schema for both kinds, `type` telling them apart: fast-json-stringify
 * has no discriminated-union support, and `additionalProperties: false`
 * already guarantees nothing beyond these fields is serialized either way.
 * `sandbox` is present only for `sql`, `fields` only for `answer` — see
 * `toLessonResponse`.
 *
 * `enum` is spread from `PRACTICE_TYPES` (capabilities.ts), not written out:
 * fast-json-stringify still compiles this to one literal schema at startup
 * (the spread runs once, at module load, same as any other `as const`
 * value) — but a type the registry gains now shows up here automatically
 * instead of depending on courses.schema.test.ts to catch the drift.
 * Getting it wrong is quiet in the worst way — `additionalProperties:
 * false` strips whatever the schema does not name. */
export const publicPracticeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "prompt"],
  properties: {
    type: { type: "string", enum: [...PRACTICE_TYPES] },
    prompt: { type: "string" },
    sandbox: { type: "string" },
    fields: { type: "array", items: publicAnswerFieldSchema },
  },
} as const;

const lessonResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    content: { type: "string" },
    quiz: publicQuizSchema,
    practice: publicPracticeSchema,
  },
} as const;

const validationErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "message"],
  properties: { path: { type: "string" }, message: { type: "string" } },
} as const;

const rejectedCourseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dir", "errors"],
  properties: {
    dir: { type: "string" },
    courseId: { type: "string" },
    errors: { type: "array", items: validationErrorSchema },
  },
} as const;

const rescanResponseSchema = {
  type: "object",
  additionalProperties: false,
  // scanFailed is required (always present, true or false) so a client
  // can't mistake its absence for "false" — scanError stays optional,
  // present only when scanFailed is true (fix round 2).
  required: ["accepted", "rejected", "rejectedCourses", "scanFailed"],
  properties: {
    // When scanFailed is true, these describe the PREVIOUS (unchanged)
    // state, not a fresh scan's result — see RescanResult's doc comment in
    // courses/registry.ts. A client must check scanFailed before reading
    // these as "what this rescan found".
    accepted: { type: "integer" },
    rejected: { type: "integer" },
    rejectedCourses: { type: "array", items: rejectedCourseSchema },
    scanFailed: { type: "boolean" },
    scanError: { type: "string" },
  },
} as const;
