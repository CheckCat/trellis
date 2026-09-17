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
