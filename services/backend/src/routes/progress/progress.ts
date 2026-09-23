// Progress API: read the course tree with per-lesson statuses, and mark a
// lesson completed by hand.
//
// The course side of every answer comes from `fastify.courses` (the
// on-disk content registry), the status side from `fastify.progress` (the
// database) — they are joined per request by reconcile.ts, never stored
// joined. That is what keeps "content format" and "progress format" separate
// and lets a course be updated underneath existing progress.

import type { FastifyInstance, FastifyReply } from "fastify";

import type { Course } from "../../courses/types.js";
import { findLesson, lessonCompletionMode, type CourseProgressTree } from "../../progress/model/index.js";
import { reconcileCourseProgress } from "../../progress/reconcile/index.js";

export default async function progressRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/progress",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: courseProgressResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      return await buildTree(fastify, course);
    },
  );

  fastify.post<{ Params: { courseId: string; lessonId: string } }>(
    "/courses/:courseId/lessons/:lessonId/complete",
    {
      schema: {
        params: lessonParamsSchema,
        response: {
          200: lessonCompletionResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      const location = findLesson(course, request.params.lessonId);
      if (location === undefined) {
        return sendLessonNotFound(reply, course.id, request.params.lessonId);
      }

      // A lesson whose completion is earned (quiz answer, practice
      // grading) must not also be claimable by hand — that would make the
      // quiz and the grading mechanics decorative. The 409 names the gate
      // so the client can say what to do instead.
      const mode = lessonCompletionMode(location.lesson);
      if (mode !== "manual") {
        return reply.code(409).send({
          error: "manual_completion_not_allowed",
          message:
            mode === "quiz"
              ? `Lesson "${location.lesson.id}" is completed by answering its quiz correctly, not by marking it done.`
              : `Lesson "${location.lesson.id}" is completed by passing its practice assignment, not by marking it done.`,
        });
      }

      await fastify.progress.markLessonCompleted({
        courseId: course.id,
        lessonId: location.lesson.id,
        courseVersion: course.version,
      });
      return toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
    },
  );

  // «Перепройти курс» — the deliberate erase. DELETE on the progress
  // resource itself, not a POST to `.../reset`: this removes a resource's
  // contents and nothing else, and saying so in the method keeps it from
  // being mistaken for one more way to write progress.
  //
  // No confirmation flag in the request: unlike `POST /progress/import`,
  // where the server knows something the client cannot (the file is older
  // than local progress) and therefore has to ask, here the server knows
  // nothing the learner doesn't. Confirming is the UI's job, and putting a
  // `?confirm=true` here would only pretend the backend was guarding
  // something.
  fastify.delete<{ Params: { courseId: string } }>(
    "/courses/:courseId/progress",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: courseProgressResetResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }

      const deletedLessons = await fastify.progress.resetCourseProgress(course.id);
      // The tree is read back AFTER the delete, so the counters the client
      // redraws from are the post-reset ones — same "one response is enough
      // to repaint" contract the completion endpoints hold to.
      const tree = await buildTree(fastify, course);
      return {
        deletedLessons,
        course: {
          courseId: tree.courseId,
          courseVersion: tree.courseVersion,
          totalLessons: tree.totalLessons,
          completedLessons: tree.completedLessons,
          completed: tree.completed,
        },
      };
    },
  );
}

/** Reads this course's stored rows and joins them onto the course as
 * installed right now. Shared by both routes here and by routes/quiz.ts. */
export async function buildTree(fastify: FastifyInstance, course: Course): Promise<CourseProgressTree> {
  const records = await fastify.progress.listCourseProgress(course.id);
  return reconcileCourseProgress(course, records);
}

/**
 * The shape both write endpoints answer with: the affected lesson's fresh
 * status plus the course's counters, so a client never needs a second
 * request to redraw "7 of 12 done" after marking something.
 */
export function toLessonCompletionPayload(tree: CourseProgressTree, lessonId: string) {
  const lesson = tree.modules.flatMap((module) => module.lessons).find((candidate) => candidate.id === lessonId);
  if (lesson === undefined) {
    // Only reachable if the course changed on disk between the write and
    // this read (a rescan removing the lesson mid-request). Loud rather
    // than a half-filled response.
    throw new Error(
      `Lesson "${lessonId}" disappeared from course "${tree.courseId}" while its completion was being recorded.`,
    );
  }
  return {
    lesson,
    course: {
      courseId: tree.courseId,
      courseVersion: tree.courseVersion,
      totalLessons: tree.totalLessons,
      completedLessons: tree.completedLessons,
      completed: tree.completed,
    },
  };
}

export function sendCourseNotFound(reply: FastifyReply, courseId: string): FastifyReply {
  return reply.code(404).send({ error: "course_not_found", message: `Course "${courseId}" was not found.` });
}

export function sendLessonNotFound(reply: FastifyReply, courseId: string, lessonId: string): FastifyReply {
  return reply.code(404).send({
    error: "lesson_not_found",
    message: `Lesson "${lessonId}" was not found in course "${courseId}".`,
  });
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string" } },
} as const;

export const lessonParamsSchema = {
  type: "object",
  required: ["courseId", "lessonId"],
  properties: { courseId: { type: "string" }, lessonId: { type: "string" } },
} as const;

export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export const lessonProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "status", "completionMode", "hasContent", "hasQuiz", "hasPractice"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["completed", "not_started"] },
    completedAt: { type: "string" },
    completionMode: { type: "string", enum: ["manual", "quiz", "practice"] },
    hasContent: { type: "boolean" },
    hasQuiz: { type: "boolean" },
    hasPractice: { type: "boolean" },
  },
} as const;

const moduleProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "totalLessons", "completedLessons", "completed", "lessons"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
    lessons: { type: "array", items: lessonProgressSchema },
  },
} as const;

const orphanedProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lessonId", "completedAt"],
  properties: {
    lessonId: { type: "string" },
    completedAt: { type: "string" },
    courseVersion: { type: "string" },
  },
} as const;

const courseProgressResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "courseId",
    "courseVersion",
    "title",
    "totalLessons",
    "completedLessons",
    "completed",
    "modules",
    "orphanedLessons",
    "recordedVersions",
  ],
  properties: {
    courseId: { type: "string" },
    courseVersion: { type: "string" },
    title: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
    modules: { type: "array", items: moduleProgressSchema },
    // Completions whose lesson is no longer part of the course — kept in
    // the database, excluded from the counters above, reported here so the
    // UI can explain "3 completed lessons are not in this version".
    orphanedLessons: { type: "array", items: orphanedProgressSchema },
    recordedVersions: { type: "array", items: { type: "string" } },
  },
} as const;

export const courseProgressSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["courseId", "courseVersion", "totalLessons", "completedLessons", "completed"],
  properties: {
    courseId: { type: "string" },
    courseVersion: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
  },
} as const;

const courseProgressResetResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["deletedLessons", "course"],
  properties: {
    // How many completions were actually erased — 0 for a course that had
    // none, which is a success, not an error. The UI reports the number
    // back so a reset is never a silent no-op the learner has to verify.
    deletedLessons: { type: "integer" },
    course: courseProgressSummarySchema,
  },
} as const;

const lessonCompletionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lesson", "course"],
  properties: { lesson: lessonProgressSchema, course: courseProgressSummarySchema },
} as const;
