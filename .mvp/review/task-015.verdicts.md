# Reviewer replies: task 015

Raw, unparsed. One section per poll.

## reviewer-015-1

```
VERDICT: request-changes
CANNOT_VERIFY: none — the package's diff section only covered tracked-file changes, but its trailing "Untracked files (new, not yet added)" section supplied full content for all four brief-named files (PracticeView.tsx, SqlEditor.tsx, ResultTable.tsx, usePractice.ts) plus their tests and testSetup.ts, letting every brief requirement (CodeMirror editor, run, result table, verbatim Postgres error, check verdict, sandbox reset) be checked against the backend's actual schemas (routes/practice.ts, routes/sandbox.ts).
FINDINGS: [{"severity": "bug", "file": "services/frontend/src/features/practice/PracticeView.tsx", "line": 862, "quote": "<SqlEditor value={sql} onChange={setSql} onRun={() => run(sql)} busy={isRunning} />", "summary": "The run button is only guarded by isRunning (not isResetting) and the reset button (line 889) is only guarded by isResetting (not isRunning), so a slow-running practice query and a sandbox reset can be in flight together; if the run's response arrives after the reset's onSuccess already called runMutation.reset() to clear the stale result, the late run response repopulates execution with a result/check verdict computed against the pre-reset sandbox, silently misrepresenting the now-wiped sandbox's current state — the exact outcome usePractice.ts's reset handler (calling runMutation.reset() on success) was written to prevent, defeated because the outstanding mutationFn promise is never cancelled."}]
```

## reviewer-015-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/frontend/src/features/practice/PracticeView.tsx", "line": 72, "quote": "{resetError !== null && <p className=\"muted-note\">Не удалось сбросить песочницу.</p>}", "summary": "Sandbox-reset failures show a generic hardcoded message instead of the backend's actual error text, unlike the run-error branch (line 45) which surfaces ApiError.message verbatim — inconsistent with the 'show backend errors as-is' pattern this same component otherwise follows, and drops sandbox.ts's own course-author-actionable detail (e.g. which seed file failed)."}, {"severity": "minor", "file": "services/frontend/src/features/practice/PracticeView.tsx", "line": 69, "quote": "<button type=\"button\" className=\"reset-sandbox-button\" onClick={reset} disabled={isResetting}>", "summary": "The reset-sandbox button is disabled only by isRunning, so a learner can reset the sandbox while a practice run is still in flight against it; verified harmless for displayed data (react-query's MutationObserver.reset() detaches the observer from the in-flight run so no stale result can reappear) but is a slightly confusing UX allowance with no stated justification."}]
```

## reviewer-015-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/frontend/src/features/practice/ResultTable.tsx", "line": 29, "quote": "<th key={column.name}>{column.name}</th>", "summary": "Column headers are keyed by name, but the file's own doc comment notes duplicate column names are valid SQL (`select 1 as a, 2 as a`), so this key is not guaranteed unique unlike the row/cell keys below which deliberately use positional indices for the same reason."}, {"severity": "minor", "file": "services/frontend/src/features/practice/PracticeView.tsx", "line": 69, "quote": "<button type=\"button\" className=\"reset-sandbox-button\" onClick={reset} disabled={isResetting}>", "summary": "Reset is only disabled while resetting, not while a run is in flight (and the run button is only disabled while running, not while resetting), so clicking Run then quickly Reset can leave the run's late-arriving response repopulating `execution` right after the sandbox was reported reset."}, {"severity": "minor", "file": "services/frontend/src/features/practice/PracticeView.tsx", "line": 72, "quote": "{resetError !== null && <p className=\"muted-note\">Не удалось сбросить песочницу.</p>}", "summary": "Reset failures always show a generic message instead of the backend's own error text, unlike runError a few lines above which deliberately surfaces `ApiError.message` verbatim because \"practice failures at the request level are almost always meaningful ... text that must reach the learner verbatim\" — the same sandbox-reset endpoint can return the identical 422/503 kinds (seed_failed, unavailable) but that text is discarded here."}]
```
