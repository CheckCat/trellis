import assert from "node:assert/strict";
import test from "node:test";

import type { Course } from "../courses/types.js";
import type { ProgressRecord } from "./model.js";
import { reconcileCourseProgress } from "./reconcile.js";
import { courseFixture } from "./testSupport.js";

function record(courseId: string, lessonId: string, overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    courseId,
    lessonId,
    status: "completed",
    courseVersion: "1.0.0",
    completedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

void test("reconcile marks stored lessons completed and everything else not started (happy path)", () => {
  const course = courseFixture();
  const tree = reconcileCourseProgress(course, [record(course.id, "a1"), record(course.id, "b1")]);

  assert.equal(tree.courseId, course.id);
  assert.equal(tree.courseVersion, "1.0.0");
  assert.equal(tree.totalLessons, 4);
  assert.equal(tree.completedLessons, 2);
  assert.equal(tree.completed, false);
  assert.deepEqual(
    tree.modules.map((module) => [module.id, module.completedLessons, module.totalLessons, module.completed]),
    [
      ["m1", 1, 2, false],
      ["m2", 1, 2, false],
    ],
  );
  assert.deepEqual(
    tree.modules.flatMap((module) => module.lessons).map((lesson) => [lesson.id, lesson.status]),
    [
      ["a1", "completed"],
      ["a2", "not_started"],
      ["b1", "completed"],
      ["b2", "not_started"],
    ],
  );
  assert.deepEqual(tree.orphanedLessons, []);
  assert.deepEqual(tree.recordedVersions, []);
});

void test("reconcile reports the course completed only when every lesson currently in it is completed", () => {
  const course = courseFixture();
  const all = ["a1", "a2", "b1", "b2"].map((lessonId) => record(course.id, lessonId));
  const tree = reconcileCourseProgress(course, all);

  assert.equal(tree.completed, true);
  assert.equal(tree.completedLessons, 4);
  assert.deepEqual(
    tree.modules.map((module) => module.completed),
    [true, true],
  );
});

void test("reconcile carries completedAt and the completion mode onto every lesson", () => {
  const course = courseFixture();
  const tree = reconcileCourseProgress(course, [
    record(course.id, "a1", { completedAt: "2026-02-03T10:20:30.000Z" }),
  ]);
  const lessons = tree.modules.flatMap((module) => module.lessons);

  assert.equal(lessons[0]?.completedAt, "2026-02-03T10:20:30.000Z");
  // Not started -> no timestamp at all, rather than a null/epoch stand-in.
  assert.equal(lessons[1]?.completedAt, undefined);
  assert.deepEqual(
    lessons.map((lesson) => lesson.completionMode),
    ["manual", "quiz", "practice", "manual"],
  );
  assert.deepEqual(
    lessons.map((lesson) => [lesson.hasContent, lesson.hasQuiz, lesson.hasPractice]),
    [
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, false, false],
    ],
  );
});

// --- The course-update rules -------------------------------------------

void test("course update: lessons whose id survived stay completed even when title, module and order changed", () => {
  const before = courseFixture();
  const progress = [record(before.id, "a1"), record(before.id, "b1")];

  // Same ids, everything else different: renamed lessons, a2 moved to the
  // other module, modules reordered, new version.
  const after: Course = {
    ...before,
    version: "2.0.0",
    modules: [
      {
        id: "m2",
        title: "Module two, renamed",
        lessons: [
          { id: "b2", title: "b2, renamed", content: "# b2" },
          { id: "a2", title: "a2, moved here", content: "# a2" },
        ],
      },
      {
        id: "m1",
        title: "Module one, renamed",
        lessons: [
          { id: "b1", title: "b1, moved here", content: "# b1" },
          { id: "a1", title: "a1, renamed", content: "# a1" },
        ],
      },
    ],
  };

  const tree = reconcileCourseProgress(after, progress);
  assert.equal(tree.completedLessons, 2);
  assert.deepEqual(
    tree.modules.flatMap((module) => module.lessons).map((lesson) => [lesson.id, lesson.status]),
    [
      ["b2", "not_started"],
      ["a2", "not_started"],
      ["b1", "completed"],
      ["a1", "completed"],
    ],
  );
  // Nothing was reset by the version bump; it is only reported.
  assert.deepEqual(tree.recordedVersions, ["1.0.0"]);
  assert.deepEqual(tree.orphanedLessons, []);
});

