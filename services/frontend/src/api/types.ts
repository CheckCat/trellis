// Response shapes for the backend HTTP API. Mirrors the JSON Schemas in
// services/backend/src/routes/*.ts byte-for-byte (fields, optionality) — do
// not widen/narrow a type here without checking the matching schema first,
// or the client silently drifts from what the server actually sends.

/** GET /health — see routes/health.ts. 200 and 503 share the same shape
 * (both fields always present), only the enum values differ. */
export interface HealthResponse {
  status: "ok" | "degraded";
  db: "ok" | "down";
}

/** One entry of GET /courses's `courses` array (routes/courses.ts,
 * `courseSummarySchema`). `description` is optional in the schema. */
export interface CourseSummary {
  id: string;
  version: string;
  title: string;
  description?: string;
}

export interface CoursesListResponse {
  courses: CourseSummary[];
}

/** A lesson as it appears inside a course's module tree (`GET
 * /courses/:courseId`) — summary only, no content/quiz/practice bodies.
 * Task 013's lesson page fetches those separately via
 * `GET /courses/:courseId/lessons/:lessonId`. */
export interface CourseLessonSummary {
  id: string;
  title: string;
  hasContent: boolean;
  hasQuiz: boolean;
  hasPractice: boolean;
}

export interface CourseModuleSummary {
  id: string;
  title: string;
  lessons: CourseLessonSummary[];
}

/** GET /courses/:courseId — routes/courses.ts, `courseDetailResponseSchema`. */
export interface CourseDetailResponse {
  id: string;
  version: string;
  title: string;
  description?: string;
  modules: CourseModuleSummary[];
}

/** Every 4xx/5xx JSON body this API sends follows this shape
 * (`notFoundResponseSchema` and friends across routes/*.ts). */
export interface ApiErrorResponse {
  error: string;
  message: string;
}

/** A quiz option as the API exposes it — `correct`/`explanation`-per-wrong-
 * option are stripped server-side (routes/courses.ts's `toLessonResponse`),
 * so this type must never gain those fields. */
export interface PublicQuizOption {
  id: string;
  text: string;
}

export interface PublicQuiz {
  question: string;
  options: PublicQuizOption[];
}

/** A practice assignment done in the course's SQL sandbox. */
export interface PublicSqlPractice {
  type: "sql";
  prompt: string;
  sandbox: string;
}

/** One value an `answer` assignment asks the learner to report. `kind`
 * decides how the input behaves; the right answer stays on the server. */
export interface PublicAnswerField {
  id: string;
  label: string;
  kind: "number" | "text";
}

/** A practice assignment done outside the platform (Excel, a BI
 * dashboard): the learner types in the values they got, and the backend
 * compares them with the course's own. No sandbox is involved. */
export interface PublicAnswerPractice {
  type: "answer";
  prompt: string;
  fields: PublicAnswerField[];
}

/** Discriminated on `type` — a lesson carries exactly one kind, and each
 * has its own submit endpoint (`practice/run` vs `practice/answer`). */
export type PublicPractice = PublicSqlPractice | PublicAnswerPractice;

/** GET /courses/:courseId/lessons/:lessonId — routes/courses.ts,
 * `lessonResponseSchema`. `content` is the lesson's Markdown body (may be
 * absent for a quiz/practice-only lesson — mirrors `hasContent` on the
 * summary shapes above). */
export interface LessonDetailResponse {
  id: string;
  title: string;
  content?: string;
  quiz?: PublicQuiz;
  practice?: PublicPractice;
}

/** How a lesson is allowed to become `completed` — routes/progress.ts /
 * progress/model.ts's `LessonCompletionMode`. `manual` is the only mode the
 * "mark as done" button is allowed to act on; `quiz`/`practice` are earned
 * elsewhere and the backend 409s a manual-complete attempt against them. */
export type LessonCompletionMode = "manual" | "quiz" | "practice";

export type LessonStatus = "completed" | "not_started";

/** One lesson inside `GET /courses/:courseId/progress` — routes/progress.ts,
 * `lessonProgressSchema`. */
export interface LessonProgress {
  id: string;
  title: string;
  status: LessonStatus;
  /** Present only when `status === "completed"`. */
  completedAt?: string;
  completionMode: LessonCompletionMode;
  hasContent: boolean;
  hasQuiz: boolean;
  hasPractice: boolean;
}

export interface ModuleProgress {
  id: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
  completed: boolean;
  lessons: LessonProgress[];
}

/** A stored completion whose lesson no longer exists in the course as
 * installed right now (`orphanedProgressSchema`) — diagnostic only. */
export interface OrphanedProgress {
  lessonId: string;
  completedAt: string;
  courseVersion?: string;
}

/** GET /courses/:courseId/progress — routes/progress.ts,
 * `courseProgressResponseSchema`. The course tree joined with per-lesson
 * completion status; this is what course/lesson navigation renders from,
 * not `CourseDetailResponse` (which has no status). */
