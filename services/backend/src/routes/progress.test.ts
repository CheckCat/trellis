import assert from "node:assert/strict";
import test from "node:test";

import {
  completedRecord,
  FIXTURE_COURSE_ID,
  FIXTURE_COURSE_VERSION,
  FIXTURE_PRACTICE_LESSON_ID,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_TEXT_LESSON_ID,
  FIXTURE_UNCHECKED_PRACTICE_LESSON_ID,
  withProgressApp,
} from "../progress/testSupport.js";

interface LessonBody {
  readonly id: string;
  readonly status: string;
}

void test("GET /courses/:courseId/progress returns the whole tree with statuses (happy path)", async () => {
  await withProgressApp(
    async (app) => {
      const response = await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` });
      assert.equal(response.statusCode, 200);
      const body = response.json();

      assert.equal(body.courseId, FIXTURE_COURSE_ID);
      assert.equal(body.courseVersion, FIXTURE_COURSE_VERSION);
      assert.equal(body.title, "Progress fixture course");
      assert.equal(body.totalLessons, 4);
      assert.equal(body.completedLessons, 1);
      assert.equal(body.completed, false);
      assert.deepEqual(
        body.modules
          .flatMap((module: { lessons: LessonBody[] }) => module.lessons)
          .map((lesson: LessonBody) => [lesson.id, lesson.status]),
        [
          [FIXTURE_TEXT_LESSON_ID, "completed"],
          [FIXTURE_QUIZ_LESSON_ID, "not_started"],
          [FIXTURE_PRACTICE_LESSON_ID, "not_started"],
          [FIXTURE_UNCHECKED_PRACTICE_LESSON_ID, "not_started"],
        ],
      );
      assert.deepEqual(
        body.modules.map((module: { id: string; completedLessons: number; totalLessons: number }) => [
          module.id,
          module.completedLessons,
          module.totalLessons,
        ]),
        [
          ["first-module", 1, 2],
          ["second-module", 0, 2],
        ],
      );
      assert.deepEqual(body.orphanedLessons, []);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
  );
});

void test("GET /courses/:courseId/progress never leaks quiz answers or a practice check", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` });
    assert.equal(response.statusCode, 200);
    // Raw-text assertions, not just shape assertions: the progress tree
    // carries lesson metadata, and "has a quiz" must never turn into "here
    // is the quiz" (same rule as routes/courses.ts's lesson response).
    for (const forbidden of ["correct", "explanation", "check", "select count", "opt-right"]) {
      assert.equal(response.body.includes(forbidden), false, `response leaked "${forbidden}"`);
    }
  });
});

void test("GET /courses/:courseId/progress reports progress for lessons the course no longer has as orphaned", async () => {
  await withProgressApp(
    async (app) => {
      const body = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
      assert.equal(body.totalLessons, 4);
      assert.equal(body.completedLessons, 1);
      assert.deepEqual(body.orphanedLessons, [
        { lessonId: "removed-in-an-update", completedAt: "2025-06-01T00:00:00.000Z", courseVersion: "0.9.0" },
      ]);
      assert.deepEqual(body.recordedVersions, ["0.9.0"]);
    },
    {
      seed: [
        completedRecord(FIXTURE_TEXT_LESSON_ID),
        completedRecord("removed-in-an-update", {
          courseVersion: "0.9.0",
          completedAt: "2025-06-01T00:00:00.000Z",
          updatedAt: "2025-06-01T00:00:00.000Z",
        }),
      ],
    },
  );
});

void test("GET /courses/:courseId/progress responds 404 for an unknown course (error path)", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/no-such-course/progress" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "course_not_found");
  });
});

void test("POST .../complete marks a text lesson completed and returns fresh counters (happy path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_TEXT_LESSON_ID}/complete`,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.lesson.id, FIXTURE_TEXT_LESSON_ID);
    assert.equal(body.lesson.status, "completed");
    assert.equal(typeof body.lesson.completedAt, "string");
    assert.equal(body.lesson.completionMode, "manual");
    assert.deepEqual(body.course, {
      courseId: FIXTURE_COURSE_ID,
      courseVersion: FIXTURE_COURSE_VERSION,
      totalLessons: 4,
      completedLessons: 1,
      completed: false,
    });

    // Stored against the stable lesson id, with the installed version as
    // provenance — never an index or a title.
    const stored = progress.records();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.courseId, FIXTURE_COURSE_ID);
    assert.equal(stored[0]?.lessonId, FIXTURE_TEXT_LESSON_ID);
    assert.equal(stored[0]?.status, "completed");
    assert.equal(stored[0]?.courseVersion, FIXTURE_COURSE_VERSION);
  });
});

void test("POST .../complete is idempotent: marking an already-completed lesson keeps its completedAt", async () => {
  await withProgressApp(async (app, progress) => {
    const url = `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_TEXT_LESSON_ID}/complete`;
    const first = (await app.inject({ method: "POST", url })).json();
    const second = (await app.inject({ method: "POST", url })).json();

    assert.equal(second.lesson.status, "completed");
    assert.equal(second.lesson.completedAt, first.lesson.completedAt);
    assert.equal(second.course.completedLessons, 1);
    assert.equal(progress.records().length, 1);
  });
});

