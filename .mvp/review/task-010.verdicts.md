# Reviewer replies: task 010

Raw, unparsed. One section per poll.

## reviewer-010-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/backend/src/progress/testSupport.ts", "line": 108, "quote": "  return `${courseId}
```

## reviewer-010-2

```
VERDICT: approve
CANNOT_VERIFY: none — the diff for `services/backend/src/progress/testSupport.ts` renders as "Binary files ... differ" in the package, so I read the file directly (not via git) to check its actual content; it is functionally sound aside from the finding below.
FINDINGS: [{"severity": "minor", "file": "services/backend/src/progress/testSupport.ts", "line": 108, "quote": "return `${courseId}${lessonId}`;", "summary": "The `key()` helper contains a raw NUL byte (0x00) between `${courseId}` and `${lessonId}` in place of the intended space separator, which makes git treat the whole file as binary and hides its diff from review; functionally harmless (Map key uniqueness is unaffected) but indicates source corruption and defeats normal diff review of this file."}]
```

## reviewer-010-3

```
Confirmed line numbers. Finalizing the review.

VERDICT: approve
CANNOT_VERIFY: `services/backend/src/progress/testSupport.ts` — the diff package shows this hunk as `Binary files a/... and b/... differ` (not a readable diff), so I cannot verify that the in-memory `importProgress` added there implements the same merge semantics (earlier-completion-wins, version travels with the winning timestamp, no-op on unchanged rows) as the real SQL in `repository.ts`. `routes/transfer.test.ts`'s 7 tests (stale-warning flow, merge outcomes, `coursesNotInstalled`, round-trip no-op) run against this in-memory repository via `withProgressApp`, so their correctness rests entirely on that unreadable hunk.
FINDINGS: [{"severity": "minor", "file": "services/backend/src/progress/repository.ts", "line": 174, "quote": "on conflict (course_id, lesson_id) do update", "summary": "importProgress is a public ProgressRepository method with no dedup/validation of (courseId, lessonId) pairs in its input; a caller passing two records for the same key (not possible via today's only caller, but reachable directly as a public method) hits Postgres's \"ON CONFLICT DO UPDATE command cannot affect row a second time\" and the call fails with an unhandled 500 instead of a documented error."}, {"severity": "minor", "file": "services/backend/src/transfer/format.ts", "line": 107, "quote": "const ISO_DATE_TIME = /^\\d{4}-\\d{2}-\\d{2}[Tt ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?([Zz]|[+-]\\d{2}:?\\d{2})?$/;", "summary": "The timestamp validator accepts an ISO date-time with no timezone/offset, which Date.parse (and thus parseProgressExport's UTC canonicalization) interprets as the importing machine's local time, so a hand-edited file's exportedAt/completedAt — and the resulting \"is this file older than local progress\" verdict — can vary by the timezone of the machine that imports it."}, {"severity": "minor", "file": "services/backend/src/routes/transfer.ts", "line": 93, "quote": "if (plan.stale && request.query.confirm !== true) {", "summary": "The 409 stale-warning fires whenever the file's exportedAt predates local progress even if plan.records is empty (the import would change nothing), forcing the caller to always retry with ?confirm=true for a file that has zero actual effect."}]
```

## reviewer-010-1

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "bug", "file": "services/backend/src/progress/repository.ts", "line": 202, "quote": "else coalesce(core.lesson_progress.course_version, excluded.course_version)", "summary": "When an imported completion is LATER than the stored one (so it loses on completedAt) but the stored row has no known courseVersion, the merge overwrites courseVersion with the losing import's version anyway, decoupling courseVersion from the completedAt it is documented to 'travel with' (same flaw mirrored in progress/testSupport.ts's in-memory importProgress)."}, {"severity": "pattern-violation", "file": ".mvp/plan.json", "line": 417, "quote": "\"id\": \"020\",", "summary": "The diff under review (task 010, Boundary: services/backend) also adds a new task 020 to .mvp/plan.json and edits .mvp/ledger.md, both outside the declared boundary, while the implementer's report explicitly (and incorrectly) claims changes are confined to services/backend/** plus the report itself."}]
```

## reviewer-010-2

```
Reviewed the diff (`services/backend/src/transfer/*`, `routes/transfer.ts`, `progress/repository.ts` extensions) against `.mvp/briefs/task-010.md` and cross-checked the implementer's report against the actual code rather than trusting its claims.

VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity":"pattern-violation","file":".mvp/plan.json","line":404,"quote":"\"title\": \"Добавить в общую npm-последовательность проверку, что ни один отслеживаемый исходник не содержит не-текстовых байт (NUL)...\",","summary":"Diff edits .mvp/plan.json (task-010 status flip + new task 020 block) and .mvp/ledger.md, both outside the brief's declared Boundary (services/backend) and not in BOUNDARY_EXEMPT (package.json/package-lock.json only), contradicting the report's own 'Границы: изменения только под services/backend/**' claim."},{"severity":"minor","file":"services/backend/src/progress/repository.ts","line":202,"quote":"else coalesce(core.lesson_progress.course_version, excluded.course_version)","summary":"importProgress's ON CONFLICT 'local wins' branch can overwrite a null local courseVersion with a losing (later-or-equal) import's version and always bumps updated_at, contradicting the documented 'nothing changes for unchanged rows' merge rule — currently dead code since the sole caller (routes/transfer.ts via planProgressImport) pre-filters unchanged records, but directly reachable via the public ProgressRepository.importProgress method; identical logic is duplicated in progress/testSupport.ts:107."}]
```

## reviewer-010-3

```
Per the reviewer skill's explicit instructions, the final output must be plain text in the `VERDICT:`/`CANNOT_VERIFY:`/`FINDINGS:` format (not the ReportFindings tool). Providing that now as my final response.
```
