// Practice API: run the learner's SQL in the course's sandbox and, when the
// course provided a check query, grade the attempt with it.
//
// The whole practice loop is ONE request (business-logic.md: "запрос
// выполняет backend в песочнице, результат или ошибка Postgres показываются
// как есть. Задание может нести check-запрос в manifest'е — после попытки
// движок выполняет его и трактует ответ как «зачтено/не зачтено»"): prepare
// the sandbox, run the user's SQL, run the check, record the completion.
// Splitting it would let a client run the check without an attempt, or show
// a result that a later check contradicts.
//
// Three things this endpoint deliberately does NOT do:
//   - it does not treat a failing statement as an API error. A syntax error
//     is what practising SQL looks like; it comes back 200 with `ok: false`
//     and Postgres' own words (same shape of decision as a wrong quiz
//     answer, which is also a 200);
//   - it does not complete lessons whose gate is not the practice check —
//     see `lessonCompletionMode` below;
//   - it does not expose the check query, its text, or its result shape. The
//     client learns one bit: passed or not.
//
// "Задание без check — самоотметка" (project invariant) needs no code here:
// such a lesson's completion mode is `manual`, so the existing
// `POST /courses/:courseId/lessons/:lessonId/complete` (task 007) is what
// completes it. This endpoint reports `check: { present: false }` so the UI
// knows to offer that button instead of waiting for a verdict.

import type { FastifyInstance } from "fastify";

import {
  executePracticeSql,
  resetSandboxSession,
  rollbackOpenTransaction,
  type PracticeExecution,
} from "../practice/execute.js";
import { isPracticeCheckError, runPracticeCheck, type PracticeCheckVerdict } from "../practice/check.js";
import { findLesson, lessonCompletionMode } from "../progress/model.js";
import { isSandboxError, SandboxError } from "../sandbox/types.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  sendCourseNotFound,
  sendLessonNotFound,
  toLessonCompletionPayload,
} from "./progress.js";
import { sendSandboxError } from "./sandbox.js";

