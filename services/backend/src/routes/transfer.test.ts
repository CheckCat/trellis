import assert from "node:assert/strict";
import test from "node:test";

import {
  completedRecord,
  FIXTURE_COURSE_ID,
  FIXTURE_COURSE_VERSION,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_TEXT_LESSON_ID,
  withProgressApp,
} from "../progress/testSupport.js";
import { PROGRESS_EXPORT_FORMAT } from "../transfer/format.js";

/** A transfer file as a client would post it. */
function exportFile(
  courses: unknown[],
  exportedAt = "2026-09-09T00:00:00.000Z",
): Record<string, unknown> {
  return { format: PROGRESS_EXPORT_FORMAT, formatVersion: 1, exportedAt, courses };
}

void test("GET /progress/export returns a versioned, timestamped progress file (happy path)", async () => {
  await withProgressApp(
    async (app) => {
      const response = await app.inject({ method: "GET", url: "/progress/export" });
      assert.equal(response.statusCode, 200);
      const body = response.json();

      assert.equal(body.format, PROGRESS_EXPORT_FORMAT);
      assert.equal(body.formatVersion, 1);
      assert.equal(Number.isNaN(Date.parse(body.exportedAt)), false);
      assert.deepEqual(body.courses, [
        {
          courseId: FIXTURE_COURSE_ID,
          installedVersion: FIXTURE_COURSE_VERSION,
          lessons: [
            {
              lessonId: FIXTURE_TEXT_LESSON_ID,
              status: "completed",
              completedAt: "2026-01-01T00:00:00.000Z",
              courseVersion: FIXTURE_COURSE_VERSION,
            },
          ],
        },
      ]);
      // Suggested save name for a plain browser navigation — the file is
      // still ordinary JSON.
      assert.match(response.headers["content-disposition"] as string, /^attachment; filename="trellis-progress-.*\.json"$/);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("GET /progress/export carries progress, never course content", async () => {
  await withProgressApp(
    async (app) => {
      const response = await app.inject({ method: "GET", url: "/progress/export" });
      // Same rule as the progress tree: the transfer file must not become a
      // second, stale copy of the course package.
      for (const forbidden of ["title", "Text lesson", "quiz", "explanation", "check", "select"]) {
        assert.equal(response.body.includes(forbidden), false, `export leaked "${forbidden}"`);
      }
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("POST /progress/import applies a file and reports what it changed", async () => {
  await withProgressApp(
    async (app, progress) => {
      const response = await app.inject({
        method: "POST",
        url: "/progress/import",
        payload: exportFile([
          {
            courseId: FIXTURE_COURSE_ID,
            installedVersion: FIXTURE_COURSE_VERSION,
            lessons: [
              // already completed here, later than the local row -> unchanged
              {
                lessonId: FIXTURE_TEXT_LESSON_ID,
                status: "completed",
                completedAt: "2026-02-02T00:00:00.000Z",
              },
              // new here
              {
                lessonId: FIXTURE_QUIZ_LESSON_ID,
                status: "completed",
                completedAt: "2026-02-02T00:00:00.000Z",
                courseVersion: "0.9.0",
              },
            ],
          },
        ]),
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.applied, true);
      assert.equal(body.stale, false);
      assert.deepEqual(body.summary, { courses: 1, lessons: 2, created: 1, earlierCompletions: 0, unchanged: 1 });
      assert.deepEqual(body.coursesNotInstalled, []);
      assert.deepEqual(body.courses, [
        {
          courseId: FIXTURE_COURSE_ID,
          installed: true,
          fileVersion: FIXTURE_COURSE_VERSION,
          lessons: 2,
          created: 1,
          earlierCompletions: 0,
          unchanged: 1,
        },
      ]);

      // The imported completion is really stored, with the file's own
      // completion time (an import restores when it happened elsewhere; it
      // does not pass the lesson again now).
      const stored = progress.records().find((row) => row.lessonId === FIXTURE_QUIZ_LESSON_ID);
      assert.equal(stored?.completedAt, "2026-02-02T00:00:00.000Z");
      assert.equal(stored?.courseVersion, "0.9.0");
      // ...and the untouched one was not re-stamped.
      const untouched = progress.records().find((row) => row.lessonId === FIXTURE_TEXT_LESSON_ID);
      assert.equal(untouched?.completedAt, "2026-01-01T00:00:00.000Z");
      assert.equal(untouched?.updatedAt, "2026-01-01T00:00:00.000Z");

      // The imported lesson is immediately visible through the normal
      // progress API — an import is progress, not a parallel store.
      const tree = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
      assert.equal(tree.completedLessons, 2);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("POST /progress/import refuses a file older than local progress until it is confirmed", async () => {
  await withProgressApp(
    async (app, progress) => {
      const payload = exportFile(
        [
          {
            courseId: FIXTURE_COURSE_ID,
            lessons: [
              { lessonId: FIXTURE_QUIZ_LESSON_ID, status: "completed", completedAt: "2019-01-01T00:00:00.000Z" },
            ],
          },
        ],
        "2020-01-01T00:00:00.000Z",
      );

      const warned = await app.inject({ method: "POST", url: "/progress/import", payload });
      assert.equal(warned.statusCode, 409);
      const warnedBody = warned.json();
      assert.equal(warnedBody.error, "import_older_than_local");
      assert.equal(warnedBody.applied, false);
      assert.equal(warnedBody.stale, true);
      assert.equal(warnedBody.fileExportedAt, "2020-01-01T00:00:00.000Z");
      assert.equal(warnedBody.localLatestProgressAt, "2026-01-01T00:00:00.000Z");
      // The preview is complete enough for the UI to explain the decision
      // without a second round trip.
      assert.equal(warnedBody.summary.created, 1);
      // Refused means refused: not one row was written.
      assert.deepEqual(
        progress.records().map((row) => row.lessonId),
        [FIXTURE_TEXT_LESSON_ID],
      );

      const confirmed = await app.inject({ method: "POST", url: "/progress/import?confirm=true", payload });
      assert.equal(confirmed.statusCode, 200);
      const confirmedBody = confirmed.json();
      assert.equal(confirmedBody.applied, true);
      // Still reported as stale — the user was told, and chose to proceed.
      assert.equal(confirmedBody.stale, true);
      assert.deepEqual(
        progress
          .records()
          .map((row) => row.lessonId)
          .sort(),
        [FIXTURE_QUIZ_LESSON_ID, FIXTURE_TEXT_LESSON_ID].sort(),
      );
      // Even a stale import cannot erase or un-complete what was here.
      assert.equal(progress.records().find((row) => row.lessonId === FIXTURE_TEXT_LESSON_ID)?.status, "completed");
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("POST /progress/import does not demand confirmation for an old file that would change nothing", async () => {
  await withProgressApp(
    async (app, progress) => {
      // Older than the local progress (2026-01-01), but its single completion
      // is already here at an earlier time — the import is a no-op. A warning
      // you cannot act on differently is friction, not a warning: re-importing
      // yesterday's file must not require "?confirm=true".
      const payload = exportFile(
        [
          {
            courseId: FIXTURE_COURSE_ID,
            lessons: [
              { lessonId: FIXTURE_TEXT_LESSON_ID, status: "completed", completedAt: "2026-06-01T00:00:00.000Z" },
            ],
          },
        ],
        "2020-01-01T00:00:00.000Z",
      );

      const response = await app.inject({ method: "POST", url: "/progress/import", payload });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.applied, true);
      // The file IS old, and the body still says so — it just isn't a question.
      assert.equal(body.stale, true);
      assert.equal(body.summary.created, 0);
      assert.equal(body.summary.earlierCompletions, 0);
      assert.equal(body.summary.unchanged, 1);
      // Nothing written: the stored completion keeps its original timestamp.
      assert.equal(progress.records().length, 1);
      assert.equal(progress.records()[0]?.completedAt, "2026-01-01T00:00:00.000Z");
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("POST /progress/import keeps progress for courses that aren't installed here", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: "/progress/import",
      payload: exportFile([
        {
          courseId: "a-course-from-the-other-machine",
          installedVersion: "4.5.6",
          lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-03-03T00:00:00.000Z" }],
        },
      ]),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body.coursesNotInstalled, ["a-course-from-the-other-machine"]);
    assert.equal(body.summary.created, 1);
    assert.equal(body.courses[0].installed, false);
    // Stored, waiting for the course to show up (clarify Q-009) — and
    // re-exported as-is meanwhile.
    assert.equal(progress.records().length, 1);
    const reexported = (await app.inject({ method: "GET", url: "/progress/export" })).json();
    assert.equal(reexported.courses[0].courseId, "a-course-from-the-other-machine");
    assert.equal(reexported.courses[0].installedVersion, undefined);
  });
});

void test("POST /progress/import round-trips this machine's own export as a no-op", async () => {
  await withProgressApp(
    async (app, progress) => {
      const exported = (await app.inject({ method: "GET", url: "/progress/export" })).json();
      const before = progress.records();

      const response = await app.inject({ method: "POST", url: "/progress/import", payload: exported });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().summary, {
        courses: 1,
        lessons: 1,
        created: 0,
        earlierCompletions: 0,
        unchanged: 1,
      });
      // Not one row re-written — no `updatedAt` churn on a no-op import.
      assert.deepEqual(progress.records(), before);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("POST /progress/import explains, in its own words, why a file was rejected", async () => {
  await withProgressApp(async (app, progress) => {
    const notOurs = await app.inject({ method: "POST", url: "/progress/import", payload: { hello: "world" } });
    assert.equal(notOurs.statusCode, 400);
    assert.equal(notOurs.json().error, "invalid_export_file");
    assert.match(notOurs.json().problems[0], /not a Trellis progress file/);

    const fromTheFuture = await app.inject({
      method: "POST",
      url: "/progress/import",
      payload: { ...exportFile([]), formatVersion: 99 },
    });
    assert.equal(fromTheFuture.statusCode, 400);
    assert.equal(fromTheFuture.json().error, "unsupported_export_version");

    const broken = await app.inject({
      method: "POST",
      url: "/progress/import",
      payload: exportFile([{ courseId: "c", lessons: [{ lessonId: "l", status: "completed", completedAt: "nope" }] }]),
    });
    assert.equal(broken.statusCode, 400);
    assert.equal(broken.json().error, "invalid_export_file");
    assert.match(broken.json().problems.join("\n"), /courses\[0\]\.lessons\[0\]\.completedAt/);

    // Nothing partial was written by any of the three.
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST /progress/import stores progress for lessons the installed course no longer has", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/progress/import",
      payload: exportFile([
        {
          courseId: FIXTURE_COURSE_ID,
          lessons: [{ lessonId: "lesson-from-an-older-build", status: "completed", completedAt: "2026-03-03T00:00:00.000Z" }],
        },
      ]),
    });
    assert.equal(response.statusCode, 200);

    // It is kept (never dropped for not matching the installed course) and
    // surfaces as orphaned progress — the same treatment a lesson removed by
    // a course update gets.
    const tree = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
    assert.deepEqual(tree.orphanedLessons, [
      { lessonId: "lesson-from-an-older-build", completedAt: "2026-03-03T00:00:00.000Z" },
    ]);
    assert.equal(tree.completedLessons, 0);
  });
});