export interface CourseProgressResponse {
  courseId: string;
  courseVersion: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
  completed: boolean;
  modules: ModuleProgress[];
  orphanedLessons: OrphanedProgress[];
  recordedVersions: string[];
}

/** Response shape shared by both progress-mutating routes
 * (`lessonCompletionResponseSchema`) — the affected lesson's fresh status
 * plus the course's counters, so the caller never needs a second request to
 * redraw "N of M done" after marking something. */
export interface LessonCompletionResponse {
  lesson: LessonProgress;
  course: {
    courseId: string;
    courseVersion: string;
    totalLessons: number;
    completedLessons: number;
    completed: boolean;
  };
}

/** POST /courses/:courseId/lessons/:lessonId/quiz/answer — routes/quiz.ts's
 * `quizAnswerResponseSchema`. Deliberately carries no way to learn which
 * option is correct beyond `correct`/`explanation` for the option the
 * caller itself submitted (the endpoint's own docstring: "the client learns
 * exactly one bit... plus that option's own explanation") — never widen
 * this type with a per-option verdict map or the correct option's id. */
export interface QuizAnswerResponse {
  correct: boolean;
  /** Present only when the submitted option itself has an explanation
   * (`CourseQuizOption.explanation` is optional server-side). */
  explanation?: string;
  lesson: LessonProgress;
  course: LessonCompletionResponse["course"];
}

/** One column of a practice SQL result (`practiceColumnSchema`,
 * routes/practice.ts). `dataTypeId` is Postgres' own OID for the column's
 * type — not rendered directly by this task's UI, kept for a future task
 * that might want type-aware formatting. */
export interface PracticeColumn {
  name: string;
  dataTypeId: number;
}

/** A successful practice run's result set (`practiceResultSchema`). Cells
 * are always `string | null` — never numbers/objects — because the backend
 * stringifies every value itself (bigints past 2^53, bytea, jsonb, arrays)
 * to avoid JSON's own lossy number type; `null` means SQL NULL, never the
 * string `"null"`. Rows are arrays positional to `columns`, not objects
 * keyed by column name — `select 1 as a, 2 as a` is valid SQL with two
 * columns named `a`, and an object would silently drop one. */
export interface PracticeResultSet {
  /** Absent for some commands (e.g. multi-statement runs where Postgres
   * reports no command tag) — see practice/execute.ts. */
  command?: string;
  /** `null` when Postgres reports no row count for the command; never a
   * placeholder `0`. */
  rowCount: number | null;
  columns: PracticeColumn[];
  rows: (string | null)[][];
  /** `true` when the result had more rows than the server's cap
   * (`MAX_RESULT_ROWS`, 200) — `rows` holds only the first 200 in that case,
   * while `rowCount` still reports the true total. */
  truncated: boolean;
  /** How many SQL statements were in the submitted text; multi-statement
   * runs are allowed, `result`/`error` describe only the last one. */
  statementCount: number;
}

/** Postgres' own error fields, passed through as-is
 * (`practiceSqlErrorSchema`) — never rewritten or summarized, per the
 * project invariant "ошибка Postgres показывается как есть". Every field
 * but `message` may be absent (not every error carries a `hint`, etc.). */
export interface PracticeSqlError {
  message: string;
  severity?: string;
  code?: string;
  detail?: string;
  hint?: string;
  /** 1-based character offset into the submitted SQL, as a string (matches
   * `pg`'s own `position` field) — usable to place a caret in the editor. */
  position?: string;
  where?: string;
}

/** Whether the lesson's check query ran and, if so, what it said
 * (`practiceCheckSchema`). `present: false` means the lesson has no check;
 * `passed` is only present when `present` is `true`. A lesson is
 * self-marked (the "mark as done" control) only when neither `check` nor
 * `expected` is present. */
export interface PracticeCheckResult {
  present: boolean;
  passed?: boolean;
}

/**
 * The other grading mechanic (`practiceExpectedSchema`): the learner's
 * result set compared with the course's reference query. `present: false`
 * means the lesson declares no reference query.
 *
 * `passed` and `reason` are both absent — not `false` — when the learner's
 * own SQL errored: there were no rows to compare, so the comparison never
 * ran. `reason` explains a failure in counts and positions only
 * («ожидалось строк: 19, получено: 22»); the reference query itself never
 * reaches the client.
 */
export interface PracticeExpectedResult {
  present: boolean;
  passed?: boolean;
  reason?: string;
}

/** POST /courses/:courseId/lessons/:lessonId/practice/run —
 * routes/practice.ts's `practiceRunResponseSchema`. Always 200 for a bad
 * SQL statement (`ok: false` + `error`, same class of decision as a wrong
 * quiz answer) — 4xx/5xx from this endpoint mean the *request itself* was
 * rejected (course/lesson/practice not found, a broken check query, or an
 * unreachable sandbox), which surfaces as `ApiError`, not this shape. */
