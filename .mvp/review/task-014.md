# Review: task 014

## Commits (9f395227edf81aa302c254d4dc072eee257e8065..HEAD)


## Diffstat (9f395227edf81aa302c254d4dc072eee257e8065 -> working tree)

 .mvp/ledger.md                                     |  2 +
 services/frontend/src/api/client.ts                | 11 ++++
 services/frontend/src/api/types.ts                 | 15 +++++
 .../src/features/lesson/LessonView.test.tsx        | 56 ++++++++++++++++
 .../frontend/src/features/lesson/LessonView.tsx    |  9 +++
 services/frontend/src/index.css                    | 76 ++++++++++++++++++++++
 6 files changed, 169 insertions(+)

## Diff (9f395227edf81aa302c254d4dc072eee257e8065 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index cd3e86e..d64b24f 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -17,3 +17,5 @@ Task 021: complete (ef5b165088ce97781679ac01da85f9b2fb44a5c5)
 Task 011: complete (8f784135283022cccfc9ed2d19b8151bd36fd1e0)
   concern (task 012): declared-files hint mismatch (non-blocking, initial): missing-declared: services/backend/tests/courses.test.ts, services/backend/tests/progress.test.ts, services/backend/tests/sandbox.test.ts, services/backend/tests/transfer.test.ts
 Task 012: complete (0f47e8d6574564e44f4f977b8da54d863cc2e94c)
+  concern (task 013): review split: 1 finding(s) came from a minority of 3 polls — the others approved
+Task 013: complete (9f395227edf81aa302c254d4dc072eee257e8065)
diff --git a/services/frontend/src/api/client.ts b/services/frontend/src/api/client.ts
index b10148f..1dcad05 100644
--- a/services/frontend/src/api/client.ts
+++ b/services/frontend/src/api/client.ts
@@ -6,6 +6,7 @@ import type {
   HealthResponse,
   LessonCompletionResponse,
   LessonDetailResponse,
+  QuizAnswerResponse,
 } from "./types";
 
 /**
@@ -81,4 +82,14 @@ export const api = {
       `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
       { method: "POST" },
     ),
+
+  answerQuiz: (courseId: string, lessonId: string, optionId: string): Promise<QuizAnswerResponse> =>
+    apiFetch<QuizAnswerResponse>(
+      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/quiz/answer`,
+      {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({ optionId }),
+      },
+    ),
 };
diff --git a/services/frontend/src/api/types.ts b/services/frontend/src/api/types.ts
index 8df96e2..3651963 100644
--- a/services/frontend/src/api/types.ts
+++ b/services/frontend/src/api/types.ts
@@ -156,3 +156,18 @@ export interface LessonCompletionResponse {
     completed: boolean;
   };
 }
+
+/** POST /courses/:courseId/lessons/:lessonId/quiz/answer — routes/quiz.ts's
+ * `quizAnswerResponseSchema`. Deliberately carries no way to learn which
+ * option is correct beyond `correct`/`explanation` for the option the
+ * caller itself submitted (the endpoint's own docstring: "the client learns
+ * exactly one bit... plus that option's own explanation") — never widen
+ * this type with a per-option verdict map or the correct option's id. */
+export interface QuizAnswerResponse {
+  correct: boolean;
+  /** Present only when the submitted option itself has an explanation
+   * (`CourseQuizOption.explanation` is optional server-side). */
+  explanation?: string;
+  lesson: LessonProgress;
+  course: LessonCompletionResponse["course"];
+}
diff --git a/services/frontend/src/features/lesson/LessonView.test.tsx b/services/frontend/src/features/lesson/LessonView.test.tsx
index 4ef5261..26973a4 100644
--- a/services/frontend/src/features/lesson/LessonView.test.tsx
+++ b/services/frontend/src/features/lesson/LessonView.test.tsx
@@ -154,6 +154,62 @@ describe("LessonView", () => {
     expect(screen.queryByRole("button", { name: "Отметить пройденным" })).toBeNull();
   });
 
