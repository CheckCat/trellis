// Quiz API: a single endpoint that grades one answer and, when it's the
// right one, completes the lesson.
//
// What this endpoint must never do, in order:
//  - reveal which option is correct (not in a field, not in a message, not
//    by returning some options' explanations and not others'). The client
//    learns exactly one bit about the quiz — whether the option IT chose is
//    right — plus that option's own explanation;
//  - store an attempt. Wrong answers write nothing at all: tries are
//    unlimited and no history is kept (product model);
//  - un-complete anything. Answering wrong after a correct answer leaves the
//    lesson completed; `status` in the response reflects that honestly.

import type { FastifyInstance } from "fastify";

import { findLesson, gradeQuizAnswer } from "../../progress/model/index.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  sendCourseNotFound,
  sendLessonNotFound,
  toLessonCompletionPayload,
} from "../progress/index.js";

export default async function quizRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { optionId: string } }>(
    "/courses/:courseId/lessons/:lessonId/quiz/answer",
    {
      schema: {
        params: lessonParamsSchema,
        // A body that isn't `{ optionId: "<non-empty string>" }` is
        // rejected by Fastify's own validation as a 400 before the handler
        // runs — `additionalProperties: false` included, so a client can't
        // smuggle extra fields past it.
        body: quizAnswerBodySchema,
        response: {
          200: quizAnswerResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
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
      const quiz = location.lesson.quiz;
      if (quiz === undefined) {
        return reply.code(404).send({
          error: "quiz_not_found",
          message: `Lesson "${location.lesson.id}" of course "${course.id}" has no quiz.`,
        });
      }

      const verdict = gradeQuizAnswer(quiz, request.body.optionId);
      if (verdict === undefined) {
        // Not "incorrect": an id that isn't in this quiz is a malformed
        // request. Grading it as a wrong answer would also hand a client a
        // way to enumerate the option space.
        return reply.code(400).send({
          error: "unknown_option",
          message: `Option "${request.body.optionId}" is not one of this quiz's options.`,
        });
      }

      if (verdict.correct) {
        await fastify.progress.markLessonCompleted({
          courseId: course.id,
          lessonId: location.lesson.id,
          courseVersion: course.version,
        });
      }

      // Read back the tree either way — after a wrong answer this reports
      // the unchanged status (which may well be "completed" already, from an
      // earlier correct answer), and after a right one, the stored
      // `completedAt` rather than a locally guessed timestamp.
      const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
      return { correct: verdict.correct, explanation: verdict.explanation, ...payload };
    },
  );
}

const quizAnswerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["optionId"],
  properties: { optionId: { type: "string", minLength: 1 } },
} as const;

const quizAnswerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "lesson", "course"],
  properties: {
    correct: { type: "boolean" },
    // The chosen option's own explanation, when it has one. Note what is
    // NOT here and cannot be added without also changing this schema
    // (`additionalProperties: false` drops undeclared fields): the correct
    // option's id, the other options' explanations, any per-option verdict
    // map.
    explanation: { type: "string" },
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