export interface PracticeRunResponse {
  ok: boolean;
  /** Present iff `ok` is `true`. */
  result?: PracticeResultSet;
  /** Present iff `ok` is `false`. */
  error?: PracticeSqlError;
  durationMs: number;
  check: PracticeCheckResult;
  expected: PracticeExpectedResult;
  lesson: LessonProgress;
  course: LessonCompletionResponse["course"];
}

/** POST /courses/:courseId/lessons/:lessonId/practice/answer —
 * routes/practice.ts's `practiceAnswerResponseSchema`. `fields` carries one
 * entry per DECLARED field (keyed by field id), including fields the
 * learner left blank — a blank is marked wrong, not omitted. `ok` is true
 * only when every field is correct, which is also what completes the
 * lesson. Nothing here says what the right answer was. */
export interface PracticeAnswerResponse {
  ok: boolean;
  fields: Record<string, { correct: boolean }>;
  lesson: LessonProgress;
  course: LessonCompletionResponse["course"];
}

/** GET /courses/:courseId/sandbox and POST /courses/:courseId/sandbox/reset
 * — routes/sandbox.ts's `sandboxStatusResponseSchema`. Fields beyond
 * `active` are only present when `active` is `true`. */
export interface SandboxStatus {
  active: boolean;
  courseId?: string;
  sandboxId?: string;
  type?: string;
  seedFiles?: string[];
  readyAt?: string;
}

/** One lesson entry inside a progress export/import file
 * (`transfer/format.ts`'s `ExportedLessonProgress`). `status` is always
 * `"completed"` — a progress file never carries "not started" rows, that's
 * the absence of an entry. */
export interface ExportedLessonProgress {
  lessonId: string;
  status: "completed";
  completedAt: string;
  /** Provenance only — never used to match rows on import. */
  courseVersion?: string;
}

/** One course's worth of progress inside the file
 * (`transfer/format.ts`'s `ExportedCourseProgress`). `installedVersion` is
 * absent when the exporting machine didn't have this course installed. */
export interface ExportedCourseProgress {
  courseId: string;
  installedVersion?: string;
  lessons: ExportedLessonProgress[];
}

/** GET /progress/export's response body, and POST /progress/import's
 * request body verbatim (`transfer/format.ts`'s `ProgressExportFile`). Carries
 * progress only — no lesson titles, no module structure, no quiz/practice
 * content (project invariant: course content and progress are separate
 * entities). This is the file this app's UI saves to/reads from disk. */
export interface ProgressExportFile {
  format: string;
  formatVersion: number;
  /** ISO 8601 UTC — when this file was produced. Compared against the
   * importing machine's own progress to decide whether the file is stale. */
  exportedAt: string;
  courses: ExportedCourseProgress[];
}

/** Per-course counters inside an import result (`routes/transfer.ts`'s
 * `importCourseSchema`). `fileVersion` is the file's own
 * `installedVersion` for this course, absent if the file never installed
 * it either. */
export interface ImportCourseSummary {
  courseId: string;
  /** Whether this course is installed on THIS (importing) machine right
   * now — not whether it was installed where the file was made. */
  installed: boolean;
  fileVersion?: string;
  lessons: number;
  created: number;
  earlierCompletions: number;
  unchanged: number;
}

/** Aggregate counters across every course in the file
 * (`routes/transfer.ts`'s `importResultSchema.summary`). */
export interface ImportTotals {
  courses: number;
  lessons: number;
  created: number;
  earlierCompletions: number;
  unchanged: number;
}

/** Shared body shape of both `POST /progress/import` outcomes
 * (`routes/transfer.ts`'s `toImportPayload`) — a 200 with `applied: true`,
 * or a 409 with `applied: false` (see `ImportStaleWarning` below for the
 * 409's extra `error`/`message` fields). `records` is deliberately not
 * part of this — the server never echoes the file's contents back. */
export interface ImportResult {
  applied: boolean;
  /** `true` when the file's `exportedAt` is older than this machine's
   * newest local progress change. Reported even when `applied` is `true`
   * (a confirmed stale import) — it is information either way. */
  stale: boolean;
  fileExportedAt: string;
  /** Absent only when this machine has no progress at all yet. */
  localLatestProgressAt?: string;
  summary: ImportTotals;
  courses: ImportCourseSummary[];
  coursesNotInstalled: string[];
}

/** `POST /progress/import`'s 409 body — `ImportResult` (`applied: false`)
 * plus the warning to show the user before they decide whether to repeat
 * the request with `?confirm=true`. Surfaces as `ApiError.body` when
 * `ApiError.status === 409`. */
export interface ImportStaleWarning extends ImportResult {
  error: "import_older_than_local";
  message: string;
}

/** `POST /progress/import`'s 400 body — the picked file is not a readable
 * Trellis progress export (`routes/transfer.ts`'s `importRejectionSchema`).
 * Surfaces as `ApiError.body` when `ApiError.status === 400`. `problems` is
 * always non-empty, one human-readable sentence per issue found. */
export interface ImportRejection {
  error: string;
  message: string;
  problems: string[];
}
