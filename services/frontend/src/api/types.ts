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

export interface PublicPractice {
  sandbox: string;
  prompt: string;
}

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