void test("course update: lessons added by the update are not started, never retroactively completed", () => {
  const before = courseFixture();
  const progress = ["a1", "a2", "b1", "b2"].map((lessonId) => record(before.id, lessonId));
  const after: Course = {
    ...before,
    modules: [
      ...before.modules,
      { id: "m3", title: "Brand new module", lessons: [{ id: "c1", title: "New lesson", content: "# c1" }] },
    ],
  };

  const tree = reconcileCourseProgress(after, progress);
  assert.equal(tree.totalLessons, 5);
  assert.equal(tree.completedLessons, 4);
  assert.equal(tree.completed, false);
  assert.equal(tree.modules.at(-1)?.lessons[0]?.status, "not_started");
});

void test("course update: progress for lessons the update removed is reported as orphaned, not counted and not lost", () => {
  const before = courseFixture();
  const progress = [record(before.id, "a1"), record(before.id, "gone-lesson", { courseVersion: "0.9.0" })];
  const tree = reconcileCourseProgress(before, progress);

  assert.equal(tree.totalLessons, 4);
  assert.equal(tree.completedLessons, 1);
  assert.deepEqual(tree.orphanedLessons, [
    { lessonId: "gone-lesson", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "0.9.0" },
  ]);
  // Reconciliation is pure: it reports orphans, it does not delete them —
  // the row must survive so it counts again if the lesson comes back.
  assert.deepEqual(
    reconcileCourseProgress(
      {
        ...before,
        modules: [
          ...before.modules,
          { id: "m3", title: "Restored", lessons: [{ id: "gone-lesson", title: "It's back", content: "#" }] },
        ],
      },
      progress,
    ).completedLessons,
    2,
  );
});

void test("reconcile ignores rows belonging to another course (error path)", () => {
  const course = courseFixture();
  const tree = reconcileCourseProgress(course, [
    record(course.id, "a1"),
    record("some-other-course", "a2"),
    record("some-other-course", "not-even-here"),
  ]);

  assert.equal(tree.completedLessons, 1);
  assert.equal(tree.modules[0]?.lessons[1]?.status, "not_started");
  // Foreign rows are dropped outright — not counted, and not reported as
  // this course's orphans either.
  assert.deepEqual(tree.orphanedLessons, []);
});

void test("reconcile on an empty progress set yields a fully not-started tree (edge case)", () => {
  const tree = reconcileCourseProgress(courseFixture(), []);
  assert.equal(tree.completedLessons, 0);
  assert.equal(tree.completed, false);
  assert.equal(
    tree.modules.flatMap((module) => module.lessons).every((lesson) => lesson.status === "not_started"),
    true,
  );
});

void test("reconcile lists each differing recorded version once, sorted (edge case)", () => {
  const course = courseFixture();
  const tree = reconcileCourseProgress(course, [
    record(course.id, "a1", { courseVersion: "0.9.0" }),
    record(course.id, "a2", { courseVersion: "0.8.0" }),
    record(course.id, "b1", { courseVersion: "0.9.0" }),
    // Matches the installed version -> not "differing", so absent below.
    record(course.id, "b2", { courseVersion: "1.0.0" }),
  ]);
  assert.deepEqual(tree.recordedVersions, ["0.8.0", "0.9.0"]);
});

void test("reconcile sorts recorded versions by semver precedence, not lexicographically (regression)", () => {
  const course = courseFixture();
  const tree = reconcileCourseProgress(course, [
    // A plain string sort would put "0.10.0" before "0.9.0" (comparing the
    // "1" and "9" characters) and "0.2.0" after "0.10.0" too.
    record(course.id, "a1", { courseVersion: "0.10.0" }),
    record(course.id, "a2", { courseVersion: "0.9.0" }),
    record(course.id, "b1", { courseVersion: "0.2.0" }),
  ]);
  assert.deepEqual(tree.recordedVersions, ["0.2.0", "0.9.0", "0.10.0"]);
});
