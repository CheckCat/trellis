# Reviewer replies: task 017

Raw, unparsed. One section per poll.

## reviewer-017-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []

Independent verification performed beyond the report's claims: ran the real `loadCoursePackage`/`scanCoursesDir` (built `services/backend/dist/courses/`) against `courses/pilot-sql` — accepted, 0 rejected, all 7 lessons load with correct content/quiz/practice flags matching the manifest. Spun a disposable `postgres:17-alpine`, applied `sandbox/seed.sql`, and ran both `practice.check` queries before/after the expected user action — each returned exactly one row with one boolean column, correctly reflecting incomplete→complete. Ran `node scripts/check-text-sources.mjs` (exit 0). Cross-checked all ids (course/module/lesson/sandbox/quiz-option) against the brief's/task-006's regex and uniqueness rules, the quiz "exactly one correct + explanation on all incorrect options" rule, `practice.sandbox` references, and `courses/README.md's documented rules against the actual schema — all consistent. No files outside the task's declared boundary were touched by the implementer (the `.mvp/ledger.md` diff in the package is pipeline bookkeeping, not part of this task's deliverable).
```

## reviewer-017-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity":"minor","file":"courses/pilot-sql/manifest.yaml","line":62,"quote":"check: \"select count(*) = 1 as ok from books where title = 'Мастер и Маргарита' and author = 'Михаил Булгаков'\"","summary":"Check only verifies title/author exist together; a row inserted with wrong published_year or in_stock (both explicitly requested in the prompt) still passes."},{"severity":"minor","file":"courses/pilot-sql/manifest.yaml","line":69,"quote":"check: \"select in_stock = false as ok from books where id = 1\"","summary":"Check only inspects row id=1; running the exact mistake the lesson text warns about (UPDATE without WHERE, flipping in_stock for every row) still passes."}]
```

## reviewer-017-3

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity":"bug","file":"courses/pilot-sql/manifest.yaml","line":69,"quote":"check: \"select in_stock = false as ok from books where id = 1\"","summary":"This check assumes row id=1 always exists, but the sandbox's `books` table persists across the whole course session and the user has full SQL access (not just SELECT), so a `delete from books where id = 1` (or similar) at any earlier point makes this query return zero rows; `services/backend/src/practice/check.ts`'s `runPracticeCheck` treats a non-single-row result as `check_contract_violation` and `routes/practice.ts` surfaces it to the learner as a 422 \"broken course content\" error instead of pass/fail feedback, unlike the sibling `practice-add-book` check which uses a `count(*) = 1` pattern that stays robust to a missing row."},{"severity":"minor","file":"courses/pilot-sql/manifest.yaml","line":62,"quote":"check: \"select count(*) = 1 as ok from books where title = 'Мастер и Маргарита' and author = 'Михаил Булгаков'\"","summary":"The check only matches on title/author even though the lesson prompt (line 61) also asks for `published_year = 1967, in_stock = true`, so a user can pass while submitting the wrong year or stock value."}]
```
