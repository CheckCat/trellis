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
