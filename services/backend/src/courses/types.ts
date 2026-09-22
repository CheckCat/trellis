// Domain types for course content packages. Shared by validate.ts (structural
// + semantic validation), loader.ts (reading manifest.yaml + lesson Markdown
// off disk) and registry.ts/routes/courses.ts (serving the result). Kept in
// one file because all three modules need the exact same shapes — splitting
// them per-module would just add re-export indirection for no benefit.

/** One validation problem, always carrying a manifest-relative path (e.g.
 * `modules[1].lessons[0].quiz.options`, or `""` for the manifest as a
 * whole) so a broken course's rejection reason can be shown verbatim by the
 * API/logs — never "first error and done", see loader.ts/registry.ts. */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface CourseQuizOption {
  readonly id: string;
  readonly text: string;
  /** Always present in the validated domain model (true/false), even though
   * the manifest may omit `correct` on incorrect options — see validate.ts. */
  readonly correct: boolean;
  readonly explanation?: string;
}

export interface CourseQuiz {
  readonly question: string;
  readonly options: readonly CourseQuizOption[];
}

/**
 * Which kind of practice assignment this is — the discriminator of
 * `CoursePractice` below, and the thing that decides which endpoint grades
 * it. Normalized by validate.ts: always present in the domain model, even
 * though a manifest that predates the second kind omits it.
 *
 * Re-exported from capabilities.ts rather than declared here: a practice
 * kind exists only if it is registered there (project invariant), and two
 * declarations of the same union could disagree.
 */
import type { AnswerFieldKind, SandboxType } from "../capabilities.js";

export type { AnswerFieldKind, CoursePracticeType, SandboxType } from "../capabilities.js";

/**
 * A practice assignment done in a course SANDBOX: the learner writes SQL,
 * the engine runs it and grades it.
 *
 * Both grading mechanics are optional and independent (an assignment may
 * carry neither, one, or both); when both are present, the lesson is only
 * completed when both pass — see routes/practice.ts. With neither, the
 * lesson is self-marked.
 */
export interface CourseSqlPractice {
  readonly type: "sql";
  readonly prompt: string;
  readonly sandbox: string;
  /** SQL over the sandbox's STATE, answering one boolean: was the exercise
   * done? The only way to grade an assignment that changes the database. */
  readonly check?: string;
  /** Reference SQL whose RESULT SET the learner's own result is compared
   * against — the only way to grade a `SELECT`, which leaves no state
   * behind to check (practice/compare.ts). Like `check`, it is the answer
   * to the exercise and never leaves the backend. */
  readonly expected?: string;
  /** Whether row order matters in that comparison. Normalized by
   * validate.ts: present (as `true`/`false`) exactly when `expected` is,
   * absent otherwise — the manifest may omit it, the domain model may not
   * leave "default false" implicit. */
  readonly ordered?: boolean;
  /**
   * The author's own SQL solution to the exercise. The engine runs it on
   * the seeded sandbox, runs the learner's SQL on an identical one, and
   * compares the two resulting STATES (practice/state.ts).
   *
   * The strict mechanic for assignments that change data: where `check`
   * grades only the predicate its author thought to write, this grades
   * everything, including the rows the assignment never mentions. Like
   * `check` and `expected`, it is the answer to the exercise and never
   * leaves the backend.
   */
  readonly solution?: string;
}

/** One value the learner is asked to report back in an `answer` practice. */
export interface CourseAnswerField {
  readonly id: string;
  readonly label: string;
  readonly kind: AnswerFieldKind;
  /** The right answer: a `number` for `kind: "number"`, a string for
   * `kind: "text"` (validate.ts enforces the agreement). Never leaves the
   * backend — same rule as a quiz's `correct` and a practice's `check`. */
  readonly expected: number | string;
  /** `kind: "number"` only. Absolute tolerance, normalized by validate.ts
   * to a present number exactly when the field is numeric (the manifest's
   * default is 0 — exact equality). */
  readonly tolerance?: number;
}

/**
 * A practice assignment done OUTSIDE the platform — in Excel, in a BI
 * dashboard, on paper. There is no sandbox and nothing to execute: the
 * learner types in the values they arrived at and the engine compares them
 * with the course's own. The process is not graded, the result is.
 */
export interface CourseAnswerPractice {
  readonly type: "answer";
  readonly prompt: string;
  /** At least one, with unique ids (validate.ts). Order is display order. */
  readonly fields: readonly CourseAnswerField[];
}

/**
 * A lesson's practice assignment. A discriminated union rather than one
 * widened shape: `sandbox` is meaningless for an `answer` assignment and
 * `fields` is meaningless for a `sql` one, and making the compiler say so
 * is what keeps a third mechanic from quietly inheriting either.
 */
export type CoursePractice = CourseSqlPractice | CourseAnswerPractice;

export interface CourseSandbox {
  readonly id: string;
  readonly type: SandboxType;
  /** Absolute, realpath'd filesystem paths — the output of validate.ts's
   * exported `resolveSafePath`, already confirmed to exist and to stay
   * inside the package directory (symlink escapes included). NOT the raw
   * relative strings written in the manifest, and NOT read here — task 009
   * reads/executes this content directly against the sandbox role. Because
   * a scan can be arbitrarily old by the time 009 acts on it (no
   * filesystem watcher — rescanning is explicit), 009 is expected to call
   * `resolveSafePath` again immediately before executing a seed file, as a
   * defense against the file having changed since this path was resolved
   * (final review, backend fixes round). */
  readonly seed: readonly string[];
}

/** validate.ts's success output: structurally + semantically valid.
 * `contentPath`, when present, is the absolute, realpath'd, ALREADY
 * VALIDATED path to the lesson's Markdown file (same guarantee as
 * `CourseSandbox.seed` above) — not yet read, though: reading Markdown off
 * disk is loader.ts's job, not validate.ts's (see task-006 brief,
 * requirement 2 vs 3). */
export interface ValidatedLesson {
  readonly id: string;
  readonly title: string;
  readonly contentPath?: string;
  readonly quiz?: CourseQuiz;
  readonly practice?: CoursePractice;
}

export interface ValidatedModule {
  readonly id: string;
  readonly title: string;
  readonly lessons: readonly ValidatedLesson[];
}

export interface ValidatedManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description?: string;
  readonly sandboxes: readonly CourseSandbox[];
  readonly modules: readonly ValidatedModule[];
}

export type ValidationResult =
  | { readonly ok: true; readonly manifest: ValidatedManifest }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

/** loader.ts's output: same shape as ValidatedLesson, but `contentPath` has
 * been read into `content` — the actual Markdown text, handed back as-is
 * (rendering happens on the frontend). */
export interface CourseLesson {
  readonly id: string;
  readonly title: string;
  readonly content?: string;
  readonly quiz?: CourseQuiz;
  readonly practice?: CoursePractice;
}

export interface CourseModule {
  readonly id: string;
  readonly title: string;
  readonly lessons: readonly CourseLesson[];
}

export interface Course {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description?: string;
  /** Absolute path to the package directory on disk, as written under
   * `coursesDir` (not realpath'd — this is "which directory did this come
   * from", used e.g. for duplicate-id messages in registry.ts). Not needed
   * to resolve `sandboxes[].seed[]`/lesson content anymore — those are
   * already absolute, validated paths in their own right (see
   * `CourseSandbox.seed`/`ValidatedLesson.contentPath`'s doc comments). */
  readonly dir: string;
  readonly sandboxes: readonly CourseSandbox[];
  readonly modules: readonly CourseModule[];
}

export type LoadResult =
  | { readonly ok: true; readonly course: Course }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };
