# Review: task 007

## Commits (0ddc4b65acc1ed5f045290f054f324774f19e599..HEAD)


## Diffstat (0ddc4b65acc1ed5f045290f054f324774f19e599 -> working tree)

 services/backend/src/db/migrate.test.ts | 17 +++++-
 services/backend/src/db/testSupport.ts  | 99 +++++++++++++++++++++++++++++++++
 services/backend/src/server.ts          | 20 +++++++
 services/backend/tsconfig.json          |  7 ++-
 4 files changed, 139 insertions(+), 4 deletions(-)

## Diff (0ddc4b65acc1ed5f045290f054f324774f19e599 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/services/backend/src/db/migrate.test.ts b/services/backend/src/db/migrate.test.ts
index 0d9aa32..cf38c7d 100644
--- a/services/backend/src/db/migrate.test.ts
+++ b/services/backend/src/db/migrate.test.ts
@@ -9,7 +9,12 @@ const DESTRUCTIVE_MIGRATION_TEST_REASON =
   "core.schema_migrations; DATABASE_URL alone is deliberately not enough, see task-005 fix round 1)";
 
 void test("runMigrations applies 001_progress from a clean core schema and is idempotent on repeat", async (t) => {
-  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON);
+  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
+    // Serialized against every other test that needs core.lesson_progress/
+    // core.schema_migrations to exist (progress/repository.test.ts): test
+    // FILES run concurrently, and these tests drop those tables.
+    exclusive: true,
+  });
   if (!pool) return;
   try {
     await pool.query("drop table if exists core.lesson_progress");
@@ -45,7 +50,10 @@ void test("runMigrations applies 001_progress from a clean core schema and is id
 });
 
 void test("runMigrations refuses to continue when an applied version's file is missing (error path)", async (t) => {
-  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON);
+  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
+    // Same exclusive access as the first test in this file.
+    exclusive: true,
+  });
   if (!pool) return;
   try {
     // Make sure core.schema_migrations exists (with exactly "001_progress",
@@ -67,7 +75,10 @@ void test("runMigrations refuses to continue when an applied version's file is m
 });
 
 void test("concurrent runMigrations calls on the same DB serialize via the advisory lock (edge case)", async (t) => {
-  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON);
+  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
+    // Same exclusive access as the first test in this file.
+    exclusive: true,
+  });
   if (!pool) return;
   try {
     await pool.query("drop table if exists core.lesson_progress");
diff --git a/services/backend/src/db/testSupport.ts b/services/backend/src/db/testSupport.ts
index 50c987d..03a6266 100644
--- a/services/backend/src/db/testSupport.ts
+++ b/services/backend/src/db/testSupport.ts
@@ -21,6 +21,37 @@ import { createPool, type AppPool } from "./pool.js";
 
 const REQUIRED_TEST_DB_SUFFIX = "_test";
 
+// A single, distinct advisory-lock key meaning "I need this test database to
+// myself for the duration of this test". Deliberately NOT migrate.ts's own
+// key (84637201): runMigrations takes that one itself, and a test holding it
+// would deadlock against the very function it is testing.
+//
+// Why this exists at all: `node --test 'dist-test/**/*.test.js'` runs test
+// FILES concurrently (one process each), and they all point at the same
+// disposable database. migrate.test.ts drops core.lesson_progress outright,
+// while progress/repository.test.ts inserts into it — without serialization
+// those two files race, and the failure ("relation core.lesson_progress does
+// not exist") would look like a bug in the code under test rather than in
+// the test setup. Any test that either destroys shared tables or depends on
+// them existing must take this lock (see `ConnectToTestDbOptions.exclusive`).
+const EXCLUSIVE_TEST_DB_LOCK_KEY = 84_637_202;
+const LOCK_POLL_INTERVAL_MS = 100;
+const LOCK_ACQUIRE_TIMEOUT_MS = 60_000;
+
+export interface ConnectToTestDbOptions {
+  /**
+   * Serializes this test against every other test that asks for the same
+   * thing, via a session-level advisory lock held for the whole test and
+   * released automatically afterwards (`t.after`).
+   *
+   * The lock is held on a SEPARATE pool created here, not on the pool
+   * returned to the caller: a checked-out client would make the caller's own
+   * `pool.end()` wait forever for it to be released, and that release only
+   * happens after the test body finishes — a deadlock.
+   */
+  readonly exclusive?: boolean;
+}
+
 /**
  * Connects to `TRELLIS_TEST_DATABASE_URL`, refusing (loudly, via `throw` —
  * not a skip) to proceed if that database's name doesn't end in `_test`.
@@ -36,6 +67,7 @@ const REQUIRED_TEST_DB_SUFFIX = "_test";
 export async function connectToDisposableTestDbOrSkip(
   t: TestContext,
   whatIsSkipped: string,
+  options: ConnectToTestDbOptions = {},
 ): Promise<AppPool | undefined> {
   const testDatabaseUrl = process.env.TRELLIS_TEST_DATABASE_URL;
   if (!testDatabaseUrl) {
@@ -70,5 +102,72 @@ export async function connectToDisposableTestDbOrSkip(
     await pool.end();
     return undefined;
   }
+
+  if (options.exclusive === true) {
+    try {
+      await holdExclusiveTestDbLock(t, testDatabaseUrl);
+    } catch (err) {
+      await pool.end();
+      throw err;
+    }
+  }
   return pool;
 }
+
+/**
+ * Takes the exclusive test-database lock on its own connection and arranges
+ * (via `t.after`) for it to be released once the test finishes, whatever the
+ * outcome. Polls `pg_try_advisory_lock` instead of blocking in
+ * `pg_advisory_lock` so a stuck holder surfaces as a stated timeout rather
+ * than a test run that hangs forever with no explanation (same reasoning as
+ * migrate.ts's own lock acquisition).
+ */
+async function holdExclusiveTestDbLock(t: TestContext, testDatabaseUrl: string): Promise<void> {
+  const lockPool = createPool(testDatabaseUrl);
+  let client;
+  try {
+    client = await lockPool.connect();
+  } catch (err) {
+    await lockPool.end();
+    throw err;
+  }
+
+  const lockClient = client;
+  const release = async (): Promise<void> => {
+    try {
+      await lockClient.query("select pg_advisory_unlock($1)", [EXCLUSIVE_TEST_DB_LOCK_KEY]);
+    } finally {
+      lockClient.release();
+      await lockPool.end();
+    }
+  };
+
+  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
+  for (;;) {
+    let acquired: boolean;
+    try {
+      const result = await lockClient.query<{ locked: boolean }>(
+        "select pg_try_advisory_lock($1) as locked",
+        [EXCLUSIVE_TEST_DB_LOCK_KEY],
+      );
+      acquired = result.rows[0]?.locked === true;
+    } catch (err) {
+      lockClient.release();
+      await lockPool.end();
+      throw err;
+    }
+    if (acquired) {
+      t.after(release);
+      return;
+    }
+    if (Date.now() >= deadline) {
+      lockClient.release();
+      await lockPool.end();
+      throw new Error(
+        `Timed out after ${LOCK_ACQUIRE_TIMEOUT_MS}ms waiting for exclusive access to the test database ` +
+          `(advisory lock ${EXCLUSIVE_TEST_DB_LOCK_KEY}) — another test file is still holding it.`,
+      );
+    }
+    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
+  }
+}
diff --git a/services/backend/src/server.ts b/services/backend/src/server.ts
index cb80656..9e176b1 100644
--- a/services/backend/src/server.ts
+++ b/services/backend/src/server.ts
@@ -7,8 +7,11 @@ import { createPool, type AppPool } from "./db/pool.js";
 import { runMigrations } from "./db/migrate.js";
 import { registerShutdown } from "./lifecycle.js";
 import { createCourseRegistry, type CourseRegistry } from "./courses/registry.js";
+import { createProgressRepository, type ProgressRepository } from "./progress/repository.js";
 import healthRoutes from "./routes/health.js";
 import coursesRoutes from "./routes/courses.js";
+import progressRoutes from "./routes/progress.js";
+import quizRoutes from "./routes/quiz.js";
 
 export interface BuildServerOptions {
   /**
@@ -46,6 +49,15 @@ export interface BuildServerOptions {
    * pass anything.
    */
   readonly coursesDir?: string;
+  /**
+   * Injects a progress repository (task 007) — same test pattern as `pool`
+   * and `registry` above: route tests substitute an in-memory fake (see
+   * progress/testSupport.ts) and never touch Postgres, while the repository
+   * itself is tested directly against a disposable database. Defaults to a
+   * real `createProgressRepository(pool)` over whichever pool this server
+   * ended up with.
+   */
+  readonly progress?: ProgressRepository;
   /**
    * Passed straight through to Fastify's own `logger` option — reuses
    * Fastify's own type rather than re-declaring it, so this stays correct
@@ -128,8 +140,16 @@ export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
     });
   app.decorate("courses", registry);
 
+  // Progress is a thin repository over the same app-role pool — decorated
+  // (rather than constructed inside the routes) so tasks 009/010 reach the
+  // same instance through `fastify.progress` instead of each building their
+  // own way into core.lesson_progress.
+  app.decorate("progress", options.progress ?? createProgressRepository(pool));
+
   app.register(healthRoutes);
   app.register(coursesRoutes);
+  app.register(progressRoutes);
+  app.register(quizRoutes);
   return app;
 }
 
diff --git a/services/backend/tsconfig.json b/services/backend/tsconfig.json
index 2834d91..1e4e0c9 100644
--- a/services/backend/tsconfig.json
+++ b/services/backend/tsconfig.json
@@ -23,5 +23,10 @@
   // test-only helpers (shared by several *.test.ts files — task-006 and the
   // final-review backend fixes round, respectively), not production code,
   // and must not ship in the runtime image either.
-  "exclude": ["src/**/*.test.ts", "src/courses/testSupport.ts", "src/db/testSupport.ts"]
+  "exclude": [
+    "src/**/*.test.ts",
+    "src/courses/testSupport.ts",
+    "src/db/testSupport.ts",
+    "src/progress/testSupport.ts"
+  ]
 }
```

## Untracked files (new, not yet added)

### services/backend/src/progress/model.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import type { CourseLesson, CourseQuiz } from "../courses/types.js";
import { findLesson, gradeQuizAnswer, lessonCompletionMode } from "./model.js";
import { courseFixture } from "./testSupport.js";

const quiz: CourseQuiz = {
  question: "Which one?",
  options: [
    { id: "right", text: "The right one", correct: true },
    { id: "wrong", text: "The wrong one", correct: false, explanation: "Because of a specific mistake." },
  ],
};

void test("lessonCompletionMode: a content-only lesson is completed by hand", () => {
  const lesson: CourseLesson = { id: "l", title: "L", content: "# L" };
  assert.equal(lessonCompletionMode(lesson), "manual");
});

void test("lessonCompletionMode: a lesson with a quiz is completed by the quiz, not by hand", () => {
  const lesson: CourseLesson = { id: "l", title: "L", content: "# L", quiz };
  assert.equal(lessonCompletionMode(lesson), "quiz");
});

void test("lessonCompletionMode: practice WITH a check is completed by the check, WITHOUT one it is self-marked", () => {
  const checked: CourseLesson = {
    id: "l",
    title: "L",
    practice: { sandbox: "main", prompt: "Do it.", check: "select true" },
  };
  const unchecked: CourseLesson = { id: "l", title: "L", practice: { sandbox: "main", prompt: "Do it." } };
  assert.equal(lessonCompletionMode(checked), "practice");
  // Project invariant: "задание без check — самоотметка".
  assert.equal(lessonCompletionMode(unchecked), "manual");
});

void test("lessonCompletionMode: a quiz wins over a checked practice on the same lesson (edge case)", () => {
  const lesson: CourseLesson = {
    id: "l",
    title: "L",
    quiz,
    practice: { sandbox: "main", prompt: "Do it.", check: "select true" },
  };
  assert.equal(lessonCompletionMode(lesson), "quiz");
});

void test("gradeQuizAnswer returns the chosen option's verdict and only its own explanation", () => {
  const correct = gradeQuizAnswer(quiz, "right");
  assert.deepEqual(correct, { correct: true, explanation: undefined });

  const incorrect = gradeQuizAnswer(quiz, "wrong");
  assert.deepEqual(incorrect, { correct: false, explanation: "Because of a specific mistake." });

  // The verdict must never carry anything identifying the correct option.
  assert.equal(JSON.stringify(incorrect).includes("right"), false);
});

void test("gradeQuizAnswer returns undefined for an id that is not one of the options (error path)", () => {
  assert.equal(gradeQuizAnswer(quiz, "not-an-option"), undefined);
  assert.equal(gradeQuizAnswer(quiz, ""), undefined);
});

void test("findLesson finds a lesson in any module by id, and nothing for an unknown id", () => {
  const course = courseFixture();
  const found = findLesson(course, "b1");
  assert.equal(found?.lesson.id, "b1");
  assert.equal(found?.module.id, "m2");
  assert.equal(findLesson(course, "no-such-lesson"), undefined);
});
```

### services/backend/src/progress/model.ts

```
// Progress domain model: the shapes and the pure rules, with no knowledge of
// HTTP, Postgres, or any specific course. Two hard rules from the project
// invariants shape everything here:
//
//  1. Progress is keyed by STABLE IDS — `(courseId, lessonId)` — never by a
//     lesson's position in a module or by its title. That is what makes
//     "update the course, keep the progress" work (see reconcile.ts).
//  2. The course format and the progress format are separate things. Nothing
//     in this file is stored in a course package, and nothing here is derived
//     from a lesson's index/title; the only thing progress borrows from the
//     content side is the id (and `courseVersion`, recorded purely as
//     provenance — see `ProgressRecord.courseVersion`).
//
// A lesson has exactly two states: completed, or not started. There is no
// "in progress", no attempt history, and no way back from completed (the
// product model: re-taking a completed lesson/quiz is allowed, but a passed
// lesson never un-passes).

import type { Course, CourseLesson, CourseModule, CourseQuiz } from "../courses/types.js";

export type LessonStatus = "completed" | "not_started";

/**
 * How a lesson is allowed to become `completed`:
 *  - `quiz`     — the lesson has a quiz: answering it correctly is what
 *                 completes it (an explicit "mark as done" must not).
 *  - `practice` — the lesson has a practice assignment WITH a `check` query:
 *                 the check's boolean verdict is what completes it (task
 *                 009 runs that check under the sandbox role; the core has
 *                 no other grading logic — project invariant).
 *  - `manual`   — everything else (plain content, or a practice assignment
 *                 without a `check`): the user marks it done themselves.
 *
 * A lesson carrying both a quiz and a checked practice resolves to `quiz`:
 * one lesson has exactly one gate, and the quiz is the cheaper/earlier one.
 * See `routes/progress.ts` for where this is enforced on the write path.
 */
export type LessonCompletionMode = "manual" | "quiz" | "practice";

/**
 * One row of `core.lesson_progress`, in domain terms. Timestamps are ISO
 * strings, not `Date`s — this is the shape that crosses the repository
 * boundary, gets serialized to JSON by the API, and (task 010) gets written
 * into the export file.
 *
 * `status` is a single-member union on purpose: the table only ever holds
 * completed lessons ("not started" is the ABSENCE of a row, see
 * migrations/001_progress.sql), and typing it as a general string would
 * invite code that pretends otherwise.
 */
export interface ProgressRecord {
  readonly courseId: string;
  readonly lessonId: string;
  readonly status: "completed";
  /**
   * The course version as it was when the lesson was completed — provenance
   * only, never a matching key. Progress is NOT invalidated when the course
   * version changes (that is the whole point of keying on stable ids);
   * reconcile.ts surfaces the mismatch as information, nothing more.
   * `undefined` for rows written before a version was known.
   */
  readonly courseVersion?: string;
  /** First time this lesson was completed — never moved by a repeat pass. */
  readonly completedAt: string;
  /** Last time the row was touched (e.g. a repeat pass refreshing
   * `courseVersion`). */
  readonly updatedAt: string;
}

export interface LessonProgress {
  readonly id: string;
  readonly title: string;
  readonly status: LessonStatus;
  /** Present only when `status === "completed"`. */
  readonly completedAt?: string;
  readonly completionMode: LessonCompletionMode;
  readonly hasContent: boolean;
  readonly hasQuiz: boolean;
  readonly hasPractice: boolean;
}

export interface ModuleProgress {
  readonly id: string;
  readonly title: string;
  readonly totalLessons: number;
  readonly completedLessons: number;
  readonly completed: boolean;
  readonly lessons: readonly LessonProgress[];
}

/**
 * A stored completion whose `lessonId` no longer exists in the course as it
 * is installed right now. Deliberately NOT deleted (see reconcile.ts): the
 * lesson may come back with the next course update, and progress for content
 * that isn't installed locally must survive — it is just ignored by the
 * counters until its lesson exists again.
 */
export interface OrphanedProgress {
  readonly lessonId: string;
  readonly completedAt: string;
  readonly courseVersion?: string;
}

export interface CourseProgressSummary {
  readonly courseId: string;
  /** The version of the course currently installed on disk — not the
   * version recorded on any progress row (see `recordedVersions`). */
  readonly courseVersion: string;
  readonly totalLessons: number;
  readonly completedLessons: number;
  /** A course is completed when every lesson currently in it is completed
   * (an empty course can't happen — a manifest needs at least one module,
   * and a module at least one lesson). */
  readonly completed: boolean;
}

export interface CourseProgressTree extends CourseProgressSummary {
  readonly title: string;
  readonly modules: readonly ModuleProgress[];
  readonly orphanedLessons: readonly OrphanedProgress[];
  /**
   * Distinct `courseVersion` values found on this course's progress rows
   * that differ from the installed `courseVersion`, sorted. Non-empty means
   * "this progress was earned on an older/other build of the course" — it
   * is diagnostic information only and never changes a status.
   */
  readonly recordedVersions: readonly string[];
}

/** Where a lesson sits in a course — returned together so callers that need
 * both (e.g. building a single-lesson response) don't walk the tree twice. */
export interface LessonLocation {
  readonly module: CourseModule;
  readonly lesson: CourseLesson;
}

/**
 * Linear search over `course.modules[].lessons[]` — lesson ids are unique
 * across the whole course (guaranteed by courses/validate.ts), so the first
 * hit is the only hit. Not indexed: courses hold tens of lessons, not
 * thousands (same call made in routes/courses.ts).
 */
export function findLesson(course: Course, lessonId: string): LessonLocation | undefined {
  for (const module of course.modules) {
    const lesson = module.lessons.find((candidate) => candidate.id === lessonId);
    if (lesson !== undefined) {
      return { module, lesson };
    }
  }
  return undefined;
}

export function lessonCompletionMode(lesson: CourseLesson): LessonCompletionMode {
  if (lesson.quiz !== undefined) {
    return "quiz";
  }
  if (lesson.practice?.check !== undefined) {
    return "practice";
  }
  return "manual";
}

export interface QuizVerdict {
  readonly correct: boolean;
  /**
   * The explanation attached to the option the user actually chose, if it
   * has one. Never another option's explanation, and never anything about
   * WHICH option is correct — that answer never leaves the backend (same
   * rule as routes/courses.ts's `toLessonResponse`).
   */
  readonly explanation?: string;
}

/**
 * Grades one quiz answer. Returns `undefined` when `optionId` isn't one of
 * this quiz's options (the caller turns that into a 400 — an unknown option
 * is a malformed request, not a wrong answer: grading it as "incorrect"
 * would let a client probe the option space by submitting ids).
 *
 * Pure: it neither records an attempt nor touches progress. Attempts are not
 * stored at all (product model: unlimited tries, no history) — completing
 * the lesson on a correct answer is the route's job.
 */
export function gradeQuizAnswer(quiz: CourseQuiz, optionId: string): QuizVerdict | undefined {
  const chosen = quiz.options.find((option) => option.id === optionId);
  if (chosen === undefined) {
    return undefined;
  }
  return { correct: chosen.correct, explanation: chosen.explanation };
}
```

### services/backend/src/progress/reconcile.test.ts

```
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
```

### services/backend/src/progress/reconcile.ts

```
// Reconciliation: stored progress rows + the course as it is installed RIGHT
// NOW -> the course tree with a status on every lesson.
//
// This is the whole "course update doesn't break progress" rule, in one pure
// function. The rules, straight from the product model:
//
//   - a lesson id that is both in the course and in the stored rows stays
//     completed (it doesn't matter that the course version, the lesson's
//     title, its module, or its position changed — only the id matches);
//   - a lesson id that is in the course but not in the stored rows is
//     not started (new lessons are never retroactively completed);
//   - a stored row whose lesson id is no longer in the course is IGNORED for
//     status/counters and reported separately as orphaned — never deleted
//     here (this function doesn't write anything at all). A removed lesson
//     can come back in the next course update, and progress for content that
//     isn't installed locally must survive (it is also what task 010's import
//     of a not-installed course relies on).
//
// There is no "reset progress on update" path anywhere, by design.

import type { Course } from "../courses/types.js";
import {
  lessonCompletionMode,
  type CourseProgressTree,
  type LessonProgress,
  type ModuleProgress,
  type OrphanedProgress,
  type ProgressRecord,
} from "./model.js";

/**
 * Builds the status tree for `course` from `records`.
 *
 * `records` are expected to be this course's rows (that is what
 * `ProgressRepository#listCourseProgress` returns); rows carrying a different
 * `courseId` are dropped rather than trusted — reconciling course A against
 * course B's progress would silently invent completions, so a caller mistake
 * must not be able to do that.
 *
 * Pure and total: no I/O, no throwing, no mutation of the inputs.
 */
export function reconcileCourseProgress(
  course: Course,
  records: readonly ProgressRecord[],
): CourseProgressTree {
  const own = records.filter((record) => record.courseId === course.id);
  const byLessonId = new Map(own.map((record) => [record.lessonId, record]));
  const seenLessonIds = new Set<string>();

  let totalLessons = 0;
  let completedLessons = 0;
  const modules: ModuleProgress[] = [];

  for (const module of course.modules) {
    const lessons: LessonProgress[] = [];
    let moduleCompletedLessons = 0;

    for (const lesson of module.lessons) {
      const record = byLessonId.get(lesson.id);
      if (record !== undefined) {
        seenLessonIds.add(lesson.id);
        moduleCompletedLessons += 1;
      }
      lessons.push({
        id: lesson.id,
        title: lesson.title,
        status: record === undefined ? "not_started" : "completed",
        completedAt: record?.completedAt,
        completionMode: lessonCompletionMode(lesson),
        hasContent: lesson.content !== undefined,
        hasQuiz: lesson.quiz !== undefined,
        hasPractice: lesson.practice !== undefined,
      });
    }

    totalLessons += lessons.length;
    completedLessons += moduleCompletedLessons;
    modules.push({
      id: module.id,
      title: module.title,
      totalLessons: lessons.length,
      completedLessons: moduleCompletedLessons,
      // `lessons.length > 0` guard: a module with no lessons can't exist per
      // the manifest schema (minItems: 1), but "0 of 0 done" reading as
      // completed would be a lie if that ever changed.
      completed: lessons.length > 0 && moduleCompletedLessons === lessons.length,
      lessons,
    });
  }

  const orphanedLessons: OrphanedProgress[] = own
    .filter((record) => !seenLessonIds.has(record.lessonId))
    .map((record) => ({
      lessonId: record.lessonId,
      completedAt: record.completedAt,
      courseVersion: record.courseVersion,
    }));

  const recordedVersions = [
    ...new Set(
      own
        .map((record) => record.courseVersion)
        .filter((version): version is string => version !== undefined && version !== course.version),
    ),
  ].sort(compareVersions);

  return {
    courseId: course.id,
    courseVersion: course.version,
    title: course.title,
    totalLessons,
    completedLessons,
    completed: totalLessons > 0 && completedLessons === totalLessons,
    modules,
    orphanedLessons,
    recordedVersions,
  };
}

/**
 * Orders `a`/`b` by semver precedence rather than lexicographically —
 * `manifest.schema.json`'s `version` field is a semver string
 * (`major.minor.patch[-pre][+build]`), and a plain string sort misorders
 * multi-digit segments (`"0.10.0"` would sort before `"0.9.0"`). Build
 * metadata (`+...`) is ignored per semver's own precedence rule; a
 * pre-release sorts before its release (`"1.0.0-alpha" < "1.0.0"`), and two
 * pre-releases fall back to a string compare of their identifiers. Anything
 * that doesn't match the expected shape falls back to a plain string
 * compare — `recordedVersions` is diagnostic-only (see its doc comment on
 * `CourseProgressTree`), never a correctness-bearing key, so a strange
 * version string degrades gracefully instead of throwing.
 */
function compareVersions(a: string, b: string): number {
  const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  const parsedA = VERSION_PATTERN.exec(a);
  const parsedB = VERSION_PATTERN.exec(b);
  if (parsedA === null || parsedB === null) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const [, majorA, minorA, patchA, preA] = parsedA;
  const [, majorB, minorB, patchB, preB] = parsedB;
  const coreA = [Number(majorA), Number(minorA), Number(patchA)];
  const coreB = [Number(majorB), Number(minorB), Number(patchB)];
  for (let i = 0; i < 3; i += 1) {
    const diff = coreA[i]! - coreB[i]!;
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}
```

### services/backend/src/progress/repository.test.ts

```
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
```

### services/backend/src/progress/repository.ts

```
// The only module that talks SQL about progress. Everything above it
// (reconcile.ts, routes/*) works with `ProgressRecord`s and never sees a
// column name, a `Date`, or a `null`.
//
// Storage rules encoded here, all of them consequences of
// migrations/001_progress.sql's model ("a row exists only for a completed
// lesson"):
//   - completing an already-completed lesson is a no-op for `completed_at`
//     (a repeat pass must not rewrite when the lesson was first passed) but
//     refreshes `course_version`/`updated_at` — see `markLessonCompleted`;
//   - there is no un-complete / delete operation, on purpose: a passed
//     lesson never un-passes (product model). Task 010's import will need
//     its own write path; it should add it here rather than reaching into
//     the table from transfer/.
//   - no attempt history is stored anywhere — a wrong quiz answer writes
//     nothing at all.

import type { AppPool } from "../db/pool.js";
import type { ProgressRecord } from "./model.js";

/** Row shape as Postgres hands it back — the only place these column names
 * and `null`s exist. */
interface LessonProgressRow {
  readonly course_id: string;
  readonly lesson_id: string;
  readonly status: string;
  readonly course_version: string | null;
  readonly completed_at: Date;
  readonly updated_at: Date;
}

const RETURNED_COLUMNS = "course_id, lesson_id, status, course_version, completed_at, updated_at";

export interface MarkLessonCompletedInput {
  readonly courseId: string;
  readonly lessonId: string;
  /** The installed course's version, recorded as provenance (see
   * `ProgressRecord.courseVersion`). Optional so a caller that genuinely
   * doesn't know it can still record the completion. */
  readonly courseVersion?: string;
}

export interface ProgressRepository {
  /** Every stored completion for one course, oldest first. Returns `[]` for
   * a course with no progress — including a course that isn't installed. */
  listCourseProgress(courseId: string): Promise<ProgressRecord[]>;
  /** Every stored completion, for every course, ordered by
   * `(courseId, lessonId)` — the stable order task 010's export needs. */
  listAllProgress(): Promise<ProgressRecord[]>;
  /**
   * Marks one lesson completed and returns the stored row (so the caller
   * reports the database's own `completedAt`, not a locally guessed one).
   * Idempotent: calling it again on an already-completed lesson keeps the
   * original `completedAt` and leaves the lesson completed.
   */
  markLessonCompleted(input: MarkLessonCompletedInput): Promise<ProgressRecord>;
}

export function createProgressRepository(pool: AppPool): ProgressRepository {
  return {
    async listCourseProgress(courseId) {
      const result = await pool.query<LessonProgressRow>(
        `select ${RETURNED_COLUMNS} from core.lesson_progress where course_id = $1 order by completed_at, lesson_id`,
        [courseId],
      );
      return result.rows.map(toProgressRecord);
    },

    async listAllProgress() {
      const result = await pool.query<LessonProgressRow>(
        `select ${RETURNED_COLUMNS} from core.lesson_progress order by course_id, lesson_id`,
      );
      return result.rows.map(toProgressRecord);
    },

    async markLessonCompleted({ courseId, lessonId, courseVersion }) {
      // `do update` rather than `do nothing`: `do nothing` would return zero
      // rows on a repeat pass, leaving the caller without the stored record
      // it needs to answer with. `completed_at` is deliberately NOT in the
      // update list — only `course_version`/`updated_at` move.
      //
      // `coalesce(excluded.course_version, core.lesson_progress.course_version)`
      // rather than a bare `excluded.course_version`: a repeat call that
      // genuinely doesn't know the version (`courseVersion` left undefined)
      // must not blow away a version recorded by an earlier call — model.ts's
      // `ProgressRecord.courseVersion` documents `undefined` only for rows
      // written before a version was EVER known, not as something a later,
      // less-informed call can regress a row back to.
      const result = await pool.query<LessonProgressRow>(
        `insert into core.lesson_progress (course_id, lesson_id, status, course_version)
         values ($1, $2, 'completed', $3)
         on conflict (course_id, lesson_id) do update
           set course_version = coalesce(excluded.course_version, core.lesson_progress.course_version),
               updated_at = now()
         returning ${RETURNED_COLUMNS}`,
        [courseId, lessonId, courseVersion ?? null],
      );
      const row = result.rows[0];
      if (row === undefined) {
        // Unreachable with the statement above (an upsert with RETURNING
        // always yields exactly one row) — but `noUncheckedIndexedAccess`
        // is right to make us say what it would mean if it ever happened.
        throw new Error(
          `Failed to record progress for lesson "${lessonId}" of course "${courseId}": the upsert returned no row.`,
        );
      }
      return toProgressRecord(row);
    },
  };
}

function toProgressRecord(row: LessonProgressRow): ProgressRecord {
  if (row.status !== "completed") {
    // The table's CHECK constraint already guarantees this; the assertion is
    // here so that widening the constraint later can't quietly produce
    // `ProgressRecord`s whose `status` lies about its own type.
    throw new Error(
      `Unexpected progress status "${row.status}" for lesson "${row.lesson_id}" of course "${row.course_id}" — ` +
        `core.lesson_progress is only supposed to hold completed lessons.`,
    );
  }
  return {
    courseId: row.course_id,
    lessonId: row.lesson_id,
    status: "completed",
    courseVersion: row.course_version ?? undefined,
    completedAt: row.completed_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

declare module "fastify" {
  interface FastifyInstance {
    progress: ProgressRepository;
  }
}
```

### services/backend/src/progress/testSupport.ts

```
// Test-only helpers for the progress domain, shared by routes/progress.test.ts
// and routes/quiz.test.ts (and reconcile.test.ts's fixtures). Kept out of the
// production build exactly like courses/testSupport.ts and db/testSupport.ts
// — see tsconfig.json's `exclude`.
//
// Everything here is synthetic: no real course's ids, titles or content (the
// core, and its tests, know nothing about any specific course).

import fs from "node:fs";

import type { FastifyInstance } from "fastify";

import { createCourseRegistry } from "../courses/registry.js";
import { makeTempDir, writeCoursePackage, type FixtureFile } from "../courses/testSupport.js";
import type { Course } from "../courses/types.js";
import type { AppPool } from "../db/pool.js";
import { buildServer } from "../server.js";
import type { ProgressRecord } from "./model.js";
import type { MarkLessonCompletedInput, ProgressRepository } from "./repository.js";

/**
 * An in-memory `ProgressRepository` with the same observable contract as the
 * Postgres one: completion is idempotent, a repeat pass keeps the original
 * `completedAt` and refreshes `updatedAt`/`courseVersion`, and there is no
 * way to un-complete. Route tests use this so they exercise real routing,
 * real schemas and real reconciliation without a database.
 *
 * `seed` pre-loads rows (e.g. progress for a lesson the course no longer
 * has). `records()` exposes the stored state for assertions — that a wrong
 * quiz answer wrote nothing at all, for instance.
 */
export function createInMemoryProgressRepository(seed: readonly ProgressRecord[] = []): ProgressRepository & {
  records(): ProgressRecord[];
} {
  const rows = new Map<string, ProgressRecord>(seed.map((record) => [key(record.courseId, record.lessonId), record]));
  // Monotonic, deterministic clock: real timestamps at test speed can land
  // in the same millisecond, which would make "completedAt didn't move"
  // assertions pass even if the code did move it.
  let tick = 0;
  const nextTimestamp = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  };

  return {
    async listCourseProgress(courseId: string): Promise<ProgressRecord[]> {
      return [...rows.values()]
        .filter((record) => record.courseId === courseId)
        .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.lessonId.localeCompare(b.lessonId));
    },

    async listAllProgress(): Promise<ProgressRecord[]> {
      return [...rows.values()].sort(
        (a, b) => a.courseId.localeCompare(b.courseId) || a.lessonId.localeCompare(b.lessonId),
      );
    },

    async markLessonCompleted({
      courseId,
      lessonId,
      courseVersion,
    }: MarkLessonCompletedInput): Promise<ProgressRecord> {
      const existing = rows.get(key(courseId, lessonId));
      const now = nextTimestamp();
      const record: ProgressRecord = {
        courseId,
        lessonId,
        status: "completed",
        courseVersion,
        completedAt: existing?.completedAt ?? now,
        updatedAt: now,
      };
      rows.set(key(courseId, lessonId), record);
      return record;
    },

    records(): ProgressRecord[] {
      return [...rows.values()];
    },
  };
}

function key(courseId: string, lessonId: string): string {
  return `${courseId}\x00${lessonId}`;
}

export const FIXTURE_COURSE_ID = "progress-fixture";
export const FIXTURE_COURSE_VERSION = "1.0.0";
/** Content only -> completed by an explicit "mark as done". */
export const FIXTURE_TEXT_LESSON_ID = "text-lesson";
/** Has a quiz -> completed only by answering correctly. */
export const FIXTURE_QUIZ_LESSON_ID = "quiz-lesson";
/** Has a practice assignment WITH a check -> completed only by task 009's
 * check verdict, never by hand. */
export const FIXTURE_PRACTICE_LESSON_ID = "practice-lesson";
/** Has a practice assignment WITHOUT a check -> self-marked, like a text
 * lesson (project invariant: "задание без check — самоотметка"). */
// NB: no lesson id/title here may contain the substrings the leak tests
// grep the raw response for ("check", "correct", "explanation") — the
// fixture must not be able to make a leak assertion pass or fail by accident.
export const FIXTURE_UNCHECKED_PRACTICE_LESSON_ID = "selfmarked-practice-lesson";
export const FIXTURE_CORRECT_OPTION_ID = "opt-right";
export const FIXTURE_INCORRECT_OPTION_ID = "opt-wrong";
export const FIXTURE_INCORRECT_EXPLANATION = "That option confuses two different things.";

/**
 * A course package covering all four completion modes across two modules —
 * everything the progress/quiz routes need to distinguish.
 */
export function progressFixtureManifestYaml(courseId = FIXTURE_COURSE_ID, version = FIXTURE_COURSE_VERSION): string {
  return [
    `id: ${courseId}`,
    `version: ${version}`,
    "title: Progress fixture course",
    "sandboxes:",
    "  - id: main",
    "    type: postgres",
    "    seed:",
    "      - sandbox/01-schema.sql",
    "modules:",
    "  - id: first-module",
    "    title: First module",
    "    lessons:",
    `      - id: ${FIXTURE_TEXT_LESSON_ID}`,
    "        title: Text lesson",
    `        content: lessons/${FIXTURE_TEXT_LESSON_ID}.md`,
    `      - id: ${FIXTURE_QUIZ_LESSON_ID}`,
    "        title: Quiz lesson",
    "        quiz:",
    '          question: "Which one is right?"',
    "          options:",
    `            - id: ${FIXTURE_CORRECT_OPTION_ID}`,
    '              text: "The right one"',
    "              correct: true",
    `            - id: ${FIXTURE_INCORRECT_OPTION_ID}`,
    '              text: "The wrong one"',
    `              explanation: ${FIXTURE_INCORRECT_EXPLANATION}`,
    "  - id: second-module",
    "    title: Second module",
    "    lessons:",
    `      - id: ${FIXTURE_PRACTICE_LESSON_ID}`,
    "        title: Graded practice lesson",
    "        practice:",
    "          sandbox: main",
    "          prompt: Do the checked thing.",
    '          check: "select count(*) = 1 from t"',
    `      - id: ${FIXTURE_UNCHECKED_PRACTICE_LESSON_ID}`,
    "        title: Self-marked practice lesson",
    "        practice:",
    "          sandbox: main",
    "          prompt: Do the unchecked thing.",
    "",
  ].join("\n");
}

/**
 * An in-memory `Course` — the shape courses/loader.ts produces, built
 * directly instead of through a temp directory, for the pure units
 * (reconcile.ts, model.ts) that only need the structure. Two modules, four
 * lessons, ids `a1`/`a2` (module `m1`) and `b1`/`b2` (module `m2`).
 */
export function courseFixture(id = "structure-fixture", version = "1.0.0"): Course {
  return {
    id,
    version,
    title: "Structure fixture course",
    dir: "/nonexistent/structure-fixture",
    sandboxes: [],
    modules: [
      {
        id: "m1",
        title: "Module one",
        lessons: [
          { id: "a1", title: "Lesson a1", content: "# a1" },
          {
            id: "a2",
            title: "Lesson a2",
            quiz: {
              question: "Which one?",
              options: [
                { id: "yes", text: "Yes", correct: true },
                { id: "no", text: "No", correct: false, explanation: "No is wrong here." },
              ],
            },
          },
        ],
      },
      {
        id: "m2",
        title: "Module two",
        lessons: [
          { id: "b1", title: "Lesson b1", practice: { sandbox: "main", prompt: "Do it.", check: "select true" } },
          { id: "b2", title: "Lesson b2", content: "# b2" },
        ],
      },
    ],
  };
}

/** The files `progressFixtureManifestYaml()` references. */
export function progressFixtureFiles(): FixtureFile[] {
  return [
    { path: `lessons/${FIXTURE_TEXT_LESSON_ID}.md`, content: "# Text lesson\n\nRead me." },
    { path: "sandbox/01-schema.sql", content: "create table t (id int);" },
  ];
}

export type FakeProgressRepository = ProgressRepository & { records(): ProgressRecord[] };

export interface WithProgressAppOptions {
  /** Progress rows that already exist before the test's first request. */
  readonly seed?: readonly ProgressRecord[];
  /** Overrides the fixture manifest — used to simulate a course update
   * (same course id, different structure/version). */
  readonly manifestYaml?: string;
}

/**
 * Builds a real server (real routing, real schemas, real reconciliation)
 * over a temp courses directory holding the fixture course, with an
 * in-memory progress repository instead of Postgres. Shared by
 * routes/progress.test.ts and routes/quiz.test.ts — which is exactly why it
 * lives here and not in one of them: importing one *.test.ts from another
 * would make node:test run that file's tests twice.
 */
export async function withProgressApp(
  run: (app: FastifyInstance, progress: FakeProgressRepository) => Promise<void>,
  options: WithProgressAppOptions = {},
): Promise<void> {
  const coursesDir = makeTempDir("trellis-progress-");
  try {
    writeCoursePackage(
      coursesDir,
      "fixture",
      options.manifestYaml ?? progressFixtureManifestYaml(),
      progressFixtureFiles(),
    );
    const progress = createInMemoryProgressRepository(options.seed ?? []);
    const app = buildServer({
      pool: poolThatMustNotBeUsed(),
      registry: createCourseRegistry(coursesDir),
      progress,
      logger: false,
    });
    try {
      await run(app, progress);
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
}

/** The progress/quiz routes must reach the database only through
 * `fastify.progress`; a pool that throws on any use keeps that honest. */
export function poolThatMustNotBeUsed(): AppPool {
  const notImplemented = () => {
    throw new Error("progress/quiz routes must go through fastify.progress, not the raw pool");
  };
  return {
    query: notImplemented as unknown as AppPool["query"],
    connect: notImplemented as unknown as AppPool["connect"],
    withTransaction: notImplemented as unknown as AppPool["withTransaction"],
    end: async () => {},
  };
}

/** A stored completion for the fixture course, for seeding. */
export function completedRecord(lessonId: string, overrides: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    courseId: FIXTURE_COURSE_ID,
    lessonId,
    status: "completed",
    courseVersion: FIXTURE_COURSE_VERSION,
    completedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
```

### services/backend/src/routes/progress.test.ts

```
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
```

### services/backend/src/routes/progress.ts

```
// Progress API: read the course tree with per-lesson statuses, and mark a
// lesson completed by hand.
//
// The course side of every answer comes from `fastify.courses` (the
// on-disk content registry), the status side from `fastify.progress` (the
// database) — they are joined per request by reconcile.ts, never stored
// joined. That is what keeps "content format" and "progress format" separate
// and lets a course be updated underneath existing progress.

import type { FastifyInstance, FastifyReply } from "fastify";

import type { Course } from "../courses/types.js";
import { findLesson, lessonCompletionMode, type CourseProgressTree } from "../progress/model.js";
import { reconcileCourseProgress } from "../progress/reconcile.js";

export default async function progressRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/progress",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: courseProgressResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      return await buildTree(fastify, course);
    },
  );

  fastify.post<{ Params: { courseId: string; lessonId: string } }>(
    "/courses/:courseId/lessons/:lessonId/complete",
    {
      schema: {
        params: lessonParamsSchema,
        response: {
          200: lessonCompletionResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      const location = findLesson(course, request.params.lessonId);
      if (location === undefined) {
        return sendLessonNotFound(reply, course.id, request.params.lessonId);
      }

      // A lesson whose completion is earned (quiz answer, practice check)
      // must not also be claimable by hand — that would make the quiz and
      // the check decorative. The 409 names the gate so the client can say
      // what to do instead.
      const mode = lessonCompletionMode(location.lesson);
      if (mode !== "manual") {
        return reply.code(409).send({
          error: "manual_completion_not_allowed",
          message:
            mode === "quiz"
              ? `Lesson "${location.lesson.id}" is completed by answering its quiz correctly, not by marking it done.`
              : `Lesson "${location.lesson.id}" is completed by passing its practice check, not by marking it done.`,
        });
      }

      await fastify.progress.markLessonCompleted({
        courseId: course.id,
        lessonId: location.lesson.id,
        courseVersion: course.version,
      });
      return toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
    },
  );
}

/** Reads this course's stored rows and joins them onto the course as
 * installed right now. Shared by both routes here and by routes/quiz.ts. */
export async function buildTree(fastify: FastifyInstance, course: Course): Promise<CourseProgressTree> {
  const records = await fastify.progress.listCourseProgress(course.id);
  return reconcileCourseProgress(course, records);
}

/**
 * The shape both write endpoints answer with: the affected lesson's fresh
 * status plus the course's counters, so a client never needs a second
 * request to redraw "7 of 12 done" after marking something.
 */
export function toLessonCompletionPayload(tree: CourseProgressTree, lessonId: string) {
  const lesson = tree.modules.flatMap((module) => module.lessons).find((candidate) => candidate.id === lessonId);
  if (lesson === undefined) {
    // Only reachable if the course changed on disk between the write and
    // this read (a rescan removing the lesson mid-request). Loud rather
    // than a half-filled response.
    throw new Error(
      `Lesson "${lessonId}" disappeared from course "${tree.courseId}" while its completion was being recorded.`,
    );
  }
  return {
    lesson,
    course: {
      courseId: tree.courseId,
      courseVersion: tree.courseVersion,
      totalLessons: tree.totalLessons,
      completedLessons: tree.completedLessons,
      completed: tree.completed,
    },
  };
}

export function sendCourseNotFound(reply: FastifyReply, courseId: string): FastifyReply {
  return reply.code(404).send({ error: "course_not_found", message: `Course "${courseId}" was not found.` });
}

export function sendLessonNotFound(reply: FastifyReply, courseId: string, lessonId: string): FastifyReply {
  return reply.code(404).send({
    error: "lesson_not_found",
    message: `Lesson "${lessonId}" was not found in course "${courseId}".`,
  });
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string" } },
} as const;

export const lessonParamsSchema = {
  type: "object",
  required: ["courseId", "lessonId"],
  properties: { courseId: { type: "string" }, lessonId: { type: "string" } },
} as const;

export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export const lessonProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "status", "completionMode", "hasContent", "hasQuiz", "hasPractice"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["completed", "not_started"] },
    completedAt: { type: "string" },
    completionMode: { type: "string", enum: ["manual", "quiz", "practice"] },
    hasContent: { type: "boolean" },
    hasQuiz: { type: "boolean" },
    hasPractice: { type: "boolean" },
  },
} as const;

const moduleProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "totalLessons", "completedLessons", "completed", "lessons"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
    lessons: { type: "array", items: lessonProgressSchema },
  },
} as const;

const orphanedProgressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lessonId", "completedAt"],
  properties: {
    lessonId: { type: "string" },
    completedAt: { type: "string" },
    courseVersion: { type: "string" },
  },
} as const;

const courseProgressResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "courseId",
    "courseVersion",
    "title",
    "totalLessons",
    "completedLessons",
    "completed",
    "modules",
    "orphanedLessons",
    "recordedVersions",
  ],
  properties: {
    courseId: { type: "string" },
    courseVersion: { type: "string" },
    title: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
    modules: { type: "array", items: moduleProgressSchema },
    // Completions whose lesson is no longer part of the course — kept in
    // the database, excluded from the counters above, reported here so the
    // UI can explain "3 completed lessons are not in this version".
    orphanedLessons: { type: "array", items: orphanedProgressSchema },
    recordedVersions: { type: "array", items: { type: "string" } },
  },
} as const;

export const courseProgressSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["courseId", "courseVersion", "totalLessons", "completedLessons", "completed"],
  properties: {
    courseId: { type: "string" },
    courseVersion: { type: "string" },
    totalLessons: { type: "integer" },
    completedLessons: { type: "integer" },
    completed: { type: "boolean" },
  },
} as const;

const lessonCompletionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lesson", "course"],
  properties: { lesson: lessonProgressSchema, course: courseProgressSummarySchema },
} as const;
```

### services/backend/src/routes/quiz.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import {
  completedRecord,
  FIXTURE_CORRECT_OPTION_ID,
  FIXTURE_COURSE_ID,
  FIXTURE_COURSE_VERSION,
  FIXTURE_INCORRECT_EXPLANATION,
  FIXTURE_INCORRECT_OPTION_ID,
  FIXTURE_PRACTICE_LESSON_ID,
  FIXTURE_QUIZ_LESSON_ID,
  FIXTURE_TEXT_LESSON_ID,
  FIXTURE_UNCHECKED_PRACTICE_LESSON_ID,
  withProgressApp,
} from "../progress/testSupport.js";

const ANSWER_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_QUIZ_LESSON_ID}/quiz/answer`;

