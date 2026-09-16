// Reconciliation: stored progress rows + the course as it is installed RIGHT
// NOW -> the course tree with a status on every lesson.
//
// This is the whole "course update doesn't break progress" rule, in one pure
// function. The rules, straight from the product model:
//
//   - a lesson id that is both in the course and in the stored rows stays
//     completed (it doesn't matter that the course version, the lesson's
//     title, its module, or its position changed — only the id matches);
//   - a lesson id that is in the course but not in the stored rows is
//     not started (new lessons are never retroactively completed);
//   - a stored row whose lesson id is no longer in the course is IGNORED for
//     status/counters and reported separately as orphaned — never deleted
//     here (this function doesn't write anything at all). A removed lesson
//     can come back in the next course update, and progress for content that
//     isn't installed locally must survive (it is also what task 010's import
//     of a not-installed course relies on).
//
// There is no "reset progress on update" path anywhere, by design.

import type { Course } from "../courses/types.js";
import {
  lessonCompletionMode,
  type CourseProgressTree,
  type LessonProgress,
  type ModuleProgress,
  type OrphanedProgress,
  type ProgressRecord,
} from "./model.js";

/**
 * Builds the status tree for `course` from `records`.
 *
 * `records` are expected to be this course's rows (that is what
 * `ProgressRepository#listCourseProgress` returns); rows carrying a different
 * `courseId` are dropped rather than trusted — reconciling course A against
 * course B's progress would silently invent completions, so a caller mistake
 * must not be able to do that.
 *
 * Pure and total: no I/O, no throwing, no mutation of the inputs.
 */
export function reconcileCourseProgress(
  course: Course,
  records: readonly ProgressRecord[],
): CourseProgressTree {
  const own = records.filter((record) => record.courseId === course.id);
  const byLessonId = new Map(own.map((record) => [record.lessonId, record]));
  const seenLessonIds = new Set<string>();

  let totalLessons = 0;
  let completedLessons = 0;
  const modules: ModuleProgress[] = [];

  for (const module of course.modules) {
    const lessons: LessonProgress[] = [];
    let moduleCompletedLessons = 0;

    for (const lesson of module.lessons) {
      const record = byLessonId.get(lesson.id);
      if (record !== undefined) {
        seenLessonIds.add(lesson.id);
        moduleCompletedLessons += 1;
      }
      lessons.push({
        id: lesson.id,
        title: lesson.title,
        status: record === undefined ? "not_started" : "completed",
        completedAt: record?.completedAt,
        completionMode: lessonCompletionMode(lesson),
        hasContent: lesson.content !== undefined,
        hasQuiz: lesson.quiz !== undefined,
        hasPractice: lesson.practice !== undefined,
      });
    }

    totalLessons += lessons.length;
    completedLessons += moduleCompletedLessons;
    modules.push({
      id: module.id,
      title: module.title,
      totalLessons: lessons.length,
      completedLessons: moduleCompletedLessons,
      // `lessons.length > 0` guard: a module with no lessons can't exist per
      // the manifest schema (minItems: 1), but "0 of 0 done" reading as
      // completed would be a lie if that ever changed.
      completed: lessons.length > 0 && moduleCompletedLessons === lessons.length,
      lessons,
    });
  }

  const orphanedLessons: OrphanedProgress[] = own
    .filter((record) => !seenLessonIds.has(record.lessonId))
    .map((record) => ({
      lessonId: record.lessonId,
      completedAt: record.completedAt,
      courseVersion: record.courseVersion,
    }));

  const recordedVersions = [
    ...new Set(
      own
        .map((record) => record.courseVersion)
        .filter((version): version is string => version !== undefined && version !== course.version),
    ),
  ].sort(compareVersions);

  return {
    courseId: course.id,
    courseVersion: course.version,
    title: course.title,
    totalLessons,
    completedLessons,
    completed: totalLessons > 0 && completedLessons === totalLessons,
    modules,
    orphanedLessons,
    recordedVersions,
  };
}

/**
 * Orders `a`/`b` by semver precedence rather than lexicographically —
 * `manifest.schema.json`'s `version` field is a semver string
 * (`major.minor.patch[-pre][+build]`), and a plain string sort misorders
 * multi-digit segments (`"0.10.0"` would sort before `"0.9.0"`). Build
 * metadata (`+...`) is ignored per semver's own precedence rule; a
 * pre-release sorts before its release (`"1.0.0-alpha" < "1.0.0"`), and two
 * pre-releases fall back to a string compare of their identifiers. Anything
 * that doesn't match the expected shape falls back to a plain string
 * compare — `recordedVersions` is diagnostic-only (see its doc comment on
 * `CourseProgressTree`), never a correctness-bearing key, so a strange
 * version string degrades gracefully instead of throwing.
 */
function compareVersions(a: string, b: string): number {
  const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  const parsedA = VERSION_PATTERN.exec(a);
  const parsedB = VERSION_PATTERN.exec(b);
  if (parsedA === null || parsedB === null) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const [, majorA, minorA, patchA, preA] = parsedA;
  const [, majorB, minorB, patchB, preB] = parsedB;
  const coreA = [Number(majorA), Number(minorA), Number(patchA)];
  const coreB = [Number(majorB), Number(minorB), Number(patchB)];
  for (let i = 0; i < 3; i += 1) {
    const diff = coreA[i]! - coreB[i]!;
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}
