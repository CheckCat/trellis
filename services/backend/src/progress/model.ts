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
