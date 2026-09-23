import { describe, expect, it } from "vitest";
import type { CourseProgressResponse, LessonProgress } from "../../../shared/api/types";
import { flattenLessons, nextUnfinishedLesson, studyStreakDays } from "./progress";

/** `[lessonId, completedAt | undefined]` per lesson, grouped per module. */
type ModuleSpec = readonly (readonly [string, string | undefined])[];

function tree(...modules: readonly ModuleSpec[]): CourseProgressResponse {
  const lessonOf = ([id, completedAt]: readonly [string, string | undefined]): LessonProgress => ({
    id,
    title: `Lesson ${id}`,
    status: completedAt === undefined ? "not_started" : "completed",
    ...(completedAt === undefined ? {} : { completedAt }),
    completionMode: "manual",
    hasContent: true,
    hasQuiz: false,
    hasPractice: false,
  });
  const all = modules.flat();
  return {
    courseId: "c1",
    courseVersion: "1.0.0",
    title: "Course",
    totalLessons: all.length,
    completedLessons: all.filter(([, at]) => at !== undefined).length,
    completed: all.every(([, at]) => at !== undefined),
    orphanedLessons: [],
    recordedVersions: [],
    modules: modules.map((lessons, index) => ({
      id: `m${index + 1}`,
      title: `Module ${index + 1}`,
      totalLessons: lessons.length,
      completedLessons: lessons.filter(([, at]) => at !== undefined).length,
      completed: lessons.every(([, at]) => at !== undefined),
      lessons: lessons.map(lessonOf),
    })),
  };
}

/** Local noon, so a test can never straddle a day boundary because of the
 * machine's timezone — the streak is counted in LOCAL days on purpose. */
function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

function localIso(year: number, month: number, day: number): string {
  return localNoon(year, month, day).toISOString();
}

describe("flattenLessons", () => {
  it("numbers each lesson inside its module and in the course at once (happy path)", () => {
    const placed = flattenLessons(tree([["a", undefined], ["b", undefined]], [["c", undefined]]));

    expect(placed.map((entry) => [entry.lesson.id, entry.numberInModule, entry.moduleLessonCount, entry.numberInCourse])).toEqual([
      ["a", 1, 2, 1],
      ["b", 2, 2, 2],
      ["c", 1, 1, 3],
    ]);
    expect(placed.map((entry) => entry.moduleTitle)).toEqual(["Module 1", "Module 1", "Module 2"]);
  });
});

describe("nextUnfinishedLesson", () => {
  it("returns the first unfinished lesson in reading order (happy path)", () => {
    const next = nextUnfinishedLesson(tree([["a", localIso(2026, 3, 1)], ["b", undefined]]));
    expect(next?.lesson.id).toBe("b");
  });

  it("goes back to a skipped lesson rather than past it (edge case)", () => {
    // Someone jumped ahead and finished c. «Продолжить» must send them to
    // the gap they left, not to whatever follows the newest completion.
    const next = nextUnfinishedLesson(
      tree([["a", localIso(2026, 3, 1)], ["b", undefined]], [["c", localIso(2026, 3, 2)]]),
    );
    expect(next?.lesson.id).toBe("b");
  });

  it("is undefined for a finished course", () => {
    expect(nextUnfinishedLesson(tree([["a", localIso(2026, 3, 1)]]))).toBeUndefined();
  });
});

describe("studyStreakDays", () => {
  it("counts consecutive local days ending today (happy path)", () => {
    const streak = studyStreakDays(
      tree([
        ["a", localIso(2026, 3, 10)],
        ["b", localIso(2026, 3, 11)],
        ["c", localIso(2026, 3, 12)],
      ]),
      localNoon(2026, 3, 12),
    );
    expect(streak).toBe(3);
  });

  it("counts several lessons finished on one day as one day", () => {
    const streak = studyStreakDays(
      tree([
        ["a", new Date(2026, 2, 12, 9, 0, 0).toISOString()],
        ["b", new Date(2026, 2, 12, 21, 0, 0).toISOString()],
      ]),
      localNoon(2026, 3, 12),
    );
    expect(streak).toBe(1);
  });

  it("still counts a run that ended yesterday (edge case)", () => {
    // Иначе серия обрывалась бы каждое утро до первого урока — наказание за
    // то, что человек проснулся.
    const streak = studyStreakDays(
      tree([["a", localIso(2026, 3, 10)], ["b", localIso(2026, 3, 11)]]),
      localNoon(2026, 3, 12),
    );
    expect(streak).toBe(2);
  });

  it("is broken by two silent days, however long the run was (edge case)", () => {
    const streak = studyStreakDays(
      tree([["a", localIso(2026, 3, 1)], ["b", localIso(2026, 3, 2)], ["c", localIso(2026, 3, 3)]]),
      localNoon(2026, 3, 5),
    );
    expect(streak).toBe(0);
  });

  it("ignores the gap before a run and counts only the run itself", () => {
    const streak = studyStreakDays(
      tree([["a", localIso(2026, 3, 1)], ["b", localIso(2026, 3, 11)], ["c", localIso(2026, 3, 12)]]),
      localNoon(2026, 3, 12),
    );
    expect(streak).toBe(2);
  });

  it("is zero for a course nobody has started", () => {
    expect(studyStreakDays(tree([["a", undefined]]), localNoon(2026, 3, 12))).toBe(0);
  });
});
