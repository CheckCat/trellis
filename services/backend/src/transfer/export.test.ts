import assert from "node:assert/strict";
import test from "node:test";

import type { ProgressRecord } from "../progress/model.js";
import { buildProgressExport } from "./export.js";
import { parseProgressExport, PROGRESS_EXPORT_FORMAT, PROGRESS_EXPORT_FORMAT_VERSION } from "./format.js";

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

const INSTALLED: Record<string, string> = { "course-a": "2.0.0" };
const installedVersion = (courseId: string): string | undefined => INSTALLED[courseId];

void test("buildProgressExport groups rows by course and carries both kinds of version (happy path)", () => {
  const file = buildProgressExport(
    [
      record("course-a", "lesson-1", { courseVersion: "1.0.0", completedAt: "2026-01-01T00:00:00.000Z" }),
      record("course-a", "lesson-2", { courseVersion: "2.0.0", completedAt: "2026-02-02T00:00:00.000Z" }),
    ],
    { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" },
  );

  assert.equal(file.format, PROGRESS_EXPORT_FORMAT);
  assert.equal(file.formatVersion, PROGRESS_EXPORT_FORMAT_VERSION);
  assert.equal(file.exportedAt, "2026-03-03T00:00:00.000Z");
  assert.deepEqual(file.courses, [
    {
      courseId: "course-a",
      // The version installed HERE, now...
      installedVersion: "2.0.0",
      lessons: [
        // ...and, per completion, the version recorded when it was passed.
        { lessonId: "lesson-1", status: "completed", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
        { lessonId: "lesson-2", status: "completed", completedAt: "2026-02-02T00:00:00.000Z", courseVersion: "2.0.0" },
      ],
    },
  ]);
});

void test("buildProgressExport is deterministic regardless of row order", () => {
  const rows = [
    record("course-b", "z-lesson"),
    record("course-a", "b-lesson"),
    record("course-b", "a-lesson"),
    record("course-a", "a-lesson"),
  ];
  const options = { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" };

  const straight = buildProgressExport(rows, options);
  const shuffled = buildProgressExport([...rows].reverse(), options);

  assert.deepEqual(straight, shuffled);
  assert.deepEqual(
    straight.courses.map((course) => [course.courseId, course.lessons.map((lesson) => lesson.lessonId)]),
    [
      ["course-a", ["a-lesson", "b-lesson"]],
      ["course-b", ["a-lesson", "z-lesson"]],
    ],
  );
});

void test("buildProgressExport keeps progress for courses that are not installed here (clarify Q-009)", () => {
  const file = buildProgressExport([record("course-a", "l1"), record("gone-course", "l9")], {
    installedVersion,
    exportedAt: "2026-03-03T00:00:00.000Z",
  });
  const gone = file.courses.find((course) => course.courseId === "gone-course");
  assert.ok(gone, "progress for a course that isn't installed must still be exported");
  // No installed version to report — the field is absent, not invented.
  assert.equal(gone.installedVersion, undefined);
  assert.equal(gone.lessons.length, 1);
});

void test("buildProgressExport carries no course content — ids and versions only", () => {
  const file = buildProgressExport([record("course-a", "l1")], {
    installedVersion,
    exportedAt: "2026-03-03T00:00:00.000Z",
  });
  // Raw-text assertion, not a shape assertion: the progress format and the
  // course format are separate entities (project invariant), so a title, a
  // module, a quiz or a check must never appear in a transfer file — not even
  // "for readability".
  const raw = JSON.stringify(file);
  for (const forbidden of ["title", "module", "quiz", "content", "check", "prompt"]) {
    assert.equal(raw.includes(forbidden), false, `export leaked "${forbidden}"`);
  }
});

void test("buildProgressExport omits internal bookkeeping (updatedAt) but keeps the file re-readable", () => {
  const file = buildProgressExport([record("course-a", "l1", { updatedAt: "2099-01-01T00:00:00.000Z" })], {
    installedVersion,
    exportedAt: "2026-03-03T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(file).includes("2099"), false, "updatedAt is local bookkeeping, not transferable data");

  // Round trip through the parser: what the exporter writes is exactly what
  // the importer accepts, with nothing lost in between.
  const parsed = parseProgressExport(JSON.parse(JSON.stringify(file)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.file, file);
});

void test("buildProgressExport with no progress at all still produces a valid, timestamped file", () => {
  const file = buildProgressExport([], { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" });
  assert.deepEqual(file.courses, []);
  assert.equal(parseProgressExport(JSON.parse(JSON.stringify(file))).ok, true);
});

void test("buildProgressExport defaults exportedAt to now", () => {
  const before = Date.now();
  const file = buildProgressExport([], { installedVersion });
  const stamp = Date.parse(file.exportedAt);
  assert.equal(Number.isNaN(stamp), false);
  assert.ok(stamp >= before && stamp <= Date.now() + 1000);
});
