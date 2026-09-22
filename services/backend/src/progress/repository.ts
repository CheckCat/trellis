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
//   - a passed lesson never un-passes by itself (product model): there is
//     no per-lesson un-complete, and nothing in the grading paths deletes.
//     The single carve-out is `resetCourseProgress` — «Перепройти курс», an
//     explicit, confirmed, whole-course erase the learner asks for. It is
//     not the inverse of `markLessonCompleted` (no caller may reach for it
//     to undo one lesson) and it is deliberately the only DELETE in the
//     module, so "what can destroy progress" stays a one-line answer.
//     Task 010's import has its own write path here too, rather than
//     reaching into the table from transfer/.
//   - no attempt history is stored anywhere — a wrong quiz answer writes
//     nothing at all.

import type { AppPool } from "../db/pool.js";
import { progressKey } from "./model.js";
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

/**
 * One completion coming in from an imported progress file (task 010). Unlike
 * `MarkLessonCompletedInput` it carries its own `completedAt`: an import
 * restores WHEN something was passed on another machine, it does not pass it
 * again now.
 */
export interface ImportProgressRecord {
  readonly courseId: string;
  readonly lessonId: string;
  /** ISO 8601 timestamp of the completion being imported. */
  readonly completedAt: string;
  /** Provenance recorded alongside the completion, when the file had it. */
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
  /**
   * Merges completions from an imported progress file and returns the rows
   * as they are stored afterwards (in the order given). The write path task
   * 010 needs, living here rather than in transfer/ so `core.lesson_progress`
   * still has exactly one module that writes to it.
   *
   * Merge semantics — additive, never destructive:
   *   - a lesson not stored here yet is inserted with the file's
   *     `completedAt` (not `now()`: the completion happened then, elsewhere);
   *   - a lesson already stored keeps the EARLIER of the two completion
   *     times, together with the `courseVersion` that belongs to it — a
   *     completion is a historical fact, and the earliest known one is the
   *     true "first passed at". When the incoming record does NOT win (it is
   *     not earlier), the stored row is left byte-for-byte as it was —
   *     including `courseVersion` (even if the incoming record has one and
   *     the stored row's is unset) and `updatedAt`. A record that loses is a
   *     true no-op, not "loses the timestamp but still donates its version";
   *   - nothing is ever deleted or un-completed, and rows absent from the
   *     file are left alone. An import is a merge, not a restore.
   *
   * Courses that are not installed locally are written like any other (the
   * table has no foreign key to course content, on purpose — see
   * migrations/001_progress.sql): their progress waits for the course to
   * appear (clarify Q-009).
   *
   * Atomic: all rows in one statement, so a failure imports nothing. An
   * empty input touches the database not at all.
   */
  importProgress(records: readonly ImportProgressRecord[]): Promise<ProgressRecord[]>;
  /**
   * Erases every stored completion of one course and returns how many rows
   * went away — «Перепройти курс».
   *
   * The one destructive operation in this module (see the header note). It
   * takes a course, never a lesson: the product model has no "un-pass this
   * one lesson", and an API that accepted a lesson id would be exactly
   * that. Rows of OTHER courses are untouched, orphaned rows of THIS course
   * are not spared — they are this course's progress too, just for lessons
   * the installed version no longer has, and a learner who asked to start
   * the course over means all of it.
   *
   * A course with no progress is not an error: zero rows deleted, zero
   * written, and the caller gets `0`.
   */
  resetCourseProgress(courseId: string): Promise<number>;
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

    async importProgress(records) {
      if (records.length === 0) {
        // Not just an optimization: "importing a file that changes nothing
        // writes nothing" is an observable property (no `updated_at` churn,
        // no rows touched), and it starts here.
        return [];
      }

      // A single `insert ... on conflict do update` cannot touch the same row
      // twice: Postgres aborts the whole statement with "ON CONFLICT DO UPDATE
      // command cannot affect row a second time". `parseProgressExport` already
      // refuses a file with duplicate ids, but this is a public repository
      // method — a caller that isn't the import route must fail with a sentence
      // that names the offending key, not with an opaque database error that
      // would surface as a 500.
      const seen = new Set<string>();
      for (const record of records) {
        const key = progressKey(record.courseId, record.lessonId);
        if (seen.has(key)) {
          throw new Error(
            `Cannot import two completions for the same lesson: course "${record.courseId}", lesson ` +
              `"${record.lessonId}" appears more than once. Merge them before calling importProgress.`,
          );
        }
        seen.add(key);
      }

      // One statement for the whole file — atomic without an explicit
      // transaction, and immune to the array growing. `unnest(...) with
      // ordinality` carries the caller's order through so the returned rows
      // line up with `records` (RETURNING on its own has no defined order).
      //
      // `least(...)`/the `case`s below encode the merge rule in SQL rather
      // than in the caller: even if two imports ran concurrently, neither
      // can replace an earlier completion with a later one. Both `case`s
      // branch on the exact same condition, and the "local wins" (`else`)
      // side is a byte-for-byte no-op — `course_version`/`updated_at` are set
      // back to their own current value, not coalesced with `excluded`'s.
      // A losing import must not be able to fill in a locally-null
      // `course_version` (that would make an "unchanged" row observably
      // change under a caller that doesn't pre-filter unchanged records the
      // way `transfer/import.ts`'s `planProgressImport` does — see fix
      // round 2, finding 2) or bump `updated_at` for a row nothing happened
      // to.
      const result = await pool.query<LessonProgressRow>(
        `with incoming as (
           select *
             from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
                  with ordinality as t(course_id, lesson_id, course_version, completed_at, ord)
         ), upserted as (
           insert into core.lesson_progress (course_id, lesson_id, status, course_version, completed_at)
           select course_id, lesson_id, 'completed', course_version, completed_at from incoming
           on conflict (course_id, lesson_id) do update
             set completed_at = least(core.lesson_progress.completed_at, excluded.completed_at),
                 course_version = case
                   when excluded.completed_at < core.lesson_progress.completed_at
                     then coalesce(excluded.course_version, core.lesson_progress.course_version)
                   else core.lesson_progress.course_version
                 end,
                 updated_at = case
                   when excluded.completed_at < core.lesson_progress.completed_at
                     then now()
                   else core.lesson_progress.updated_at
                 end
           returning ${RETURNED_COLUMNS}
         )
         select upserted.*
           from upserted
           join incoming on incoming.course_id = upserted.course_id
                        and incoming.lesson_id = upserted.lesson_id
          order by incoming.ord`,
        [
          records.map((record) => record.courseId),
          records.map((record) => record.lessonId),
          records.map((record) => record.courseVersion ?? null),
          records.map((record) => record.completedAt),
        ],
      );
      return result.rows.map(toProgressRecord);
    },

    async resetCourseProgress(courseId) {
      // No `returning`: the caller needs the count, not the rows — what was
      // erased is by definition gone, and handing back the deleted records
      // would invite a caller to "undo" a reset the learner confirmed.
      const result = await pool.query(`delete from core.lesson_progress where course_id = $1`, [courseId]);
      // `rowCount` is `number | null` in `pg`'s types (null for commands
      // that report none); a DELETE always reports one, so the coalesce is
      // a type formality, not a case that happens.
      return result.rowCount ?? 0;
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
