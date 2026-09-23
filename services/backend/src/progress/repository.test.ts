// Repository tests run against a REAL Postgres (the disposable
// `TRELLIS_TEST_DATABASE_URL` one — never DATABASE_URL, see
// db/test-support.ts): the whole point of this module is its SQL, so a fake
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
import { connectToDisposableTestDbOrSkip } from "../db/test-support.js";
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

void test("importProgress stores completions with the time they happened elsewhere, not now (task 010)", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const stored = await repository.importProgress([
      { courseId, lessonId: "b-lesson", completedAt: "2024-03-03T10:00:00.000Z", courseVersion: "0.9.0" },
      { courseId, lessonId: "a-lesson", completedAt: "2024-01-01T10:00:00.000Z" },
    ]);

    // Returned in the order given (the statement carries the caller's order
    // through explicitly — RETURNING alone has none).
    assert.deepEqual(
      stored.map((row) => row.lessonId),
      ["b-lesson", "a-lesson"],
    );
    assert.equal(stored[0]?.completedAt, "2024-03-03T10:00:00.000Z");
    assert.equal(stored[0]?.courseVersion, "0.9.0");
    assert.equal(stored[0]?.status, "completed");
    // No version in the file -> no version invented for the row.
    assert.equal(stored[1]?.courseVersion, undefined);
    // An import is progress like any other — the ordinary read path sees it.
    assert.equal((await repository.listCourseProgress(courseId)).length, 2);
  });
});

void test("importProgress merges: the earlier completion wins, with the version that belongs to it", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    const local = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1", courseVersion: "2.0.0" });

    // A file from the other machine that passed this lesson EARLIER: the
    // stored completion moves back, and takes that file's recorded version
    // with it (the two travel together — they describe the same event).
    const earlier = await repository.importProgress([
      { courseId, lessonId: "lesson-1", completedAt: "2020-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
    ]);
    assert.equal(earlier[0]?.completedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(earlier[0]?.courseVersion, "1.0.0");
    assert.ok(Date.parse(earlier[0]?.updatedAt ?? "") >= Date.parse(local.completedAt));

    // A file that passed it LATER cannot push the completion forward, and
    // cannot overwrite the version recorded with the earlier completion.
    const later = await repository.importProgress([
      { courseId, lessonId: "lesson-1", completedAt: "2030-01-01T00:00:00.000Z", courseVersion: "9.9.9" },
    ]);
    assert.equal(later[0]?.completedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(later[0]?.courseVersion, "1.0.0");

    // Still one row: the key is (course_id, lesson_id), and an import never
    // adds a second completion for the same lesson.
    assert.equal((await repository.listCourseProgress(courseId)).length, 1);
  });
});

void test(
  "importProgress: a losing import cannot donate its courseVersion to a locally-null one, and does not " +
    "touch updatedAt (regression, fix round 2 finding 2)",
  async (t) => {
    await withRepository(t, async (repository, courseId) => {
      // Local completion with NO recorded version — the exact edge case that
      // let a losing import's version leak in through the SQL's `coalesce`.
      const local = await repository.importProgress([
        { courseId, lessonId: "lesson-1", completedAt: "2025-01-01T00:00:00.000Z" },
      ]);
      assert.equal(local[0]?.courseVersion, undefined);

      // An import that does NOT win (same time or later) must leave the row
      // byte-for-byte as it was: no version filled in, no updatedAt bump.
      const sameTime = await repository.importProgress([
        { courseId, lessonId: "lesson-1", completedAt: "2025-01-01T00:00:00.000Z", courseVersion: "5.0.0" },
      ]);
      assert.equal(sameTime[0]?.courseVersion, undefined);
      assert.equal(sameTime[0]?.updatedAt, local[0]?.updatedAt);

      const later = await repository.importProgress([
        { courseId, lessonId: "lesson-1", completedAt: "2030-01-01T00:00:00.000Z", courseVersion: "9.9.9" },
      ]);
      assert.equal(later[0]?.courseVersion, undefined);
      assert.equal(later[0]?.updatedAt, local[0]?.updatedAt);
    });
  },
);

void test("importProgress writes progress for a course that isn't installed, and nothing at all for an empty file", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    // There is no "courses" table to point at — progress for content that
    // isn't here must be storable (clarify Q-009, migrations/001_progress.sql).
    const stored = await repository.importProgress([
      { courseId, lessonId: "lesson-of-an-absent-course", completedAt: "2024-01-01T10:00:00.000Z" },
    ]);
    assert.equal(stored.length, 1);

    assert.deepEqual(await repository.importProgress([]), []);
    assert.equal((await repository.listCourseProgress(courseId)).length, 1);
  });
});

void test("importProgress refuses two completions for the same lesson instead of letting Postgres abort", async (t) => {
  await withRepository(t, async (repository, courseId) => {
    // `insert ... on conflict do update` cannot affect one row twice —
    // Postgres aborts the whole statement. parseProgressExport already refuses
    // such a file, but this is a public method: it must answer with a sentence
    // naming the key, not with a database error surfacing as a 500.
    await assert.rejects(
      repository.importProgress([
        { courseId, lessonId: "lesson-1", completedAt: "2024-01-01T10:00:00.000Z" },
        { courseId, lessonId: "lesson-1", completedAt: "2023-01-01T10:00:00.000Z" },
      ]),
      (error: Error) => /lesson-1.*more than once/s.test(error.message),
    );
    // Rejected before anything was written.
    assert.equal((await repository.listCourseProgress(courseId)).length, 0);
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
