## Task
- id: 019
- title: Написать сквозной smoke-тест поднятого стека: курс валидируется и виден, урок и квиз отмечаются пройденными, SQL-практика выполняется в песочнице, экспорт и импорт прогресса дают round-trip.
- level: 8
- service: root
- service_path: .
- role: test-writer
- files: tests/e2e/stack.test.ts, tests/e2e/helpers/compose.ts
- depends_on: 013, 014, 015, 016, 017
- estimate_tokens: 16000
- status: pending
- complexity_class: novel-design

## Boundary
.

## Interfaces from dependencies
### 013
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

### 014
# Task 014 — UI квиза — отчёт

## Новые файлы (`services/frontend/src/features/quiz/`)

- **`useQuiz.ts`** — `export function useQuiz(courseId: string, lessonId: string)`.
  Wraps `useMutation({ mutationFn: (optionId) => api.answerQuiz(...) })` +
  local `useState<QuizVerdict | undefined>`. Returns `{ verdict,
  pendingOptionId, isError, submit }`:
  - `verdict: QuizVerdict | undefined` — `{ optionId, correct, explanation? }`
    for the **most recently submitted** option only (matches
    `routes/quiz.ts`'s contract: the client learns exactly one bit, nothing
    about other options). Cleared the instant a new `submit(optionId)` is
    called, before the request resolves.
  - `pendingOptionId: string | undefined` — the option currently awaiting a
    verdict (`mutation.variables` while `isPending`).
  - On a correct answer: `queryClient.invalidateQueries({ queryKey:
    ["courseProgress", courseId] })` — same key `CoursePage`/`LessonView`
    already read, per task-013's report's explicit instruction for
    014/015. A wrong answer invalidates nothing (nothing changed server-side
    either — `routes/quiz.ts` stores nothing on a wrong answer).
  - `export interface QuizVerdict { optionId: string; correct: boolean;
    explanation?: string }`.

- **`AnswerOption.tsx`** — `export function AnswerOption({ option,
  status, explanation, disabled, onSelect })`. Pure presentational button:
  `status: "idle" | "pending" | "correct" | "incorrect"` (exported as
  `AnswerOptionStatus`) drives a CSS class (`answer-option--correct` /
  `--incorrect`) and a status label; the explanation paragraph only renders
  when `status` is `"correct"`/`"incorrect"` **and** `explanation !==
  undefined` (server omits `explanation` when the chosen option has none).

- **`QuizView.tsx`** — `export function QuizView({ courseId, lessonId, quiz
  }: { courseId: string; lessonId: string; quiz: PublicQuiz })`. Renders the
  question + one `<AnswerOption>` per `quiz.options`, deriving each option's
  `status`/`explanation` from `useQuiz`'s `verdict`/`pendingOptionId` (helper
  `optionStatus(...)`, local, not exported). All options disabled while any
  submission is in flight (`disabled = pendingOptionId !== undefined`) so
  only one answer is ever in flight. Deliberately takes **no** `isCompleted`
  prop — unlimited attempts means a lesson already completed in an earlier
  session is still safely re-answerable; `LessonView` is the one that shows
  the "already completed" note separately, from the progress tree it
  already has.

## Files changed

- **`services/frontend/src/api/types.ts`** — added `QuizAnswerResponse`
  (`{ correct: boolean; explanation?: string; lesson: LessonProgress;
  course: LessonCompletionResponse["course"] }`), mirroring
  `routes/quiz.ts`'s `quizAnswerResponseSchema` field-for-field.
- **`services/frontend/src/api/client.ts`** — added `api.answerQuiz(courseId,
  lessonId, optionId): Promise<QuizAnswerResponse>` — `POST
  /courses/:courseId/lessons/:lessonId/quiz/answer`, JSON body `{
  optionId }`. Same `apiFetch`/`ApiError` chokepoint as every other method.
- **`services/frontend/src/features/lesson/LessonView.tsx`** — wired
  `<QuizView>` in: renders when `lessonProgress.completionMode === "quiz"
  && contentQuery.data.quiz !== undefined` (both guards needed — the two
  come from separate queries), placed after `<Markdown>` and before the
  existing `<CompletionControl>` (which still shows its
  "Урок пройден."/"Урок завершается правильным ответом на квиз." note
  above/below it, unchanged). Not in the brief's `files:` hint, but required
  to make the quiz UI reachable at all — see Deferred decisions.
- **`services/frontend/src/features/lesson/LessonView.test.tsx`** — added one
  integration test asserting a quiz-graded lesson whose content carries a
  `quiz` field actually renders the question and option buttons through the
  real route/page (not just `QuizView` in isolation).
- **`services/frontend/src/index.css`** — added `.quiz-view`,
  `.quiz-question`, `.answer-option-list`, `.answer-option` (+
  `--correct`/`--incorrect` modifiers), `.answer-option-status`,
  `.answer-option-explanation`. Reuses existing tokens
  (`--color-status-ok/error`, `--color-accent-soft`, `--color-border`), no
  new tokens added.

## Interfaces for downstream tasks (015/016)

- `QuizAnswerResponse` / `api.answerQuiz` follow the exact pattern
  `api.completeLesson` established — a task 015 practice endpoint should add
  its own method the same way (`api.runPractice`/`api.checkPractice` or
  similar), not a standalone `fetch`.
