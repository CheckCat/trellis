# Reviewer replies: task 011

Raw, unparsed. One section per poll.

## reviewer-011-1

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "bug", "file": "services/frontend/src/routes.tsx", "line": 83, "quote": "return <p className=\"muted-note\">Курс «{courseId}» не найден.</p>;", "summary": "CourseDetailPage's isError branch shows \"course not found\" for any query failure (network error, 500, etc.), not just an actual 404 — unlike CoursesIndexPage's sibling error branch which correctly shows a generic \"failed to load\" message for the same class of failure, this page falsely tells the user a course doesn't exist when the backend is merely unreachable or erroring."}]
```

## reviewer-011-2

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "bug", "file": "services/frontend/src/routes.tsx", "line": 83, "quote": "return <p className=\"muted-note\">Курс «{courseId}» не найден.</p>;", "summary": "CourseDetailPage shows \"course not found\" for any query error (network failure, 500, backend outage), not only an actual 404, unlike CoursesIndexPage's generic failure message for the same class of errors."}]
```

## reviewer-011-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/frontend/src/ui/Layout.tsx", "line": 28, "quote": "const state = isPending ? \"loading\" : isError || data?.status !== \"ok\" ? \"disconnected\" : \"connected\";", "summary": "data?.status !== \"ok\" is unreachable dead code: per routes/health.ts, HTTP 200 always sends status:\"ok\" and HTTP 503 makes apiFetch throw before data is ever populated, so isError alone always decides \"disconnected\"."}, {"severity": "minor", "file": "services/frontend/src/routes.tsx", "line": 83, "quote": "return <p className=\"muted-note\">Курс «{courseId}» не найден.</p>;", "summary": "Any getCourse failure (network error, 500, etc.), not only an actual 404, is reported to the user as \"course not found\", misrepresenting the real cause of the error."}]
```
