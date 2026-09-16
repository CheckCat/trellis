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

export interface CoursePractice {
  readonly sandbox: string;
  readonly prompt: string;
  readonly check?: string;
}

export interface CourseSandbox {
  readonly id: string;
  readonly type: "postgres";
  /** Relative paths from the package directory, already validated to exist
   * and stay inside the package (see validate.ts's resolveSafePath) — not
   * read here; task 009 reads/executes their content against the sandbox
   * role. */
  readonly seed: readonly string[];
}

/** validate.ts's success output: structurally + semantically valid, but
 * lesson content is still a path (`contentPath`), not yet read — reading
 * Markdown off disk is loader.ts's job, not validate.ts's (see task-006
 * brief, requirement 2 vs 3). */
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
  /** Absolute path to the package directory on disk (e.g. so task 009 can
   * resolve `sandboxes[].seed[]` paths). */
  readonly dir: string;
  readonly sandboxes: readonly CourseSandbox[];
  readonly modules: readonly CourseModule[];
}

export type LoadResult =
  | { readonly ok: true; readonly course: Course }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };
