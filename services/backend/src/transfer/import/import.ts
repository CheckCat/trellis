// Import: a parsed transfer file + the progress already on this machine ->
// a plan describing exactly what the import would change, including the one
// thing the product explicitly asks for — the warning that the chosen file is
// OLDER than the local progress ("чтобы не затереть новые данные старыми",
// business-logic.md).
//
// Planning is separated from writing on purpose. The endpoint
// (routes/transfer.ts) builds the plan first, and when the plan says `stale`
// it answers 409 WITHOUT writing anything, so the UI (task 016) can show the
// warning and let the user confirm. Nothing about that flow needs a second
// "preview" endpoint or a half-applied import.
//
// The merge itself is additive — an imported completion can only add a
// completion or move one EARLIER in time (progress/repository.ts's
// `importProgress`), never remove or un-complete anything. So a stale file is
// not actually able to destroy newer progress; the confirmation exists
// because the product wants the user told, and because "this file is from
// before your last session" is usually a sign the wrong file was picked.
//
// Two product rules this module implements literally:
//   - clarify Q-009: progress for courses that are NOT installed here is
//     imported like any other and waits for the course to show up. It is
//     counted and reported (`coursesNotInstalled`) so the UI can say so, but
//     it is never skipped.
//   - Q-010 / the progress model: a completion never un-completes, so a
//     lesson already completed locally is `unchanged` unless the file knows
//     an earlier completion time for it.

import { progressKey } from "../../progress/model/index.js";
import type { ProgressRecord } from "../../progress/model/index.js";
import type { ImportProgressRecord } from "../../progress/repository/index.js";
import type { ProgressExportFile } from "../format/index.js";

export type ImportOutcome =
  /** No local row for this lesson: the completion is new here. */
  | "created"
  /** Already completed here, but the file knows an earlier completion time —
   * the stored row's `completedAt` (and its recorded course version) moves
   * back to the file's. */
  | "earlier_completion"
  /** Already completed here at the same time or earlier: nothing to do. */
  | "unchanged";

export interface PlannedCourseImport {
  readonly courseId: string;
  /** Whether this course is installed on THIS machine right now. `false`
   * does not reduce what gets imported — see the header comment. */
  readonly installed: boolean;
  /** The version the exporting machine had installed, if the file says. */
  readonly fileVersion?: string;
  readonly lessons: number;
  readonly created: number;
  readonly earlierCompletions: number;
  readonly unchanged: number;
}

export interface ProgressImportTotals {
  readonly courses: number;
  readonly lessons: number;
  readonly created: number;
  readonly earlierCompletions: number;
  readonly unchanged: number;
}

export interface ProgressImportPlan {
  /** The file's own "last saved" timestamp. */
  readonly fileExportedAt: string;
  /** The most recent moment local progress changed, or `undefined` when
   * there is no local progress at all. */
  readonly localLatestProgressAt?: string;
  /** True when the file was exported BEFORE the newest local progress
   * change — the case the product wants a warning for. Always false when
   * there is no local progress: nothing can be older than nothing. */
  readonly stale: boolean;
  readonly totals: ProgressImportTotals;
  /** Per course, in file order (which `parseProgressExport` preserves and
   * `buildProgressExport` sorts by course id). */
  readonly courses: readonly PlannedCourseImport[];
  /** Ids of imported courses not installed here — the list the UI turns into
   * "progress for 2 courses you don't have yet was saved". */
  readonly coursesNotInstalled: readonly string[];
  /**
   * Exactly the rows that need writing: `created` and `earlier_completion`
   * ones, never `unchanged` ones. Importing a file that changes nothing
   * therefore writes nothing at all (no `updated_at` churn), which is what
   * makes an export/import round trip provably a no-op.
   */
  readonly records: readonly ImportProgressRecord[];
}

export interface PlanProgressImportOptions {
  /** Injected by routes/transfer.ts from the course registry — the planner
   * must not depend on the content layer itself. */
  readonly isCourseInstalled: (courseId: string) => boolean;
}

/**
 * Computes what importing `file` would do to the progress described by
 * `existing` (all local rows — `ProgressRepository#listAllProgress`).
 *
 * Pure: no I/O, no mutation, no throwing.
 */
export function planProgressImport(
  file: ProgressExportFile,
  existing: readonly ProgressRecord[],
  options: PlanProgressImportOptions,
): ProgressImportPlan {
  const localByKey = new Map(existing.map((record) => [progressKey(record.courseId, record.lessonId), record]));

  const courses: PlannedCourseImport[] = [];
  const coursesNotInstalled: string[] = [];
  const records: ImportProgressRecord[] = [];
  let totalLessons = 0;
  let totalCreated = 0;
  let totalEarlier = 0;
  let totalUnchanged = 0;

  for (const course of file.courses) {
    const installed = options.isCourseInstalled(course.courseId);
    if (!installed) {
      coursesNotInstalled.push(course.courseId);
    }
    let created = 0;
    let earlierCompletions = 0;
    let unchanged = 0;

    for (const lesson of course.lessons) {
      const local = localByKey.get(progressKey(course.courseId, lesson.lessonId));
      const outcome = decideOutcome(local, lesson.completedAt);
      if (outcome === "unchanged") {
        unchanged += 1;
        continue;
      }
      if (outcome === "created") {
        created += 1;
      } else {
        earlierCompletions += 1;
      }
      records.push({
        courseId: course.courseId,
        lessonId: lesson.lessonId,
        completedAt: lesson.completedAt,
        courseVersion: lesson.courseVersion,
      });
    }

    courses.push({
      courseId: course.courseId,
      installed,
      fileVersion: course.installedVersion,
      lessons: course.lessons.length,
      created,
      earlierCompletions,
      unchanged,
    });
    totalLessons += course.lessons.length;
    totalCreated += created;
    totalEarlier += earlierCompletions;
    totalUnchanged += unchanged;
  }

  const localLatestProgressAt = latestLocalChange(existing);
  return {
    fileExportedAt: file.exportedAt,
    localLatestProgressAt,
    stale:
      localLatestProgressAt !== undefined &&
      Date.parse(file.exportedAt) < Date.parse(localLatestProgressAt),
    totals: {
      courses: file.courses.length,
      lessons: totalLessons,
      created: totalCreated,
      earlierCompletions: totalEarlier,
      unchanged: totalUnchanged,
    },
    courses,
    coursesNotInstalled,
    records,
  };
}

function decideOutcome(local: ProgressRecord | undefined, importedCompletedAt: string): ImportOutcome {
  if (local === undefined) {
    return "created";
  }
  return Date.parse(importedCompletedAt) < Date.parse(local.completedAt) ? "earlier_completion" : "unchanged";
}

/**
 * The newest `updatedAt` across all local rows — "when progress on this
 * computer last changed". `updatedAt` rather than `completedAt` on purpose:
 * a row touched after its completion (a repeat pass refreshing the recorded
 * course version) is still a local change the user made after the file they
 * are about to import was written.
 */
function latestLocalChange(existing: readonly ProgressRecord[]): string | undefined {
  let latest: string | undefined;
  for (const record of existing) {
    if (latest === undefined || Date.parse(record.updatedAt) > Date.parse(latest)) {
      latest = record.updatedAt;
    }
  }
  return latest;
}
