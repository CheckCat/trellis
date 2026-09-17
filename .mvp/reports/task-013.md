## Task 013 — навигация по курсу, Markdown-контент урока, отметка «пройдено» — отчёт

## Новые файлы

- `services/frontend/src/features/course/CoursePage.tsx` — `export function
  CoursePage({ courseId }: { courseId: string })`. Fetches `GET
  /courses/:courseId/progress` (`api.getCourseProgress`, not
  `CourseDetailResponse` — that shape has no status) via
  `useQuery(["courseProgress", courseId], ...)`. Renders title, "N / M
  уроков пройдено", and `<ModuleList>`. 404 → "Курс «id» не найден.", any
  other error → "Не удалось загрузить курс." (same narrowing pattern task
  011's fix round established: only `error instanceof ApiError &&
  error.status === 404`).
- `services/frontend/src/features/course/ModuleList.tsx` — `export function
  ModuleList({ courseId, modules }: { courseId: string; modules: readonly
  ModuleProgress[] })`. Pure/presentational, no data fetching. Renders each
  module's title + counters, and each lesson as `<Link to="/courses/$courseId
  /lessons/$lessonId" params={{ courseId, lessonId }}>` showing the lesson
  title and a status badge ("Пройден" / "Не начат").
- `services/frontend/src/features/lesson/LessonView.tsx` — `export function
  LessonView({ courseId, lessonId }: { courseId: string; lessonId: string
  })`. Two queries: `["lesson", courseId, lessonId]` via `api.getLesson`
  (Markdown body) and `["courseProgress", courseId]` via
  `api.getCourseProgress` (status + `completionMode` for this lesson, same
  `queryKey` `CoursePage` uses — one cache entry for both). Renders
  `<Markdown>`, then:
  - `completionMode !== "manual"` → note explaining the lesson is earned via
    quiz/practice (no button — avoids ever triggering the backend's 409 on a
    manual-complete attempt against a graded lesson).
  - `completionMode === "manual" && !completed` → "Отметить пройденным"
    button, `useMutation(() => api.completeLesson(courseId, lessonId))` on
    click; `onSuccess` invalidates `["courseProgress", courseId]` so both
    this page and `CoursePage`'s cache (if visited again) redraw from one
    fresh fetch.
  - `completionMode === "manual" && completed` → "Урок отмечен как
    пройденный." (no button).
  - Both queries' error → 404 (either) shows "Урок «id» не найден.", other
    failures show "Не удалось загрузить урок."
- `services/frontend/src/features/lesson/Markdown.tsx` — `export function
  Markdown({ source }: { source: string })`. Wraps `react-markdown`
  (CommonMark only, no `rehype-raw`) — never `dangerouslySetInnerHTML`,
  confirmed by a test that embedded `<script>` never executes. Wrapping
  `<div className="lesson-content">`.
- Test files (one per component above, `*.test.tsx` beside each): happy +
  error + edge case per file, all through `createAppRouter` +
  `QueryClientProvider` (`Link`s need real router context — same pattern
  App.test.tsx and task-011's report document), except `Markdown.test.tsx`
  which needs neither (no routing/query inside it).

## Files changed

- `services/frontend/src/api/types.ts` — added `PublicQuizOption`,
  `PublicQuiz`, `PublicPractice`, `LessonDetailResponse` (GET
  `/courses/:courseId/lessons/:lessonId`), `LessonCompletionMode`,
  `LessonStatus`, `LessonProgress`, `ModuleProgress`, `OrphanedProgress`,
  `CourseProgressResponse` (GET `/courses/:courseId/progress`),
  `LessonCompletionResponse` (POST
  `/courses/:courseId/lessons/:lessonId/complete`). All mirror
  `services/backend/src/routes/{courses,progress}.ts`'s JSON Schemas
  field-for-field, same convention as the existing types in this file.
- `services/frontend/src/api/client.ts` — added to the `api` object:
  `getCourseProgress(courseId)`, `getLesson(courseId, lessonId)`,
  `completeLesson(courseId, lessonId)` (POST, no body). Same
  `apiFetch`/`ApiError` chokepoint as the existing three methods.
- `services/frontend/src/routes.tsx` — added `lessonRoute` (`path:
  "/courses/$courseId/lessons/$lessonId"`, **top-level**, `getParentRoute:
  () => rootRoute`, sibling of `courseRoute` — deliberately NOT nested
  under `courseRoute`/`addChildren`, see Deferred decisions). `courseRoute`'s
  and `lessonRoute`'s `component`s now delegate to `CoursePage`/`LessonView`
  reading params via `.useParams()`. Removed the old inline
  `CourseDetailPage` (superseded by `CoursePage`) and its now-unused
  `ApiError` import. `routeTree` = `rootRoute.addChildren([indexRoute,
  courseRoute, lessonRoute])`.
- `services/frontend/src/App.test.tsx` — updated the course-detail mock from
  `/api/courses/c1` (`CourseDetailResponse`) to `/api/courses/c1/progress`
  (`CourseProgressResponse`) and the 404 test's mock URL to
  `/api/courses/missing/progress`, matching `CoursePage`'s actual fetch.
- `services/frontend/src/index.css` — added `.lesson-list`, `.lesson-link`,
  `.lesson-status`/`.lesson-status--completed`, `.lesson-content` (+ `pre`/
  `code` styling for fenced SQL blocks), `.mark-done-button`. Existing
  `.card-list`/`.card-list-item`/`.page-heading`/`.muted-note` reused
  as-is, per task-011's report's guidance.
- `services/frontend/package.json` / root `package-lock.json`
  (`BOUNDARY_EXEMPT`) — added dependency `react-markdown@^10.1.0`.

## Interfaces for downstream tasks (014–016: quiz/practice/transfer UI)

- **Route params for a lesson page**: `/courses/$courseId/lessons/$lessonId`
  is a **top-level** route (sibling of `courseRoute`, not its child) — no
  `<Outlet />` anywhere expects a lesson to render nested inside the module
  list. If 014/015 add quiz/practice UI to the lesson page, extend
  `LessonView` itself (it already fetches `LessonDetailResponse`, which
  carries `quiz`/`practice` alongside `content` — `LessonView` currently
  ignores those two fields, rendering only `content`).
- **`LessonDetailResponse.quiz`/`.practice`** (types.ts) are typed and ready
  to consume (`PublicQuiz`, `PublicPractice`) — not rendered by this task,
  since quiz-answering/practice-running UI is out of scope here (see
  Deferred decisions).
- **Completion status source of truth**: `["courseProgress", courseId]`
  (`api.getCourseProgress`) is the one query both `CoursePage` and
  `LessonView` read/invalidate. A quiz/practice completion flow (014/015)
  should invalidate the same key after grading succeeds, exactly as
  `LessonView`'s mark-done mutation does, so `CoursePage`'s tree stays in
  sync without a manual re-fetch dance.
- **`api.completeLesson` is manual-completion only** — it must not be called
  for `completionMode !== "manual"` lessons (backend 409s); `LessonView`
  already gates the button on this, downstream code touching quiz/practice
  grading needs a different endpoint (not implemented in this task —
  `routes/quiz.ts`/`routes/practice.ts` exist backend-side but have no
  frontend client methods yet).

## Deferred decisions

- **`lessonRoute` is a top-level sibling of `courseRoute`, not its child.**
  Task-011's report left this open explicitly. Nesting would force
  `CoursePage` to render an `<Outlet />` and stay mounted behind the lesson
  (a master-detail layout), which nothing in the brief asked for and would
  double the rendered module list's queries for no visible benefit. A full
  lesson page (its own `<h1>`, its own "back to course" link) matches the
  existing `courseRoute`/`indexRoute` shape most closely — KISS.
- **`react-markdown` (CommonMark only, no `remark-gfm`).** Added because
  Markdown rendering is an explicit brief deliverable and nothing else in
  the codebase renders it. Deliberately did NOT add `remark-gfm` (tables/
  strikethrough/task-lists) — no course content package exists yet to prove
  that need (`courses/` is empty in this repo right now — `find courses -name
  "*.md"` returns nothing), and speculative dependencies for content that
  doesn't exist yet contradict "не добавляй фичи на будущее". If a course
  package later needs tables, that's a one-line addition to `Markdown.tsx`.
- **`LessonView` renders only `content`, not `quiz`/`practice`.** The brief
  scopes this task to "рендер Markdown-контента урока и кнопка явной
  отметки «пройдено»" — quiz-answering and practice-running UI are
  reasonably later tasks (backend already has `routes/quiz.ts`/
  `routes/practice.ts` with no frontend consumer yet). `LessonDetailResponse`
  is already typed with `quiz?`/`practice?` so a later task doesn't need to
  touch `api/types.ts` again for this endpoint.
- **Two separate `useQuery` calls in `LessonView`** (content +
  courseProgress) instead of one combined fetch. The backend doesn't offer
  a single endpoint returning both a lesson's Markdown body and its
  progress-tree status — keeping them as two typed, independently-cacheable
  queries (TanStack Query dedupes/caches each by its own key) is simpler
  than inventing a client-side merge endpoint for a join the backend
  doesn't do either.
- **Mark-done button hidden (not disabled) for non-manual lessons.** A
  disabled button inviting a click that would just 409 is worse UX than no
  button at all with an explanatory note — the backend's 409 exists as a
  safety net for a misbehaving/future client, not as UI copy to surface to
  a human who clicked the one button offered.

## Verification

`bash .mvp/ci-mirror.sh` → exit 0. Backend: 217/217 tests pass (unchanged —
no backend files touched). Frontend: `eslint .` clean, `tsc -b && vite
build` clean (314 modules transformed), `vitest run` → 5 test files / 17
tests pass (existing `App.test.tsx` 4 + `Layout.test.tsx` 4 +
`CoursePage.test.tsx` 3 + `LessonView.test.tsx` 3 +
`Markdown.test.tsx` 3).

## Boundary check

`git status --porcelain` — changes confined to `services/frontend/**` (new
`features/course/`, `features/lesson/`, edits to `api/`, `routes.tsx`,
`index.css`, `App.test.tsx`) plus `package.json`/`package-lock.json`
(`BOUNDARY_EXEMPT`) plus this report. `.mvp/ledger.md` and
`.mvp/briefs/task-013.md` predate this task (planner-owned), not touched
by me.

## Fix round (review finding)

**Finding (minor):** `CoursePage.tsx:33` (`<h1 className="page-heading">
{data.title}</h1>`) — the page drops the course description the prior
inline `CourseDetailPage` (task-011) used to render, because
`CourseProgressResponse`/`courseProgressResponseSchema` — the shape this
page fetches — carries no `description` field (`CourseDetailResponse` does,
but was deliberately dropped in favour of the progress endpoint for its
status data, per this report's design note above).

**Verified, not refuted.** Confirmed by reading
`services/backend/src/routes/progress.ts`'s `courseProgressResponseSchema`
(`additionalProperties: false`, no `description` in `properties`) and by
`git show 8f78413` — the task-011 commit that introduced the now-deleted
`CourseDetailPage`, which rendered `{data.description !== undefined && <p>
{data.description}</p>}` from `api.getCourse`. Task 013's `CoursePage`
genuinely regressed this.

**Fixed.** `CoursePage.tsx` now also runs a second, independent `useQuery`
(`queryKey: ["course", courseId]`, `api.getCourse`) and renders
`courseData?.description` (when present) as a `<p className="muted-note">`
right under the `<h1>`, matching the old `CourseDetailPage`'s placement and
undefined-guard. Deliberately not gated on its own pending/error state —
title/counters/module tree already render from the (mandatory) progress
query; the description is supplementary and simply renders nothing extra
while its own fetch is in flight or fails, rather than blocking or erroring
the whole page for a non-essential field. Same "don't invent a client-side
join the backend doesn't offer" reasoning this report's Deferred decisions
section already applied to `LessonView`'s two-query split.

`CoursePage.test.tsx`'s happy-path test extended with an `/api/courses/c1`
mock (`CourseDetailResponse` with `description: "Learn the basics."`) and
an assertion the text renders; the error-path/404 tests are unchanged
(they return before the JSX that reads `courseData` ever runs, so no mock
was needed there).

`bash .mvp/ci-mirror.sh` → exit 0. Frontend: `eslint .` clean, `tsc -b &&
vite build` clean, `vitest run` → 5 test files / 17 tests pass (same count
as before — one assertion added to an existing test, not a new test).
Backend unaffected (no backend files touched, boundary is
`services/frontend`).