void test("POST .../quiz/answer with the correct option completes the lesson (happy path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, true);
    assert.equal(body.lesson.id, FIXTURE_QUIZ_LESSON_ID);
    assert.equal(body.lesson.status, "completed");
    assert.equal(body.lesson.completionMode, "quiz");
    assert.equal(typeof body.lesson.completedAt, "string");
    assert.deepEqual(body.course, {
      courseId: FIXTURE_COURSE_ID,
      courseVersion: FIXTURE_COURSE_VERSION,
      totalLessons: 4,
      completedLessons: 1,
      completed: false,
    });

    const stored = progress.records();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.lessonId, FIXTURE_QUIZ_LESSON_ID);
    assert.equal(stored[0]?.courseVersion, FIXTURE_COURSE_VERSION);
  });
});

void test("POST .../quiz/answer with a wrong option explains it, stores nothing, and keeps the lesson open", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.correct, false);
    assert.equal(body.explanation, FIXTURE_INCORRECT_EXPLANATION);
    assert.equal(body.lesson.status, "not_started");
    assert.equal(body.lesson.completedAt, undefined);
    assert.equal(body.course.completedLessons, 0);
    // No attempt history: a wrong answer writes nothing at all.
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer never reveals which option is correct (security)", async () => {
  await withProgressApp(async (app) => {
    const wrong = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    // Raw text, not shape: the correct option's id must not appear anywhere
    // in the response — not in a field, not in a message.
    assert.equal(wrong.body.includes(FIXTURE_CORRECT_OPTION_ID), false);
    assert.equal(wrong.body.includes("The right one"), false);

    const right = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    // The other option's explanation is never handed out either — only the
    // explanation of the option the caller actually chose.
    assert.equal(right.body.includes(FIXTURE_INCORRECT_EXPLANATION), false);
  });
});