- **Cache invalidation convention reaffirmed**: any mutation that can change
  a lesson's completion (quiz, practice) invalidates `["courseProgress",
  courseId]` on success — `useQuiz.ts` is a second example of this pattern
  (`LessonView`'s manual-complete mutation was the first), 015 should follow
  it for practice too.
- `LessonView.tsx` now has a precedent for gating a feature's UI on
  `lessonProgress.completionMode === "<mode>" && contentQuery.data.<field>
  !== undefined` — task 015 (practice) can follow the same shape for
  `completionMode === "practice"` and `contentQuery.data.practice`.

## Deferred decisions

- **Edited `LessonView.tsx`/`LessonView.test.tsx`, not just the three files
  the brief's `files:` hint named.** Common Agent Principles: "файлы —
  подсказка, не контракт". `QuizView`/`AnswerOption`/`useQuiz` alone would
  be dead code with no route ever rendering them — task 013's report
  explicitly left `LessonView` "renders only `content`, not `quiz`" as a
  scoping note for *this* task to lift, not a boundary. Wiring it in is the
  minimal change that makes "Реализовать UI квиза" actually true for a user
  navigating the app, and stays inside `services/frontend`.
- **No `isCompleted`/`disabled-once-passed` prop on `QuizView`.** The
  backend's own contract (`routes/quiz.ts`: "never un-complete anything...
  answering wrong after a correct answer leaves the lesson completed")
  makes every re-submission safe regardless of prior completion — freezing
  the UI after one correct answer would just be an artificial restriction
  the backend doesn't impose and the brief's "неограниченные попытки"
  explicitly rules out.
- **Verdict cleared as soon as a new option is submitted (not just on
  response)**: prevents a stale correct/incorrect badge sitting on the
  previous pick while the new request is in flight — a purely local UX
  choice with no server-visible effect (the backend was never going to be
  asked about the old option again).
- **Single generic error message on submission failure** (`"Не удалось
  отправить ответ. Попробуйте ещё раз."`), same wording pattern as
  `LessonView`'s manual-complete mutation's `isError` branch — no per-option
  error state, since a network/5xx failure isn't about any particular
  option.

## Verification

`bash .mvp/ci-mirror.sh` → exit 0, run twice consecutively. Backend: 217/217
tests pass (unchanged, no backend files touched). Frontend: `eslint .`
clean, `tsc -b && vite build` clean (317 modules transformed), `vitest run`
→ 7 test files / 24 tests pass (17 pre-existing + 3 `AnswerOption.test.tsx`
+ 3 `QuizView.test.tsx` + 1 new `LessonView.test.tsx` case).

## Boundary check

`git status --porcelain` — changes confined to `services/frontend/**`
(`api/types.ts`, `api/client.ts`, `features/lesson/LessonView.{tsx,test.tsx}`,
`index.css`, new `features/quiz/`) plus this report. `.mvp/ledger.md` and
`.mvp/briefs/task-014.md` predate/are updated by the pipeline, not touched by
me.

## Fix round (review findings)

Both findings held up under verification — fixed, not refuted.

- **`AnswerOption.tsx:42` — `aria-pressed={isGraded}` (fixed).** Read the
  button in context: it's a plain `<button type="button">`, not a
  toggle-button widget (no `role="switch"`/actual on-off semantics — clicking
  it again after grading just resubmits via `onSelect`, it doesn't flip a
  pressed state off). `aria-pressed` on a `<button>` is the ARIA
  "toggle button" pattern; assistive tech announces it as "button, pressed" /
  "not pressed". Applying it whenever `status` is `correct`/`incorrect`
  mislabels a graded verdict as a toggle state, and it's also redundant: the
  `<span className="answer-option-status">{STATUS_LABEL[status]}</span>`
  (e.g. "Верно"/"Неверно") already sits inside the `<button>`, so it's part
  of the button's accessible name and a screen reader already announces the
  verdict through the visible text without any `aria-*` attribute needed.
  Removed the `aria-pressed` attribute entirely; no replacement `aria-*` was
  added since the accessible name already carries the information.
  `bash .mvp/ci-mirror.sh` → exit 0 (`services/frontend` vitest: 7 files / 24
  tests still pass, `AnswerOption.test.tsx` has no assertion on
  `aria-pressed`).

- **`AnswerOption.tsx:39` — missing visual treatment for `pending` (fixed).**
  Confirmed in `services/frontend/src/index.css`: `.answer-option--correct`
  and `.answer-option--incorrect` each set a distinct `border-color` from
  `--color-status-ok`/`--color-status-error`, but there was no
  `.answer-option--pending` rule at all, even though `theme.css` defines
  `--color-status-pending` and `index.css`'s own `.status-dot` block already
  uses that exact token for the analogous "connecting" indicator elsewhere on
  the page — so the pending option really did fall back to only the disabled
  cursor plus the "Проверяем…" text, no border/background distinction like
  its correct/incorrect siblings get. Added `.answer-option--pending {
  border-color: var(--color-status-pending); }` in `index.css` immediately
  before `.answer-option--correct`, following the same
  `border-color: var(--color-status-*)` pattern already established for the
  other two states — no new token, reuses the existing
  `--color-status-pending`. `bash .mvp/ci-mirror.sh` → exit 0.

Both fixes verified together: `bash .mvp/ci-mirror.sh` exit 0 (backend
217/217 unchanged, frontend `eslint`/`tsc -b && vite build`/`vitest run`
7 files / 24 tests all pass).

### 015
# Task 015 — UI практики (CodeMirror SQL-редактор) — отчёт

## Новые файлы (`services/frontend/src/features/practice/`)

