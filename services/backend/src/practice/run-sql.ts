// The `sql` practice mechanic's grading ORCHESTRATION: given a freshly
// seeded sandbox, read whichever references the assignment needs, run the
// learner's statement against an identical sandbox, and grade it with
// whichever of check/expected/solution the course declared. Extracted out of
// routes/practice/sql.ts so the HTTP route stays a thin translation to
// status codes/JSON, and this domain logic is unit-testable without a
// Fastify request/reply or a real network call.
//
// See routes/practice/sql.ts's own header for the mechanics themselves
// (check/expected/solution) and the project invariants they implement
// (.mvp/invariants.md) — this module only owns HOW one attempt is run, not
// WHY the rules are what they are.

import {
  executePracticeSql,
  resetSandboxSession,
  rollbackOpenTransaction,
  type PracticeExecution,
} from "./execute.js";
import { runPracticeCheck, type PracticeCheckVerdict } from "./check.js";
import {
  compareResults,
  MAX_COMPARISON_ROWS,
  readPracticeExpected,
  type ComparableResult,
  type PracticeExpectedVerdict,
} from "./compare.js";
import {
  assertDeterministic,
  comparePracticeState,
  runPracticeSolution,
  snapshotSandboxState,
  type PracticeSolutionVerdict,
  type SandboxStateSnapshot,
} from "./state.js";
import type { CourseSqlPractice } from "../courses/types.js";
import type { PostgresSandboxDriver } from "../sandbox/postgres-sandbox.js";
import type { FreshSandboxContext } from "../sandbox/types.js";

export interface SqlPracticeAttemptResult {
  readonly executed: PracticeExecution;
  readonly checked?: PracticeCheckVerdict;
  readonly compared?: PracticeExpectedVerdict;
  readonly stated?: PracticeSolutionVerdict;
}

/**
 * Runs one graded attempt inside an already-fresh sandbox window (the
 * `work` callback of `SandboxProvisioner.withFreshSandbox`). The caller
 * supplies `reseed` (via `freshSandbox`) because grading by the course's
 * SOLUTION needs the seeded state more than once per attempt — see
 * `withFreshSandbox`'s own docstring for why that handle exists instead of
 * a re-entrant reset.
 */
export async function runSqlPracticeAttempt(
  sandboxDriver: PostgresSandboxDriver,
  practice: CourseSqlPractice,
  sql: string,
  context: { readonly courseId: string; readonly lessonId: string },
  { reseed }: FreshSandboxContext,
): Promise<SqlPracticeAttemptResult> {
  // Read once into a local so TypeScript keeps the narrowing across the
  // closures below — `practice.solution` is a property access and would
  // have to be re-narrowed inside every one of them.
  const solutionSql = practice.solution;

  // Step 1 — the references, read from the seeded state BEFORE the
  // learner's statement can touch it. Skipped entirely for an assignment
  // that declares neither: a self-marked exercise (or a `check`-only one)
  // must not pay for a connection nobody reads from.
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

  // The solution CHANGED the sandbox (that is what made it gradable), so
  // the learner must not inherit it.
  if (solutionSql !== undefined) {
    await reseed();
  }

  // Step 2 — the learner's own statement, on a sandbox identical to the one
  // the references were read from.
  const referenceState = reference.state;
  const result = await sandboxDriver.withClient(async (client) => {
    try {
      const executed = await executePracticeSql(client, sql, {
        // Rows are only retained for grading when something actually grades
        // them — see `PracticeGradingRows`. `MAX_RESULT_ROWS` still caps
        // what `executed.result` (the client's grid) carries either way.
        ...(practice.expected === undefined ? {} : { gradingRows: MAX_COMPARISON_ROWS }),
      });
      if (practice.check === undefined && practice.expected === undefined && solutionSql === undefined) {
        return { executed, checked: undefined, compared: undefined, stated: undefined };
      }
      // Before any grading, not after: an attempt that failed inside a
      // transaction leaves the session in the "current transaction is
      // aborted" state, where no further query can run at all, and an
      // attempt that opened a transaction and never closed it must not have
      // its uncommitted work graded as if it were durable.
      await rollbackOpenTransaction(client);

      // Comparison against the reference rows, and only for an attempt that
      // produced a result at all ("если запрос ученика упал с ошибкой —
      // expected не выполняется": there are no rows to compare, and the
      // learner already has Postgres' own error).
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

      // State comparison. Unlike `expected`, it runs even when the attempt
      // errored: a statement that failed halfway can still have committed
      // part of its work, and "the database ended up right" is a question
      // with an answer either way.
      let stated: PracticeSolutionVerdict | undefined;
      if (referenceState !== undefined) {
        stated = comparePracticeState(referenceState, await snapshotSandboxState(client));
      }

      const checked =
        practice.check === undefined ? undefined : await runPracticeCheck(client, { sql: practice.check, ...context });
      return { executed, checked, compared, stated };
    } finally {
      // Whatever happened — a broken check throwing included — the
      // connection goes back to the pool carrying none of this request's
      // session state (see `resetSandboxSession`).
      await resetSandboxSession(client);
    }
  });

  // The solution is re-verified only when the learner did NOT match it:
  // that is the moment the answer is disputed, and the only moment a third
  // re-seed is worth its ~30ms. An attempt that MATCHED cannot have been
  // graded against a moving target. See `assertDeterministic` for what this
  // catches that a "no now(), no random()" rule for course authors cannot.
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
}

export interface SqlPracticeVerdict {
  /** Whether this assignment declares any grading mechanic at all — an
   * assignment with none is self-marked and this function is never reached
   * for it in the route (its completion mode is `manual`). */
  readonly graded: boolean;
  /** Every mechanic the assignment declares must pass, and at least one
   * must be declared — "зачёт требует прохождения обоих" when a lesson
   * carries both. */
  readonly allPassed: boolean;
}

/** Combines the up-to-three independent verdicts into the one decision that
 * matters for completion: did THIS attempt satisfy every mechanic the
 * assignment declared. */
export function evaluateSqlPracticeAttempt(
  practice: CourseSqlPractice,
  attempt: SqlPracticeAttemptResult,
): SqlPracticeVerdict {
  const graded = practice.check !== undefined || practice.expected !== undefined || practice.solution !== undefined;
  const allPassed =
    graded &&
    (practice.check === undefined || attempt.checked?.passed === true) &&
    (practice.expected === undefined || attempt.compared?.passed === true) &&
    (practice.solution === undefined || attempt.stated?.passed === true);
  return { graded, allPassed };
}