+  it("renders the quiz UI for a quiz-graded lesson whose content carries a quiz (task 014 wiring)", async () => {
+    mockApi({
+      "/api/health": healthOk,
+      "/api/courses/c1/lessons/l1": () =>
+        jsonResponse({
+          id: "l1",
+          title: "Quiz Lesson",
+          content: "Body.",
+          quiz: {
+            question: "2 + 2?",
+            options: [
+              { id: "a", text: "4" },
+              { id: "b", text: "5" },
+            ],
+          },
+        }),
+      "/api/courses/c1/progress": () =>
+        jsonResponse({
+          courseId: "c1",
+          courseVersion: "1.0.0",
+          title: "Course One",
+          totalLessons: 1,
+          completedLessons: 0,
+          completed: false,
+          orphanedLessons: [],
+          recordedVersions: [],
+          modules: [
+            {
+              id: "m1",
+              title: "Module One",
+              totalLessons: 1,
+              completedLessons: 0,
+              completed: false,
+              lessons: [
+                {
+                  id: "l1",
+                  title: "Quiz Lesson",
+                  status: "not_started",
+                  completionMode: "quiz",
+                  hasContent: true,
+                  hasQuiz: true,
+                  hasPractice: false,
+                },
+              ],
+            },
+          ],
+        }),
+    });
+
+    renderAt("/courses/c1/lessons/l1");
+
+    await waitFor(() => expect(screen.getByText("2 + 2?")).toBeTruthy());
+    expect(screen.getByRole("button", { name: "4" })).toBeTruthy();
+    expect(screen.getByRole("button", { name: "5" })).toBeTruthy();
+  });
+
   it("shows a not-found message for an unknown lesson (error path)", async () => {
     mockApi({
       "/api/health": healthOk,
diff --git a/services/frontend/src/features/lesson/LessonView.tsx b/services/frontend/src/features/lesson/LessonView.tsx
index dccd5b2..88207e2 100644
--- a/services/frontend/src/features/lesson/LessonView.tsx
+++ b/services/frontend/src/features/lesson/LessonView.tsx
@@ -2,6 +2,7 @@ import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
 import { Link } from "@tanstack/react-router";
 import { ApiError, api } from "../../api/client";
 import type { LessonCompletionMode } from "../../api/types";
+import { QuizView } from "../quiz/QuizView";
 import { Markdown } from "./Markdown";
 
 const NON_MANUAL_NOTE: Record<Exclude<LessonCompletionMode, "manual">, string> = {
@@ -82,6 +83,14 @@ export function LessonView({ courseId, lessonId }: { courseId: string; lessonId:
       </p>
       <h1 className="page-heading">{contentQuery.data.title}</h1>
       {contentQuery.data.content !== undefined && <Markdown source={contentQuery.data.content} />}
+      {lessonProgress.completionMode === "quiz" && contentQuery.data.quiz !== undefined && (
+        // `LessonDetailResponse.quiz` and the tree's `completionMode` come
+        // from two separate queries (see the module doc comment above) —
+        // guarding on both, rather than trusting `completionMode` alone, is
+        // what keeps this from ever rendering `QuizView` with `quiz` typed
+        // as possibly-undefined.
+        <QuizView courseId={courseId} lessonId={lessonId} quiz={contentQuery.data.quiz} />
+      )}
       <CompletionControl
         mode={lessonProgress.completionMode}
         isCompleted={isCompleted}
diff --git a/services/frontend/src/index.css b/services/frontend/src/index.css
index 3ffd8c5..8852c22 100644
--- a/services/frontend/src/index.css
+++ b/services/frontend/src/index.css
@@ -205,3 +205,79 @@ a {
   opacity: 0.6;
   cursor: default;
 }
+
+.quiz-view {
+  margin: 1rem 0;
+}
+
+.quiz-question {
+  font-weight: 600;
+  margin: 0 0 0.75rem;
+}
+
+.answer-option-list {
+  list-style: none;
+  margin: 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 0.5rem;
+}
+
+.answer-option {
+  width: 100%;
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 0.75rem;
+  padding: 0.6rem 1rem;
+  background-color: var(--color-surface);
+  border: 1px solid var(--color-border);
+  border-radius: 0.5rem;
+  font-size: 0.9rem;
+  text-align: left;
+  color: inherit;
+  cursor: pointer;
+}
+
+.answer-option:hover:not(:disabled) {
+  border-color: var(--color-accent);
+}
+
+.answer-option:disabled {
+  cursor: default;
+}
+
+.answer-option--pending {
+  border-color: var(--color-status-pending);
+}
+
+.answer-option--correct {
+  border-color: var(--color-status-ok);
+  background-color: var(--color-accent-soft);
+}
+
+.answer-option--incorrect {
+  border-color: var(--color-status-error);
+}
+
+.answer-option-status {
+  font-size: 0.8rem;
+  color: var(--color-text-muted);
+  white-space: nowrap;
+}
+
+.answer-option--correct .answer-option-status {
+  color: var(--color-status-ok);
+}
+
+.answer-option--incorrect .answer-option-status {
+  color: var(--color-status-error);
+}
+
+.answer-option-explanation {
+  margin: 0.3rem 0 0;
+  padding: 0 1rem;
+  font-size: 0.85rem;
+  color: var(--color-text-muted);
+}
```

## Untracked files (new, not yet added)

### services/frontend/src/features/quiz/AnswerOption.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnswerOption } from "./AnswerOption";

afterEach(() => {
  cleanup();
});

const OPTION = { id: "o1", text: "SELECT 1;" };

describe("AnswerOption", () => {
  it("calls onSelect when clicked in idle state and shows no status/explanation (happy path)", async () => {
    const onSelect = vi.fn();
    render(<AnswerOption option={OPTION} status="idle" disabled={false} onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "SELECT 1;" });
    expect(button.hasAttribute("disabled")).toBe(false);

    const user = userEvent.setup();
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders a wrong verdict with its explanation and stays clickable (error path)", () => {
    render(
      <AnswerOption
        option={OPTION}
        status="incorrect"
        explanation="Missing FROM clause."
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Неверно")).toBeTruthy();
    expect(screen.getByText("Missing FROM clause.")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });

  it("disables the button while pending and omits explanation text for a graded-but-unexplained option (edge case)", () => {
    render(<AnswerOption option={OPTION} status="pending" disabled={true} onSelect={vi.fn()} />);

    expect(screen.getByText("Проверяем…")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

    cleanup();

    // A correct option with no `explanation` (server omits the field when
    // the option itself has none) must not render an empty explanation
    // paragraph.
    render(<AnswerOption option={OPTION} status="correct" disabled={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Верно")).toBeTruthy();
    expect(screen.queryByText("", { selector: ".answer-option-explanation" })).toBeNull();
  });
});
```

### services/frontend/src/features/quiz/AnswerOption.tsx

```
import type { PublicQuizOption } from "../../api/types";

export type AnswerOptionStatus = "idle" | "pending" | "correct" | "incorrect";

const STATUS_LABEL: Record<Exclude<AnswerOptionStatus, "idle">, string> = {
  pending: "Проверяем…",
  correct: "Верно",
  incorrect: "Неверно",
};

/**
 * One selectable quiz option. Purely presentational — `QuizView` decides
 * `status` per render from `useQuiz`'s verdict, this component just paints
 * it: an unanswered option is a plain button, the option most recently
 * submitted turns green (with its own explanation, if it has one) when
 * right or red (with its explanation) when wrong. No other option's status
 * is ever implied, matching the backend's "reveals nothing about options
 * the caller didn't pick" contract (`routes/quiz.ts`).
 */
export function AnswerOption({
  option,
  status,
  explanation,
  disabled,
  onSelect,
}: {
  option: PublicQuizOption;
  status: AnswerOptionStatus;
  explanation?: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const isGraded = status === "correct" || status === "incorrect";

  return (
    <li>
      <button
        type="button"
        className={`answer-option${status === "idle" ? "" : ` answer-option--${status}`}`}
        onClick={onSelect}
        disabled={disabled}
      >
        <span>{option.text}</span>
        {status !== "idle" && <span className="answer-option-status">{STATUS_LABEL[status]}</span>}
      </button>
      {isGraded && explanation !== undefined && <p className="answer-option-explanation">{explanation}</p>}
    </li>
  );
}
```

### services/frontend/src/features/quiz/QuizView.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuizView } from "./QuizView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const QUIZ = {
  question: "Which query selects everything from t?",
  options: [
    { id: "a", text: "SELECT * FROM t;" },
    { id: "b", text: "DROP TABLE t;" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderQuiz(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <QuizView courseId="c1" lessonId="l1" quiz={QUIZ} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const ANSWER_URL = "/api/courses/c1/lessons/l1/quiz/answer";

describe("QuizView", () => {
  it("shows a visual confirmation and re-fetches course progress on a correct answer (happy path)", async () => {
    const queryClient = renderQuiz(async (url) => {
      expect(url).toBe(ANSWER_URL);
      return jsonResponse({
        correct: true,
        lesson: {
          id: "l1",
          title: "Lesson",
          status: "completed",
          completionMode: "quiz",
          hasContent: true,
          hasQuiz: true,
          hasPractice: false,
        },
        course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 1, completed: true },
      });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /SELECT \* FROM t;/ }));

    await waitFor(() => expect(screen.getByText("Верно")).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("highlights the wrong option with its explanation, keeps other options untouched, and allows retrying (unlimited attempts)", async () => {
    const queryClient = renderQuiz(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { optionId: string };
      if (body.optionId === "b") {
        return jsonResponse({
          correct: false,
          explanation: "This deletes the table instead.",
          lesson: {
            id: "l1",
            title: "Lesson",
            status: "not_started",
            completionMode: "quiz",
            hasContent: true,
            hasQuiz: true,
            hasPractice: false,
          },
          course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 0, completed: false },
        });
      }
      return jsonResponse({
        correct: true,
        lesson: {
          id: "l1",
          title: "Lesson",
          status: "completed",
          completionMode: "quiz",
          hasContent: true,
          hasQuiz: true,
          hasPractice: false,
        },
        course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 1, completed: true },
      });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /DROP TABLE t;/ }));

    await waitFor(() => expect(screen.getByText("Неверно")).toBeTruthy());
    expect(screen.getByText("This deletes the table instead.")).toBeTruthy();
    // Wrong answer must not trigger a re-fetch (nothing was recorded).
    expect(invalidateSpy).not.toHaveBeenCalled();
    // The other option is untouched, not silently marked correct.
    expect(screen.getByRole("button", { name: /SELECT \* FROM t;/ }).className).not.toContain("answer-option--");

    await user.click(screen.getByRole("button", { name: /SELECT \* FROM t;/ }));
    await waitFor(() => expect(screen.getByText("Верно")).toBeTruthy());
    // The previously-wrong option's badge/explanation is gone now that a
    // different option was picked.
    expect(screen.queryByText("Неверно")).toBeNull();
    expect(screen.queryByText("This deletes the table instead.")).toBeNull();
  });

  it("shows a generic error message and leaves options re-clickable when the request fails (edge case)", async () => {
    renderQuiz(async () => jsonResponse({ error: "internal_error", message: "boom" }, 500));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /SELECT \* FROM t;/ }));

    await waitFor(() => expect(screen.getByText("Не удалось отправить ответ. Попробуйте ещё раз.")).toBeTruthy());
    expect(screen.getByRole("button", { name: /SELECT \* FROM t;/ }).hasAttribute("disabled")).toBe(false);
  });
});
```

### services/frontend/src/features/quiz/QuizView.tsx

```
import type { PublicQuiz, PublicQuizOption } from "../../api/types";
import { AnswerOption, type AnswerOptionStatus } from "./AnswerOption";
import { useQuiz, type QuizVerdict } from "./useQuiz";

function optionStatus(
  option: PublicQuizOption,
  verdict: QuizVerdict | undefined,
  pendingOptionId: string | undefined,
): AnswerOptionStatus {
  if (pendingOptionId === option.id) {
    return "pending";
  }
  if (verdict !== undefined && verdict.optionId === option.id) {
    return verdict.correct ? "correct" : "incorrect";
  }
  return "idle";
}

/**
 * A lesson's quiz: pick an option, get graded, try again if wrong —
 * unlimited attempts, no attempt history kept (`routes/quiz.ts`'s product
 * model). Deliberately doesn't take an `isCompleted` prop: a right answer
 * is always safe to resubmit (the backend never un-completes a passed
 * lesson), so this renders interactive the same way whether the lesson was
 * already completed in an earlier session or not — `LessonView` is the one
 * that shows the "already completed" note above this, from the progress
 * tree it already has.
 */
export function QuizView({ courseId, lessonId, quiz }: { courseId: string; lessonId: string; quiz: PublicQuiz }) {
  const { verdict, pendingOptionId, isError, submit } = useQuiz(courseId, lessonId);
  const disabled = pendingOptionId !== undefined;

  return (
    <section className="quiz-view">
      <p className="quiz-question">{quiz.question}</p>
      <ul className="answer-option-list">
        {quiz.options.map((option) => (
          <AnswerOption
            key={option.id}
            option={option}
            status={optionStatus(option, verdict, pendingOptionId)}
            explanation={verdict?.optionId === option.id ? verdict.explanation : undefined}
            disabled={disabled}
            onSelect={() => submit(option.id)}
          />
        ))}
      </ul>
      {isError && <p className="muted-note">Не удалось отправить ответ. Попробуйте ещё раз.</p>}
    </section>
  );
}
```

### services/frontend/src/features/quiz/useQuiz.ts

```
import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * What the most recently submitted answer told the caller about the option
 * it chose. Never more than that: `routes/quiz.ts`'s own contract is "the
 * client learns exactly one bit... plus that option's own explanation" —
 * this hook can't track a per-option verdict map or the correct option's id
 * because the backend response never carries either.
 */
export interface QuizVerdict {
  optionId: string;
  correct: boolean;
  explanation?: string;
}

/**
 * Drives one quiz's answer-submission flow for `QuizView`. There is no
 * "locked" state to represent — the product model is unlimited attempts,
 * never un-completing a lesson once it's right (`routes/quiz.ts`) — so this
 * hook only ever remembers the verdict for the option most recently
 * submitted, and clears it the instant a different option is picked so a
 * stale correct/incorrect badge never lingers on an option the caller
 * didn't just try.
 */
export function useQuiz(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();
  const [verdict, setVerdict] = useState<QuizVerdict | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: (optionId: string) => api.answerQuiz(courseId, lessonId, optionId),
    onSuccess: (data, optionId) => {
      setVerdict({ optionId, correct: data.correct, explanation: data.explanation });
      if (data.correct) {
        // Re-fetch rather than hand-patch the cache: the response also
        // carries fresh module/course counters this hook doesn't otherwise
        // see — same reasoning as LessonView's manual-complete mutation.
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  const submit = useCallback(
    (optionId: string) => {
      setVerdict(undefined);
      mutation.mutate(optionId);
    },
    [mutation],
  );

  return {
    verdict,
    /** The option currently awaiting a verdict, if any — `undefined` means
     * nothing is in flight. `QuizView` disables every option while this is
     * set, so only one answer can be in flight at a time. */
    pendingOptionId: mutation.isPending ? mutation.variables : undefined,
    isError: mutation.isError,
    submit,
  };
}
```