- **`SqlEditor.tsx`** — `export function SqlEditor({ value, onChange, onRun,
  busy }: { value: string; onChange: (value: string) => void; onRun: () =>
  void; busy: boolean })`. Controlled wrapper around
  `@uiw/react-codemirror` + `@codemirror/lang-sql` (syntax highlighting
  only, no schema-aware completion — the sandbox's actual tables vary per
  course). Run button disabled when `busy` or `value.trim()` is empty
  (mirrors backend's `pattern: "\\S"` body guard, `routes/practice.ts`).

- **`ResultTable.tsx`** — `export function ResultTable({ result }: {
  result: PracticeResultSet })`. Pure/presentational. Cells render as-is
  (`string`) or `<span className="result-null">NULL</span>` for `null`. A
  command with zero columns (CREATE TABLE, bare INSERT, …) renders a
  one-line summary ("`INSERT` выполнена, затронуто строк: N.") instead of
  an empty `<table>`. `truncated: true` adds a note with the shown/actual
  row counts.

- **`usePractice.ts`** — `export function usePractice(courseId: string,
  lessonId: string, sandboxId: string)`. Two `useMutation`s:
  - run: `api.runPractice(courseId, lessonId, sql)` → on success,
    invalidates `["courseProgress", courseId]` **only when** `check.present
    && check.passed === true` (same "only on the thing that actually
    changed" convention `useQuiz` established for a correct answer).
  - reset: `api.resetSandbox(courseId, sandboxId)` → on success, calls
    `runMutation.reset()` so a stale result/verdict from before the reset
    never lingers as if it still described the (now-wiped) sandbox.
  Returns `{ execution, isRunning, runError, run, isResetting, resetError,
  resetSucceeded, reset }`. `execution` is `PracticeRunResponse |
  undefined` — `runMutation.data` directly, no local state duplicate.

- **`PracticeView.tsx`** — `export function PracticeView({ courseId,
  lessonId, practice }: { courseId: string; lessonId: string; practice:
  PublicPractice })`. Renders the prompt, `<SqlEditor>`, the last run's
  `<ResultTable>` (`ok: true`) or Postgres' own error text verbatim (`ok:
  false`, `message` + `hint` if present — never rewritten/summarized, per
  the project invariant), the check verdict ("Проверка пройдена."/"Проверка
  не пройдена.") when `check.present`, and a "Сбросить песочницу" button.
  Run failures (`ApiError`, e.g. 422 `check_contract_violation`/503
  `unavailable`) show `error.message` directly — these are meaningful
  backend text (broken course content, unreachable sandbox), not a generic
  network-failure message.

- Tests (one file per component + a hook-level scenario through
  `PracticeView.test.tsx`, same convention as `useQuiz`/`QuizView`):
  `SqlEditor.test.tsx` (4), `ResultTable.test.tsx` (3), `PracticeView.test.tsx`
  (3: happy path run+passing check+cache invalidation, error path — SQL
  error shown as-is + no invalidation, edge case — reset clears the prior
  result).

## Files changed

- **`services/frontend/src/api/types.ts`** — added `PracticeColumn`,
  `PracticeResultSet`, `PracticeSqlError`, `PracticeCheckResult`,
  `PracticeRunResponse` (POST `.../practice/run`), `SandboxStatus` (GET/POST
  `.../sandbox`, `.../sandbox/reset`). Mirror `routes/practice.ts`'s/
  `routes/sandbox.ts`'s JSON Schemas field-for-field, same convention as
  every other type in this file.
- **`services/frontend/src/api/client.ts`** — added `api.runPractice(courseId,
  lessonId, sql): Promise<PracticeRunResponse>` (POST `.../practice/run`,
  body `{ sql }` — **always resolves for a SQL error**, `ok: false` is a
  200, only request-level failures throw `ApiError`) and
  `api.resetSandbox(courseId, sandboxId): Promise<SandboxStatus>` (POST
  `.../sandbox/reset`, body `{ sandboxId }`). Same `apiFetch`/`ApiError`
  chokepoint as every other method.
- **`services/frontend/src/features/lesson/LessonView.tsx`** — wired
  `<PracticeView>` in: renders whenever `contentQuery.data.practice !==
  undefined`, **not** gated on `completionMode` (unlike `<QuizView>`, gated
  on `completionMode === "quiz"`) — an ungraded practice
  (`completionMode: "manual"`) still needs the editor, it just doesn't
  complete the lesson by itself; the existing "mark as done" button
  (unchanged) is what closes it, per task-009's report. Not in the brief's
  `files:` hint, but required to make the feature reachable — same
  justification task-014's report gave for its own `LessonView` edit.
- **`services/frontend/src/features/lesson/LessonView.test.tsx`** — added
  one integration test asserting a manual-mode lesson with an (ungraded)
  practice renders the prompt and still shows the mark-done button.
- **`services/frontend/src/index.css`** — added `.practice-view`,
  `.practice-prompt`, `.sql-editor` (+ `.cm-editor` font-size override),
  `.run-button`, `.practice-result`, `.result-table-wrapper`,
  `.result-table` (+ `th`/`td`), `.result-null`, `.practice-sql-error`,
  `.practice-verdict` (+ `--passed`/`--failed`), `.practice-sandbox-controls`,
  `.reset-sandbox-button`. Reuses existing tokens
  (`--color-status-ok/error`, `--color-surface/border/bg`), no new tokens.
- **`services/frontend/src/testSetup.ts`** (new) + **`vite.config.ts`**
  (`test.setupFiles`) — see "jsdom/CodeMirror incompatibility" below.
- **`services/frontend/package.json`** / root **`package-lock.json`**
  (`BOUNDARY_EXEMPT`) — added `@uiw/react-codemirror@^4.25.11`,
  `@codemirror/lang-sql@^6.10.0`.

## jsdom/CodeMirror incompatibility (why `testSetup.ts` exists)

`document.createRange().getClientRects` is `undefined` under this project's
jsdom version (verified directly, not assumed) — jsdom has no real layout
engine and never implemented `Range.getClientRects()`/
`getBoundingClientRect()` at all. `@uiw/react-codemirror` measures text
geometry through these on every content change, scheduled via
`requestAnimationFrame`; the resulting `TypeError` is thrown **outside**
any test's own call stack (inside a jsdom-scheduled rAF callback), which
still fails the whole `vitest run` with a non-zero exit code even though
the test that triggered it had already passed — confirmed by reproducing
it with a scratch test (`userEvent.type` into the editor) before adding the
fix.

Fix: `services/frontend/src/testSetup.ts` polyfills both methods with an
empty/zero-rect stub (harmless for headless tests that never assert on
pixel geometry), wired via `vite.config.ts`'s new `test.setupFiles:
["./src/testSetup.ts"]`. This is a **global** test-environment change
(applies to every test file, not just practice's), but the incompatibility
itself is global — any future test typing into the CodeMirror editor would
hit the same crash. No existing test's behavior changed because of it (full
suite: 35/35 pass before and after, same set of files).

## Interfaces for downstream tasks

- `api.runPractice`/`api.resetSandbox` follow the exact pattern established
  by `api.completeLesson`/`api.answerQuiz` — a future task needing another
  practice-adjacent endpoint should add its own method here, not a
  standalone `fetch`.
- **Cache invalidation convention reaffirmed a third time**: a mutation
  that can change a lesson's completion invalidates `["courseProgress",
  courseId]` on success — `usePractice.ts`'s run mutation is the third
  example (`LessonView`'s manual-complete, `useQuiz`'s correct-answer path,
  now this one), each gated on "did this response actually record a
  change", not "did the request succeed".
- `PracticeSqlError.position` (1-based char offset into the submitted SQL,
  matching `pg`'s own field) is typed and passed through but **not** used
  to place a caret in the editor — noted as a possible follow-up in
  `PracticeSqlErrorView`'s doc comment, not implemented here (brief scope:
  show the error "как есть", not build caret-positioning UX).
- If a later task needs to type into `SqlEditor` in a test, `container.
  querySelector('[contenteditable="true"]')` + `userEvent.type(...)` works
  (see `PracticeView.test.tsx`'s `typeSql` helper) — requires
  `testSetup.ts`'s polyfill, which is already wired globally.

## Deferred decisions

- **`@uiw/react-codemirror` + `@codemirror/lang-sql`, not a hand-rolled
  `<textarea>` or a different CodeMirror wrapper.** The brief names
  CodeMirror explicitly ("встроенный SQL-редактор на CodeMirror"); `@uiw/
  react-codemirror` is the standard, actively-maintained React 19-compatible
  wrapper for CodeMirror 6 (verified peer/dependency ranges before
  installing) — a hand-rolled `<textarea>` would not be "CodeMirror" at all.
- **No SQL autocompletion/schema awareness.** `@codemirror/lang-sql`'s
  `sql()` extension gives keyword/string/number highlighting for free;
  wiring table/column completion would need to know the sandbox's actual
  schema, which the frontend has no endpoint for and nothing in the brief
  asks for — speculative feature, not built.
- **`PracticeView` renders unconditionally on `practice !== undefined`,
  not gated on `completionMode === "practice"`** (unlike `QuizView`'s gate
  on `"quiz"`). An unchecked practice (`completionMode: "manual"`) is a
  real, brief-scoped case — "самоотметка для заданий без check" — and
  still needs the editor to be usable at all; gating it the same way
  `QuizView` is gated would silently hide the exercise for exactly the
  lessons task-009's report says self-marking exists for.
- **`usePractice`'s reset calls `runMutation.reset()` on success** rather
  than leaving the prior result visible. A reset wipes the tables/data the
  prior run's result and verdict described — showing a stale "Проверка
  пройдена." after the sandbox that earned it no longer has that data would
  misrepresent the current state.
- **`resetSucceeded` has no auto-dismiss/timeout.** It clears the moment
  `resetMutation.mutate()` is called again (react-query resets `isSuccess`
  to `false` while the new attempt is `isPending`) — no `setTimeout`/local
  state needed for a one-shot confirmation note; KISS.
- **Run/error messages use `ApiError.message` directly for `runError`**
  (unlike `LessonView`'s manual-complete and `useQuiz`'s generic strings).
  Practice failures at the request level are almost always meaningful
  course-content/infrastructure text from the backend (422
  `check_contract_violation`, 503 sandbox `unavailable`) that the report
  says must reach the learner/course-author verbatim — collapsing it to a
  generic "попробуйte ещё раз" would hide exactly the information those
  statuses exist to carry.
- **`testSetup.ts` polyfill is global** (`vite.config.ts`'s
  `setupFiles`), not scoped to `features/practice/`'s tests only — vitest's
  `setupFiles` option has no per-directory scoping mechanism, and the
  incompatibility it fixes (`Range.getClientRects`) is a property of
  jsdom itself, not of this feature — any future test that types into a
  CodeMirror instance needs the same fix.

## Verification — real output

### `bash .mvp/ci-mirror.sh` — exit `0`, run three times consecutively

Backend unaffected (boundary is `services/frontend`): `# tests 217 / # pass
217 / # fail 0 / # skipped 0` (unchanged from before this task — no backend
files touched). Frontend: `Test Files 10 passed (10)` / `Tests 35 passed
(35)` all three runs (25 pre-existing + 10 new: 4 `SqlEditor.test.tsx` + 3
`ResultTable.test.tsx` + 3 `PracticeView.test.tsx`, plus one new assertion
inside the existing `LessonView.test.tsx` file).

### `npx tsc -b` / `npx eslint .` / `npx vite build` (in `services/frontend`)

All exit `0`. Build: `347 modules transformed`, `895.08 kB` bundle
(`5.66 kB` CSS) — one chunk-size warning from Vite (CodeMirror's own
weight), not an error; no code-splitting attempted (KISS, brief doesn't ask
for it, and this is a single-page local tool, not a CDN-served app where
initial load matters the same way).

## Boundary check

`git status --porcelain` (after removing a leftover `.vitest/` report
directory a manual `npx vitest run` invocation created, not part of the
diff): changes confined to `services/frontend/**` (new
`features/practice/`, new `testSetup.ts`, edits to `api/`,
`features/lesson/LessonView.{tsx,test.tsx}`, `index.css`, `vite.config.ts`)
plus `package.json`/`package-lock.json` (`BOUNDARY_EXEMPT`) plus this
report. `.mvp/ledger.md` and `.mvp/briefs/task-015.md` predate/are
maintained by the pipeline, not touched by me.

## Fix round 1 (review findings)

### Finding 1 (bug, `PracticeView.tsx:42`, run/reset can be in flight together) — refuted

The claim: run isn't gated by `isResetting` and reset isn't gated by
`isRunning`, so a run's late response could "repopulate `execution` with a
result/check verdict computed against the pre-reset sandbox" after
`usePractice`'s reset `onSuccess` already called `runMutation.reset()`.

Read `node_modules/@tanstack/query-core/build/modern/mutationObserver.js`
(the actual installed v5.103 source, after `npm ci` — no node_modules
existed before this fix round) and `mutation.js` to trace exactly what
`reset()` does:

- `MutationObserver.reset()` (mutationObserver.js:102-107): `this.#currentMutation?.removeObserver(this); this.#currentMutation = void 0; this.#updateResult(); this.#notify();`
  Its own doc comment states this precisely: "This does not cancel an
  in-flight mutation; the mutation itself keeps running to completion and
  its own callbacks still fire, **but this observer stops reflecting its
  state**."
- `Mutation.execute()` (mutation.js:130-219), on success, calls
  `this.#dispatch({ type: "success", data })` (line 184-187), which
  (mutation.js:268-279) does `this.#observers.forEach(observer =>
  observer.onMutationUpdate(action))` — but `reset()` already removed this
  hook's observer from `#observers` via `removeObserver` (mutation.js:61-69,
  filters it out). The late-arriving success can therefore never reach
  `onMutationUpdate` → `#updateResult()` on the hook's `MutationObserver`,
  which is the only thing that ever sets `runMutation.data`
  (`usePractice.ts`'s `execution`). `isPending` similarly falls back to the
  detached observer's default `idle` state, so it's not `isRunning` either.
- A subsequent `run(sql)` call (`MutationObserver.mutate`, lines 126-132)
  always `build()`s a brand-new `Mutation` instance and attaches the
  observer to *that* one — it never re-attaches to the old, still-running
  instance — so a new run right after a reset can't be corrupted by the old
  one's eventual response either.

So the concrete path the finding needs — a stale run response reaching
`execution`/`runError`/`isRunning` after `reset()` — does not exist in this
react-query version; it is exactly what `MutationObserver.reset()` is
built to prevent, and `usePractice.ts`'s reset `onSuccess` calling
`runMutation.reset()` (not e.g. `queryClient.cancelMutations()`, which
would be the wrong tool here) already relies on that guarantee correctly.
No code change. (The old in-flight `mutationFn` promise/HTTP request itself
does keep running to completion in the browser — that's an accepted,
harmless wasted request, not a UI-correctness bug, and outside what this
finding claims.)

### Finding 2 (minor, `PracticeView.tsx:72`, hardcoded reset-error text) — fixed

Confirmed by reading `api/client.ts`: `resetSandbox` goes through the same
`apiFetch`/`ApiError` chokepoint as `runPractice`, so a failing reset
(course-author-actionable detail, e.g. "seed-скрипт X упал") carries the
same kind of real backend `message` the run-error branch already surfaces
verbatim. Changed the reset-error branch to match: `resetError instanceof
ApiError ? resetError.message : <generic fallback>`, same pattern as
`runError` two lines above. Added a test (`PracticeView.test.tsx`, "shows
the backend's own error text when resetting the sandbox fails") asserting
the backend's `message` reaches the DOM verbatim on a 500.

`bash .mvp/ci-mirror.sh` → exit `0` (frontend: `Test Files 10 passed (10)`,
`Tests 37 passed (37)`; backend unaffected, `217/217`).

### Finding 3 (minor, `PracticeView.tsx:69`, reset button not gated on `isRunning`) — fixed (comment only)

The reviewer's own text already verifies this harmless for displayed data —
Finding 1's refutation above confirms exactly why (`reset()` detaches the
observer from any in-flight run, so nothing stale can reappear). The actual
ask ("no stated justification") is a documentation gap, not a behavior
change: added a comment above the reset button explaining precisely why
`isRunning` deliberately does not gate it, citing the same
`MutationObserver.reset()` mechanics. No behavior change — changing the
gating itself was not requested and would remove intended UX (resetting
without waiting out a slow query).

### Finding 4 (minor, `ResultTable.tsx:29`, header `key={column.name}` not unique) — fixed

Confirmed via `api/types.ts`'s own doc comment on `PracticeResultSet`
(`select 1 as a, 2 as a` is valid SQL with two columns both named `a`) that
`column.name` is not guaranteed unique, while the row/cell keys just below
already use positional indices for the identical reason. Changed the
header `<th>` key to `columnIndex`, matching that existing pattern, with a
comment pointing at the same doc comment as justification. Added a test
(`ResultTable.test.tsx`, "renders one header per column even when names
collide") asserting two `columnheader`s named `a` both render.

`bash .mvp/ci-mirror.sh` → exit `0` (same run as Finding 2's, both fixed
together; frontend `37/37`, backend `217/217`).

### 016
# Task 016 — UI переноса прогресса (экспорт/импорт) — отчёт

## Что создано

- `services/frontend/src/features/transfer/TransferPage.tsx` — страница
  `/transfer`: секция «Экспорт» (кнопка «Скачать файл прогресса») + секция
  «Импорт» (рендерит `ImportDialog`).
  - `exportFileName(exportedAt)` — воспроизводит алгоритм backend'а
    `progressExportFileName` (`services/backend/src/transfer/format.ts`)
    байт-в-байт: `.replace(/\.\d+Z$/, "Z").replace(/:/g, "-")`, чтобы имя
    файла не зависело от заголовка `content-disposition` (клиент на `fetch`
    его не видит/не использует — так и задумано в отчёте задачи 010:
    «a fetch-based client (task 016) ignores it and names its own
    download»).
  - `downloadFile(file)` — `Blob` → `URL.createObjectURL` → временный
    `<a download>` → `.click()` → `remove()` → `URL.revokeObjectURL`.
  - `useMutation({ mutationFn: api.exportProgress, onSuccess: downloadFile })`
    — состояние `isPending`/`isError` рендерится тем же паттерном, что и
    остальные мутации в проекте (`ApiError` → `.message`, иначе дженерик
    текст).
- `services/frontend/src/features/transfer/ImportDialog.tsx` — выбор файла
  (`<input type="file" accept="application/json,.json">`) → чтение через
  `File.text()` + `JSON.parse` (клиентская проверка — только «это вообще
  JSON-объект»; вся содержательная валидация — на сервере,
  `parseProgressExport`, единственный источник истины) → `POST
  /progress/import`.
  - Три исхода, различаются по `ApiError.status`:
    - **200** (`importMutation.isSuccess`) — счётчики
      (`created`/`earlierCompletions`/`unchanged`) + список
      `coursesNotInstalled`, если есть.
    - **409** (`import_older_than_local`, файл старше локального прогресса
      И реально что-то изменил бы) — текст предупреждения
      (`error.message`, ровно то, что прислал backend) + тот же блок
      счётчиков (preview) + кнопка «Импортировать всё равно» (повторяет
      запрос с `confirm: true`, используя `importMutation.variables.file` —
      TanStack Query v5 не очищает `variables` при переходе в `error`,
      только при следующем `mutate()`/`reset()`) + «Отмена»
      (`importMutation.reset()`, возврат к выбору файла).
    - **400** (`invalid_export_file`/`unsupported_export_version`) —
      `error.message` + список `problems` (по одной фразе на проблему, как
      прислал сервер).
    - Любая другая ошибка (сеть, 5xx) — общий текст «Не удалось
      импортировать файл...».
  - На успех (в том числе после подтверждённого stale-импорта) —
    `queryClient.invalidateQueries({ queryKey: ["courseProgress"] })` без
    привязки к конкретному `courseId` (импорт мог затронуть любое число
    курсов) — тот же паттерн префиксного инвалидирования, что уже
    использует `useQuiz`/`usePractice`/`LessonView`.

## Изменения существующих файлов

- `services/frontend/src/api/types.ts` — добавлены типы, зеркалящие
  `services/backend/src/transfer/{format,import}.ts` и
  `routes/transfer.ts`'s JSON Schemas: `ExportedLessonProgress`,
  `ExportedCourseProgress`, `ProgressExportFile`, `ImportCourseSummary`,
  `ImportTotals`, `ImportResult` (тело 200 и 409, `applied` их различает),
  `ImportStaleWarning` (`ImportResult & {error: "import_older_than_local";
  message: string}` — форма 409), `ImportRejection` (форма 400: `error`,
  `message`, `problems: string[]`).
- `services/frontend/src/api/client.ts` — два новых метода в `api`:
  - `exportProgress(): Promise<ProgressExportFile>` — `GET /progress/export`.
  - `importProgress(file, options?: {confirm?: boolean}):
    Promise<ImportResult>` — `POST /progress/import[?confirm=true]`, тело —
    сам файл (`JSON.stringify(file)`), без обёртки. На 409/400 бросает
    `ApiError` как всегда (`apiFetch` бросает на любой non-2xx) — вызывающая
    сторона узнаёт исход по `error.status`, тело — по `error.body` (типы
    выше).
- `services/frontend/src/routes.tsx` — новый top-level роут `transferRoute`
  (`path: "/transfer"`, `component: TransferPage`), добавлен в
  `rootRoute.addChildren([indexRoute, courseRoute, lessonRoute,
  transferRoute])`.
- `services/frontend/src/ui/Layout.tsx` — в хедере, рядом с заголовком,
  добавлен постоянный `<nav className="app-nav"><Link
  to="/transfer">Перенос прогресса</Link></nav>` — единственная точка входа
  на страницу переноса, видна на каждой странице приложения (страница
  переноса иначе была бы недостижима из UI).
- `services/frontend/src/index.css` — новые классы: `.app-nav` (хедер),
  `.transfer-section` (карточка секции экспорта/импорта, тот же визуальный
  язык что `.practice-view`), `.import-file-label`, `.import-summary`,
  `.import-warning` (акцент `--color-status-pending`, как «требует
  решения»), `.import-rejection` (акцент `--color-status-error`). Кнопки
  внутри переиспользуют существующие `.mark-done-button` /
  `.reset-sandbox-button` — новых классов кнопок не заводилось.

## Интерфейсный дайджест

- `api.exportProgress()` / `api.importProgress(file, {confirm})` — единая
  точка входа для transfer-эндпоинтов, как и весь остальной API-клиент
  (`api/client.ts`'s doc comment: «add methods here rather than calling
  `fetch` directly from a component»).
- Типы `ProgressExportFile`/`ImportResult`/`ImportStaleWarning`/
  `ImportRejection` в `api/types.ts` — при появлении новой задачи, которой
  нужно показать/разобрать файл прогресса (например, отдельный
  предпросмотр без реального импорта), эти типы уже есть, дублировать не
  нужно.
- Маршрут: `/transfer` (top-level, соседний с `/` и `/courses/$courseId`,
  не вложен никуда). Ссылка на него — в `Layout`'а хедере, не на
  `CoursesIndexPage` — так что доступна с любой страницы.

## Проверки — реальный вывод

### `npx tsc -b` / `npx eslint .` (в `services/frontend`)

Без ошибок и замечаний.

### `npx vitest run` (в `services/frontend`)

`Test Files 12 passed (12)` / `Tests 43 passed (43)` — из них 6 новых
(`TransferPage.test.tsx`: happy path скачивания с проверкой точного имени
файла + error path; `ImportDialog.test.tsx`: happy path импорта +
инвалидация кэша, edge case — нечитаемый JSON без обращения к сети, error
path — 409-предупреждение → подтверждение → успех + повторная инвалидация,
400-отклонение со списком `problems`).

Находка в процессе написания тестов: `@testing-library/user-event`'s
`upload()` фильтрует файлы по атрибуту `accept` инпута (как это делает
реальный OS file picker) — тест на «файл не JSON» первоначально давал
`.txt`/`text/plain`, который `user-event` тихо отбрасывал (событие `change`
не долетало до компонента вовсе), из-за чего первая попытка теста зависала
на `waitFor`. Исправлено: тестовый файл — `.json`/`application/json` с
невалидным содержимым внутри.

### `npm run build -w @trellis/frontend`

`tsc -b && vite build` — `0`, `349 modules transformed`. Предупреждение
vite про размер чанка (`> 500 kB`) — существовало до этой задачи
(SqlEditor/CodeMirror), не расследовалось (вне границы задачи).

### `bash .mvp/ci-mirror.sh`

Код `0` (первый прогон упал на старте одноразового Postgres — транзиентная
проблема поднятия контейнера, не связана с этой задачей; повторный прогон
— чисто). Backend: `# tests 217 / # pass 217 / # fail 0`. Frontend: `Test
Files 12 passed (12)` / `Tests 43 passed (43)`.

## Проверка границы

`git status --porcelain` — изменения только под `services/frontend/**`
(перечислены выше) плюс этот отчёт. `.mvp/ledger.md` (modified) и
`.mvp/briefs/task-016.md` (untracked) существовали до старта этой задачи —
не мои правки, принадлежат планировщику/диспатчеру.

## Deferred decisions

- **`ImportDialog` — не буквальный HTML `<dialog>`/модальное окно**, а
  инлайн-секция с пошаговым состоянием (выбор файла → результат/
  предупреждение). В проекте нет прецедента модальных окон, и продукт не
  требует именно модальности — многошаговый флоу («выбрал файл → увидел
  предупреждение → подтвердил») естественно ложится на условный рендер по
  состоянию одного `useMutation`, без порталов/фокус-трапов, которые внесли
  бы сложность без запрошенной пользы (KISS).
- **Клиентская валидация файла минимальна** (это JSON, это объект) —
  сознательно: дублировать `parseProgressExport`'ю логику на фронте значило
  бы поддерживать два источника истины о том, что такое валидный файл
  прогресса; сервер и так возвращает все проблемы разом
  (`problems: string[]`), которые рендерятся как есть.
- **`importMutation.variables` используется как хранилище «последнего
  выбранного файла» для кнопки подтверждения**, а не отдельный `useState` —
  подтверждено чтением исходника `@tanstack/query-core`'s `Mutation`
  reducer: `variables` не очищается при переходе в `error`, только новым
  `mutate()`/`reset()`. Один источник правды вместо двух совпадающих
  (anti-pattern «prop drilling через дублирующий state», которого явно
  просили избегать).
- **Ссылка на `/transfer` — в хедере (`Layout`), не на странице списка
  курсов** — транзит прогресса не привязан к конкретному курсу
  (экспортирует/импортирует прогресс по всем курсам сразу), поэтому место
  в общем хедере, видимое с любой страницы, точнее отражает область
  действия функции, чем размещение на `CoursesIndexPage`.

## Fix — ревью-находки

### minor: `ImportDialog.tsx:141` — переиспользование `mark-done-button`/`reset-sandbox-button`

**fixed.** Подтверждено при чтении: кнопки подтверждения/отмены
stale-импорта действительно использовали классы `mark-done-button`
(зачёт урока, `LessonView.tsx`) и `reset-sandbox-button` (сброс песочницы,
`PracticeView.tsx`) — совпадение чисто визуальное (тот же акцентный/
контурный стиль кнопки), связи по смыслу с импортом файла нет; находка
верна.

Фикс — не переименование существующих классов (это задело бы
`LessonView.tsx`/`PracticeView.tsx`, вне области находки), а добавление
собственных семантических имён для transfer-фичи, которые делят CSS-тело с
исходными через групповой селектор (сама декларация стиля одна, DRY не
нарушается):

- `services/frontend/src/index.css` — `.mark-done-button` →
  `.mark-done-button, .import-confirm-button` (и её `:disabled`);
  `.reset-sandbox-button` → `.reset-sandbox-button, .import-cancel-button`
  (и её `:disabled`); `.import-warning .mark-done-button` →
  `.import-warning .import-confirm-button` (override отступа теперь тоже
  адресует новый класс, а не старый).
- `services/frontend/src/features/transfer/ImportDialog.tsx` — кнопки
  «Импортировать всё равно»/«Отмена» теперь используют
  `import-confirm-button`/`import-cancel-button` вместо
  `mark-done-button`/`reset-sandbox-button`.

Визуальный результат не изменился (то же CSS-тело через групповой
селектор); классы в `LessonView.tsx`/`PracticeView.tsx` не трогались.

`bash .mvp/ci-mirror.sh` → код `0`: backend `# tests 217 / # pass 217 /
# fail 0`; frontend `Test Files 12 passed (12)` / `Tests 43 passed (43)`.

### 017
# Task 017 — пилотный контент-пакет `courses/pilot-sql/` — отчёт

## Что создано

- `courses/pilot-sql/manifest.yaml` — курс `id: pilot-sql`, `version: 1.0.0`,
  2 модуля, 7 уроков, 1 песочница (`id: main`, `type: postgres`).
- `courses/pilot-sql/lessons/*.md` (7 файлов) — Markdown-текст каждого
  урока, на русском.
- `courses/pilot-sql/sandbox/seed.sql` — одна таблица `books` (5 столбцов) +
  5 стартовых строк; DDL и данные в одном файле (единственный `seed`,
  указанный в манифесте).
- `courses/README.md` — формат контент-пакета для будущих авторов курсов
  (структура каталога, обязательные правила `manifest.yaml` дословно по
  `manifest.schema.json`/`validate.ts` из задачи 006/фикс-раундов), ссылка
  на `pilot-sql` как эталон.
- Удалён `courses/.gitkeep` (каталог больше не пуст).

## Структура курса (для 018/019 — smoke-тест/установщик)

- `intro` (Введение в SQL): `what-is-sql` (только content), `select-basics`
  (content + quiz, 1 верный / 2 неверных варианта с `explanation`),
  `practice-instock` (content + practice **без** `check` — самоотметка,
  задание "выбрать книги в наличии").
- `filtering` (Фильтрация и изменение данных): `where-clause` (content +
  quiz), `practice-add-book` (content + practice **с** `check` — INSERT,
  check: `select count(*) = 1 as ok from books where title = 'Мастер и
  Маргарита' and author = 'Михаил Булгаков'`), `practice-update-stock`
  (content + practice **с** `check` — UPDATE, check: `select in_stock =
  false as ok from books where id = 1`), `wrap-up` (только content).
- Все id (курс/модуль/урок/sandbox/вариант квиза) уникальны на своём
  уровне, урок — глобально по курсу; module/lesson id используют только
  `[A-Za-z0-9._-]`, начиная с буквы/цифры (URL/id-safe, как требует схема
  006/фикс-раундов).
- Каждый check-запрос — контракт "одна строка, один boolean" — проверен
  вживую (см. ниже), не только по форме текста.

## Верификация — реальный вывод

- `node --input-type=module` со `scanCoursesDir('./courses')` (реальный,
  собранный `services/backend/dist/courses/loader.js`, не собственная
  логика) — курс `pilot-sql` принят, `rejected: []`.
- `loadCoursePackage('./courses/pilot-sql')` — `ok: true`, все 7 уроков
  прочитаны с `content`, структура модулей/квизов/практики — как описано
  выше (точный per-lesson дамп снят и совпал с ожиданием).
- Одноразовый `postgres:17-alpine` в Docker: `sandbox/seed.sql` применяется
  без ошибок (5 строк книг); практический сценарий `practice-add-book`
  (INSERT нужной книги → check) и `practice-update-stock` (UPDATE `id=1` →
  check) оба дали check-результат `t` (true) — контракт "одна строка, один
  boolean" подтверждён на реальном Postgres, не только по тексту SQL.
- `bash .mvp/ci-mirror.sh` — код `0`: `npm ci` → lint (backend+frontend) →
  build → test (backend 217/217, 0 skip — одноразовый Postgres ci-mirror
  поднялся; frontend 43/43 vitest). Новых тестов не добавлял — задача
  контентная, не кодовая; существующий тест-сьют не менялся и не задет.
- `node scripts/check-text-sources.mjs` — код `0` (новые файлы — валидный
  UTF-8 текст, гейт не-текстовых байт не сработал).

## Интерфейсный дайджест для задач 018/019

- Курс для smoke-теста/установщика: `courseId = "pilot-sql"`,
  `sandboxId = "main"` (единственная песочница — можно не указывать
  `sandboxId` в вызовах, где он опционален).
- Пример "self-check" урока (без `check`): `lessonId =
  "practice-instock"` — прогоняется одной пользовательской SQL-попыткой
  и самоотметкой.
- Пример урока с автоматической проверкой: `lessonId =
  "practice-add-book"` (INSERT) или `"practice-update-stock"` (UPDATE) —
  оба содержат `practice.check`, возвращающий `true` после корректного
  запроса пользователя (запросы см. выше или в `manifest.yaml`).
- Пример урока с квизом: `lessonId = "select-basics"`, верный вариант
  `id: "select"`; `lessonId = "where-clause"`, верный вариант
  `id: "filter"`.
- Курс пройден полностью = пройдены все 7 уроков (нет отдельного
  "финального" урока с особой семантикой — `wrap-up` обычный content-урок).

## Deferred decisions

- **Язык контента — русский.** Продукт (`docs/product/business-logic.md`,
  весь UI-текст в отчётах предыдущих задач) на русском; явного требования
  на язык пилотного курса брифом не задано, выбрал согласованный с
  остальным продуктом язык.
- **Один общий `seed.sql` (DDL + данные), а не два файла.** Список файлов
  в брифе называет ровно `courses/pilot-sql/sandbox/seed.sql` (единственное
  число) — не стал заводить `01-schema.sql`/`02-data.sql`, как в
  синтетических тестовых фикстурах задачи 008 (там несколько файлов
  демонстрировали многофайловый seed как таковой; здесь бриф явно назвал
  один файл).
- **Тема курса — SQL на примере таблицы книг (`books`).** Бриф/продуктовые
  доки называют тему только как «пилот для обкатки платформы» /
  практика на SQL (`docs/product/business-logic.md`); конкретный домен
  (книги, а не сотрудники/заказы) — самостоятельный выбор, ничего в ядре
  или тестах от него не зависит (ядро специальность-агностично).
- **7 уроков / 2 модуля, смесь content-only, content+quiz, content+practice
  (с check и без)** — выбрано так, чтобы пилотный курс реально
  демонстрировал весь функционал формата (квиз, self-check практика,
  practice с check), а не был вырожденным одноурочным примером.

## Concerns

Нет — `DONE`, не `DONE_WITH_CONCERNS`: контент-пакет валиден по реальному
валидатору, seed и оба check-запроса проверены на живом Postgres, полный
`ci-mirror.sh` зелёный.

## Fix round (review findings)

Оба финдинга — **fixed**, `courses/pilot-sql/manifest.yaml` (единственный
файл в границе, единственный изменённый файл этого раунда).

- **minor, строка 62 (`practice-add-book` check).** Подтверждено чтением
  `manifest.yaml`: `check` проверял только `title`/`author`, хотя промпт
  урока (строка 61) явно требует `published_year = 1967, in_stock = true`
  — строка с верным названием/автором, но неверным годом или статусом
  наличия, проходила проверку. Исправлено — check теперь требует
  совпадения всех четырёх полей:
  `select count(*) = 1 as ok from books where title = 'Мастер и
  Маргарита' and author = 'Михаил Булгаков' and published_year = 1967
  and in_stock = true`.

- **bug, строка 69 (`practice-update-stock` check).** Подтверждено чтением
  `services/backend/src/practice/check.ts` (`runPracticeCheck`: `rows.length
  !== 1` → `throw violation(...)`, kind `check_contract_violation`) и
  `services/backend/src/routes/practice.ts` (`isPracticeCheckError(err)` →
  `reply.code(422)`, "Broken check query — course content, not a failed
  attempt"). Исходный check `select in_stock = false as ok from books
  where id = 1` возвращает ноль строк, если строки с `id = 1` больше нет —
  а песочница персистентна на весь сеанс курса и пользователь имеет полный
  SQL-доступ (не только SELECT), так что `delete from books where id = 1`
  на любом более раннем шаге делает этот check структурно битым: ученик
  получит 422 "сломанный контент курса" вместо честного pass/fail.
  Исправлено по образцу соседнего `practice-add-book` — паттерн
  `count(*) = 1`, устойчивый к отсутствию строки:
  `select count(*) = 1 as ok from books where id = 1 and in_stock =
  false`.

Проверено:
- `grep` по всему репозиторию (кроме `.mvp/review/*`,
  `.mvp/reports/task-017.md` — цитаты ревью/отчёта, не код) — на точный
  текст исходных check-запросов ссылок из тестов/фикстур нет, изменение
  безопасно.
- `bash .mvp/ci-mirror.sh` — код `0` (первый прогон упал на старте
  одноразового Postgres в докере — инфраструктурная флакиность запуска
  контейнера, не связанная с правкой; повторный прогон сразу после этого
  прошёл зелёным: backend 217/217, frontend 43/43, lint/build без ошибок).

## Project invariants
# Project invariants — Trellis

## Architectural invariants

- Ядро специальность-агностично: код backend/frontend не содержит знаний о конкретном курсе. Курс — данные (контент-пакет в `courses/`: manifest.yaml + Markdown-уроки), проходящие валидацию по схеме до показа пользователю. Хардкод названий модулей/уроков курса в коде запрещён.
- Развязка контента и прогресса: формат курса и формат прогресса — разные сущности с чёткой границей. Прогресс привязан к стабильным id модулей/уроков, никогда к индексам или названиям.
- Песочница практики — интерфейс с реализациями; Postgres — лишь одна из них. Именование и структура кода не должны требовать переписывания первой реализации при появлении второй.
- Postgres-песочница: отдельная схема + роль с правами только на эту схему. Seed- и check-запросы курса, как и запросы пользователя, выполняются от sandbox-роли — никогда от роли приложения или суперпользователя.
- Контракт check-запроса зачёта: возвращает одну строку с одним boolean-значением. Никакой другой логики зачёта («грейдера») в ядре.
- Всё локально: backend слушает только 127.0.0.1, наружу порты не публикуются; никаких внешних сервисов и отправки данных наружу.
- Данные прогресса — только в Postgres с именованным volume; пересоздание контейнеров не должно терять данные.
- Frontend работает с данными только через HTTP API backend; прямых подключений frontend к Postgres нет.

## Service boundaries

- backend: services/backend
- frontend: services/frontend
- postgres (инфраструктура, без кода): docker-compose.yml + docker/postgres/

## Forbidden edges

FORBIDDEN_EDGE: frontend --> postgres
FORBIDDEN_EDGE: frontend --> sandbox
BOUNDARY_EXEMPT: package.json
BOUNDARY_EXEMPT: package-lock.json