void test("POST .../quiz/answer allows unlimited attempts and never un-completes a passed lesson", async () => {
  await withProgressApp(async (app, progress) => {
    const wrongFirst = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(wrongFirst.statusCode, 200);
    assert.equal(wrongFirst.json().correct, false);

    const right = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    const completedAt = right.json().lesson.completedAt;

    // Answering again — wrong, then right — after passing: the status stays
    // completed and the original completion time never moves.
    const wrongAgain = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID },
    });
    assert.equal(wrongAgain.json().correct, false);
    assert.equal(wrongAgain.json().lesson.status, "completed");
    assert.equal(wrongAgain.json().lesson.completedAt, completedAt);

    const rightAgain = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(rightAgain.json().lesson.completedAt, completedAt);
    assert.equal(progress.records().length, 1);
  });
});

void test("POST .../quiz/answer responds 400 for an option id that is not in the quiz (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: "not-an-option" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "unknown_option");
    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer rejects a malformed body before reaching the handler (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const missing = await app.inject({ method: "POST", url: ANSWER_URL, payload: {} });
    assert.equal(missing.statusCode, 400);

    const empty = await app.inject({ method: "POST", url: ANSWER_URL, payload: { optionId: "" } });
    assert.equal(empty.statusCode, 400);

    const wrongType = await app.inject({ method: "POST", url: ANSWER_URL, payload: { optionId: 42 } });
    assert.equal(wrongType.statusCode, 400);

    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer ignores unknown body fields instead of acting on them (security)", async () => {
  await withProgressApp(async (app) => {
    // Fastify's schema validation is configured (by its own default) to
    // strip properties the body schema doesn't declare rather than reject
    // the request — so the assertion is that the extra field has no effect
    // and is not echoed anywhere, not that the request fails.
    const response = await app.inject({
      method: "POST",
      url: ANSWER_URL,
      payload: { optionId: FIXTURE_INCORRECT_OPTION_ID, correct: true, adminOverride: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().correct, false);
    assert.equal(response.body.includes("adminOverride"), false);
  });
});

void test("POST .../quiz/answer responds 404 for a lesson without a quiz, and for unknown ids (error path)", async () => {
  await withProgressApp(async (app, progress) => {
    const noQuiz = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_TEXT_LESSON_ID}/quiz/answer`,
      payload: { optionId: "whatever" },
    });
    assert.equal(noQuiz.statusCode, 404);
    assert.equal(noQuiz.json().error, "quiz_not_found");

    const unknownCourse = await app.inject({
      method: "POST",
      url: `/courses/no-such-course/lessons/${FIXTURE_QUIZ_LESSON_ID}/quiz/answer`,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(unknownCourse.statusCode, 404);
    assert.equal(unknownCourse.json().error, "course_not_found");

    const unknownLesson = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/no-such-lesson/quiz/answer`,
      payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
    });
    assert.equal(unknownLesson.statusCode, 404);
    assert.equal(unknownLesson.json().error, "lesson_not_found");

    assert.deepEqual(progress.records(), []);
  });
});

