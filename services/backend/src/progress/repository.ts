// The only module that talks SQL about progress. Everything above it
// (reconcile.ts, routes/*) works with `ProgressRecord`s and never sees a
// column name, a `Date`, or a `null`.
//
// Storage rules encoded here, all of them consequences of
// migrations/001_progress.sql's model ("a row exists only for a completed
// lesson"):
//   - completing an already-completed lesson is a no-op for `completed_at`
//     (a repeat pass must not rewrite when the lesson was first passed) but
//     refreshes `course_version`/`updated_at` — see `markLessonCompleted`;
//   - there is no un-complete / delete operation, on purpose: a passed
//     lesson never un-passes (product model). Task 010's import will need
//     its own write path; it should add it here rather than reaching into
//     the table from transfer/.
//   - no attempt history is stored anywhere — a wrong quiz answer writes
//     nothing at all.

import type { AppPool } from "../db/pool.js";
import type { ProgressRecord } from "./model.js";

/** Row shape as Postgres hands it back — the only place these column names
 * and `null`s exist. */
interface LessonProgressRow {
  readonly course_id: string;
  readonly lesson_id: string;
  readonly status: string;
  readonly course_version: string | null;
  readonly completed_at: Date;
  readonly updated_at: Date;
}

const RETURNED_COLUMNS = "course_id, lesson_id, status, course_version, completed_at, updated_at";

export interface MarkLessonCompletedInput {
  readonly courseId: string;
  readonly lessonId: string;
  /** The installed course's version, recorded as provenance (see
   * `ProgressRecord.courseVersion`). Optional so a caller that genuinely
   * doesn't know it can still record the completion. */
  readonly courseVersion?: string;
}

export interface ProgressRepository {
  /** Every stored completion for one course, oldest first. Returns `[]` for
   * a course with no progress — including a course that isn't installed. */
  listCourseProgress(courseId: string): Promise<ProgressRecord[]>;
  /** Every stored completion, for every course, ordered by
   * `(courseId, lessonId)` — the stable order task 010's export needs. */
  listAllProgress(): Promise<ProgressRecord[]>;
  /**
   * Marks one lesson completed and returns the stored row (so the caller
   * reports the database's own `completedAt`, not a locally guessed one).
   * Idempotent: calling it again on an already-completed lesson keeps the
   * original `completedAt` and leaves the lesson completed.
   */
  markLessonCompleted(input: MarkLessonCompletedInput): Promise<ProgressRecord>;
}

export function createProgressRepository(pool: AppPool): ProgressRepository {
  return {
    async listCourseProgress(courseId) {
      const result = await pool.query<LessonProgressRow>(
        `select ${RETURNED_COLUMNS} from core.lesson_progress where course_id = $1 order by completed_at, lesson_id`,
        [courseId],
      );
      return result.rows.map(toProgressRecord);
    },

    async listAllProgress() {
      const result = await pool.query<LessonProgressRow>(
        `select ${RETURNED_COLUMNS} from core.lesson_progress order by course_id, lesson_id`,
      );
      return result.rows.map(toProgressRecord);
    },

    async markLessonCompleted({ courseId, lessonId, courseVersion }) {
      // `do update` rather than `do nothing`: `do nothing` would return zero
      // rows on a repeat pass, leaving the caller without the stored record
      // it needs to answer with. `completed_at` is deliberately NOT in the
      // update list — only `course_version`/`updated_at` move.
      //
      // `coalesce(excluded.course_version, core.lesson_progress.course_version)`
      // rather than a bare `excluded.course_version`: a repeat call that
      // genuinely doesn't know the version (`courseVersion` left undefined)
      // must not blow away a version recorded by an earlier call — model.ts's
      // `ProgressRecord.courseVersion` documents `undefined` only for rows
      // written before a version was EVER known, not as something a later,
      // less-informed call can regress a row back to.
      const result = await pool.query<LessonProgressRow>(
        `insert into core.lesson_progress (course_id, lesson_id, status, course_version)
         values ($1, $2, 'completed', $3)
         on conflict (course_id, lesson_id) do update
           set course_version = coalesce(excluded.course_version, core.lesson_progress.course_version),
               updated_at = now()
         returning ${RETURNED_COLUMNS}`,
        [courseId, lessonId, courseVersion ?? null],
      );
      const row = result.rows[0];
      if (row === undefined) {
        // Unreachable with the statement above (an upsert with RETURNING
        // always yields exactly one row) — but `noUncheckedIndexedAccess`
        // is right to make us say what it would mean if it ever happened.
        throw new Error(
          `Failed to record progress for lesson "${lessonId}" of course "${courseId}": the upsert returned no row.`,
        );
      }
      return toProgressRecord(row);
    },
  };
}

function toProgressRecord(row: LessonProgressRow): ProgressRecord {
  if (row.status !== "completed") {
    // The table's CHECK constraint already guarantees this; the assertion is
    // here so that widening the constraint later can't quietly produce
    // `ProgressRecord`s whose `status` lies about its own type.
    throw new Error(
      `Unexpected progress status "${row.status}" for lesson "${row.lesson_id}" of course "${row.course_id}" — ` +
        `core.lesson_progress is only supposed to hold completed lessons.`,
    );
  }
  return {
    courseId: row.course_id,
    lessonId: row.lesson_id,
    status: "completed",
    courseVersion: row.course_version ?? undefined,
    completedAt: row.completed_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

declare module "fastify" {
  interface FastifyInstance {
    progress: ProgressRepository;
  }
}
