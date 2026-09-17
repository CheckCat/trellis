# Review: task 010

## Commits (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402..HEAD)


## Diffstat (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402 -> working tree)

 .mvp/ledger.md                                   |   2 +
 .mvp/plan.json                                   |  19 +-
 services/backend/.gitattributes                  |  25 ++
 services/backend/src/progress/model.ts           |  13 +
 services/backend/src/progress/repository.test.ts | 112 ++++++++
 services/backend/src/progress/repository.ts      | 126 +++++++++
 services/backend/src/progress/testSupport.ts     |  57 +++-
 services/backend/src/routes/transfer.test.ts     | 325 +++++++++++++++++++++++
 services/backend/src/routes/transfer.ts          | 233 ++++++++++++++++
 services/backend/src/server.ts                   |   2 +
 services/backend/src/transfer/export.test.ts     | 125 +++++++++
 services/backend/src/transfer/export.ts          |  88 ++++++
 services/backend/src/transfer/format.test.ts     | 213 +++++++++++++++
 services/backend/src/transfer/format.ts          | 308 +++++++++++++++++++++
 services/backend/src/transfer/import.test.ts     | 177 ++++++++++++
 services/backend/src/transfer/import.ts          | 204 ++++++++++++++
 16 files changed, 2020 insertions(+), 9 deletions(-)

## Diff (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index 94c5cb6..00a220e 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -4,3 +4,5 @@
 Task 007: complete (711625fa57d7df862e24df53832e6312cea33db8)
   concern (task 008): `bash .mvp/ci-mirror.sh` → exit 0 (136 tests, 136 pass, 0 fail, 0 skipped). No dependency/lockfile changes; nothing touched outside `services/backend` except the report. Concerns (detail in `.mvp/reports/task-008.md`): 1. No automated live-Postgres test for the sandbox: neither `.github/workflows/ci.yml` nor `.mvp/ci-mirror.sh` exports a `trellis_sandbox` connection string, and both are outside my boundary; a skip-guarded test would also make ci-mirror red (it fails on any skip). Автотесты гоняю review split: 1 finding(s) came from a minority of 3 polls — the others approved agentType "backend-implementer" did not dispatch — this task ran on general-purpose, WITHOUT the _common.md contract (boundary rules, report format, blocker protocol) that mvp:bootstrap assembled for it. Agents register at session start, so a bootstrap run in this same session yields files that are not dispatchable until the next one. Restart the session and re-run this task if the role's rules mattered.
 Task 008: complete (843d7efabf61b7892b2178297f4700a5f4341250)
+  concern (task 009): `bash .mvp/ci-mirror.sh` → 0 дважды подряд (169 тестов, 0 fail, 0 skipped). Детали — в `.mvp/reports/task-009.md`. 1. Автотесты практики идут через скриптуемый драйвер, не через живой Postgres: sandbox-строка подключения не пробрасывается в тест-ран ни `ci.yml`, ни `ci-mirror.sh` (оба вне границы) — поведение против реального Postgres под `trellis_sandbox` проверено вручную, вывод в отчёте. 2. `docker/postgres/init/02-schemas.sql` грантит sandbox-роли CREATE на БД с именем `trellis`, а одноразов
+Task 009: complete (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402)
diff --git a/.mvp/plan.json b/.mvp/plan.json
index f6c79c9..16f7051 100644
--- a/.mvp/plan.json
+++ b/.mvp/plan.json
@@ -214,7 +214,7 @@
         "007"
       ],
       "estimate_tokens": 18000,
-      "status": "pending",
+      "status": "failed",
       "complexity_class": "novel-design"
     },
     {
@@ -399,6 +399,23 @@
       "estimate_tokens": 16000,
       "status": "pending",
       "complexity_class": "novel-design"
+    },
+    {
+      "title": "Добавить в общую npm-последовательность проверку, что ни один отслеживаемый исходник не содержит не-текстовых байт (NUL): гейт должен срабатывать одинаково в .mvp/ci-mirror.sh и .github/workflows/ci.yml, падать с указанием файла и позиции.",
+      "level": 1,
+      "service": "root",
+      "service_path": ".",
+      "role": "devops-engineer",
+      "files": [
+        "package.json",
+        "scripts/check-text-sources.mjs"
+      ],
+      "depends_on": [],
+      "estimate_tokens": 8000,
+      "status": "pending",
+      "complexity_class": "follow-pattern",
+      "id": "020",
+      "epoch": 1
     }
   ]
 }
diff --git a/services/backend/.gitattributes b/services/backend/.gitattributes
new file mode 100644
index 0000000..e9e9ac5
--- /dev/null
+++ b/services/backend/.gitattributes
@@ -0,0 +1,25 @@
+# Source in this service is always text, and must always diff as text.
+#
+# Why this exists: git decides "binary" by heuristic — a single NUL byte in
+# the first 8000 of a file is enough — and for a binary file it prints
+# "Binary files a/... and b/... differ" instead of a diff. That is a silent
+# review outage: a reviewer (human or automated) gets a package with no
+# visible change for that file and can only approve what they cannot read.
+# It happened here: `src/progress/testSupport.ts` carried a raw 0x00 where a
+# space belonged (committed in task 007, removed in task 010), and every
+# diff of that file since was unreadable.
+#
+# `diff` marks these paths as textual for diffing purposes regardless of
+# their contents, so a stray control byte can never again hide a change from
+# review — it shows up IN the diff instead of erasing it.
+#
+# This is the display half of the defence only. Keeping such bytes out of
+# the sources in the first place is a separate, repo-wide lint gate (task
+# 020), which lives outside this service.
+*.ts     diff
+*.tsx    diff
+*.js     diff
+*.mjs    diff
+*.json   diff
+*.sql    diff
+*.md     diff
diff --git a/services/backend/src/progress/model.ts b/services/backend/src/progress/model.ts
index cf5f6cb..b05897e 100644
--- a/services/backend/src/progress/model.ts
+++ b/services/backend/src/progress/model.ts
@@ -150,6 +150,19 @@ export function findLesson(course: Course, lessonId: string): LessonLocation | u
   return undefined;
 }
 
+/**
+ * Map key for a `(courseId, lessonId)` pair — the stable identity progress
+ * is keyed on everywhere a `Map`/`Set` needs one (the repository's import
+ * dedup, `transfer/import.ts`'s local lookup, the in-memory test
+ * repository). JSON, not a joined string: ids coming out of an imported file
+ * are only checked for being non-empty (`transfer/format.ts` — the manifest
+ * id pattern doesn't apply to them), so a separator that can itself occur
+ * inside an id would make `("a b", "c")` collide with `("a", "b c")`.
+ */
+export function progressKey(courseId: string, lessonId: string): string {
+  return JSON.stringify([courseId, lessonId]);
+}
+
 export function lessonCompletionMode(lesson: CourseLesson): LessonCompletionMode {
   if (lesson.quiz !== undefined) {
     return "quiz";
diff --git a/services/backend/src/progress/repository.test.ts b/services/backend/src/progress/repository.test.ts
index 26463da..f40968d 100644
--- a/services/backend/src/progress/repository.test.ts
+++ b/services/backend/src/progress/repository.test.ts
@@ -114,6 +114,118 @@ void test("markLessonCompleted accepts a completion with no known course version
   });
 });
 
