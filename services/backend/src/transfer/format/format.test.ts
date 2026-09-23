import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProgressExport,
  progressExportFileName,
  PROGRESS_EXPORT_FORMAT,
  PROGRESS_EXPORT_FORMAT_VERSION,
} from "./format.js";

/** A minimal valid file, as a plain JSON value (what the HTTP layer hands
 * `parseProgressExport` after decoding the body). */
function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: PROGRESS_EXPORT_FORMAT,
    formatVersion: PROGRESS_EXPORT_FORMAT_VERSION,
    exportedAt: "2026-09-16T12:30:00.000Z",
    courses: [
      {
        courseId: "course-a",
        installedVersion: "1.2.0",
        lessons: [
          { lessonId: "lesson-1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: "1.1.0" },
          { lessonId: "lesson-2", status: "completed", completedAt: "2026-09-02T10:00:00.000Z" },
        ],
      },
    ],
    ...overrides,
  };
}

void test("parseProgressExport accepts a well-formed file and normalizes it (happy path)", () => {
  const parsed = parseProgressExport(validFile());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.file, {
    format: PROGRESS_EXPORT_FORMAT,
    formatVersion: 1,
    exportedAt: "2026-09-16T12:30:00.000Z",
    courses: [
      {
        courseId: "course-a",
        installedVersion: "1.2.0",
        lessons: [
          { lessonId: "lesson-1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: "1.1.0" },
          {
            lessonId: "lesson-2",
            status: "completed",
            completedAt: "2026-09-02T10:00:00.000Z",
            courseVersion: undefined,
          },
        ],
      },
    ],
  });
});

void test("parseProgressExport canonicalizes timestamps to UTC and drops unknown fields", () => {
  const parsed = parseProgressExport(
    validFile({
      exportedAt: "2026-09-16T15:30:00+03:00",
      somethingFromTheFuture: { whatever: true },
      courses: [
        {
          courseId: "course-a",
          lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T13:00:00+03:00", extra: 1 }],
          extra: "ignored",
        },
      ],
    }),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  // Same instants, one canonical spelling — comparisons ("is this file older
  // than my progress?") must not depend on which offset a machine wrote.
  assert.equal(parsed.file.exportedAt, "2026-09-16T12:30:00.000Z");
  assert.deepEqual(parsed.file.courses, [
    {
      courseId: "course-a",
      installedVersion: undefined,
      lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: undefined }],
    },
  ]);
  assert.equal("somethingFromTheFuture" in parsed.file, false);
});