void test("POST .../quiz/answer reports the course completed once its last lesson is passed (edge case)", async () => {
  await withProgressApp(
    async (app) => {
      const response = await app.inject({
        method: "POST",
        url: ANSWER_URL,
        payload: { optionId: FIXTURE_CORRECT_OPTION_ID },
      });
      assert.equal(response.json().course.completed, true);
      assert.equal(response.json().course.completedLessons, 4);
    },
    {
      seed: [
        completedRecord(FIXTURE_TEXT_LESSON_ID),
        completedRecord(FIXTURE_PRACTICE_LESSON_ID),
        completedRecord(FIXTURE_UNCHECKED_PRACTICE_LESSON_ID),
      ],
    },
  );
});
```

### services/backend/src/routes/quiz.ts

```
// Quiz API: a single endpoint that grades one answer and, when it's the
// right one, completes the lesson.
//
// What this endpoint must never do, in order:
//  - reveal which option is correct (not in a field, not in a message, not
//    by returning some options' explanations and not others'). The client
//    learns exactly one bit about the quiz — whether the option IT chose is
//    right — plus that option's own explanation;
//  - store an attempt. Wrong answers write nothing at all: tries are
//    unlimited and no history is kept (product model);
//  - un-complete anything. Answering wrong after a correct answer leaves the
//    lesson completed; `status` in the response reflects that honestly.

