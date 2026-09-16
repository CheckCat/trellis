# Reviewer replies: task 007

Raw, unparsed. One section per poll.

## reviewer-007-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```

## reviewer-007-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/backend/src/progress/repository.ts", "line": 85, "quote": "set course_version = excluded.course_version,\n               updated_at = now()", "summary": "markLessonCompleted's upsert always overwrites course_version with the caller's value (including null when courseVersion is omitted), so a repeat call that doesn't pass courseVersion silently wipes out a previously recorded version instead of leaving it untouched; currently unreachable since both routes always pass course.version, but the repository's own public contract and tests (which only exercise the no-version case on a first call) don't guard against a future caller (e.g. task 010's import) hitting this."}]
```

## reviewer-007-3

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity":"bug","file":"services/backend/src/progress/repository.ts","line":85,"quote":"set course_version = excluded.course_version,","summary":"markLessonCompleted's upsert always overwrites course_version with whatever this call passed (including null via `courseVersion ?? null`), so a repeat completion call made without a courseVersion silently erases a previously recorded one, contradicting model.ts's documented provenance semantics (`undefined` is described only for rows written before a version was ever known, not as something a later call can regress a row back to) — reachable directly via the public ProgressRepository API and untested."},{"severity":"minor","file":"services/backend/src/progress/reconcile.ts","line":105,"quote":"].sort();","summary":"recordedVersions uses the default lexicographic Array.sort() on version strings, which misorders multi-digit semver segments (e.g. \"0.10.0\" would sort before \"0.9.0\")."}]
```