void test("parseProgressExport accepts a file with no progress at all (edge case)", () => {
  const parsed = parseProgressExport(validFile({ courses: [] }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.file.courses, []);
});

void test("parseProgressExport rejects anything that isn't a Trellis progress file", () => {
  for (const value of [null, 42, "a string", [], {}, { format: "pg_dump" }, { format: 5 }]) {
    const parsed = parseProgressExport(value);
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(value)} to be rejected`);
    if (parsed.ok) continue;
    assert.equal(parsed.reason, "not_an_export_file");
    assert.equal(parsed.problems.length, 1);
  }
});

void test("parseProgressExport rejects a file written by a newer Trellis, by version, without reading it", () => {
  const parsed = parseProgressExport(
    validFile({ formatVersion: PROGRESS_EXPORT_FORMAT_VERSION + 1, courses: "not even an array" }),
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "unsupported_version");
  // The version is the whole verdict — the (here deliberately broken) rest of
  // the file is not half-parsed and not reported as a pile of field errors.
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0] ?? "", /version 2/);
});

void test("parseProgressExport reports every problem in one pass, with field paths", () => {
  const parsed = parseProgressExport({
    format: PROGRESS_EXPORT_FORMAT,
    formatVersion: 1,
    exportedAt: "last tuesday",
    courses: [
      {
        courseId: "",
        lessons: [
          { lessonId: "l1", status: "in_progress", completedAt: "2026-09-01T10:00:00.000Z" },
          { lessonId: "l2", status: "completed", completedAt: "2026-13-45T99:00:00.000Z" },
          { status: "completed", completedAt: "2026-09-01T10:00:00.000Z" },
        ],
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "malformed");
  const joined = parsed.problems.join("\n");
  assert.match(joined, /^exportedAt: expected an ISO 8601 timestamp/m);
  assert.match(joined, /^courses\[0\]\.courseId: expected a non-empty string/m);
  assert.match(joined, /^courses\[0\]\.lessons\[0\]\.status: expected "completed"/m);
  // Shaped like a timestamp, but there is no month 13 — caught by the parse,
  // not by the regex, and reported with its own wording.
  assert.match(joined, /^courses\[0\]\.lessons\[1\]\.completedAt: "2026-13-45T99:00:00\.000Z" is not a real date\./m);
  assert.match(joined, /^courses\[0\]\.lessons\[2\]\.lessonId: expected a non-empty string/m);
  assert.equal(parsed.problems.length, 5);
});

void test("parseProgressExport rejects a timestamp with no time zone (its instant would depend on the reader)", () => {
  // "2026-09-01T10:00:00" is read by Date.parse as the LOCAL time of the
  // machine doing the import, so the same hand-edited file would canonicalize
  // to a different instant in Moscow than in London — and with it the "is
  // this file older than my progress?" verdict. Refused instead of guessed.
  const parsed = parseProgressExport(
    validFile({
      exportedAt: "2026-09-16T12:30:00",
      courses: [
        { courseId: "course-a", lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00" }] },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.reason, "malformed");
  const joined = parsed.problems.join("\n");
  assert.match(joined, /^exportedAt: expected an ISO 8601 timestamp with a time zone/m);
  assert.match(joined, /^courses\[0\]\.lessons\[0\]\.completedAt: expected an ISO 8601 timestamp with a time zone/m);

  // The same instants spelled WITH a zone stay accepted, in either spelling.
  for (const stamp of ["2026-09-16T12:30:00Z", "2026-09-16T15:30:00+03:00", "2026-09-16T15:30:00+0300"]) {
    const ok = parseProgressExport(validFile({ exportedAt: stamp, courses: [] }));
    assert.equal(ok.ok, true, `expected ${stamp} to be accepted`);
    if (!ok.ok) continue;
    assert.equal(ok.file.exportedAt, "2026-09-16T12:30:00.000Z");
  }
});

void test("parseProgressExport rejects duplicate course and lesson ids (they would make the import order-dependent)", () => {
  const parsed = parseProgressExport(
    validFile({
      courses: [
        {
          courseId: "course-a",
          lessons: [
            { lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z" },
            { lessonId: "l1", status: "completed", completedAt: "2026-09-02T10:00:00.000Z" },
          ],
        },
        { courseId: "course-a", lessons: [] },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const joined = parsed.problems.join("\n");
  assert.match(joined, /duplicate lesson id "l1"/);
  assert.match(joined, /duplicate course id "course-a"/);
});

void test("parseProgressExport error messages never echo the whole file back", () => {
  const long = "x".repeat(5000);
  const parsed = parseProgressExport({ format: PROGRESS_EXPORT_FORMAT, formatVersion: 1, exportedAt: long, courses: [] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.problems.length, 1);
  assert.ok((parsed.problems[0] ?? "").length < 200, "a problem message must stay a sentence, not a copy of the input");
});

void test("progressExportFileName is a legal Windows filename carrying the timestamp", () => {
  const name = progressExportFileName("2026-09-16T12:30:00.000Z");
  assert.equal(name, "trellis-progress-2026-09-16T12-30-00Z.json");
  // ":" is not allowed in a Windows filename — the launcher scripts target
  // Windows, so a suggested download name with colons would be unusable.
  assert.equal(name.includes(":"), false);
});
