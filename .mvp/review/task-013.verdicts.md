# Reviewer replies: task 013

Raw, unparsed. One section per poll.

## reviewer-013-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []

Reviewed the full diff package (routes.tsx wiring, api/client.ts + api/types.ts additions, index.css, App.test.tsx update) plus all four untracked new files with their tests (CoursePage.tsx/.test.tsx, ModuleList.tsx, LessonView.tsx/.test.tsx, Markdown.tsx/.test.tsx). Cross-checked the frontend's `CourseProgressResponse`/`LessonProgress`/`ModuleProgress`/`LessonDetailResponse` types against the actual backend JSON Schemas in `services/backend/src/routes/progress.ts` and `courses.ts` — field-for-field match. Verified `lessonCompletionMode`'s manual/quiz/practice semantics (`services/backend/src/progress/model.ts`) match the frontend's button-gating logic in `LessonView`'s `CompletionControl`, and confirmed via `reconcileCourseProgress` (`services/backend/src/progress/reconcile.ts`) that every lesson always appears in the progress tree regardless of status, so `LessonView`'s "lesson missing from progress tree" branch really is the documented rescan-race edge case, not a reachable bug. Boundary is clean (all changes under `services/frontend/**` plus exempt `package.json`/`package-lock.json`). No hardcoded course content, no direct Postgres access, no `dangerouslySetInnerHTML` (react-markdown, confirmed by its own script-injection test). All three brief deliverables present: module/lesson list with per-lesson status badges (`ModuleList.tsx`), Markdown lesson content render (`Markdown.tsx`), explicit "mark done" button gated to `completionMode === "manual"` only (`LessonView.tsx`).

One non-blocking observation (not filed as a finding — no offending code to quote): the report's "one test file per component" claim doesn't hold for `ModuleList.tsx`, which has no dedicated `ModuleList.test.tsx`; it's exercised only indirectly through `CoursePage.test.tsx`'s assertions on rendered module/lesson text and status labels. Coverage exists, just not isolated — worth the operator's awareness, not worth blocking.
```

## reviewer-013-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```

## reviewer-013-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/frontend/src/features/course/CoursePage.tsx", "line": 33, "quote": "<h1 className=\"page-heading\">{data.title}</h1>", "summary": "CoursePage drops the course description that the prior CourseDetailPage rendered (courseProgressResponseSchema has no description field, so this is an unavoidable but real loss of previously-shown info)."}]
```
