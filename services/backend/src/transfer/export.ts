// Export: stored progress rows -> the transfer file (transfer/format.ts).
//
// Pure and I/O-free on purpose — it takes the rows (from
// `ProgressRepository#listAllProgress`) and a way to ask "which version of
// this course is installed here?", and returns the file. That keeps the
// format testable without a database and without a courses directory, and
// keeps the endpoint (routes/transfer.ts) down to "read rows, build file,
// send".
//
// What does NOT happen here, by design:
//   - no course content is read (no titles, no module structure) — the file
//     carries progress only (business-logic.md, clarify Q-006);
//   - no course is skipped for not being installed. Progress for a course
//     that isn't on this machine was deliberately kept (clarify Q-009) and
//     is exported like any other, just without an `installedVersion`;
//   - no filtering of "orphaned" completions (lessons the installed course
//     no longer has): they are progress too, and dropping them here would
//     lose data on every export/import round trip through a machine whose
//     course happens to be older.

import type { ProgressRecord } from "../progress/model.js";
import {
  PROGRESS_EXPORT_FORMAT,
  PROGRESS_EXPORT_FORMAT_VERSION,
  type ExportedCourseProgress,
  type ExportedLessonProgress,
  type ProgressExportFile,
} from "./format.js";

export interface BuildProgressExportOptions {
  /**
   * The version of `courseId` as installed on THIS machine, or `undefined`
   * if it isn't installed (routes/transfer.ts passes
   * `fastify.courses.get(id)?.version`). Injected rather than taking the
   * registry itself: the exporter needs one fact per course, not the whole
   * content layer.
   */
  readonly installedVersion: (courseId: string) => string | undefined;
  /** The file's "last saved" timestamp. Defaults to now; tests (and any
   * caller that wants a deterministic file) pass their own. */
  readonly exportedAt?: string;
}

/**
 * Builds the export file from `records`. Output is deterministic: courses
 * ordered by `courseId`, lessons by `lessonId` within a course, regardless
 * of the order the rows arrived in — two exports of the same progress at the
 * same instant are byte-identical, which is what makes a round-trip test
 * meaningful.
 */
export function buildProgressExport(
  records: readonly ProgressRecord[],
  options: BuildProgressExportOptions,
): ProgressExportFile {
  const byCourse = new Map<string, ExportedLessonProgress[]>();
  for (const record of records) {
    const lessons = byCourse.get(record.courseId) ?? [];
    lessons.push({
      lessonId: record.lessonId,
      status: "completed",
      completedAt: record.completedAt,
      courseVersion: record.courseVersion,
    });
    byCourse.set(record.courseId, lessons);
  }

  const courses: ExportedCourseProgress[] = [...byCourse.entries()]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([courseId, lessons]) => ({
      courseId,
      installedVersion: options.installedVersion(courseId),
      lessons: lessons.sort((a, b) => compareIds(a.lessonId, b.lessonId)),
    }));

  return {
    format: PROGRESS_EXPORT_FORMAT,
    formatVersion: PROGRESS_EXPORT_FORMAT_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    courses,
  };
}

/** Plain code-unit order (not locale-aware `localeCompare`): ids are ASCII
 * identifiers, and the point here is a stable order that is the same on
 * every machine and in every locale, not a human-friendly one. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
