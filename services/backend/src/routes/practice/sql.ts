// The `sql` practice mechanic: run the learner's SQL in the course's
// sandbox and grade the attempt with whichever of the core's declarative
// mechanics the course declared for that lesson.
//
// There are two, independent of each other (see .mvp/invariants.md):
//   - `check`    — SQL over the sandbox's STATE, answering one boolean.
//                  Grades an exercise that CHANGES the database;
//   - `expected` — a reference query whose RESULT SET the learner's result
//                  is compared against (practice/compare.ts). Grades a
//                  `SELECT`, which leaves no state to check.
// A lesson may declare either, both, or neither. With both, the lesson is
// completed only when both pass — they answer different questions ("did you
// change the data correctly" and "does your query return the right rows"),
// so neither one subsumes the other.
//
// The whole practice loop is ONE request (business-logic.md: "запрос
// выполняет backend в песочнице, результат или ошибка Postgres показываются
// как есть. Задание может нести check-запрос в manifest'е — после попытки
// движок выполняет его и трактует ответ как «зачтено/не зачтено»"): prepare
// the sandbox, run the user's SQL, grade it, record the completion.
// Splitting it would let a client grade without an attempt, or show a result
// that a later verdict contradicts.
//
// Three things this endpoint deliberately does NOT do:
//   - it does not treat a failing statement as an API error. A syntax error
//     is what practising SQL looks like; it comes back 200 with `ok: false`
//     and Postgres' own words (same shape of decision as a wrong quiz
//     answer, which is also a 200);
//   - it does not complete lessons whose gate is not the practice verdict —
//     see `lessonCompletionMode` below;
//   - it does not expose either grading query, its text, or its result
//     shape. The client learns one bit per mechanic, plus (for `expected`)
//     a reason phrased in counts and shapes only.
//
// "Задание без механик зачёта — самоотметка" (project invariant) needs no
// code here: such a lesson's completion mode is `manual`, so the existing
// `POST /courses/:courseId/lessons/:lessonId/complete` (task 007) is what
// completes it. This endpoint reports `{ present: false }` for both
// mechanics so the UI knows to offer that button instead of waiting for a
// verdict.

import type { FastifyInstance } from "fastify";

import { MAX_PRACTICE_SQL_LENGTH } from "../../capabilities.js";
import type { CourseSqlPractice } from "../../courses/types.js";
import {
  executePracticeSql,
  resetSandboxSession,
  rollbackOpenTransaction,
  type PracticeExecution,
} from "../../practice/execute.js";
import { isPracticeCheckError, runPracticeCheck, type PracticeCheckVerdict } from "../../practice/check.js";
import {
  compareResults,
  isPracticeExpectedError,
  MAX_COMPARISON_ROWS,
  readPracticeExpected,
  type ComparableResult,
  type PracticeExpectedVerdict,
} from "../../practice/compare.js";
import {
  assertDeterministic,
  comparePracticeState,
  isPracticeSolutionError,
  runPracticeSolution,
  snapshotSandboxState,
  type PracticeSolutionVerdict,
  type SandboxStateSnapshot,
} from "../../practice/state.js";
import { lessonCompletionMode } from "../../progress/model.js";
import { isPostgresSandboxDriver } from "../../sandbox/postgres-sandbox.js";
import { isSandboxError, SandboxError } from "../../sandbox/types.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  toLessonCompletionPayload,
} from "../progress.js";
import { sendSandboxError } from "../sandbox.js";
import { resolvePractice, type PracticeStrategy } from "./shared.js";

