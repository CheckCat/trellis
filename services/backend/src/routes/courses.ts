import type { FastifyInstance, FastifyReply } from "fastify";

import type { Course, CourseLesson } from "../courses/types.js";

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
    async () => fastify.courses.list(),
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
      const result = fastify.courses.rescan();
      const rejectedCourses = fastify.courses.listRejected();
      for (const rejected of rejectedCourses) {
        fastify.log.warn(
          { dir: rejected.dir, courseId: rejected.courseId, errors: rejected.errors },
          "course package rejected during rescan",
        );
      }
      return { accepted: result.accepted, rejected: result.rejected, rejectedCourses };
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
 * that must never let a quiz's correct answer or a practice's `check` query
 * leak out: quiz options are rebuilt as `{ id, text }` pairs only — dropping
 * `correct` on every option, not just the true one, and dropping
 * `explanation` on every option too. Stripping `correct` alone would still
 * leak the answer indirectly (this project's manifest rule makes
 * `explanation` required on every *incorrect* option and optional on the
 * correct one, so "which option has no explanation" would out it) — see
 * courses/validate.ts's quiz rules and the task-006 brief.
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
    practice:
      lesson.practice === undefined
        ? undefined
        : { sandbox: lesson.practice.sandbox, prompt: lesson.practice.prompt },
  };
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
  type: "array",
  items: courseSummarySchema,
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

const publicPracticeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sandbox", "prompt"],
  properties: {
    sandbox: { type: "string" },
    prompt: { type: "string" },
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
  required: ["accepted", "rejected", "rejectedCourses"],
  properties: {
    accepted: { type: "integer" },
    rejected: { type: "integer" },
    rejectedCourses: { type: "array", items: rejectedCourseSchema },
  },
} as const;