export default async function practiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { sql: string } }>(
    "/courses/:courseId/lessons/:lessonId/practice/run",
    {
      schema: {
        params: lessonParamsSchema,
        body: practiceRunBodySchema,
        response: {
          200: practiceRunResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          422: practiceErrorResponseSchema,
          503: practiceErrorResponseSchema,
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
      const practice = location.lesson.practice;
      if (practice === undefined) {
        return reply.code(404).send({
          error: "practice_not_found",
          message: `Lesson "${location.lesson.id}" of course "${course.id}" has no practice assignment.`,
        });
      }

      let execution: PracticeExecution;
      let verdict: PracticeCheckVerdict | undefined;
      try {
        // Idempotent: the first practice request of a course pays for the
        // seed, later ones don't — re-seeding on every run would wipe the
        // tables the learner just created, mid-exercise.
        await fastify.sandbox.ensure(course.id, practice.sandbox);

        // One client for the attempt AND the check, so the check grades the
        // session the attempt left behind (temp tables and all) rather than
        // some other pooled connection's view.
        const attempt = await fastify.sandbox.driver.withClient(async (client) => {
          try {
            const executed = await executePracticeSql(client, request.body.sql);
            if (practice.check === undefined) {
              return { executed, checked: undefined };
            }
            // Before the check, not after: an attempt that failed inside a
            // transaction leaves the session in the "current transaction is
            // aborted" state, where the check query cannot run at all, and
            // an attempt that opened a transaction and never closed it must
            // not have its uncommitted work graded as if it were durable.
            await rollbackOpenTransaction(client);
            const checked = await runPracticeCheck(client, {
              sql: practice.check,
              courseId: course.id,
              lessonId: location.lesson.id,
            });
            return { executed, checked };
          } finally {
            // Whatever happened — a broken check throwing included — the
            // connection goes back to the pool carrying none of this
            // request's session state (see `resetSandboxSession`).
            await resetSandboxSession(client);
          }
        });
        execution = attempt.executed;
        verdict = attempt.checked;
      } catch (err) {
        if (isPracticeCheckError(err)) {
          // Broken check query — course content, not a failed attempt. Same
          // class (and status) as a seed file the database rejects.
          request.log.warn({ err }, "practice check query is broken");
          return reply.code(422).send({
            error: err.kind,
            message: err.message,
            ...(err.databaseError === undefined ? {} : { databaseError: err.databaseError }),
          });
        }
        // executePracticeSql (practice/execute.ts) rethrows exactly here:
        // when the failure it caught was not the submitted statement's own
        // fault (its docstring's example is the sandbox connection dying
        // mid-query). Such a failure is not course content and not a wrong
        // answer, so it must not reach the learner as `ok: false` — it is
        // reported the same way any other unreachable sandbox is
        // (`unavailable`, 503), carrying the underlying error's own words.
        const sandboxErr = isSandboxError(err)
          ? err
          : new SandboxError(
              "unavailable",
              `The practice sandbox connection failed: ${err instanceof Error ? err.message : String(err)}.`,
              { cause: err },
            );
        return sendSandboxError(request, reply, sandboxErr);
      }

      // A lesson carrying both a quiz and a checked practice is gated by its
      // quiz (progress/model.ts: one lesson, one gate). The verdict is still
      // reported honestly — the learner sees whether the exercise is right —
      // but completing the lesson stays the quiz's job, exactly as
      // `POST .../complete` refuses to do it by hand.
      if (verdict?.passed === true && lessonCompletionMode(location.lesson) === "practice") {
        // Idempotent (task 007): passing a second time never moves
        // `completedAt`, and a later failed attempt never un-completes.
        await fastify.progress.markLessonCompleted({
          courseId: course.id,
          lessonId: location.lesson.id,
          courseVersion: course.version,
        });
      }

      const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
      return {
        ok: execution.ok,
        ...(execution.ok ? { result: execution.result } : { error: execution.error }),
        durationMs: execution.durationMs,
        check:
          practice.check === undefined
            ? { present: false }
            : { present: true, passed: verdict?.passed === true },
        ...payload,
      };
    },
  );
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const practiceRunBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sql"],
  properties: {
    sql: {
      type: "string",
      // `pattern` is an unanchored search: this rejects whitespace-only
      // submissions (which Postgres would happily accept as an empty
      // command, answering with a resultless result nobody can read) while
      // leaving every real statement alone.
      pattern: "\\S",
      minLength: 1,
      // Generous for a single exercise, finite for a local editor. Well
      // under Fastify's own 1MB body limit, so an oversized submission is
      // rejected as a validation error naming the field rather than as a
      // transport error.
      maxLength: 50000,
    },
  },
} as const;

const practiceColumnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "dataTypeId"],
  properties: { name: { type: "string" }, dataTypeId: { type: "integer" } },
} as const;

const practiceResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rowCount", "columns", "rows", "truncated", "statementCount"],
  properties: {
    command: { type: "string" },
    // Nullable on purpose: Postgres reports no row count for some commands,
    // and `0` would be a different (wrong) claim.
    rowCount: { type: ["integer", "null"] },
    columns: { type: "array", items: practiceColumnSchema },
    // Positional cells, `null` for SQL NULL — see practice/execute.ts's
    // `PracticeResultSet.rows`/`formatCell`.
    rows: { type: "array", items: { type: "array", items: { type: ["string", "null"] } } },
    truncated: { type: "boolean" },
    statementCount: { type: "integer" },
  },
} as const;

const practiceSqlErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string" },
    severity: { type: "string" },
    code: { type: "string" },
    detail: { type: "string" },
    hint: { type: "string" },
    position: { type: "string" },
    where: { type: "string" },
  },
} as const;

const practiceCheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["present"],
  properties: {
    // `false` means the course set no check for this lesson: the lesson is
    // self-marked (invariant), and no verdict exists — which is why `passed`
    // is absent rather than `false` in that case.
    present: { type: "boolean" },
    passed: { type: "boolean" },
  },
} as const;

const practiceRunResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "durationMs", "check", "lesson", "course"],
  properties: {
    ok: { type: "boolean" },
    result: practiceResultSchema,
    error: practiceSqlErrorSchema,
    durationMs: { type: "integer" },
    check: practiceCheckSchema,
    // The same `{ lesson, course }` pair the other write endpoints answer
    // with (routes/progress.ts, routes/quiz.ts), so a client redraws the
    // lesson's status and the course counters from one response.
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;

// `errorResponseSchema` plus the database's own words, for a check query the
// database rejected — the same extra field routes/sandbox.ts exposes for a
// rejected seed. The check's TEXT is never part of it.
const practiceErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    seedFile: { type: "string" },
    databaseError: { type: "string" },
  },
} as const;
