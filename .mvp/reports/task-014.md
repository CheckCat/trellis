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
