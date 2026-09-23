import assert from "node:assert/strict";
import test from "node:test";

import type { ProgressRecord } from "../../progress/model/index.js";
import { buildProgressExport } from "../export/index.js";
import type { ProgressExportFile } from "../format/index.js";
import { planProgressImport } from "./import.js";

function record(courseId: string, lessonId: string, overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    courseId,
    lessonId,
    status: "completed",
    courseVersion: "1.0.0",
    completedAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function file(courses: ProgressExportFile["courses"], exportedAt = "2026-06-06T00:00:00.000Z"): ProgressExportFile {
  return { format: "trellis.progress", formatVersion: 1, exportedAt, courses };
}

function lesson(lessonId: string, completedAt: string, courseVersion?: string) {
  return { lessonId, status: "completed" as const, completedAt, courseVersion };
}

const installedEverywhere = { isCourseInstalled: () => true };

void test("planProgressImport classifies every lesson: created, earlier completion, unchanged (happy path)", () => {
  const plan = planProgressImport(
    file([
      {
        courseId: "course-a",
        installedVersion: "1.0.0",
        lessons: [
          // not here yet
          lesson("new-lesson", "2026-04-04T00:00:00.000Z", "0.9.0"),
          // here, but the file passed it earlier
          lesson("old-lesson", "2026-01-01T00:00:00.000Z", "0.8.0"),
          // here already, and the file's completion is later -> no change
          lesson("known-lesson", "2026-09-09T00:00:00.000Z"),
        ],
      },
    ]),
    [record("course-a", "old-lesson"), record("course-a", "known-lesson")],
    installedEverywhere,
  );

  assert.deepEqual(plan.totals, { courses: 1, lessons: 3, created: 1, earlierCompletions: 1, unchanged: 1 });
  assert.deepEqual(plan.courses, [
    {
      courseId: "course-a",
      installed: true,
      fileVersion: "1.0.0",
      lessons: 3,
      created: 1,
      earlierCompletions: 1,
      unchanged: 1,
    },
  ]);
  // Only what actually changes is written — an unchanged lesson is not
  // re-stamped.
  assert.deepEqual(plan.records, [
    { courseId: "course-a", lessonId: "new-lesson", completedAt: "2026-04-04T00:00:00.000Z", courseVersion: "0.9.0" },
    { courseId: "course-a", lessonId: "old-lesson", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "0.8.0" },
  ]);
});

void test("planProgressImport never plans to remove or un-complete anything", () => {
  // Local progress the file knows nothing about must survive an import: the
  // file is merged in, it does not replace the local state.
  const plan = planProgressImport(
    file([{ courseId: "course-a", lessons: [lesson("l1", "2026-06-01T00:00:00.000Z")] }]),
    [record("course-a", "l1"), record("course-a", "only-here"), record("other-course", "l1")],
    installedEverywhere,
  );
  assert.equal(plan.totals.created, 0);
  assert.deepEqual(plan.records, []);
  // Nothing in the plan refers to the rows the file didn't mention.
  assert.equal(JSON.stringify(plan.records).includes("only-here"), false);
  assert.equal(JSON.stringify(plan.courses).includes("other-course"), false);
});

void test("planProgressImport warns when the file is older than local progress", () => {
  const plan = planProgressImport(
    file([{ courseId: "course-a", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] }], "2026-02-02T00:00:00.000Z"),
    [record("course-a", "l2", { updatedAt: "2026-07-07T00:00:00.000Z" })],
    installedEverywhere,
  );
  assert.equal(plan.stale, true);
  assert.equal(plan.fileExportedAt, "2026-02-02T00:00:00.000Z");
  assert.equal(plan.localLatestProgressAt, "2026-07-07T00:00:00.000Z");
});

void test("planProgressImport does not warn for a newer file, an equally-old one, or an empty machine", () => {
  const local = [record("course-a", "l1", { updatedAt: "2026-05-05T00:00:00.000Z" })];
  const newer = planProgressImport(file([], "2026-06-06T00:00:00.000Z"), local, installedEverywhere);
  assert.equal(newer.stale, false);

  // Exactly as old as the newest local change: not older, so not a warning.
  const same = planProgressImport(file([], "2026-05-05T00:00:00.000Z"), local, installedEverywhere);
  assert.equal(same.stale, false);

  // Nothing local at all — there is nothing an older file could shadow.
  const empty = planProgressImport(file([], "1999-01-01T00:00:00.000Z"), [], installedEverywhere);
  assert.equal(empty.stale, false);
  assert.equal(empty.localLatestProgressAt, undefined);
});

void test("planProgressImport compares against the newest local change, not the first or the last row", () => {
  const plan = planProgressImport(
    file([], "2026-06-06T00:00:00.000Z"),
    [
      record("course-a", "l1", { updatedAt: "2026-08-08T00:00:00.000Z" }),
      record("course-b", "l1", { updatedAt: "2026-02-02T00:00:00.000Z" }),
    ],
    installedEverywhere,
  );
  assert.equal(plan.localLatestProgressAt, "2026-08-08T00:00:00.000Z");
  assert.equal(plan.stale, true);
});

void test("planProgressImport imports progress for courses that are not installed, and says which (clarify Q-009)", () => {
  const plan = planProgressImport(
    file([
      { courseId: "installed-course", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] },
      { courseId: "absent-course", installedVersion: "3.1.0", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] },
    ]),
    [],
    { isCourseInstalled: (courseId) => courseId === "installed-course" },
  );

  assert.deepEqual(plan.coursesNotInstalled, ["absent-course"]);
  // Reported, not skipped: both courses' rows are planned for writing.
  assert.deepEqual(
    plan.records.map((entry) => entry.courseId),
    ["installed-course", "absent-course"],
  );
  assert.equal(plan.totals.created, 2);
  assert.equal(plan.courses[1]?.installed, false);
  // The version the OTHER machine had installed travels with the file even
  // though nothing here can match it yet.
  assert.equal(plan.courses[1]?.fileVersion, "3.1.0");
});

void test("re-importing a machine's own export changes nothing (round trip)", () => {
  const local = [
    record("course-a", "l1", { completedAt: "2026-01-01T00:00:00.000Z" }),
    record("course-b", "l2", { completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined }),
  ];
  const exported = buildProgressExport(local, {
    installedVersion: () => "1.0.0",
    exportedAt: "2026-09-09T00:00:00.000Z",
  });

  const plan = planProgressImport(exported, local, installedEverywhere);
  assert.equal(plan.stale, false);
  assert.deepEqual(plan.totals, { courses: 2, lessons: 2, created: 0, earlierCompletions: 0, unchanged: 2 });
  assert.deepEqual(plan.records, []);
});

void test("importing into an empty machine restores everything the file holds", () => {
  const source = [
    record("course-a", "l1", { completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" }),
    record("course-a", "l2", { completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined }),
  ];
  const exported = buildProgressExport(source, { installedVersion: () => "1.0.0" });

  const plan = planProgressImport(exported, [], installedEverywhere);
  assert.equal(plan.totals.created, 2);
  assert.deepEqual(plan.records, [
    { courseId: "course-a", lessonId: "l1", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
    { courseId: "course-a", lessonId: "l2", completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined },
  ]);
});
