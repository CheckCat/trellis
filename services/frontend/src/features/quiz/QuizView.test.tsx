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
