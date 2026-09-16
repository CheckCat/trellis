// Repository tests run against a REAL Postgres (the disposable
// `TRELLIS_TEST_DATABASE_URL` one — never DATABASE_URL, see
// db/testSupport.ts): the whole point of this module is its SQL, so a fake
// pool would test nothing. They take the exclusive test-db lock because
// db/migrate.test.ts drops core.lesson_progress and test files run
// concurrently.
//
// Every test uses a unique course id and deletes its own rows afterwards, so
// a shared database is never left dirty for the next file.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { runMigrations } from "../db/migrate.js";
import { connectToDisposableTestDbOrSkip } from "../db/testSupport.js";
import { createProgressRepository, type ProgressRepository } from "./repository.js";

const REASON =
  "progress repository test (this suite inserts into and deletes from core.lesson_progress; " +
  "DATABASE_URL is deliberately not enough — it points at the developer's real progress data)";

/**
 * Connects (or skips), makes sure the schema is there (migrate.test.ts may
 * have dropped it — it runs under the same lock, so never mid-test), and
 * hands a repository plus a throwaway course id to `run`. Always deletes
 * that course's rows and closes the pool.
 */
async function withRepository(
  t: TestContext,
  run: (repository: ProgressRepository, courseId: string) => Promise<void>,
): Promise<void> {
  const pool = await connectToDisposableTestDbOrSkip(t, REASON, { exclusive: true });
  if (!pool) return;
  const courseId = `test-course-${randomUUID()}`;
  try {
    await runMigrations(pool);
    await run(createProgressRepository(pool), courseId);
  } finally {
    try {
      await pool.query("delete from core.lesson_progress where course_id like 'test-course-%'");
    } finally {
      await pool.end();
    }
  }
}

void test("markLessonCompleted stores a completed row that listCourseProgress reads back (happy path)", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const before = Date.now();
    const stored = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1", courseVersion: "1.2.3" });

    assert.equal(stored.courseId, courseId);
    assert.equal(stored.lessonId, "lesson-1");
    assert.equal(stored.status, "completed");
    assert.equal(stored.courseVersion, "1.2.3");
    // ISO strings, not Date objects — the repository is the boundary where
    // pg's `Date`s stop existing.
    assert.equal(typeof stored.completedAt, "string");
    assert.equal(Number.isNaN(Date.parse(stored.completedAt)), false);
    assert.ok(Date.parse(stored.completedAt) >= before - 60_000);

    const rows = await repository.listCourseProgress(courseId);
    assert.deepEqual(rows, [stored]);
  });
});

void test("markLessonCompleted is idempotent: a repeat pass keeps completedAt and refreshes courseVersion", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const first = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1", courseVersion: "1.0.0" });
    // A course update between the two passes: the version moves, the
    // original completion time must not.
    const second = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1", courseVersion: "2.0.0" });

    assert.equal(second.completedAt, first.completedAt);
    assert.equal(second.courseVersion, "2.0.0");
    assert.equal(second.status, "completed");
    assert.ok(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt));

    // Still exactly one row — the primary key is (course_id, lesson_id).
    const rows = await repository.listCourseProgress(courseId);
    assert.equal(rows.length, 1);
  });
});

void test(
  "markLessonCompleted keeps a previously recorded courseVersion when a repeat call doesn't know it (regression)",
  async (t) => {
    await withRepository(t, async (repository, courseId) => {
      const first = await repository.markLessonCompleted({
        courseId,
        lessonId: "lesson-1",
        courseVersion: "1.0.0",
      });
      assert.equal(first.courseVersion, "1.0.0");

      // A caller that genuinely doesn't know the version (courseVersion left
      // undefined) must not erase the version an earlier, better-informed
      // call already recorded.
      const second = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1" });

      assert.equal(second.courseVersion, "1.0.0");
      assert.equal(second.completedAt, first.completedAt);
    });
  },
);

void test("markLessonCompleted accepts a completion with no known course version (edge case)", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const stored = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1" });
    // NULL in the column comes back as absent, never as the string "null".
    assert.equal(stored.courseVersion, undefined);
    assert.deepEqual(await repository.listCourseProgress(courseId), [stored]);
  });
});

void test("listCourseProgress is scoped to one course; listAllProgress spans them in a stable order", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const otherCourseId = `test-course-${randomUUID()}`;
    await repository.markLessonCompleted({ courseId, lessonId: "b-lesson", courseVersion: "1.0.0" });
    await repository.markLessonCompleted({ courseId, lessonId: "a-lesson", courseVersion: "1.0.0" });
    await repository.markLessonCompleted({ courseId: otherCourseId, lessonId: "z-lesson" });

    const mine = await repository.listCourseProgress(courseId);
    assert.deepEqual(
      mine.map((row) => row.lessonId).sort(),
      ["a-lesson", "b-lesson"], // the other course's row is not in here
    );
    // Ordered by (completed_at, lesson_id) — asserted as "already sorted by
    // that key" rather than as a fixed list, because two inserts can in
    // principle share a timestamp and the tiebreaker would then decide.
    const orderKeys = mine.map((row) => `${row.completedAt} ${row.lessonId}`);
    assert.deepEqual(orderKeys, [...orderKeys].sort());

    // An unknown course is an empty list, not an error — progress simply
    // doesn't exist for it yet.
    assert.deepEqual(await repository.listCourseProgress(`test-course-${randomUUID()}`), []);

    const all = (await repository.listAllProgress()).filter(
      (row) => row.courseId === courseId || row.courseId === otherCourseId,
    );
    const allKeys = all.map((row) => `${row.courseId}/${row.lessonId}`);
    assert.equal(allKeys.length, 3);
    assert.deepEqual(allKeys, [...allKeys].sort());
  });
});