export const sqlPracticeStrategy: PracticeStrategy = {
  type: "sql",
  register(fastify: FastifyInstance) {
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
      const resolved = resolvePractice(request, reply, "sql");
      if (resolved === undefined) {
        // `resolvePractice` already answered (404/409) — see shared.ts.
        return reply;
      }
      const { course, location } = resolved;
      const practice = resolved.practice as CourseSqlPractice;

      let execution: PracticeExecution;
      let verdict: PracticeCheckVerdict | undefined;
      let expectedVerdict: PracticeExpectedVerdict | undefined;
      let solutionVerdict: PracticeSolutionVerdict | undefined;
      try {
        const driver = fastify.sandbox.drivers.get("postgres");
        if (!isPostgresSandboxDriver(driver)) {
          // The course declared a Postgres sandbox (validation guarantees
          // the type is registered), but this build has no driver for it.
          // Not course breakage and not a wrong answer — the same
          // `unavailable` any unreachable sandbox answers with.
          throw new SandboxError(
            "unavailable",
            `This build has no Postgres sandbox driver registered, so SQL practice cannot run.`,
          );
        }
        const sandboxDriver = driver;
        const context = { courseId: course.id, lessonId: location.lesson.id };
        // Read once into a local so TypeScript keeps the narrowing across
        // the closures below — `practice.solution` is a property access and
        // would have to be re-narrowed inside every one of them.
        const solutionSql = practice.solution;

        // The whole attempt happens inside one exclusive, freshly seeded
        // window. Nothing carries over from the last attempt, this lesson's
        // or another's — see `withFreshSandbox` for why accumulated state
        // turned out to be ungradable.
        const attempt = await fastify.sandbox.withFreshSandbox(
          course.id,
          practice.sandbox,
          async ({ reseed }) => {
            // Step 1 — the references, read from the seeded state BEFORE
            // the learner's statement can touch it. Skipped entirely for an
            // assignment that declares neither: a self-marked exercise (or
            // a `check`-only one) must not pay for a connection nobody
            // reads from.
            const needsReference = practice.expected !== undefined || solutionSql !== undefined;
            const reference: {
              rows?: ComparableResult;
              state?: SandboxStateSnapshot;
            } = !needsReference
              ? {}
              : await sandboxDriver.withClient(async (client) => {
                  try {
                    const rows =
                      practice.expected === undefined
                        ? undefined
                        : await readPracticeExpected(client, { sql: practice.expected, ...context });
                    if (solutionSql === undefined) {
                      return { rows };
                    }
                    await runPracticeSolution(client, { sql: solutionSql, ...context });
                    return { rows, state: await snapshotSandboxState(client) };
                  } finally {
                    await resetSandboxSession(client);
                  }
                });

            // The solution CHANGED the sandbox (that is what made it
            // gradable), so the learner must not inherit it.
            if (solutionSql !== undefined) {
              await reseed();
            }

            // Step 2 — the learner's own statement, on a sandbox identical
            // to the one the references were read from.
            const referenceState = reference.state;
            const result = await sandboxDriver.withClient(async (client) => {
              try {
                const executed = await executePracticeSql(client, request.body.sql, {
                  // Rows are only retained for grading when something
                  // actually grades them — see `PracticeGradingRows`.
                  // `MAX_RESULT_ROWS` still caps what `executed.result`
                  // (the client's grid) carries either way.
                  ...(practice.expected === undefined ? {} : { gradingRows: MAX_COMPARISON_ROWS }),
                });
                if (
                  practice.check === undefined &&
                  practice.expected === undefined &&
                  solutionSql === undefined
                ) {
                  return { executed, checked: undefined, compared: undefined, stated: undefined };
                }
                // Before any grading, not after: an attempt that failed
                // inside a transaction leaves the session in the "current
                // transaction is aborted" state, where no further query can
                // run at all, and an attempt that opened a transaction and
                // never closed it must not have its uncommitted work graded
                // as if it were durable.
                await rollbackOpenTransaction(client);

                // Comparison against the reference rows, and only for an
                // attempt that produced a result at all ("если запрос
                // ученика упал с ошибкой — expected не выполняется": there
                // are no rows to compare, and the learner already has
                // Postgres' own error).
                const compared =
                  reference.rows === undefined || !executed.ok
                    ? undefined
                    : compareResults(
                        {
                          columnTypeIds: executed.result.columns.map((column) => column.dataTypeId),
                          rows: executed.grading?.rows ?? executed.result.rows,
                          totalRows: executed.grading?.totalRows ?? executed.result.rows.length,
                        },
                        reference.rows,
                        practice.ordered === true,
                      );

                // State comparison. Unlike `expected`, it runs even when
                // the attempt errored: a statement that failed halfway can
                // still have committed part of its work, and "the database
                // ended up right" is a question with an answer either way.
                let stated: PracticeSolutionVerdict | undefined;
                if (referenceState !== undefined) {
                  stated = comparePracticeState(referenceState, await snapshotSandboxState(client));
                }

                const checked =
                  practice.check === undefined
                    ? undefined
                    : await runPracticeCheck(client, { sql: practice.check, ...context });
                return { executed, checked, compared, stated };
              } finally {
                // Whatever happened — a broken check throwing included —
                // the connection goes back to the pool carrying none of
                // this request's session state (see `resetSandboxSession`).
                await resetSandboxSession(client);
              }
            });

            // The solution is re-verified only when the learner did NOT
            // match it: that is the moment the answer is disputed, and the
            // only moment a third re-seed is worth its ~30ms. An attempt
            // that MATCHED cannot have been graded against a moving
            // target. See `assertDeterministic` for what this catches that
            // a "no now(), no random()" rule for course authors cannot.
            if (solutionSql !== undefined && referenceState !== undefined && result.stated?.passed === false) {
              await reseed();
              const second = await sandboxDriver.withClient(async (client) => {
                try {
                  await runPracticeSolution(client, { sql: solutionSql, ...context });
                  return await snapshotSandboxState(client);
                } finally {
                  await resetSandboxSession(client);
                }
              });
              assertDeterministic(referenceState, second, context);
            }
            return result;
          },
        );
        execution = attempt.executed;
        verdict = attempt.checked;
        expectedVerdict = attempt.compared;
        solutionVerdict = attempt.stated;
      } catch (err) {
        if (isPracticeCheckError(err) || isPracticeExpectedError(err) || isPracticeSolutionError(err)) {
          // A broken grading query (any mechanic) — course content, not a
          // failed attempt. Same class (and status) as a seed file the
          // database rejects, and the same for an assignment whose expected
          // result is too large to compare: the author configured it, the
          // learner cannot have caused it.
          request.log.warn({ err }, "practice grading query is broken");
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

      // Every mechanic the assignment declares must pass, and at least one
      // must be declared — "зачёт требует прохождения обоих" when a lesson
      // carries both. An assignment with neither is self-marked and never
      // reaches this branch anyway (its completion mode is `manual`).
      const graded =
        practice.check !== undefined || practice.expected !== undefined || practice.solution !== undefined;
      const allPassed =
        graded &&
        (practice.check === undefined || verdict?.passed === true) &&
        (practice.expected === undefined || expectedVerdict?.passed === true) &&
        (practice.solution === undefined || solutionVerdict?.passed === true);

      // A lesson carrying both a quiz and a graded practice is gated by its
      // quiz (progress/model.ts: one lesson, one gate). The verdicts are
      // still reported honestly — the learner sees whether the exercise is
      // right — but completing the lesson stays the quiz's job, exactly as
      // `POST .../complete` refuses to do it by hand.
      if (allPassed && lessonCompletionMode(location.lesson) === "practice") {
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
        // `passed`/`reason` are absent, not `false`, when the comparison
        // did not happen at all — the learner's own statement errored, so
        // there is no result set to judge and Postgres' words (already in
        // `error`) are the whole story. "Не сошлось" and "не проверялось"
        // are different things and must not look alike.
        expected:
          practice.expected === undefined
            ? { present: false }
            : {
                present: true,
                ...(expectedVerdict === undefined
                  ? {}
                  : {
                      passed: expectedVerdict.passed,
                      ...(expectedVerdict.reason === undefined ? {} : { reason: expectedVerdict.reason }),
                    }),
              },
        // The state mechanic reports like the other two: presence first, a
        // verdict only when one was reached. Its `reason` names tables and
        // row counts — never a cell, and never a word of the solution.
        solution:
          practice.solution === undefined
            ? { present: false }
            : {
                present: true,
                ...(solutionVerdict === undefined
                  ? {}
                  : {
                      passed: solutionVerdict.passed,
                      ...(solutionVerdict.reason === undefined ? {} : { reason: solutionVerdict.reason }),
                    }),
              },
        ...payload,
      };
    },
  );
  },
};

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
      maxLength: MAX_PRACTICE_SQL_LENGTH,
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
    // `false` means the course set no check for this lesson, so no verdict
    // exists — which is why `passed` is absent rather than `false` in that
    // case. The lesson is self-marked only when `expected` is absent too.
    present: { type: "boolean" },
    passed: { type: "boolean" },
  },
} as const;

// The `expected` mechanic's verdict. `reason` is the only free text the
// grading path ever sends a client, and practice/compare.ts builds it out
// of counts and positions alone — the reference query's text, its column
// names and its values are never part of it.
const practiceExpectedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["present"],
  properties: {
    present: { type: "boolean" },
    // Both absent when the learner's own statement errored: the comparison
    // was not run, which is neither a pass nor a fail.
    passed: { type: "boolean" },
    reason: { type: "string" },
  },
} as const;

const practiceSolutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["present"],
  properties: {
    present: { type: "boolean" },
    passed: { type: "boolean" },
    // Counts and table names only — practice/state.ts builds it.
    reason: { type: "string" },
  },
} as const;

const practiceRunResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "durationMs", "check", "expected", "solution", "lesson", "course"],
  properties: {
    ok: { type: "boolean" },
    result: practiceResultSchema,
    error: practiceSqlErrorSchema,
    durationMs: { type: "integer" },
    check: practiceCheckSchema,
    expected: practiceExpectedSchema,
    solution: practiceSolutionSchema,
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