+void test("importProgress stores completions with the time they happened elsewhere, not now (task 010)", async (t) => {
+  await withRepository(t, async (repository, courseId) => {
+    const stored = await repository.importProgress([
+      { courseId, lessonId: "b-lesson", completedAt: "2024-03-03T10:00:00.000Z", courseVersion: "0.9.0" },
+      { courseId, lessonId: "a-lesson", completedAt: "2024-01-01T10:00:00.000Z" },
+    ]);
+
+    // Returned in the order given (the statement carries the caller's order
+    // through explicitly — RETURNING alone has none).
+    assert.deepEqual(
+      stored.map((row) => row.lessonId),
+      ["b-lesson", "a-lesson"],
+    );
+    assert.equal(stored[0]?.completedAt, "2024-03-03T10:00:00.000Z");
+    assert.equal(stored[0]?.courseVersion, "0.9.0");
+    assert.equal(stored[0]?.status, "completed");
+    // No version in the file -> no version invented for the row.
+    assert.equal(stored[1]?.courseVersion, undefined);
+    // An import is progress like any other — the ordinary read path sees it.
+    assert.equal((await repository.listCourseProgress(courseId)).length, 2);
+  });
+});
+
+void test("importProgress merges: the earlier completion wins, with the version that belongs to it", async (t) => {
+  await withRepository(t, async (repository, courseId) => {
+    const local = await repository.markLessonCompleted({ courseId, lessonId: "lesson-1", courseVersion: "2.0.0" });
+
+    // A file from the other machine that passed this lesson EARLIER: the
+    // stored completion moves back, and takes that file's recorded version
+    // with it (the two travel together — they describe the same event).
+    const earlier = await repository.importProgress([
+      { courseId, lessonId: "lesson-1", completedAt: "2020-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
+    ]);
+    assert.equal(earlier[0]?.completedAt, "2020-01-01T00:00:00.000Z");
+    assert.equal(earlier[0]?.courseVersion, "1.0.0");
+    assert.ok(Date.parse(earlier[0]?.updatedAt ?? "") >= Date.parse(local.completedAt));
+
+    // A file that passed it LATER cannot push the completion forward, and
+    // cannot overwrite the version recorded with the earlier completion.
+    const later = await repository.importProgress([
+      { courseId, lessonId: "lesson-1", completedAt: "2030-01-01T00:00:00.000Z", courseVersion: "9.9.9" },
+    ]);
+    assert.equal(later[0]?.completedAt, "2020-01-01T00:00:00.000Z");
+    assert.equal(later[0]?.courseVersion, "1.0.0");
+
+    // Still one row: the key is (course_id, lesson_id), and an import never
+    // adds a second completion for the same lesson.
+    assert.equal((await repository.listCourseProgress(courseId)).length, 1);
+  });
+});
+
+void test(
+  "importProgress: a losing import cannot donate its courseVersion to a locally-null one, and does not " +
+    "touch updatedAt (regression, fix round 2 finding 2)",
+  async (t) => {
+    await withRepository(t, async (repository, courseId) => {
+      // Local completion with NO recorded version — the exact edge case that
+      // let a losing import's version leak in through the SQL's `coalesce`.
+      const local = await repository.importProgress([
+        { courseId, lessonId: "lesson-1", completedAt: "2025-01-01T00:00:00.000Z" },
+      ]);
+      assert.equal(local[0]?.courseVersion, undefined);
+
+      // An import that does NOT win (same time or later) must leave the row
+      // byte-for-byte as it was: no version filled in, no updatedAt bump.
+      const sameTime = await repository.importProgress([
+        { courseId, lessonId: "lesson-1", completedAt: "2025-01-01T00:00:00.000Z", courseVersion: "5.0.0" },
+      ]);
+      assert.equal(sameTime[0]?.courseVersion, undefined);
+      assert.equal(sameTime[0]?.updatedAt, local[0]?.updatedAt);
+
+      const later = await repository.importProgress([
+        { courseId, lessonId: "lesson-1", completedAt: "2030-01-01T00:00:00.000Z", courseVersion: "9.9.9" },
+      ]);
+      assert.equal(later[0]?.courseVersion, undefined);
+      assert.equal(later[0]?.updatedAt, local[0]?.updatedAt);
+    });
+  },
+);
+
+void test("importProgress writes progress for a course that isn't installed, and nothing at all for an empty file", async (t) => {
+  await withRepository(t, async (repository, courseId) => {
+    // There is no "courses" table to point at — progress for content that
+    // isn't here must be storable (clarify Q-009, migrations/001_progress.sql).
+    const stored = await repository.importProgress([
+      { courseId, lessonId: "lesson-of-an-absent-course", completedAt: "2024-01-01T10:00:00.000Z" },
+    ]);
+    assert.equal(stored.length, 1);
+
+    assert.deepEqual(await repository.importProgress([]), []);
+    assert.equal((await repository.listCourseProgress(courseId)).length, 1);
+  });
+});
+
+void test("importProgress refuses two completions for the same lesson instead of letting Postgres abort", async (t) => {
+  await withRepository(t, async (repository, courseId) => {
+    // `insert ... on conflict do update` cannot affect one row twice —
+    // Postgres aborts the whole statement. parseProgressExport already refuses
+    // such a file, but this is a public method: it must answer with a sentence
+    // naming the key, not with a database error surfacing as a 500.
+    await assert.rejects(
+      repository.importProgress([
+        { courseId, lessonId: "lesson-1", completedAt: "2024-01-01T10:00:00.000Z" },
+        { courseId, lessonId: "lesson-1", completedAt: "2023-01-01T10:00:00.000Z" },
+      ]),
+      (error: Error) => /lesson-1.*more than once/s.test(error.message),
+    );
+    // Rejected before anything was written.
+    assert.equal((await repository.listCourseProgress(courseId)).length, 0);
+  });
+});
+
 void test("listCourseProgress is scoped to one course; listAllProgress spans them in a stable order", async (t) => {
   await withRepository(t, async (repository, courseId) => {
     const otherCourseId = `test-course-${randomUUID()}`;
diff --git a/services/backend/src/progress/repository.ts b/services/backend/src/progress/repository.ts
index e15fdc6..aa76f44 100644
--- a/services/backend/src/progress/repository.ts
+++ b/services/backend/src/progress/repository.ts
@@ -16,6 +16,7 @@
 //     nothing at all.
 
 import type { AppPool } from "../db/pool.js";
+import { progressKey } from "./model.js";
 import type { ProgressRecord } from "./model.js";
 
 /** Row shape as Postgres hands it back — the only place these column names
@@ -40,6 +41,21 @@ export interface MarkLessonCompletedInput {
   readonly courseVersion?: string;
 }
 
+/**
+ * One completion coming in from an imported progress file (task 010). Unlike
+ * `MarkLessonCompletedInput` it carries its own `completedAt`: an import
+ * restores WHEN something was passed on another machine, it does not pass it
+ * again now.
+ */
+export interface ImportProgressRecord {
+  readonly courseId: string;
+  readonly lessonId: string;
+  /** ISO 8601 timestamp of the completion being imported. */
+  readonly completedAt: string;
+  /** Provenance recorded alongside the completion, when the file had it. */
+  readonly courseVersion?: string;
+}
+
 export interface ProgressRepository {
   /** Every stored completion for one course, oldest first. Returns `[]` for
    * a course with no progress — including a course that isn't installed. */
@@ -54,6 +70,35 @@ export interface ProgressRepository {
    * original `completedAt` and leaves the lesson completed.
    */
   markLessonCompleted(input: MarkLessonCompletedInput): Promise<ProgressRecord>;
+  /**
+   * Merges completions from an imported progress file and returns the rows
+   * as they are stored afterwards (in the order given). The write path task
+   * 010 needs, living here rather than in transfer/ so `core.lesson_progress`
+   * still has exactly one module that writes to it.
+   *
+   * Merge semantics — additive, never destructive:
+   *   - a lesson not stored here yet is inserted with the file's
+   *     `completedAt` (not `now()`: the completion happened then, elsewhere);
+   *   - a lesson already stored keeps the EARLIER of the two completion
+   *     times, together with the `courseVersion` that belongs to it — a
+   *     completion is a historical fact, and the earliest known one is the
+   *     true "first passed at". When the incoming record does NOT win (it is
+   *     not earlier), the stored row is left byte-for-byte as it was —
+   *     including `courseVersion` (even if the incoming record has one and
+   *     the stored row's is unset) and `updatedAt`. A record that loses is a
+   *     true no-op, not "loses the timestamp but still donates its version";
+   *   - nothing is ever deleted or un-completed, and rows absent from the
+   *     file are left alone. An import is a merge, not a restore.
+   *
+   * Courses that are not installed locally are written like any other (the
+   * table has no foreign key to course content, on purpose — see
+   * migrations/001_progress.sql): their progress waits for the course to
+   * appear (clarify Q-009).
+   *
+   * Atomic: all rows in one statement, so a failure imports nothing. An
+   * empty input touches the database not at all.
+   */
+  importProgress(records: readonly ImportProgressRecord[]): Promise<ProgressRecord[]>;
 }
 
 export function createProgressRepository(pool: AppPool): ProgressRepository {
@@ -106,6 +151,87 @@ export function createProgressRepository(pool: AppPool): ProgressRepository {
       }
       return toProgressRecord(row);
     },
+
+    async importProgress(records) {
+      if (records.length === 0) {
+        // Not just an optimization: "importing a file that changes nothing
+        // writes nothing" is an observable property (no `updated_at` churn,
+        // no rows touched), and it starts here.
+        return [];
+      }
+
+      // A single `insert ... on conflict do update` cannot touch the same row
+      // twice: Postgres aborts the whole statement with "ON CONFLICT DO UPDATE
+      // command cannot affect row a second time". `parseProgressExport` already
+      // refuses a file with duplicate ids, but this is a public repository
+      // method — a caller that isn't the import route must fail with a sentence
+      // that names the offending key, not with an opaque database error that
+      // would surface as a 500.
+      const seen = new Set<string>();
+      for (const record of records) {
+        const key = progressKey(record.courseId, record.lessonId);
+        if (seen.has(key)) {
+          throw new Error(
+            `Cannot import two completions for the same lesson: course "${record.courseId}", lesson ` +
+              `"${record.lessonId}" appears more than once. Merge them before calling importProgress.`,
+          );
+        }
+        seen.add(key);
+      }
+
+      // One statement for the whole file — atomic without an explicit
+      // transaction, and immune to the array growing. `unnest(...) with
+      // ordinality` carries the caller's order through so the returned rows
+      // line up with `records` (RETURNING on its own has no defined order).
+      //
+      // `least(...)`/the `case`s below encode the merge rule in SQL rather
+      // than in the caller: even if two imports ran concurrently, neither
+      // can replace an earlier completion with a later one. Both `case`s
+      // branch on the exact same condition, and the "local wins" (`else`)
+      // side is a byte-for-byte no-op — `course_version`/`updated_at` are set
+      // back to their own current value, not coalesced with `excluded`'s.
+      // A losing import must not be able to fill in a locally-null
+      // `course_version` (that would make an "unchanged" row observably
+      // change under a caller that doesn't pre-filter unchanged records the
+      // way `transfer/import.ts`'s `planProgressImport` does — see fix
+      // round 2, finding 2) or bump `updated_at` for a row nothing happened
+      // to.
+      const result = await pool.query<LessonProgressRow>(
+        `with incoming as (
+           select *
+             from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
+                  with ordinality as t(course_id, lesson_id, course_version, completed_at, ord)
+         ), upserted as (
+           insert into core.lesson_progress (course_id, lesson_id, status, course_version, completed_at)
+           select course_id, lesson_id, 'completed', course_version, completed_at from incoming
+           on conflict (course_id, lesson_id) do update
+             set completed_at = least(core.lesson_progress.completed_at, excluded.completed_at),
+                 course_version = case
+                   when excluded.completed_at < core.lesson_progress.completed_at
+                     then coalesce(excluded.course_version, core.lesson_progress.course_version)
+                   else core.lesson_progress.course_version
+                 end,
+                 updated_at = case
+                   when excluded.completed_at < core.lesson_progress.completed_at
+                     then now()
+                   else core.lesson_progress.updated_at
+                 end
+           returning ${RETURNED_COLUMNS}
+         )
+         select upserted.*
+           from upserted
+           join incoming on incoming.course_id = upserted.course_id
+                        and incoming.lesson_id = upserted.lesson_id
+          order by incoming.ord`,
+        [
+          records.map((record) => record.courseId),
+          records.map((record) => record.lessonId),
+          records.map((record) => record.courseVersion ?? null),
+          records.map((record) => record.completedAt),
+        ],
+      );
+      return result.rows.map(toProgressRecord);
+    },
   };
 }
 
diff --git a/services/backend/src/progress/testSupport.ts b/services/backend/src/progress/testSupport.ts
index 9564c9f..72265cc 100644
--- a/services/backend/src/progress/testSupport.ts
+++ b/services/backend/src/progress/testSupport.ts
@@ -15,8 +15,9 @@ import { makeTempDir, writeCoursePackage, type FixtureFile } from "../courses/te
 import type { Course } from "../courses/types.js";
 import type { AppPool } from "../db/pool.js";
 import { buildServer } from "../server.js";
+import { progressKey } from "./model.js";
 import type { ProgressRecord } from "./model.js";
-import type { MarkLessonCompletedInput, ProgressRepository } from "./repository.js";
+import type { ImportProgressRecord, MarkLessonCompletedInput, ProgressRepository } from "./repository.js";
 
 /**
  * An in-memory `ProgressRepository` with the same observable contract as the
@@ -32,7 +33,7 @@ import type { MarkLessonCompletedInput, ProgressRepository } from "./repository.
 export function createInMemoryProgressRepository(seed: readonly ProgressRecord[] = []): ProgressRepository & {
   records(): ProgressRecord[];
 } {
-  const rows = new Map<string, ProgressRecord>(seed.map((record) => [key(record.courseId, record.lessonId), record]));
+  const rows = new Map<string, ProgressRecord>(seed.map((record) => [progressKey(record.courseId, record.lessonId), record]));
   // Monotonic, deterministic clock: real timestamps at test speed can land
   // in the same millisecond, which would make "completedAt didn't move"
   // assertions pass even if the code did move it.
@@ -60,7 +61,7 @@ export function createInMemoryProgressRepository(seed: readonly ProgressRecord[]
       lessonId,
       courseVersion,
     }: MarkLessonCompletedInput): Promise<ProgressRecord> {
-      const existing = rows.get(key(courseId, lessonId));
+      const existing = rows.get(progressKey(courseId, lessonId));
       const now = nextTimestamp();
       const record: ProgressRecord = {
         courseId,
@@ -70,20 +71,60 @@ export function createInMemoryProgressRepository(seed: readonly ProgressRecord[]
         completedAt: existing?.completedAt ?? now,
         updatedAt: now,
       };
-      rows.set(key(courseId, lessonId), record);
+      rows.set(progressKey(courseId, lessonId), record);
       return record;
     },
 
+    // Mirrors the SQL merge in repository.ts exactly (task 010): the EARLIER
+    // completion wins, the course version travels with the completion time
+    // it belongs to, nothing is ever deleted, and an empty input writes
+    // nothing.
+    async importProgress(records: readonly ImportProgressRecord[]): Promise<ProgressRecord[]> {
+      // The real repository rejects a duplicated (course, lesson) pair rather
+      // than letting Postgres abort the statement; mirrored here so a test
+      // that passes one sees the same failure, not a silently-applied second
+      // write.
+      const seen = new Set<string>();
+      for (const record of records) {
+        const dedupKey = progressKey(record.courseId, record.lessonId);
+        if (seen.has(dedupKey)) {
+          throw new Error(
+            `Cannot import two completions for the same lesson: course "${record.courseId}", lesson ` +
+              `"${record.lessonId}" appears more than once. Merge them before calling importProgress.`,
+          );
+        }
+        seen.add(dedupKey);
+      }
+      return records.map((incoming) => {
+        const existing = rows.get(progressKey(incoming.courseId, incoming.lessonId));
+        const takesIncoming =
+          existing === undefined || Date.parse(incoming.completedAt) < Date.parse(existing.completedAt);
+        // A losing incoming record (existing is defined and not later than
+        // it) is a true no-op: it does not donate its courseVersion to a
+        // locally-null one, and it does not touch updatedAt — mirrors
+        // repository.ts's SQL merge exactly (fix round 2, finding 2).
+        if (!takesIncoming && existing !== undefined) {
+          return existing;
+        }
+        const record: ProgressRecord = {
+          courseId: incoming.courseId,
+          lessonId: incoming.lessonId,
+          status: "completed",
+          courseVersion: incoming.courseVersion ?? existing?.courseVersion,
+          completedAt: incoming.completedAt,
+          updatedAt: nextTimestamp(),
+        };
+        rows.set(progressKey(record.courseId, record.lessonId), record);
+        return record;
+      });
+    },
+
     records(): ProgressRecord[] {
       return [...rows.values()];
     },
   };
 }
 
-function key(courseId: string, lessonId: string): string {
-  return `${courseId}\x00${lessonId}`;
-}
-
 export const FIXTURE_COURSE_ID = "progress-fixture";
 export const FIXTURE_COURSE_VERSION = "1.0.0";
 /** Content only -> completed by an explicit "mark as done". */
diff --git a/services/backend/src/routes/transfer.test.ts b/services/backend/src/routes/transfer.test.ts
new file mode 100644
index 0000000..02abebc
--- /dev/null
+++ b/services/backend/src/routes/transfer.test.ts
@@ -0,0 +1,325 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+
+import {
+  completedRecord,
+  FIXTURE_COURSE_ID,
+  FIXTURE_COURSE_VERSION,
+  FIXTURE_QUIZ_LESSON_ID,
+  FIXTURE_TEXT_LESSON_ID,
+  withProgressApp,
+} from "../progress/testSupport.js";
+import { PROGRESS_EXPORT_FORMAT } from "../transfer/format.js";
+
+/** A transfer file as a client would post it. */
+function exportFile(
+  courses: unknown[],
+  exportedAt = "2026-09-09T00:00:00.000Z",
+): Record<string, unknown> {
+  return { format: PROGRESS_EXPORT_FORMAT, formatVersion: 1, exportedAt, courses };
+}
+
+void test("GET /progress/export returns a versioned, timestamped progress file (happy path)", async () => {
+  await withProgressApp(
+    async (app) => {
+      const response = await app.inject({ method: "GET", url: "/progress/export" });
+      assert.equal(response.statusCode, 200);
+      const body = response.json();
+
+      assert.equal(body.format, PROGRESS_EXPORT_FORMAT);
+      assert.equal(body.formatVersion, 1);
+      assert.equal(Number.isNaN(Date.parse(body.exportedAt)), false);
+      assert.deepEqual(body.courses, [
+        {
+          courseId: FIXTURE_COURSE_ID,
+          installedVersion: FIXTURE_COURSE_VERSION,
+          lessons: [
+            {
+              lessonId: FIXTURE_TEXT_LESSON_ID,
+              status: "completed",
+              completedAt: "2026-01-01T00:00:00.000Z",
+              courseVersion: FIXTURE_COURSE_VERSION,
+            },
+          ],
+        },
+      ]);
+      // Suggested save name for a plain browser navigation — the file is
+      // still ordinary JSON.
+      assert.match(response.headers["content-disposition"] as string, /^attachment; filename="trellis-progress-.*\.json"$/);
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("GET /progress/export carries progress, never course content", async () => {
+  await withProgressApp(
+    async (app) => {
+      const response = await app.inject({ method: "GET", url: "/progress/export" });
+      // Same rule as the progress tree: the transfer file must not become a
+      // second, stale copy of the course package.
+      for (const forbidden of ["title", "Text lesson", "quiz", "explanation", "check", "select"]) {
+        assert.equal(response.body.includes(forbidden), false, `export leaked "${forbidden}"`);
+      }
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("POST /progress/import applies a file and reports what it changed", async () => {
+  await withProgressApp(
+    async (app, progress) => {
+      const response = await app.inject({
+        method: "POST",
+        url: "/progress/import",
+        payload: exportFile([
+          {
+            courseId: FIXTURE_COURSE_ID,
+            installedVersion: FIXTURE_COURSE_VERSION,
+            lessons: [
+              // already completed here, later than the local row -> unchanged
+              {
+                lessonId: FIXTURE_TEXT_LESSON_ID,
+                status: "completed",
+                completedAt: "2026-02-02T00:00:00.000Z",
+              },
+              // new here
+              {
+                lessonId: FIXTURE_QUIZ_LESSON_ID,
+                status: "completed",
+                completedAt: "2026-02-02T00:00:00.000Z",
+                courseVersion: "0.9.0",
+              },
+            ],
+          },
+        ]),
+      });
+
+      assert.equal(response.statusCode, 200);
+      const body = response.json();
+      assert.equal(body.applied, true);
+      assert.equal(body.stale, false);
+      assert.deepEqual(body.summary, { courses: 1, lessons: 2, created: 1, earlierCompletions: 0, unchanged: 1 });
+      assert.deepEqual(body.coursesNotInstalled, []);
+      assert.deepEqual(body.courses, [
+        {
+          courseId: FIXTURE_COURSE_ID,
+          installed: true,
+          fileVersion: FIXTURE_COURSE_VERSION,
+          lessons: 2,
+          created: 1,
+          earlierCompletions: 0,
+          unchanged: 1,
+        },
+      ]);
+
+      // The imported completion is really stored, with the file's own
+      // completion time (an import restores when it happened elsewhere; it
+      // does not pass the lesson again now).
+      const stored = progress.records().find((row) => row.lessonId === FIXTURE_QUIZ_LESSON_ID);
+      assert.equal(stored?.completedAt, "2026-02-02T00:00:00.000Z");
+      assert.equal(stored?.courseVersion, "0.9.0");
+      // ...and the untouched one was not re-stamped.
+      const untouched = progress.records().find((row) => row.lessonId === FIXTURE_TEXT_LESSON_ID);
+      assert.equal(untouched?.completedAt, "2026-01-01T00:00:00.000Z");
+      assert.equal(untouched?.updatedAt, "2026-01-01T00:00:00.000Z");
+
+      // The imported lesson is immediately visible through the normal
+      // progress API — an import is progress, not a parallel store.
+      const tree = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
+      assert.equal(tree.completedLessons, 2);
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("POST /progress/import refuses a file older than local progress until it is confirmed", async () => {
+  await withProgressApp(
+    async (app, progress) => {
+      const payload = exportFile(
+        [
+          {
+            courseId: FIXTURE_COURSE_ID,
+            lessons: [
+              { lessonId: FIXTURE_QUIZ_LESSON_ID, status: "completed", completedAt: "2019-01-01T00:00:00.000Z" },
+            ],
+          },
+        ],
+        "2020-01-01T00:00:00.000Z",
+      );
+
+      const warned = await app.inject({ method: "POST", url: "/progress/import", payload });
+      assert.equal(warned.statusCode, 409);
+      const warnedBody = warned.json();
+      assert.equal(warnedBody.error, "import_older_than_local");
+      assert.equal(warnedBody.applied, false);
+      assert.equal(warnedBody.stale, true);
+      assert.equal(warnedBody.fileExportedAt, "2020-01-01T00:00:00.000Z");
+      assert.equal(warnedBody.localLatestProgressAt, "2026-01-01T00:00:00.000Z");
+      // The preview is complete enough for the UI to explain the decision
+      // without a second round trip.
+      assert.equal(warnedBody.summary.created, 1);
+      // Refused means refused: not one row was written.
+      assert.deepEqual(
+        progress.records().map((row) => row.lessonId),
+        [FIXTURE_TEXT_LESSON_ID],
+      );
+
+      const confirmed = await app.inject({ method: "POST", url: "/progress/import?confirm=true", payload });
+      assert.equal(confirmed.statusCode, 200);
+      const confirmedBody = confirmed.json();
+      assert.equal(confirmedBody.applied, true);
+      // Still reported as stale — the user was told, and chose to proceed.
+      assert.equal(confirmedBody.stale, true);
+      assert.deepEqual(
+        progress
+          .records()
+          .map((row) => row.lessonId)
+          .sort(),
+        [FIXTURE_QUIZ_LESSON_ID, FIXTURE_TEXT_LESSON_ID].sort(),
+      );
+      // Even a stale import cannot erase or un-complete what was here.
+      assert.equal(progress.records().find((row) => row.lessonId === FIXTURE_TEXT_LESSON_ID)?.status, "completed");
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("POST /progress/import does not demand confirmation for an old file that would change nothing", async () => {
+  await withProgressApp(
+    async (app, progress) => {
+      // Older than the local progress (2026-01-01), but its single completion
+      // is already here at an earlier time — the import is a no-op. A warning
+      // you cannot act on differently is friction, not a warning: re-importing
+      // yesterday's file must not require "?confirm=true".
+      const payload = exportFile(
+        [
+          {
+            courseId: FIXTURE_COURSE_ID,
+            lessons: [
+              { lessonId: FIXTURE_TEXT_LESSON_ID, status: "completed", completedAt: "2026-06-01T00:00:00.000Z" },
+            ],
+          },
+        ],
+        "2020-01-01T00:00:00.000Z",
+      );
+
+      const response = await app.inject({ method: "POST", url: "/progress/import", payload });
+      assert.equal(response.statusCode, 200);
+      const body = response.json();
+      assert.equal(body.applied, true);
+      // The file IS old, and the body still says so — it just isn't a question.
+      assert.equal(body.stale, true);
+      assert.equal(body.summary.created, 0);
+      assert.equal(body.summary.earlierCompletions, 0);
+      assert.equal(body.summary.unchanged, 1);
+      // Nothing written: the stored completion keeps its original timestamp.
+      assert.equal(progress.records().length, 1);
+      assert.equal(progress.records()[0]?.completedAt, "2026-01-01T00:00:00.000Z");
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("POST /progress/import keeps progress for courses that aren't installed here", async () => {
+  await withProgressApp(async (app, progress) => {
+    const response = await app.inject({
+      method: "POST",
+      url: "/progress/import",
+      payload: exportFile([
+        {
+          courseId: "a-course-from-the-other-machine",
+          installedVersion: "4.5.6",
+          lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-03-03T00:00:00.000Z" }],
+        },
+      ]),
+    });
+
+    assert.equal(response.statusCode, 200);
+    const body = response.json();
+    assert.deepEqual(body.coursesNotInstalled, ["a-course-from-the-other-machine"]);
+    assert.equal(body.summary.created, 1);
+    assert.equal(body.courses[0].installed, false);
+    // Stored, waiting for the course to show up (clarify Q-009) — and
+    // re-exported as-is meanwhile.
+    assert.equal(progress.records().length, 1);
+    const reexported = (await app.inject({ method: "GET", url: "/progress/export" })).json();
+    assert.equal(reexported.courses[0].courseId, "a-course-from-the-other-machine");
+    assert.equal(reexported.courses[0].installedVersion, undefined);
+  });
+});
+
+void test("POST /progress/import round-trips this machine's own export as a no-op", async () => {
+  await withProgressApp(
+    async (app, progress) => {
+      const exported = (await app.inject({ method: "GET", url: "/progress/export" })).json();
+      const before = progress.records();
+
+      const response = await app.inject({ method: "POST", url: "/progress/import", payload: exported });
+      assert.equal(response.statusCode, 200);
+      assert.deepEqual(response.json().summary, {
+        courses: 1,
+        lessons: 1,
+        created: 0,
+        earlierCompletions: 0,
+        unchanged: 1,
+      });
+      // Not one row re-written — no `updatedAt` churn on a no-op import.
+      assert.deepEqual(progress.records(), before);
+    },
+    { seed: [completedRecord(FIXTURE_TEXT_LESSON_ID)] },
+  );
+});
+
+void test("POST /progress/import explains, in its own words, why a file was rejected", async () => {
+  await withProgressApp(async (app, progress) => {
+    const notOurs = await app.inject({ method: "POST", url: "/progress/import", payload: { hello: "world" } });
+    assert.equal(notOurs.statusCode, 400);
+    assert.equal(notOurs.json().error, "invalid_export_file");
+    assert.match(notOurs.json().problems[0], /not a Trellis progress file/);
+
+    const fromTheFuture = await app.inject({
+      method: "POST",
+      url: "/progress/import",
+      payload: { ...exportFile([]), formatVersion: 99 },
+    });
+    assert.equal(fromTheFuture.statusCode, 400);
+    assert.equal(fromTheFuture.json().error, "unsupported_export_version");
+
+    const broken = await app.inject({
+      method: "POST",
+      url: "/progress/import",
+      payload: exportFile([{ courseId: "c", lessons: [{ lessonId: "l", status: "completed", completedAt: "nope" }] }]),
+    });
+    assert.equal(broken.statusCode, 400);
+    assert.equal(broken.json().error, "invalid_export_file");
+    assert.match(broken.json().problems.join("\n"), /courses\[0\]\.lessons\[0\]\.completedAt/);
+
+    // Nothing partial was written by any of the three.
+    assert.deepEqual(progress.records(), []);
+  });
+});
+
+void test("POST /progress/import stores progress for lessons the installed course no longer has", async () => {
+  await withProgressApp(async (app) => {
+    const response = await app.inject({
+      method: "POST",
+      url: "/progress/import",
+      payload: exportFile([
+        {
+          courseId: FIXTURE_COURSE_ID,
+          lessons: [{ lessonId: "lesson-from-an-older-build", status: "completed", completedAt: "2026-03-03T00:00:00.000Z" }],
+        },
+      ]),
+    });
+    assert.equal(response.statusCode, 200);
+
+    // It is kept (never dropped for not matching the installed course) and
+    // surfaces as orphaned progress — the same treatment a lesson removed by
+    // a course update gets.
+    const tree = (await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/progress` })).json();
+    assert.deepEqual(tree.orphanedLessons, [
+      { lessonId: "lesson-from-an-older-build", completedAt: "2026-03-03T00:00:00.000Z" },
+    ]);
+    assert.equal(tree.completedLessons, 0);
+  });
+});
diff --git a/services/backend/src/routes/transfer.ts b/services/backend/src/routes/transfer.ts
new file mode 100644
index 0000000..688586d
--- /dev/null
+++ b/services/backend/src/routes/transfer.ts
@@ -0,0 +1,233 @@
+// Transfer API: carry progress between computers (home/work) as one
+// versioned JSON file.
+//
+//   GET  /progress/export          -> the file (transfer/format.ts)
+//   POST /progress/import          <- the same file, merged into this machine
+//
+// The import is a two-answer endpoint on purpose. When the file is OLDER
+// than the progress already here, the first request writes NOTHING and comes
+// back 409 with the full preview of what it would do; the client shows that
+// warning (task 016) and repeats the request with `?confirm=true` to go
+// ahead. The product asks for a warning, and a warning nobody has to answer
+// is not one — this keeps the decision with the user without inventing a
+// second "preview" endpoint or a server-side session.
+//
+// Everything else about the import is deliberately additive: progress is
+// merged, never replaced, and a lesson never un-completes (see
+// progress/repository.ts's `importProgress`). Even a confirmed stale import
+// cannot lose a completion.
+//
+// One thing the import deliberately does NOT do: it does not re-apply the
+// completion-mode gate that `POST .../complete` enforces (a quiz lesson can
+// only be completed by answering it, a checked practice lesson by passing
+// its check). An import does not COMPLETE anything — it restores completions
+// already earned, on another machine, under that machine's copy of the
+// course. Refusing them here would mean "transfer your progress, except the
+// quizzes you passed", which is the opposite of what the file is for. It
+// also cannot be used to cheat a gate: the same person could just as well
+// answer the quiz locally, and everything here stays on their own computer.
+
+import type { FastifyInstance } from "fastify";
+
+import { buildProgressExport } from "../transfer/export.js";
+import { progressExportFileName, parseProgressExport } from "../transfer/format.js";
+import { planProgressImport, type ProgressImportPlan } from "../transfer/import.js";
+import { errorResponseSchema } from "./progress.js";
+
+export default async function transferRoutes(fastify: FastifyInstance): Promise<void> {
+  fastify.get(
+    "/progress/export",
+    { schema: { response: { 200: progressExportFileSchema } } },
+    async (_request, reply) => {
+      const records = await fastify.progress.listAllProgress();
+      const file = buildProgressExport(records, {
+        installedVersion: (courseId) => fastify.courses.get(courseId)?.version,
+      });
+      // Lets a plain browser navigation save the file under a meaningful
+      // name; a fetch-based client (task 016) ignores it and names its own
+      // download. Nothing depends on it, so the endpoint stays a normal JSON
+      // endpoint that a test can read with `response.json()`.
+      void reply.header("content-disposition", `attachment; filename="${progressExportFileName(file.exportedAt)}"`);
+      return file;
+    },
+  );
+
+  fastify.post<{ Querystring: { confirm?: boolean }; Body: unknown }>(
+    "/progress/import",
+    {
+      // A progress file is small (a few hundred bytes per completed lesson),
+      // but it grows with every course a person has ever touched — this
+      // lifts the ceiling off Fastify's 1MB default while keeping a finite
+      // one, so a wrong file (a database dump, a video) is refused by size
+      // instead of being parsed.
+      bodyLimit: 4 * 1024 * 1024,
+      schema: {
+        querystring: importQuerystringSchema,
+        // No `body` schema on purpose: the body IS a user-picked file, and
+        // every problem with it must be reported in this app's own words
+        // (parseProgressExport's `problems`), not as an Ajv message about a
+        // JSON pointer. Fastify still rejects a body that isn't valid JSON.
+        response: { 200: importResultSchema, 400: importRejectionSchema, 409: importResultSchema },
+      },
+    },
+    async (request, reply) => {
+      const parsed = parseProgressExport(request.body);
+      if (!parsed.ok) {
+        return reply.code(400).send({
+          error: parsed.reason === "unsupported_version" ? "unsupported_export_version" : "invalid_export_file",
+          message:
+            parsed.reason === "not_an_export_file"
+              ? "That file is not a Trellis progress export."
+              : parsed.reason === "unsupported_version"
+                ? "That progress file was written by a newer version of Trellis."
+                : "That progress file could not be read — see the problems listed below.",
+          problems: parsed.problems,
+        });
+      }
+
+      const existing = await fastify.progress.listAllProgress();
+      const plan = planProgressImport(parsed.file, existing, {
+        isCourseInstalled: (courseId) => fastify.courses.get(courseId) !== undefined,
+      });
+
+      // A warning is only worth asking about when there is something to warn
+      // about: an old file whose every completion is already here (the usual
+      // shape of "I re-imported yesterday's file") changes nothing, so asking
+      // the user to confirm a no-op would be friction with no decision behind
+      // it. `stale` is still reported in the 200 body — the fact that the file
+      // is old is information either way; it just isn't a question.
+      const worthWarningAbout = plan.stale && plan.records.length > 0;
+      if (worthWarningAbout && request.query.confirm !== true) {
+        return reply.code(409).send({
+          error: "import_older_than_local",
+          message:
+            `This progress file was saved on ${plan.fileExportedAt}, which is older than the progress already on ` +
+            `this computer (last changed ${plan.localLatestProgressAt ?? "never"}). Nothing was imported. ` +
+            `Importing it can only add completed lessons — it never removes any — so repeat the request with ` +
+            `"?confirm=true" if this is the file you meant to use.`,
+          ...toImportPayload(plan, false),
+        });
+      }
+
+      await fastify.progress.importProgress(plan.records);
+      return toImportPayload(plan, true);
+    },
+  );
+}
+
+/** The plan as the API reports it — the same body for the applied (200) and
+ * the refused (409) case, so a client renders one shape either way and only
+ * looks at `applied`. `records` is deliberately not part of it: the client
+ * needs counts, not a copy of its own file back. */
+function toImportPayload(plan: ProgressImportPlan, applied: boolean) {
+  return {
+    applied,
+    stale: plan.stale,
+    fileExportedAt: plan.fileExportedAt,
+    localLatestProgressAt: plan.localLatestProgressAt,
+    summary: plan.totals,
+    courses: plan.courses,
+    coursesNotInstalled: plan.coursesNotInstalled,
+  };
+}
+
+// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---
+
+const exportedLessonSchema = {
+  type: "object",
+  additionalProperties: false,
+  required: ["lessonId", "status", "completedAt"],
+  properties: {
+    lessonId: { type: "string" },
+    status: { type: "string", enum: ["completed"] },
+    completedAt: { type: "string" },
+    courseVersion: { type: "string" },
+  },
+} as const;
+
+const progressExportFileSchema = {
+  type: "object",
+  additionalProperties: false,
+  required: ["format", "formatVersion", "exportedAt", "courses"],
+  properties: {
+    format: { type: "string" },
+    formatVersion: { type: "integer" },
+    exportedAt: { type: "string" },
+    courses: {
+      type: "array",
+      items: {
+        type: "object",
+        additionalProperties: false,
+        required: ["courseId", "lessons"],
+        properties: {
+          courseId: { type: "string" },
+          installedVersion: { type: "string" },
+          lessons: { type: "array", items: exportedLessonSchema },
+        },
+      },
+    },
+  },
+} as const;
+
+const importQuerystringSchema = {
+  type: "object",
+  additionalProperties: false,
+  properties: {
+    // Answering the "this file is older than your progress" warning. Has no
+    // effect on any other outcome — it is not a "force" flag.
+    confirm: { type: "boolean" },
+  },
+} as const;
+
+const importCourseSchema = {
+  type: "object",
+  additionalProperties: false,
+  required: ["courseId", "installed", "lessons", "created", "earlierCompletions", "unchanged"],
+  properties: {
+    courseId: { type: "string" },
+    installed: { type: "boolean" },
+    fileVersion: { type: "string" },
+    lessons: { type: "integer" },
+    created: { type: "integer" },
+    earlierCompletions: { type: "integer" },
+    unchanged: { type: "integer" },
+  },
+} as const;
+
+const importResultSchema = {
+  type: "object",
+  additionalProperties: false,
+  required: ["applied", "stale", "fileExportedAt", "summary", "courses", "coursesNotInstalled"],
+  properties: {
+    // Present (with `applied: false`) on the 409 too — see toImportPayload.
+    error: { type: "string" },
+    message: { type: "string" },
+    applied: { type: "boolean" },
+    stale: { type: "boolean" },
+    fileExportedAt: { type: "string" },
+    localLatestProgressAt: { type: "string" },
+    summary: {
+      type: "object",
+      additionalProperties: false,
+      required: ["courses", "lessons", "created", "earlierCompletions", "unchanged"],
+      properties: {
+        courses: { type: "integer" },
+        lessons: { type: "integer" },
+        created: { type: "integer" },
+        earlierCompletions: { type: "integer" },
+        unchanged: { type: "integer" },
+      },
+    },
+    courses: { type: "array", items: importCourseSchema },
+    coursesNotInstalled: { type: "array", items: { type: "string" } },
+  },
+} as const;
+
+/** `errorResponseSchema` plus the per-field problems found in the file. */
+const importRejectionSchema = {
+  ...errorResponseSchema,
+  properties: {
+    ...errorResponseSchema.properties,
+    problems: { type: "array", items: { type: "string" } },
+  },
+} as const;
diff --git a/services/backend/src/server.ts b/services/backend/src/server.ts
index 0127993..a04b474 100644
--- a/services/backend/src/server.ts
+++ b/services/backend/src/server.ts
@@ -21,6 +21,7 @@ import progressRoutes from "./routes/progress.js";
 import quizRoutes from "./routes/quiz.js";
 import sandboxRoutes from "./routes/sandbox.js";
 import practiceRoutes from "./routes/practice.js";
+import transferRoutes from "./routes/transfer.js";
 
 export interface BuildServerOptions {
   /**
@@ -213,6 +214,7 @@ export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
   app.register(quizRoutes);
   app.register(sandboxRoutes);
   app.register(practiceRoutes);
+  app.register(transferRoutes);
   return app;
 }
 
diff --git a/services/backend/src/transfer/export.test.ts b/services/backend/src/transfer/export.test.ts
new file mode 100644
index 0000000..244b8fe
--- /dev/null
+++ b/services/backend/src/transfer/export.test.ts
@@ -0,0 +1,125 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+
+import type { ProgressRecord } from "../progress/model.js";
+import { buildProgressExport } from "./export.js";
+import { parseProgressExport, PROGRESS_EXPORT_FORMAT, PROGRESS_EXPORT_FORMAT_VERSION } from "./format.js";
+
+function record(courseId: string, lessonId: string, overrides: Partial<ProgressRecord> = {}): ProgressRecord {
+  return {
+    courseId,
+    lessonId,
+    status: "completed",
+    courseVersion: "1.0.0",
+    completedAt: "2026-01-01T00:00:00.000Z",
+    updatedAt: "2026-01-01T00:00:00.000Z",
+    ...overrides,
+  };
+}
+
+const INSTALLED: Record<string, string> = { "course-a": "2.0.0" };
+const installedVersion = (courseId: string): string | undefined => INSTALLED[courseId];
+
+void test("buildProgressExport groups rows by course and carries both kinds of version (happy path)", () => {
+  const file = buildProgressExport(
+    [
+      record("course-a", "lesson-1", { courseVersion: "1.0.0", completedAt: "2026-01-01T00:00:00.000Z" }),
+      record("course-a", "lesson-2", { courseVersion: "2.0.0", completedAt: "2026-02-02T00:00:00.000Z" }),
+    ],
+    { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" },
+  );
+
+  assert.equal(file.format, PROGRESS_EXPORT_FORMAT);
+  assert.equal(file.formatVersion, PROGRESS_EXPORT_FORMAT_VERSION);
+  assert.equal(file.exportedAt, "2026-03-03T00:00:00.000Z");
+  assert.deepEqual(file.courses, [
+    {
+      courseId: "course-a",
+      // The version installed HERE, now...
+      installedVersion: "2.0.0",
+      lessons: [
+        // ...and, per completion, the version recorded when it was passed.
+        { lessonId: "lesson-1", status: "completed", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
+        { lessonId: "lesson-2", status: "completed", completedAt: "2026-02-02T00:00:00.000Z", courseVersion: "2.0.0" },
+      ],
+    },
+  ]);
+});
+
+void test("buildProgressExport is deterministic regardless of row order", () => {
+  const rows = [
+    record("course-b", "z-lesson"),
+    record("course-a", "b-lesson"),
+    record("course-b", "a-lesson"),
+    record("course-a", "a-lesson"),
+  ];
+  const options = { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" };
+
+  const straight = buildProgressExport(rows, options);
+  const shuffled = buildProgressExport([...rows].reverse(), options);
+
+  assert.deepEqual(straight, shuffled);
+  assert.deepEqual(
+    straight.courses.map((course) => [course.courseId, course.lessons.map((lesson) => lesson.lessonId)]),
+    [
+      ["course-a", ["a-lesson", "b-lesson"]],
+      ["course-b", ["a-lesson", "z-lesson"]],
+    ],
+  );
+});
+
+void test("buildProgressExport keeps progress for courses that are not installed here (clarify Q-009)", () => {
+  const file = buildProgressExport([record("course-a", "l1"), record("gone-course", "l9")], {
+    installedVersion,
+    exportedAt: "2026-03-03T00:00:00.000Z",
+  });
+  const gone = file.courses.find((course) => course.courseId === "gone-course");
+  assert.ok(gone, "progress for a course that isn't installed must still be exported");
+  // No installed version to report — the field is absent, not invented.
+  assert.equal(gone.installedVersion, undefined);
+  assert.equal(gone.lessons.length, 1);
+});
+
+void test("buildProgressExport carries no course content — ids and versions only", () => {
+  const file = buildProgressExport([record("course-a", "l1")], {
+    installedVersion,
+    exportedAt: "2026-03-03T00:00:00.000Z",
+  });
+  // Raw-text assertion, not a shape assertion: the progress format and the
+  // course format are separate entities (project invariant), so a title, a
+  // module, a quiz or a check must never appear in a transfer file — not even
+  // "for readability".
+  const raw = JSON.stringify(file);
+  for (const forbidden of ["title", "module", "quiz", "content", "check", "prompt"]) {
+    assert.equal(raw.includes(forbidden), false, `export leaked "${forbidden}"`);
+  }
+});
+
+void test("buildProgressExport omits internal bookkeeping (updatedAt) but keeps the file re-readable", () => {
+  const file = buildProgressExport([record("course-a", "l1", { updatedAt: "2099-01-01T00:00:00.000Z" })], {
+    installedVersion,
+    exportedAt: "2026-03-03T00:00:00.000Z",
+  });
+  assert.equal(JSON.stringify(file).includes("2099"), false, "updatedAt is local bookkeeping, not transferable data");
+
+  // Round trip through the parser: what the exporter writes is exactly what
+  // the importer accepts, with nothing lost in between.
+  const parsed = parseProgressExport(JSON.parse(JSON.stringify(file)));
+  assert.equal(parsed.ok, true);
+  if (!parsed.ok) return;
+  assert.deepEqual(parsed.file, file);
+});
+
+void test("buildProgressExport with no progress at all still produces a valid, timestamped file", () => {
+  const file = buildProgressExport([], { installedVersion, exportedAt: "2026-03-03T00:00:00.000Z" });
+  assert.deepEqual(file.courses, []);
+  assert.equal(parseProgressExport(JSON.parse(JSON.stringify(file))).ok, true);
+});
+
+void test("buildProgressExport defaults exportedAt to now", () => {
+  const before = Date.now();
+  const file = buildProgressExport([], { installedVersion });
+  const stamp = Date.parse(file.exportedAt);
+  assert.equal(Number.isNaN(stamp), false);
+  assert.ok(stamp >= before && stamp <= Date.now() + 1000);
+});
diff --git a/services/backend/src/transfer/export.ts b/services/backend/src/transfer/export.ts
new file mode 100644
index 0000000..33980f0
--- /dev/null
+++ b/services/backend/src/transfer/export.ts
@@ -0,0 +1,88 @@
+// Export: stored progress rows -> the transfer file (transfer/format.ts).
+//
+// Pure and I/O-free on purpose — it takes the rows (from
+// `ProgressRepository#listAllProgress`) and a way to ask "which version of
+// this course is installed here?", and returns the file. That keeps the
+// format testable without a database and without a courses directory, and
+// keeps the endpoint (routes/transfer.ts) down to "read rows, build file,
+// send".
+//
+// What does NOT happen here, by design:
+//   - no course content is read (no titles, no module structure) — the file
+//     carries progress only (business-logic.md, clarify Q-006);
+//   - no course is skipped for not being installed. Progress for a course
+//     that isn't on this machine was deliberately kept (clarify Q-009) and
+//     is exported like any other, just without an `installedVersion`;
+//   - no filtering of "orphaned" completions (lessons the installed course
+//     no longer has): they are progress too, and dropping them here would
+//     lose data on every export/import round trip through a machine whose
+//     course happens to be older.
+
+import type { ProgressRecord } from "../progress/model.js";
+import {
+  PROGRESS_EXPORT_FORMAT,
+  PROGRESS_EXPORT_FORMAT_VERSION,
+  type ExportedCourseProgress,
+  type ExportedLessonProgress,
+  type ProgressExportFile,
+} from "./format.js";
+
+export interface BuildProgressExportOptions {
+  /**
+   * The version of `courseId` as installed on THIS machine, or `undefined`
+   * if it isn't installed (routes/transfer.ts passes
+   * `fastify.courses.get(id)?.version`). Injected rather than taking the
+   * registry itself: the exporter needs one fact per course, not the whole
+   * content layer.
+   */
+  readonly installedVersion: (courseId: string) => string | undefined;
+  /** The file's "last saved" timestamp. Defaults to now; tests (and any
+   * caller that wants a deterministic file) pass their own. */
+  readonly exportedAt?: string;
+}
+
+/**
+ * Builds the export file from `records`. Output is deterministic: courses
+ * ordered by `courseId`, lessons by `lessonId` within a course, regardless
+ * of the order the rows arrived in — two exports of the same progress at the
+ * same instant are byte-identical, which is what makes a round-trip test
+ * meaningful.
+ */
+export function buildProgressExport(
+  records: readonly ProgressRecord[],
+  options: BuildProgressExportOptions,
+): ProgressExportFile {
+  const byCourse = new Map<string, ExportedLessonProgress[]>();
+  for (const record of records) {
+    const lessons = byCourse.get(record.courseId) ?? [];
+    lessons.push({
+      lessonId: record.lessonId,
+      status: "completed",
+      completedAt: record.completedAt,
+      courseVersion: record.courseVersion,
+    });
+    byCourse.set(record.courseId, lessons);
+  }
+
+  const courses: ExportedCourseProgress[] = [...byCourse.entries()]
+    .sort(([a], [b]) => compareIds(a, b))
+    .map(([courseId, lessons]) => ({
+      courseId,
+      installedVersion: options.installedVersion(courseId),
+      lessons: lessons.sort((a, b) => compareIds(a.lessonId, b.lessonId)),
+    }));
+
+  return {
+    format: PROGRESS_EXPORT_FORMAT,
+    formatVersion: PROGRESS_EXPORT_FORMAT_VERSION,
+    exportedAt: options.exportedAt ?? new Date().toISOString(),
+    courses,
+  };
+}
+
+/** Plain code-unit order (not locale-aware `localeCompare`): ids are ASCII
+ * identifiers, and the point here is a stable order that is the same on
+ * every machine and in every locale, not a human-friendly one. */
+function compareIds(a: string, b: string): number {
+  return a < b ? -1 : a > b ? 1 : 0;
+}
diff --git a/services/backend/src/transfer/format.test.ts b/services/backend/src/transfer/format.test.ts
new file mode 100644
index 0000000..8db3bfc
--- /dev/null
+++ b/services/backend/src/transfer/format.test.ts
@@ -0,0 +1,213 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+
+import {
+  parseProgressExport,
+  progressExportFileName,
+  PROGRESS_EXPORT_FORMAT,
+  PROGRESS_EXPORT_FORMAT_VERSION,
+} from "./format.js";
+
+/** A minimal valid file, as a plain JSON value (what the HTTP layer hands
+ * `parseProgressExport` after decoding the body). */
+function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
+  return {
+    format: PROGRESS_EXPORT_FORMAT,
+    formatVersion: PROGRESS_EXPORT_FORMAT_VERSION,
+    exportedAt: "2026-09-16T12:30:00.000Z",
+    courses: [
+      {
+        courseId: "course-a",
+        installedVersion: "1.2.0",
+        lessons: [
+          { lessonId: "lesson-1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: "1.1.0" },
+          { lessonId: "lesson-2", status: "completed", completedAt: "2026-09-02T10:00:00.000Z" },
+        ],
+      },
+    ],
+    ...overrides,
+  };
+}
+
+void test("parseProgressExport accepts a well-formed file and normalizes it (happy path)", () => {
+  const parsed = parseProgressExport(validFile());
+  assert.equal(parsed.ok, true);
+  if (!parsed.ok) return;
+  assert.deepEqual(parsed.file, {
+    format: PROGRESS_EXPORT_FORMAT,
+    formatVersion: 1,
+    exportedAt: "2026-09-16T12:30:00.000Z",
+    courses: [
+      {
+        courseId: "course-a",
+        installedVersion: "1.2.0",
+        lessons: [
+          { lessonId: "lesson-1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: "1.1.0" },
+          {
+            lessonId: "lesson-2",
+            status: "completed",
+            completedAt: "2026-09-02T10:00:00.000Z",
+            courseVersion: undefined,
+          },
+        ],
+      },
+    ],
+  });
+});
+
+void test("parseProgressExport canonicalizes timestamps to UTC and drops unknown fields", () => {
+  const parsed = parseProgressExport(
+    validFile({
+      exportedAt: "2026-09-16T15:30:00+03:00",
+      somethingFromTheFuture: { whatever: true },
+      courses: [
+        {
+          courseId: "course-a",
+          lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T13:00:00+03:00", extra: 1 }],
+          extra: "ignored",
+        },
+      ],
+    }),
+  );
+  assert.equal(parsed.ok, true);
+  if (!parsed.ok) return;
+  // Same instants, one canonical spelling — comparisons ("is this file older
+  // than my progress?") must not depend on which offset a machine wrote.
+  assert.equal(parsed.file.exportedAt, "2026-09-16T12:30:00.000Z");
+  assert.deepEqual(parsed.file.courses, [
+    {
+      courseId: "course-a",
+      installedVersion: undefined,
+      lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z", courseVersion: undefined }],
+    },
+  ]);
+  assert.equal("somethingFromTheFuture" in parsed.file, false);
+});
+
+void test("parseProgressExport accepts a file with no progress at all (edge case)", () => {
+  const parsed = parseProgressExport(validFile({ courses: [] }));
+  assert.equal(parsed.ok, true);
+  if (!parsed.ok) return;
+  assert.deepEqual(parsed.file.courses, []);
+});
+
+void test("parseProgressExport rejects anything that isn't a Trellis progress file", () => {
+  for (const value of [null, 42, "a string", [], {}, { format: "pg_dump" }, { format: 5 }]) {
+    const parsed = parseProgressExport(value);
+    assert.equal(parsed.ok, false, `expected ${JSON.stringify(value)} to be rejected`);
+    if (parsed.ok) continue;
+    assert.equal(parsed.reason, "not_an_export_file");
+    assert.equal(parsed.problems.length, 1);
+  }
+});
+
+void test("parseProgressExport rejects a file written by a newer Trellis, by version, without reading it", () => {
+  const parsed = parseProgressExport(
+    validFile({ formatVersion: PROGRESS_EXPORT_FORMAT_VERSION + 1, courses: "not even an array" }),
+  );
+  assert.equal(parsed.ok, false);
+  if (parsed.ok) return;
+  assert.equal(parsed.reason, "unsupported_version");
+  // The version is the whole verdict — the (here deliberately broken) rest of
+  // the file is not half-parsed and not reported as a pile of field errors.
+  assert.equal(parsed.problems.length, 1);
+  assert.match(parsed.problems[0] ?? "", /version 2/);
+});
+
+void test("parseProgressExport reports every problem in one pass, with field paths", () => {
+  const parsed = parseProgressExport({
+    format: PROGRESS_EXPORT_FORMAT,
+    formatVersion: 1,
+    exportedAt: "last tuesday",
+    courses: [
+      {
+        courseId: "",
+        lessons: [
+          { lessonId: "l1", status: "in_progress", completedAt: "2026-09-01T10:00:00.000Z" },
+          { lessonId: "l2", status: "completed", completedAt: "2026-13-45T99:00:00.000Z" },
+          { status: "completed", completedAt: "2026-09-01T10:00:00.000Z" },
+        ],
+      },
+    ],
+  });
+  assert.equal(parsed.ok, false);
+  if (parsed.ok) return;
+  assert.equal(parsed.reason, "malformed");
+  const joined = parsed.problems.join("\n");
+  assert.match(joined, /^exportedAt: expected an ISO 8601 timestamp/m);
+  assert.match(joined, /^courses\[0\]\.courseId: expected a non-empty string/m);
+  assert.match(joined, /^courses\[0\]\.lessons\[0\]\.status: expected "completed"/m);
+  // Shaped like a timestamp, but there is no month 13 — caught by the parse,
+  // not by the regex, and reported with its own wording.
+  assert.match(joined, /^courses\[0\]\.lessons\[1\]\.completedAt: "2026-13-45T99:00:00\.000Z" is not a real date\./m);
+  assert.match(joined, /^courses\[0\]\.lessons\[2\]\.lessonId: expected a non-empty string/m);
+  assert.equal(parsed.problems.length, 5);
+});
+
+void test("parseProgressExport rejects a timestamp with no time zone (its instant would depend on the reader)", () => {
+  // "2026-09-01T10:00:00" is read by Date.parse as the LOCAL time of the
+  // machine doing the import, so the same hand-edited file would canonicalize
+  // to a different instant in Moscow than in London — and with it the "is
+  // this file older than my progress?" verdict. Refused instead of guessed.
+  const parsed = parseProgressExport(
+    validFile({
+      exportedAt: "2026-09-16T12:30:00",
+      courses: [
+        { courseId: "course-a", lessons: [{ lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00" }] },
+      ],
+    }),
+  );
+  assert.equal(parsed.ok, false);
+  if (parsed.ok) return;
+  assert.equal(parsed.reason, "malformed");
+  const joined = parsed.problems.join("\n");
+  assert.match(joined, /^exportedAt: expected an ISO 8601 timestamp with a time zone/m);
+  assert.match(joined, /^courses\[0\]\.lessons\[0\]\.completedAt: expected an ISO 8601 timestamp with a time zone/m);
+
+  // The same instants spelled WITH a zone stay accepted, in either spelling.
+  for (const stamp of ["2026-09-16T12:30:00Z", "2026-09-16T15:30:00+03:00", "2026-09-16T15:30:00+0300"]) {
+    const ok = parseProgressExport(validFile({ exportedAt: stamp, courses: [] }));
+    assert.equal(ok.ok, true, `expected ${stamp} to be accepted`);
+    if (!ok.ok) continue;
+    assert.equal(ok.file.exportedAt, "2026-09-16T12:30:00.000Z");
+  }
+});
+
+void test("parseProgressExport rejects duplicate course and lesson ids (they would make the import order-dependent)", () => {
+  const parsed = parseProgressExport(
+    validFile({
+      courses: [
+        {
+          courseId: "course-a",
+          lessons: [
+            { lessonId: "l1", status: "completed", completedAt: "2026-09-01T10:00:00.000Z" },
+            { lessonId: "l1", status: "completed", completedAt: "2026-09-02T10:00:00.000Z" },
+          ],
+        },
+        { courseId: "course-a", lessons: [] },
+      ],
+    }),
+  );
+  assert.equal(parsed.ok, false);
+  if (parsed.ok) return;
+  const joined = parsed.problems.join("\n");
+  assert.match(joined, /duplicate lesson id "l1"/);
+  assert.match(joined, /duplicate course id "course-a"/);
+});
+
+void test("parseProgressExport error messages never echo the whole file back", () => {
+  const long = "x".repeat(5000);
+  const parsed = parseProgressExport({ format: PROGRESS_EXPORT_FORMAT, formatVersion: 1, exportedAt: long, courses: [] });
+  assert.equal(parsed.ok, false);
+  if (parsed.ok) return;
+  assert.equal(parsed.problems.length, 1);
+  assert.ok((parsed.problems[0] ?? "").length < 200, "a problem message must stay a sentence, not a copy of the input");
+});
+
+void test("progressExportFileName is a legal Windows filename carrying the timestamp", () => {
+  const name = progressExportFileName("2026-09-16T12:30:00.000Z");
+  assert.equal(name, "trellis-progress-2026-09-16T12-30-00Z.json");
+  // ":" is not allowed in a Windows filename — the launcher scripts target
+  // Windows, so a suggested download name with colons would be unusable.
+  assert.equal(name.includes(":"), false);
+});
diff --git a/services/backend/src/transfer/format.ts b/services/backend/src/transfer/format.ts
new file mode 100644
index 0000000..78d29c8
--- /dev/null
+++ b/services/backend/src/transfer/format.ts
@@ -0,0 +1,308 @@
+// The progress transfer file: what an export contains, and how an incoming
+// file is checked before a single row is written.
+//
+// Product decisions this file implements literally (business-logic.md,
+// clarify Q-006): the transfer format is a VERSIONED, APP-LEVEL JSON
+// carrying PROGRESS DATA ONLY — never a pg_dump, never a copy of course
+// content. Two consequences that are easy to get wrong:
+//
+//   - No lesson titles, no module structure, no quiz/practice anything. A
+//     course is identified here by its id (and versions, see below) and
+//     nothing else: the course format and the progress format are separate
+//     entities (project invariant), and a title in here would be a stale
+//     copy of content the importing machine may hold a different version of.
+//   - The file carries its own "last saved" timestamp (`exportedAt`) and the
+//     course ids/versions, which is what makes the "this file is older than
+//     what you already have" warning (transfer/import.ts) readable from the
+//     file alone, without a database.
+//
+// Versions appear at two levels, and they mean different things:
+//   - `courses[].installedVersion` — the version of that course installed on
+//     the machine that produced the file, at export time. Absent when the
+//     course wasn't installed there (progress for a not-installed course is
+//     kept and exported too — clarify Q-009).
+//   - `courses[].lessons[].courseVersion` — provenance of that single
+//     completion: the course version recorded when the lesson was passed
+//     (see `ProgressRecord.courseVersion`). Never a matching key: progress
+//     matches on stable ids only.
+//
+// Nothing here talks to Fastify, Postgres or the filesystem — `parse` takes
+// an already-decoded JSON value (the HTTP layer does the decoding) and
+// returns either a normalized file or a list of human-readable problems.
+
+/** The `format` marker every Trellis progress file carries. Its only job is
+ * to make "the user picked the wrong file" a clear, immediate answer instead
+ * of a confusing list of missing fields. */
+export const PROGRESS_EXPORT_FORMAT = "trellis.progress";
+
+/**
+ * Version of the FILE FORMAT — not of the app, and not of any course. Bump
+ * it only when the shape below changes in a way an older reader would
+ * misread; add the migration branch in `parseProgressExport` when that
+ * happens (a file from a NEWER Trellis is rejected by version, with a
+ * message saying so, rather than half-read).
+ */
+export const PROGRESS_EXPORT_FORMAT_VERSION = 1;
+
+export interface ExportedLessonProgress {
+  readonly lessonId: string;
+  /** Only completions are ever stored or transferred — "not started" is the
+   * absence of an entry (same model as the table, see
+   * migrations/001_progress.sql). Written out explicitly so the file is
+   * self-describing rather than relying on that convention. */
+  readonly status: "completed";
+  /** ISO 8601 UTC. When the lesson was FIRST completed. */
+  readonly completedAt: string;
+  /** Provenance only (see the header comment). */
+  readonly courseVersion?: string;
+}
+
+export interface ExportedCourseProgress {
+  readonly courseId: string;
+  /** The course version installed on the exporting machine, when it was
+   * installed there at all. */
+  readonly installedVersion?: string;
+  readonly lessons: readonly ExportedLessonProgress[];
+}
+
+export interface ProgressExportFile {
+  readonly format: typeof PROGRESS_EXPORT_FORMAT;
+  readonly formatVersion: number;
+  /** "Метка времени последнего сохранения" — ISO 8601 UTC, the instant the
+   * file was produced. The import warning compares this against the newest
+   * local progress. */
+  readonly exportedAt: string;
+  /** Courses with at least one completion, ordered by `courseId`. A course
+   * that is installed but has no progress does not appear: this file holds
+   * progress, not an inventory of courses. */
+  readonly courses: readonly ExportedCourseProgress[];
+}
+
+export type ProgressExportRejection =
+  /** The JSON is well-formed but is not a Trellis progress file at all (no
+   * or wrong `format` marker) — most likely the user picked the wrong file. */
+  | "not_an_export_file"
+  /** A Trellis progress file whose `formatVersion` this build cannot read. */
+  | "unsupported_version"
+  /** A Trellis progress file of a supported version with broken contents. */
+  | "malformed";
+
+export type ParsedProgressExport =
+  | { readonly ok: true; readonly file: ProgressExportFile }
+  | {
+      readonly ok: false;
+      readonly reason: ProgressExportRejection;
+      /** One sentence per problem, safe to show to the person who picked the
+       * file (paths like `courses[0].lessons[2].completedAt`, no stack
+       * traces). Always non-empty. */
+      readonly problems: readonly string[];
+    };
+
+// Deliberately stricter than `Date.parse`, which accepts (implementation
+// defined) shapes like "March 3 2026" and would let a hand-edited file
+// through with a timestamp whose meaning depends on the runtime. Date-time
+// with a date, a time, and an EXPLICIT zone ("Z" or a ±hh:mm offset).
+//
+// Two shapes are refused on purpose:
+//   - a plain date ("2026-01-01") — a progress timestamp without a time is
+//     not something this app ever writes;
+//   - a date-time with no zone ("2026-01-01T10:00:00") — `Date.parse` reads
+//     that as the IMPORTING machine's local time, so the same file would
+//     canonicalize to a different instant depending on where it is opened,
+//     and with it the "is this file older than my progress?" verdict. A
+//     transfer format whose meaning depends on the reader's timezone is not
+//     a transfer format; this app's own exports always write "Z".
+const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;
+
+/**
+ * Validates an already-decoded JSON value as a progress export file and
+ * normalizes it (unknown fields dropped, timestamps canonicalized to ISO
+ * 8601 UTC). Never throws: every rejection comes back as `problems`.
+ *
+ * It collects ALL problems rather than failing on the first one — a person
+ * fixing a hand-written file should not have to re-upload it once per typo.
+ */
+export function parseProgressExport(value: unknown): ParsedProgressExport {
+  if (!isPlainObject(value)) {
+    return {
+      ok: false,
+      reason: "not_an_export_file",
+      problems: ["The file does not contain a JSON object — a Trellis progress file is a single JSON object."],
+    };
+  }
+
+  if (value.format !== PROGRESS_EXPORT_FORMAT) {
+    return {
+      ok: false,
+      reason: "not_an_export_file",
+      problems: [
+        `This is not a Trellis progress file: its "format" field is ${describeValue(value.format)}, ` +
+          `expected "${PROGRESS_EXPORT_FORMAT}".`,
+      ],
+    };
+  }
+
+  const formatVersion = value.formatVersion;
+  if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
+    return {
+      ok: false,
+      reason: "malformed",
+      problems: [`formatVersion: expected a positive whole number, got ${describeValue(formatVersion)}.`],
+    };
+  }
+  if (formatVersion > PROGRESS_EXPORT_FORMAT_VERSION) {
+    return {
+      ok: false,
+      reason: "unsupported_version",
+      problems: [
+        `This progress file is version ${formatVersion}, but this version of Trellis can only read files up to ` +
+          `version ${PROGRESS_EXPORT_FORMAT_VERSION}. Update Trellis on this computer, or export again from an ` +
+          `older one.`,
+      ],
+    };
+  }
+  // Only version 1 exists so far. When version 2 arrives, this is where its
+  // branch goes (read the old shape, upgrade it here) — never by loosening
+  // the checks below, which describe version 1 and must keep describing it.
+
+  const problems: string[] = [];
+  const exportedAt = readTimestamp(value.exportedAt, "exportedAt", problems);
+
+  const courses: ExportedCourseProgress[] = [];
+  const rawCourses = value.courses;
+  if (!Array.isArray(rawCourses)) {
+    problems.push(`courses: expected an array, got ${describeValue(rawCourses)}.`);
+  } else {
+    const seenCourseIds = new Set<string>();
+    rawCourses.forEach((rawCourse, courseIndex) => {
+      const at = `courses[${courseIndex}]`;
+      if (!isPlainObject(rawCourse)) {
+        problems.push(`${at}: expected an object, got ${describeValue(rawCourse)}.`);
+        return;
+      }
+      const courseId = readNonEmptyString(rawCourse.courseId, `${at}.courseId`, problems);
+      if (courseId !== undefined) {
+        if (seenCourseIds.has(courseId)) {
+          // Two entries for one course would make the import order-dependent
+          // (and, in the database, a single statement trying to upsert the
+          // same key twice) — rejected instead of silently merged.
+          problems.push(`${at}.courseId: duplicate course id "${courseId}" — each course may appear only once.`);
+        }
+        seenCourseIds.add(courseId);
+      }
+      const installedVersion = readOptionalNonEmptyString(
+        rawCourse.installedVersion,
+        `${at}.installedVersion`,
+        problems,
+      );
+
+      const lessons: ExportedLessonProgress[] = [];
+      const rawLessons = rawCourse.lessons;
+      if (!Array.isArray(rawLessons)) {
+        problems.push(`${at}.lessons: expected an array, got ${describeValue(rawLessons)}.`);
+      } else {
+        const seenLessonIds = new Set<string>();
+        rawLessons.forEach((rawLesson, lessonIndex) => {
+          const lessonAt = `${at}.lessons[${lessonIndex}]`;
+          if (!isPlainObject(rawLesson)) {
+            problems.push(`${lessonAt}: expected an object, got ${describeValue(rawLesson)}.`);
+            return;
+          }
+          const lessonId = readNonEmptyString(rawLesson.lessonId, `${lessonAt}.lessonId`, problems);
+          if (lessonId !== undefined) {
+            if (seenLessonIds.has(lessonId)) {
+              problems.push(
+                `${lessonAt}.lessonId: duplicate lesson id "${lessonId}" in course ` +
+                  `"${courseId ?? "?"}" — each lesson may appear only once.`,
+              );
+            }
+            seenLessonIds.add(lessonId);
+          }
+          if (rawLesson.status !== "completed") {
+            problems.push(
+              `${lessonAt}.status: expected "completed" (the only status a progress file carries), got ` +
+                `${describeValue(rawLesson.status)}.`,
+            );
+          }
+          const completedAt = readTimestamp(rawLesson.completedAt, `${lessonAt}.completedAt`, problems);
+          const courseVersion = readOptionalNonEmptyString(
+            rawLesson.courseVersion,
+            `${lessonAt}.courseVersion`,
+            problems,
+          );
+          if (lessonId !== undefined && completedAt !== undefined && rawLesson.status === "completed") {
+            lessons.push({ lessonId, status: "completed", completedAt, courseVersion });
+          }
+        });
+      }
+
+      if (courseId !== undefined) {
+        courses.push({ courseId, installedVersion, lessons });
+      }
+    });
+  }
+
+  if (problems.length > 0 || exportedAt === undefined) {
+    return { ok: false, reason: "malformed", problems };
+  }
+  return { ok: true, file: { format: PROGRESS_EXPORT_FORMAT, formatVersion, exportedAt, courses } };
+}
+
+/**
+ * Suggested download name for an export, e.g.
+ * `trellis-progress-2026-09-16T12-30-00Z.json`. Colons are not legal in
+ * Windows filenames (the target platform for the launcher scripts), so the
+ * timestamp is punctuated with dashes rather than pasted in raw.
+ */
+export function progressExportFileName(exportedAt: string): string {
+  const stamp = exportedAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
+  return `trellis-progress-${stamp}.json`;
+}
+
+function isPlainObject(value: unknown): value is Record<string, unknown> {
+  return typeof value === "object" && value !== null && !Array.isArray(value);
+}
+
+function readNonEmptyString(value: unknown, at: string, problems: string[]): string | undefined {
+  if (typeof value !== "string" || value.length === 0) {
+    problems.push(`${at}: expected a non-empty string, got ${describeValue(value)}.`);
+    return undefined;
+  }
+  return value;
+}
+
+function readOptionalNonEmptyString(value: unknown, at: string, problems: string[]): string | undefined {
+  if (value === undefined) {
+    return undefined;
+  }
+  return readNonEmptyString(value, at, problems);
+}
+
+/** Accepts an ISO 8601 date-time WITH a zone, returns it canonicalized to
+ * UTC (see `ISO_DATE_TIME` for why the zone is required). */
+function readTimestamp(value: unknown, at: string, problems: string[]): string | undefined {
+  if (typeof value !== "string" || !ISO_DATE_TIME.test(value)) {
+    problems.push(
+      `${at}: expected an ISO 8601 timestamp with a time zone (e.g. "2026-09-16T12:30:00.000Z" or ` +
+        `"2026-09-16T15:30:00+03:00"), got ${describeValue(value)}.`,
+    );
+    return undefined;
+  }
+  const parsed = Date.parse(value);
+  if (Number.isNaN(parsed)) {
+    problems.push(`${at}: "${value}" is not a real date.`);
+    return undefined;
+  }
+  return new Date(parsed).toISOString();
+}
+
+/** Short, quoted rendering of an unexpected value for an error message —
+ * never the whole file, never a stack trace. */
+function describeValue(value: unknown): string {
+  if (value === undefined) return "nothing";
+  if (value === null) return "null";
+  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
+  if (typeof value === "number" || typeof value === "boolean") return String(value);
+  if (Array.isArray(value)) return "an array";
+  return "an object";
+}
diff --git a/services/backend/src/transfer/import.test.ts b/services/backend/src/transfer/import.test.ts
new file mode 100644
index 0000000..fe75851
--- /dev/null
+++ b/services/backend/src/transfer/import.test.ts
@@ -0,0 +1,177 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+
+import type { ProgressRecord } from "../progress/model.js";
+import { buildProgressExport } from "./export.js";
+import type { ProgressExportFile } from "./format.js";
+import { planProgressImport } from "./import.js";
+
+function record(courseId: string, lessonId: string, overrides: Partial<ProgressRecord> = {}): ProgressRecord {
+  return {
+    courseId,
+    lessonId,
+    status: "completed",
+    courseVersion: "1.0.0",
+    completedAt: "2026-05-05T00:00:00.000Z",
+    updatedAt: "2026-05-05T00:00:00.000Z",
+    ...overrides,
+  };
+}
+
+function file(courses: ProgressExportFile["courses"], exportedAt = "2026-06-06T00:00:00.000Z"): ProgressExportFile {
+  return { format: "trellis.progress", formatVersion: 1, exportedAt, courses };
+}
+
+function lesson(lessonId: string, completedAt: string, courseVersion?: string) {
+  return { lessonId, status: "completed" as const, completedAt, courseVersion };
+}
+
+const installedEverywhere = { isCourseInstalled: () => true };
+
+void test("planProgressImport classifies every lesson: created, earlier completion, unchanged (happy path)", () => {
+  const plan = planProgressImport(
+    file([
+      {
+        courseId: "course-a",
+        installedVersion: "1.0.0",
+        lessons: [
+          // not here yet
+          lesson("new-lesson", "2026-04-04T00:00:00.000Z", "0.9.0"),
+          // here, but the file passed it earlier
+          lesson("old-lesson", "2026-01-01T00:00:00.000Z", "0.8.0"),
+          // here already, and the file's completion is later -> no change
+          lesson("known-lesson", "2026-09-09T00:00:00.000Z"),
+        ],
+      },
+    ]),
+    [record("course-a", "old-lesson"), record("course-a", "known-lesson")],
+    installedEverywhere,
+  );
+
+  assert.deepEqual(plan.totals, { courses: 1, lessons: 3, created: 1, earlierCompletions: 1, unchanged: 1 });
+  assert.deepEqual(plan.courses, [
+    {
+      courseId: "course-a",
+      installed: true,
+      fileVersion: "1.0.0",
+      lessons: 3,
+      created: 1,
+      earlierCompletions: 1,
+      unchanged: 1,
+    },
+  ]);
+  // Only what actually changes is written — an unchanged lesson is not
+  // re-stamped.
+  assert.deepEqual(plan.records, [
+    { courseId: "course-a", lessonId: "new-lesson", completedAt: "2026-04-04T00:00:00.000Z", courseVersion: "0.9.0" },
+    { courseId: "course-a", lessonId: "old-lesson", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "0.8.0" },
+  ]);
+});
+
+void test("planProgressImport never plans to remove or un-complete anything", () => {
+  // Local progress the file knows nothing about must survive an import: the
+  // file is merged in, it does not replace the local state.
+  const plan = planProgressImport(
+    file([{ courseId: "course-a", lessons: [lesson("l1", "2026-06-01T00:00:00.000Z")] }]),
+    [record("course-a", "l1"), record("course-a", "only-here"), record("other-course", "l1")],
+    installedEverywhere,
+  );
+  assert.equal(plan.totals.created, 0);
+  assert.deepEqual(plan.records, []);
+  // Nothing in the plan refers to the rows the file didn't mention.
+  assert.equal(JSON.stringify(plan.records).includes("only-here"), false);
+  assert.equal(JSON.stringify(plan.courses).includes("other-course"), false);
+});
+
+void test("planProgressImport warns when the file is older than local progress", () => {
+  const plan = planProgressImport(
+    file([{ courseId: "course-a", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] }], "2026-02-02T00:00:00.000Z"),
+    [record("course-a", "l2", { updatedAt: "2026-07-07T00:00:00.000Z" })],
+    installedEverywhere,
+  );
+  assert.equal(plan.stale, true);
+  assert.equal(plan.fileExportedAt, "2026-02-02T00:00:00.000Z");
+  assert.equal(plan.localLatestProgressAt, "2026-07-07T00:00:00.000Z");
+});
+
+void test("planProgressImport does not warn for a newer file, an equally-old one, or an empty machine", () => {
+  const local = [record("course-a", "l1", { updatedAt: "2026-05-05T00:00:00.000Z" })];
+  const newer = planProgressImport(file([], "2026-06-06T00:00:00.000Z"), local, installedEverywhere);
+  assert.equal(newer.stale, false);
+
+  // Exactly as old as the newest local change: not older, so not a warning.
+  const same = planProgressImport(file([], "2026-05-05T00:00:00.000Z"), local, installedEverywhere);
+  assert.equal(same.stale, false);
+
+  // Nothing local at all — there is nothing an older file could shadow.
+  const empty = planProgressImport(file([], "1999-01-01T00:00:00.000Z"), [], installedEverywhere);
+  assert.equal(empty.stale, false);
+  assert.equal(empty.localLatestProgressAt, undefined);
+});
+
+void test("planProgressImport compares against the newest local change, not the first or the last row", () => {
+  const plan = planProgressImport(
+    file([], "2026-06-06T00:00:00.000Z"),
+    [
+      record("course-a", "l1", { updatedAt: "2026-08-08T00:00:00.000Z" }),
+      record("course-b", "l1", { updatedAt: "2026-02-02T00:00:00.000Z" }),
+    ],
+    installedEverywhere,
+  );
+  assert.equal(plan.localLatestProgressAt, "2026-08-08T00:00:00.000Z");
+  assert.equal(plan.stale, true);
+});
+
+void test("planProgressImport imports progress for courses that are not installed, and says which (clarify Q-009)", () => {
+  const plan = planProgressImport(
+    file([
+      { courseId: "installed-course", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] },
+      { courseId: "absent-course", installedVersion: "3.1.0", lessons: [lesson("l1", "2026-01-01T00:00:00.000Z")] },
+    ]),
+    [],
+    { isCourseInstalled: (courseId) => courseId === "installed-course" },
+  );
+
+  assert.deepEqual(plan.coursesNotInstalled, ["absent-course"]);
+  // Reported, not skipped: both courses' rows are planned for writing.
+  assert.deepEqual(
+    plan.records.map((entry) => entry.courseId),
+    ["installed-course", "absent-course"],
+  );
+  assert.equal(plan.totals.created, 2);
+  assert.equal(plan.courses[1]?.installed, false);
+  // The version the OTHER machine had installed travels with the file even
+  // though nothing here can match it yet.
+  assert.equal(plan.courses[1]?.fileVersion, "3.1.0");
+});
+
+void test("re-importing a machine's own export changes nothing (round trip)", () => {
+  const local = [
+    record("course-a", "l1", { completedAt: "2026-01-01T00:00:00.000Z" }),
+    record("course-b", "l2", { completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined }),
+  ];
+  const exported = buildProgressExport(local, {
+    installedVersion: () => "1.0.0",
+    exportedAt: "2026-09-09T00:00:00.000Z",
+  });
+
+  const plan = planProgressImport(exported, local, installedEverywhere);
+  assert.equal(plan.stale, false);
+  assert.deepEqual(plan.totals, { courses: 2, lessons: 2, created: 0, earlierCompletions: 0, unchanged: 2 });
+  assert.deepEqual(plan.records, []);
+});
+
+void test("importing into an empty machine restores everything the file holds", () => {
+  const source = [
+    record("course-a", "l1", { completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" }),
+    record("course-a", "l2", { completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined }),
+  ];
+  const exported = buildProgressExport(source, { installedVersion: () => "1.0.0" });
+
+  const plan = planProgressImport(exported, [], installedEverywhere);
+  assert.equal(plan.totals.created, 2);
+  assert.deepEqual(plan.records, [
+    { courseId: "course-a", lessonId: "l1", completedAt: "2026-01-01T00:00:00.000Z", courseVersion: "1.0.0" },
+    { courseId: "course-a", lessonId: "l2", completedAt: "2026-02-02T00:00:00.000Z", courseVersion: undefined },
+  ]);
+});
diff --git a/services/backend/src/transfer/import.ts b/services/backend/src/transfer/import.ts
new file mode 100644
index 0000000..30d4818
--- /dev/null
+++ b/services/backend/src/transfer/import.ts
@@ -0,0 +1,204 @@
+// Import: a parsed transfer file + the progress already on this machine ->
+// a plan describing exactly what the import would change, including the one
+// thing the product explicitly asks for — the warning that the chosen file is
+// OLDER than the local progress ("чтобы не затереть новые данные старыми",
+// business-logic.md).
+//
+// Planning is separated from writing on purpose. The endpoint
+// (routes/transfer.ts) builds the plan first, and when the plan says `stale`
+// it answers 409 WITHOUT writing anything, so the UI (task 016) can show the
+// warning and let the user confirm. Nothing about that flow needs a second
+// "preview" endpoint or a half-applied import.
+//
+// The merge itself is additive — an imported completion can only add a
+// completion or move one EARLIER in time (progress/repository.ts's
+// `importProgress`), never remove or un-complete anything. So a stale file is
+// not actually able to destroy newer progress; the confirmation exists
+// because the product wants the user told, and because "this file is from
+// before your last session" is usually a sign the wrong file was picked.
+//
+// Two product rules this module implements literally:
+//   - clarify Q-009: progress for courses that are NOT installed here is
+//     imported like any other and waits for the course to show up. It is
+//     counted and reported (`coursesNotInstalled`) so the UI can say so, but
+//     it is never skipped.
+//   - Q-010 / the progress model: a completion never un-completes, so a
+//     lesson already completed locally is `unchanged` unless the file knows
+//     an earlier completion time for it.
+
+import { progressKey } from "../progress/model.js";
+import type { ProgressRecord } from "../progress/model.js";
+import type { ImportProgressRecord } from "../progress/repository.js";
+import type { ProgressExportFile } from "./format.js";
+
+export type ImportOutcome =
+  /** No local row for this lesson: the completion is new here. */
+  | "created"
+  /** Already completed here, but the file knows an earlier completion time —
+   * the stored row's `completedAt` (and its recorded course version) moves
+   * back to the file's. */
+  | "earlier_completion"
+  /** Already completed here at the same time or earlier: nothing to do. */
+  | "unchanged";
+
+export interface PlannedCourseImport {
+  readonly courseId: string;
+  /** Whether this course is installed on THIS machine right now. `false`
+   * does not reduce what gets imported — see the header comment. */
+  readonly installed: boolean;
+  /** The version the exporting machine had installed, if the file says. */
+  readonly fileVersion?: string;
+  readonly lessons: number;
+  readonly created: number;
+  readonly earlierCompletions: number;
+  readonly unchanged: number;
+}
+
+export interface ProgressImportTotals {
+  readonly courses: number;
+  readonly lessons: number;
+  readonly created: number;
+  readonly earlierCompletions: number;
+  readonly unchanged: number;
+}
+
+export interface ProgressImportPlan {
+  /** The file's own "last saved" timestamp. */
+  readonly fileExportedAt: string;
+  /** The most recent moment local progress changed, or `undefined` when
+   * there is no local progress at all. */
+  readonly localLatestProgressAt?: string;
+  /** True when the file was exported BEFORE the newest local progress
+   * change — the case the product wants a warning for. Always false when
+   * there is no local progress: nothing can be older than nothing. */
+  readonly stale: boolean;
+  readonly totals: ProgressImportTotals;
+  /** Per course, in file order (which `parseProgressExport` preserves and
+   * `buildProgressExport` sorts by course id). */
+  readonly courses: readonly PlannedCourseImport[];
+  /** Ids of imported courses not installed here — the list the UI turns into
+   * "progress for 2 courses you don't have yet was saved". */
+  readonly coursesNotInstalled: readonly string[];
+  /**
+   * Exactly the rows that need writing: `created` and `earlier_completion`
+   * ones, never `unchanged` ones. Importing a file that changes nothing
+   * therefore writes nothing at all (no `updated_at` churn), which is what
+   * makes an export/import round trip provably a no-op.
+   */
+  readonly records: readonly ImportProgressRecord[];
+}
+
+export interface PlanProgressImportOptions {
+  /** Injected by routes/transfer.ts from the course registry — the planner
+   * must not depend on the content layer itself. */
+  readonly isCourseInstalled: (courseId: string) => boolean;
+}
+
+/**
+ * Computes what importing `file` would do to the progress described by
+ * `existing` (all local rows — `ProgressRepository#listAllProgress`).
+ *
+ * Pure: no I/O, no mutation, no throwing.
+ */
+export function planProgressImport(
+  file: ProgressExportFile,
+  existing: readonly ProgressRecord[],
+  options: PlanProgressImportOptions,
+): ProgressImportPlan {
+  const localByKey = new Map(existing.map((record) => [progressKey(record.courseId, record.lessonId), record]));
+
+  const courses: PlannedCourseImport[] = [];
+  const coursesNotInstalled: string[] = [];
+  const records: ImportProgressRecord[] = [];
+  let totalLessons = 0;
+  let totalCreated = 0;
+  let totalEarlier = 0;
+  let totalUnchanged = 0;
+
+  for (const course of file.courses) {
+    const installed = options.isCourseInstalled(course.courseId);
+    if (!installed) {
+      coursesNotInstalled.push(course.courseId);
+    }
+    let created = 0;
+    let earlierCompletions = 0;
+    let unchanged = 0;
+
+    for (const lesson of course.lessons) {
+      const local = localByKey.get(progressKey(course.courseId, lesson.lessonId));
+      const outcome = decideOutcome(local, lesson.completedAt);
+      if (outcome === "unchanged") {
+        unchanged += 1;
+        continue;
+      }
+      if (outcome === "created") {
+        created += 1;
+      } else {
+        earlierCompletions += 1;
+      }
+      records.push({
+        courseId: course.courseId,
+        lessonId: lesson.lessonId,
+        completedAt: lesson.completedAt,
+        courseVersion: lesson.courseVersion,
+      });
+    }
+
+    courses.push({
+      courseId: course.courseId,
+      installed,
+      fileVersion: course.installedVersion,
+      lessons: course.lessons.length,
+      created,
+      earlierCompletions,
+      unchanged,
+    });
+    totalLessons += course.lessons.length;
+    totalCreated += created;
+    totalEarlier += earlierCompletions;
+    totalUnchanged += unchanged;
+  }
+
+  const localLatestProgressAt = latestLocalChange(existing);
+  return {
+    fileExportedAt: file.exportedAt,
+    localLatestProgressAt,
+    stale:
+      localLatestProgressAt !== undefined &&
+      Date.parse(file.exportedAt) < Date.parse(localLatestProgressAt),
+    totals: {
+      courses: file.courses.length,
+      lessons: totalLessons,
+      created: totalCreated,
+      earlierCompletions: totalEarlier,
+      unchanged: totalUnchanged,
+    },
+    courses,
+    coursesNotInstalled,
+    records,
+  };
+}
+
+function decideOutcome(local: ProgressRecord | undefined, importedCompletedAt: string): ImportOutcome {
+  if (local === undefined) {
+    return "created";
+  }
+  return Date.parse(importedCompletedAt) < Date.parse(local.completedAt) ? "earlier_completion" : "unchanged";
+}
+
+/**
+ * The newest `updatedAt` across all local rows — "when progress on this
+ * computer last changed". `updatedAt` rather than `completedAt` on purpose:
+ * a row touched after its completion (a repeat pass refreshing the recorded
+ * course version) is still a local change the user made after the file they
+ * are about to import was written.
+ */
+function latestLocalChange(existing: readonly ProgressRecord[]): string | undefined {
+  let latest: string | undefined;
+  for (const record of existing) {
+    if (latest === undefined || Date.parse(record.updatedAt) > Date.parse(latest)) {
+      latest = record.updatedAt;
+    }
+  }
+  return latest;
+}
```

## Untracked files (new, not yet added)

(none)