import type { FastifyInstance } from "fastify";

import { findLesson, gradeQuizAnswer } from "../progress/model.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  sendCourseNotFound,
  sendLessonNotFound,
  toLessonCompletionPayload,
} from "./progress.js";

export default async function quizRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { optionId: string } }>(
    "/courses/:courseId/lessons/:lessonId/quiz/answer",
    {
      schema: {
        params: lessonParamsSchema,
        // A body that isn't `{ optionId: "<non-empty string>" }` is
        // rejected by Fastify's own validation as a 400 before the handler
        // runs — `additionalProperties: false` included, so a client can't
        // smuggle extra fields past it.
        body: quizAnswerBodySchema,
        response: {
          200: quizAnswerResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      const location = findLesson(course, request.params.lessonId);
      if (location === undefined) {
        return sendLessonNotFound(reply, course.id, request.params.lessonId);
      }
      const quiz = location.lesson.quiz;
      if (quiz === undefined) {
        return reply.code(404).send({
          error: "quiz_not_found",
          message: `Lesson "${location.lesson.id}" of course "${course.id}" has no quiz.`,
        });
      }

      const verdict = gradeQuizAnswer(quiz, request.body.optionId);
      if (verdict === undefined) {
        // Not "incorrect": an id that isn't in this quiz is a malformed
        // request. Grading it as a wrong answer would also hand a client a
        // way to enumerate the option space.
        return reply.code(400).send({
          error: "unknown_option",
          message: `Option "${request.body.optionId}" is not one of this quiz's options.`,
        });
      }

      if (verdict.correct) {
        await fastify.progress.markLessonCompleted({
          courseId: course.id,
          lessonId: location.lesson.id,
          courseVersion: course.version,
        });
      }

      // Read back the tree either way — after a wrong answer this reports
      // the unchanged status (which may well be "completed" already, from an
      // earlier correct answer), and after a right one, the stored
      // `completedAt` rather than a locally guessed timestamp.
      const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
      return { correct: verdict.correct, explanation: verdict.explanation, ...payload };
    },
  );
}

const quizAnswerBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["optionId"],
  properties: { optionId: { type: "string", minLength: 1 } },
} as const;

const quizAnswerResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "lesson", "course"],
  properties: {
    correct: { type: "boolean" },
    // The chosen option's own explanation, when it has one. Note what is
    // NOT here and cannot be added without also changing this schema
    // (`additionalProperties: false` drops undeclared fields): the correct
    // option's id, the other options' explanations, any per-option verdict
    // map.
    explanation: { type: "string" },
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
```

