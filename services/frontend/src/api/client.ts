import type {
  ApiErrorResponse,
  CourseDetailResponse,
  CourseProgressResponse,
  CoursesListResponse,
  HealthResponse,
  ImportResult,
  LessonCompletionResponse,
  LessonDetailResponse,
  PracticeAnswerResponse,
  PracticeRunResponse,
  ProgressExportFile,
  QuizAnswerResponse,
  SandboxStatus,
} from "./types";

/**
 * Thrown for any non-2xx response. Carries the parsed JSON body (when the
 * response had one) so callers that care about the specific `error` code
 * (e.g. `course_not_found`) can branch on it instead of parsing `.message`.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(isApiErrorBody(body) ? body.message : `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Partial<ApiErrorResponse>).error === "string" &&
    typeof (body as Partial<ApiErrorResponse>).message === "string"
  );
}

/**
 * Single fetch chokepoint for the whole app. Always relative and always
 * prefixed with `/api` — the dev-proxy (vite.config.ts) and the production
 * nginx.conf both strip that prefix before forwarding to the backend, so
 * this code never needs to know the backend's actual host/port (task-004
 * report's "как ходить в API" — this client just wraps that same contract,
 * doesn't change it).
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const rawBody = await response.text();
  // Every endpoint here returns JSON or nothing (no empty-200 route
  // currently exists, but this keeps the client from throwing on one).
  const body: unknown = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body as T;
}

/**
 * Typed surface for the backend HTTP API. Grows as later tasks (013+) need
 * more endpoints (progress, quiz, practice, transfer) — add methods here
 * rather than calling `fetch` directly from a component, so the `/api`
 * prefix and error handling stay in one place.
 */
export const api = {
  getHealth: (): Promise<HealthResponse> => apiFetch<HealthResponse>("/health"),

  listCourses: (): Promise<CoursesListResponse> => apiFetch<CoursesListResponse>("/courses"),

  getCourse: (courseId: string): Promise<CourseDetailResponse> =>
    apiFetch<CourseDetailResponse>(`/courses/${encodeURIComponent(courseId)}`),

  getCourseProgress: (courseId: string): Promise<CourseProgressResponse> =>
    apiFetch<CourseProgressResponse>(`/courses/${encodeURIComponent(courseId)}/progress`),

  getLesson: (courseId: string, lessonId: string): Promise<LessonDetailResponse> =>
    apiFetch<LessonDetailResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
    ),

  completeLesson: (courseId: string, lessonId: string): Promise<LessonCompletionResponse> =>
    apiFetch<LessonCompletionResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
      { method: "POST" },
    ),

  answerQuiz: (courseId: string, lessonId: string, optionId: string): Promise<QuizAnswerResponse> =>
    apiFetch<QuizAnswerResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/quiz/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      },
    ),

  runPractice: (courseId: string, lessonId: string, sql: string): Promise<PracticeRunResponse> =>
    apiFetch<PracticeRunResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/practice/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      },
    ),

  submitPracticeAnswers: (
    courseId: string,
    lessonId: string,
    answers: Record<string, string>,
  ): Promise<PracticeAnswerResponse> =>
    apiFetch<PracticeAnswerResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/practice/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Values go over as typed, never pre-parsed: reading "18,5" as a
        // number is the backend's rule (practice/answer.ts), and doing it
        // here too would be a second implementation of it, free to drift.
        body: JSON.stringify({ answers }),
      },
    ),

  resetSandbox: (courseId: string, sandboxId: string): Promise<SandboxStatus> =>
    apiFetch<SandboxStatus>(`/courses/${encodeURIComponent(courseId)}/sandbox/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId }),
    }),

  exportProgress: (): Promise<ProgressExportFile> => apiFetch<ProgressExportFile>("/progress/export"),

  /**
   * `POST /progress/import`. `confirm: true` answers the "this file is
   * older than what's here" warning — omit it (or pass `false`) for the
   * first attempt; a stale file that would actually change something comes
   * back as a rejected promise (`ApiError`, `status === 409`) whose `body`
   * is an `ImportStaleWarning` (see api/types.ts), not a success value —
   * callers must retry with `{ confirm: true }` to apply it.
   */
  importProgress: (file: ProgressExportFile, options?: { confirm?: boolean }): Promise<ImportResult> =>
    apiFetch<ImportResult>(`/progress/import${options?.confirm === true ? "?confirm=true" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    }),
};
