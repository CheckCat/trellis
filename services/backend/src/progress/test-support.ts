// Test-only helpers for the progress domain, shared by routes/progress.test.ts
// and routes/quiz.test.ts (and reconcile.test.ts's fixtures). Kept out of the
// production build exactly like courses/test-support.ts and db/test-support.ts
// — see tsconfig.json's `exclude`.
//
// Everything here is synthetic: no real course's ids, titles or content (the
// core, and its tests, know nothing about any specific course).

import fs from "node:fs";

import type { FastifyInstance } from "fastify";

import { createCourseRegistry } from "../courses/registry/index.js";
import { makeTempDir, writeCoursePackage, type FixtureFile } from "../courses/test-support.js";
import type { Course } from "../courses/types.js";
import type { AppPool } from "../db/pool/index.js";
import { buildServer } from "../server/index.js";
import { progressKey } from "./model/index.js";
import type { ProgressRecord } from "./model/index.js";
import type { ImportProgressRecord, MarkLessonCompletedInput, ProgressRepository } from "./repository/index.js";

/**
 * An in-memory `ProgressRepository` with the same observable contract as the
 * Postgres one: completion is idempotent, a repeat pass keeps the original
 * `completedAt` and refreshes `updatedAt`/`courseVersion`, and the only way
 * rows ever disappear is a whole-course `resetCourseProgress`. Route tests use this so they exercise real routing,
 * real schemas and real reconciliation without a database.
 *
 * `seed` pre-loads rows (e.g. progress for a lesson the course no longer
 * has). `records()` exposes the stored state for assertions — that a wrong
 * quiz answer wrote nothing at all, for instance.
 */
export function createInMemoryProgressRepository(seed: readonly ProgressRecord[] = []): ProgressRepository & {
  records(): ProgressRecord[];
} {
  const rows = new Map<string, ProgressRecord>(seed.map((record) => [progressKey(record.courseId, record.lessonId), record]));
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
      const existing = rows.get(progressKey(courseId, lessonId));
      const now = nextTimestamp();
      const record: ProgressRecord = {
        courseId,
        lessonId,
        status: "completed",
        courseVersion,
        completedAt: existing?.completedAt ?? now,
        updatedAt: now,
      };
      rows.set(progressKey(courseId, lessonId), record);
      return record;
    },

    // Mirrors the SQL merge in repository.ts exactly (task 010): the EARLIER
    // completion wins, the course version travels with the completion time
    // it belongs to, nothing is ever deleted, and an empty input writes
    // nothing.
    async importProgress(records: readonly ImportProgressRecord[]): Promise<ProgressRecord[]> {
      // The real repository rejects a duplicated (course, lesson) pair rather
      // than letting Postgres abort the statement; mirrored here so a test
      // that passes one sees the same failure, not a silently-applied second
      // write.
      const seen = new Set<string>();
      for (const record of records) {
        const dedupKey = progressKey(record.courseId, record.lessonId);
        if (seen.has(dedupKey)) {
          throw new Error(
            `Cannot import two completions for the same lesson: course "${record.courseId}", lesson ` +
              `"${record.lessonId}" appears more than once. Merge them before calling importProgress.`,
          );
        }
        seen.add(dedupKey);
      }
      return records.map((incoming) => {
        const existing = rows.get(progressKey(incoming.courseId, incoming.lessonId));
        const takesIncoming =
          existing === undefined || Date.parse(incoming.completedAt) < Date.parse(existing.completedAt);
        // A losing incoming record (existing is defined and not later than
        // it) is a true no-op: it does not donate its courseVersion to a
        // locally-null one, and it does not touch updatedAt — mirrors
        // repository.ts's SQL merge exactly (fix round 2, finding 2).
        if (!takesIncoming && existing !== undefined) {
          return existing;
        }
        const record: ProgressRecord = {
          courseId: incoming.courseId,
          lessonId: incoming.lessonId,
          status: "completed",
          courseVersion: incoming.courseVersion ?? existing?.courseVersion,
          completedAt: incoming.completedAt,
          updatedAt: nextTimestamp(),
        };
        rows.set(progressKey(record.courseId, record.lessonId), record);
        return record;
      });
    },

    // Mirrors repository.ts: a whole course at a time, orphaned rows of that
    // course included, other courses untouched.
    async resetCourseProgress(courseId: string): Promise<number> {
      let deleted = 0;
      for (const [key, record] of [...rows.entries()]) {
        if (record.courseId === courseId) {
          rows.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },

    records(): ProgressRecord[] {
      return [...rows.values()];
    },
  };
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
              multiple: false,
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
          { id: "b1", title: "Lesson b1", practice: { type: "sql", sandbox: "main", prompt: "Do it.", check: "select true" } },
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
