import type { CourseProgressResponse, LessonProgress } from "../../../shared/api/types";

/**
 * Pure derivations over a course's progress tree. Everything the course and
 * lesson screens need to answer "where am I, what's next, how am I doing"
 * lives here rather than in a component, because all of it is arithmetic
 * over one already-fetched response — and because two screens ask the same
 * questions and must not answer them differently.
 *
 * Nothing here is stored anywhere. That is deliberate and it is what keeps
 * the motivational bits transferable between machines: a streak, a module's
 * completion, "what to open next" are all functions of the completions
 * already in `GET /courses/:id/progress` — which is exactly what the
 * progress export file carries. A counter kept on the side would be a
 * second kind of progress with its own format, and it would not survive the
 * trip.
 */

/** A lesson together with everything only the whole course knows about it:
 * which module it is in, where it sits inside that module, and where it
 * sits in the course. */
export interface PlacedLesson {
  readonly lesson: LessonProgress;
  readonly moduleId: string;
  readonly moduleTitle: string;
  /** 1-based position inside its own module — what the lesson page shows. */
  readonly numberInModule: number;
  readonly moduleLessonCount: number;
  /** 1-based position in the whole course — the quiet second number. */
  readonly numberInCourse: number;
}

/**
 * Flattens the tree into the order the course is read: modules in order,
 * lessons in order inside each. That order IS "what comes next" — the
 * manifest defines it and the progress response preserves it, so no
 * separate endpoint or stored cursor is involved.
 */
export function flattenLessons(progress: CourseProgressResponse): PlacedLesson[] {
  const placed: PlacedLesson[] = [];
  for (const module of progress.modules) {
    module.lessons.forEach((lesson, index) => {
      placed.push({
        lesson,
        moduleId: module.id,
        moduleTitle: module.title,
        numberInModule: index + 1,
        moduleLessonCount: module.lessons.length,
        numberInCourse: placed.length + 1,
      });
    });
  }
  return placed;
}

/**
 * Where «Продолжить» goes: the first lesson that is not completed yet, in
 * reading order.
 *
 * The FIRST unfinished one, not the one after the most recently finished:
 * a learner who skipped ahead and came back should be sent to the gap they
 * left, not past it. `undefined` means the course is finished.
 */
export function nextUnfinishedLesson(progress: CourseProgressResponse): PlacedLesson | undefined {
  return flattenLessons(progress).find((placed) => placed.lesson.status !== "completed");
}

/** Local calendar day of an ISO timestamp, as `YYYY-MM-DD`. Local, not UTC:
 * a streak is about the learner's own days, and someone studying at 01:00
 * in Moscow would otherwise have it counted against the previous date. */
function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/**
 * How many days in a row, ending today, the learner has finished at least
 * one lesson of this course.
 *
 * Counted from `completedAt` timestamps and nothing else, which is what
 * makes it survive an export/import onto another machine: the data the
 * streak is made of is already in the file.
 *
 * Yesterday still counts as the end of the run — a streak broken by "it is
 * 9am and I haven't studied yet" would be a punishment for waking up. Two
 * days of silence ends it. A run of one day is not a run: the caller gets 1
 * and decides that it isn't worth saying.
 */
export function studyStreakDays(progress: CourseProgressResponse, now: Date = new Date()): number {
  const days = new Set<string>();
  for (const module of progress.modules) {
    for (const lesson of module.lessons) {
      if (lesson.completedAt !== undefined) {
        days.add(localDayKey(new Date(lesson.completedAt)));
      }
    }
  }
  if (days.size === 0) {
    return 0;
  }

  const today = localDayKey(now);
  const yesterday = localDayKey(shiftDays(now, -1));
  let cursor = days.has(today) ? now : days.has(yesterday) ? shiftDays(now, -1) : undefined;
  if (cursor === undefined) {
    return 0;
  }

  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}
