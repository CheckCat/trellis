// Quiz API: a single endpoint that grades one answer and, when it's the
// right one, completes the lesson. Two quiz kinds share it, told apart by
// the course's own declaration (`quiz.multiple`): a single-choice quiz is
// answered with `{ optionId }`, a multi-select one with `{ optionIds }` —
// the whole set graded at once.
//
// What this endpoint must never do, in order:
//  - reveal anything about options the caller did not pick (not in a field,
//    not in a message, not by returning some options' explanations and not
//    others'). Single-choice: the client learns exactly one bit — whether
//    the option IT chose is right — plus that option's own explanation.
//    Multi-select: the same, per CHOSEN option; the one extra hint is the
//    overall verdict, so "every pick right, overall wrong" tells the client
//    correct options are missing — but never which, or how many. (Yes,
//    checking every box reveals the whole answer in one attempt; accepted
//    deliberately — docs/product/analysis-grey-zones.md — attempts are
//    unlimited, so single-choice was enumerable one try at a time anyway.)
//  - store an attempt. Wrong answers write nothing at all: tries are
//    unlimited and no history is kept (product model);
//  - un-complete anything. Answering wrong after a correct answer leaves the
//    lesson completed; `status` in the response reflects that honestly.

import type { FastifyInstance, FastifyReply } from "fastify";

import type { CourseQuiz } from "../../courses/types.js";
import { findLesson, gradeMultiQuizAnswer, gradeQuizAnswer } from "../../progress/model/index.js";
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

interface QuizAnswerBody {
  optionId?: string;
  optionIds?: string[];
}

export default async function quizRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: QuizAnswerBody }>(
    "/courses/:courseId/lessons/:lessonId/quiz/answer",
    {
      schema: {
        params: lessonParamsSchema,
        // Field TYPES are the schema's job (`additionalProperties: false`
        // included, so a client can't smuggle extra fields past it); which
        // ONE of the two fields the request must carry depends on the
        // quiz's own kind, which a static schema can't know — the handler
        // rejects a shape mismatch as `wrong_answer_shape` below. Both
        // fields optional here, never both accepted there.
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

      const { optionId, optionIds } = request.body;
      let verdict;
      if (quiz.multiple) {
        if (optionIds === undefined || optionId !== undefined) {
          return sendWrongAnswerShape(reply, quiz);
        }
        verdict = gradeMultiQuizAnswer(quiz, optionIds);
      } else {
        if (optionId === undefined || optionIds !== undefined) {
          return sendWrongAnswerShape(reply, quiz);
        }
        verdict = gradeQuizAnswer(quiz, optionId);
      }
      if (verdict === undefined) {
        // Not "incorrect": an id that isn't in this quiz is a malformed
        // request. Grading it as a wrong answer would also hand a client a
        // way to enumerate the option space.
        return reply.code(400).send({
          error: "unknown_option",
          message: `The submitted option id(s) include one that is not one of this quiz's options.`,
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
      // The two verdict shapes share `correct`; only the matching detail
      // field is attached (`explanation` for single, `options` for multi) —
      // the response schema's `additionalProperties: false` guards the rest.
      return "options" in verdict
        ? { correct: verdict.correct, options: verdict.options, ...payload }
        : { correct: verdict.correct, explanation: verdict.explanation, ...payload };
    },
  );
}

function sendWrongAnswerShape(reply: FastifyReply, quiz: CourseQuiz): FastifyReply {
  return reply.code(400).send({
    error: "wrong_answer_shape",
    message: quiz.multiple
      ? 'This quiz is answered with "optionIds" alone — it is a multi-select quiz (quiz.multiple: true), graded on the whole set at once.'
      : 'This quiz is answered with "optionId" alone — it is a single-choice quiz.',
  });
}

const quizAnswerBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    optionId: { type: "string", minLength: 1 },
    optionIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 },
    },
  },
} as const;

/** One chosen option's verdict in a multi-select answer — mirrors
 * `MultiQuizOptionVerdict`. Only ever describes options the caller itself
 * submitted. */
const quizAnswerOptionVerdictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "correct"],
  properties: {
    id: { type: "string" },
    correct: { type: "boolean" },
    explanation: { type: "string" },
  },
} as const;

const quizAnswerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "lesson", "course"],
  properties: {
    correct: { type: "boolean" },
    // The chosen option's own explanation, when it has one (single-choice
    // answers only). Note what is NOT here and cannot be added without also
    // changing this schema (`additionalProperties: false` drops undeclared
    // fields): the correct option's id, the other options' explanations,
    // any verdict on an option the caller didn't submit.
    explanation: { type: "string" },
    // Multi-select answers only: per-option verdicts for the CHOSEN set, in
    // submission order.
    options: { type: "array", items: quizAnswerOptionVerdictSchema },
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