void test("POST .../complete allows a practice lesson WITHOUT a check (self-marked assignment)", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_UNCHECKED_PRACTICE_LESSON_ID}/complete`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().lesson.completionMode, "manual");
    assert.equal(response.json().lesson.status, "completed");
  });
});

void test("POST .../complete refuses a quiz lesson with 409 and writes nothing (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_QUIZ_LESSON_ID}/complete`,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "manual_completion_not_allowed");
    assert.match(response.json().message, /quiz/);
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../complete refuses a practice lesson WITH a check with 409 (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_PRACTICE_LESSON_ID}/complete`,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "manual_completion_not_allowed");
    // The refusal must not quote the check query itself.
    assert.equal(response.body.includes("select count"), false);
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../complete responds 404 for an unknown course or lesson (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const unknownCourse = await app.inject({
      method: "POST",
      url: `/courses/no-such-course/lessons/${FIXTURE_TEXT_LESSON_ID}/complete`,
    });
    assert.equal(unknownCourse.statusCode, 404);
    assert.equal(unknownCourse.json().error, "course_not_found");

    const unknownLesson = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/no-such-lesson/complete`,
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");
    assert.deepEqual(progress.records(), []);
  });
});

void test("a course update keeps progress: same ids stay completed, new ids start fresh, removed ones go orphaned", async () => {
  // Same course id, version 2.0.0: the text lesson kept its id (progress
  // survives a retitle and a move to a renamed module), the quiz lesson is
  // gone (its progress becomes orphaned, not deleted), and a brand-new
  // lesson appears (not started).
  const updatedManifest = [
    `id: ${FIXTURE_COURSE_ID}`,
    "version: 2.0.0",
    "title: Progress fixture course, updated",
    "modules:",
    "  - id: renamed-module",
    "    title: Renamed module",
    "    lessons:",
    `      - id: ${FIXTURE_TEXT_LESSON_ID}`,
    "        title: Text lesson, retitled",
    `        content: lessons/${FIXTURE_TEXT_LESSON_ID}.md`,
    "      - id: brand-new-lesson",
    "        title: Brand new lesson",
    `        content: lessons/${FIXTURE_TEXT_LESSON_ID}.md`,
    "",
  ].join("\n");

  await withProgressApp(
    async (app) => {
      const body = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
      assert.equal(body.courseVersion, "2.0.0");
      assert.equal(body.totalLessons, 2);
      assert.equal(body.completedLessons, 1);
      assert.deepEqual(
        body.modules[0].lessons.map((lesson: LessonBody) => [lesson.id, lesson.status]),
        [
          [FIXTURE_TEXT_LESSON_ID, "completed"],
          ["brand-new-lesson", "not_started"],
        ],
      );
      assert.deepEqual(
        body.orphanedLessons.map((entry: { lessonId: string }) => entry.lessonId),
        [FIXTURE_QUIZ_LESSON_ID],
      );
      // The old version is reported, never used to invalidate anything.
      assert.deepEqual(body.recordedVersions, [FIXTURE_COURSE_VERSION]);
    },
    {
      seed: [completedRecord(FIXTURE_TEXT_LESSON_ID), completedRecord(FIXTURE_QUIZ_LESSON_ID)],
      manifestYaml: updatedManifest,
    },
  );
});

void test("DELETE /courses/:courseId/progress erases that course's progress and reports how much", async () => {
  await withProgressApp(
    async (app, progress) => {
      const response = await app.inject({ method: "DELETE", url: `/courses/${FIXTURE_COURSE_ID}/progress` });
      assert.equal(response.statusCode, 200);
      const body = response.json();

      assert.equal(body.deletedLessons, 2);
      // The counters answer with the state AFTER the reset — a client that
      // redraws from this response must not show the pre-reset numbers.
      assert.equal(body.course.completedLessons, 0);
      assert.equal(body.course.totalLessons, 4);
      assert.equal(body.course.completed, false);
      assert.deepEqual(progress.records(), []);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID), completedRecord(FIXTURE_QUIZ_LESSON_ID)] },
  );
});

void test("DELETE /courses/:courseId/progress leaves other courses alone", async () => {
  await withProgressApp(
    async (app, progress) => {
      await app.inject({ method: "DELETE", url: `/courses/${FIXTURE_COURSE_ID}/progress` });
      assert.deepEqual(
        progress.records().map((record) => [record.courseId, record.lessonId]),
        [["some-other-course", FIXTURE_TEXT_LESSON_ID]],
      );
    },
    {
      seed: [
        completedRecord(FIXTURE_TEXT_LESSON_ID),
        completedRecord(FIXTURE_TEXT_LESSON_ID, { courseId: "some-other-course" }),
      ],
    },
  );
});

void test("DELETE /courses/:courseId/progress also drops completions orphaned by a course update", async () => {
  await withProgressApp(
    async (app, progress) => {
      // `gone-lesson` is not in the fixture manifest, so it never shows up in
      // the tree's counters — but it is still this course's progress, and
      // «перепройти» means all of it.
      const body = (await app.inject({ method: "DELETE", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
      assert.equal(body.deletedLessons, 2);
      assert.deepEqual(progress.records(), []);
    },
    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID), completedRecord("gone-lesson")] },
  );
});

void test("DELETE /courses/:courseId/progress on a course with no progress is a success, not an error", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({ method: "DELETE", url: `/courses/${FIXTURE_COURSE_ID}/progress` });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().deletedLessons, 0);
  });
});

void test("DELETE /courses/:courseId/progress 404s for a course that does not exist", async () => {
  await withProgressApp(async (app) => {
    const response = await app.inject({ method: "DELETE", url: "/courses/no-such-course/progress" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "course_not_found");
  });
});
