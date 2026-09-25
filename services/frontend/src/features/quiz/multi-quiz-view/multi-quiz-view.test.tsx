import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuizView } from "../quiz-view";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Rendered through QuizView on purpose: `multiple` on the quiz itself is
// what switches the whole UI to checkboxes, and that delegation is part of
// what these tests pin down.
const MULTI_QUIZ = {
  question: "Which of these change data?",
  multiple: true,
  options: [
    { id: "insert", text: "INSERT" },
    { id: "update", text: "UPDATE" },
    { id: "create", text: "CREATE TABLE" },
  ],
};

const COMPLETED_LESSON = {
  id: "l1",
  title: "Lesson",
  status: "completed",
  completionMode: "quiz",
  hasContent: true,
  hasQuiz: true,
  hasPractice: false,
};

const OPEN_LESSON = { ...COMPLETED_LESSON, status: "not_started" };

const COURSE_DONE = { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 1, completed: true };
const COURSE_OPEN = { ...COURSE_DONE, completedLessons: 0, completed: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderMultiQuiz(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <QuizView courseId="c1" lessonId="l1" quiz={MULTI_QUIZ} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("QuizView with a multi-select quiz", () => {
  it("renders checkboxes with a submit button that stays disabled until something is checked", async () => {
    renderMultiQuiz(async () => {
      throw new Error("nothing should be fetched before submit");
    });

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    const submit = screen.getByRole("button", { name: "Проверить" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("submits the checked set, marks every chosen option and re-fetches progress on the exact correct set (happy path)", async () => {
    const queryClient = renderMultiQuiz(async (url, init) => {
      expect(url).toBe("/api/courses/c1/lessons/l1/quiz/answer");
      expect(JSON.parse(String(init?.body))).toEqual({ optionIds: ["insert", "update"] });
      return jsonResponse({
        correct: true,
        options: [
          { id: "insert", correct: true },
          { id: "update", correct: true },
        ],
        lesson: COMPLETED_LESSON,
        course: COURSE_DONE,
      });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    await user.click(screen.getByRole("checkbox", { name: /UPDATE/ }));
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getAllByText("Верно")).toHaveLength(2));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("marks a wrong inclusion with its explanation, leaves unchosen options untouched and records nothing", async () => {
    const queryClient = renderMultiQuiz(async () =>
      jsonResponse({
        correct: false,
        options: [
          { id: "insert", correct: true },
          { id: "create", correct: false, explanation: "That one changes the schema, not the data." },
        ],
        lesson: OPEN_LESSON,
        course: COURSE_OPEN,
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    await user.click(screen.getByRole("checkbox", { name: /CREATE TABLE/ }));
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("Неверно")).toBeTruthy());
    expect(screen.getByText("Верно")).toBeTruthy();
    expect(screen.getByText("That one changes the schema, not the data.")).toBeTruthy();
    expect(screen.getByText("Не зачтено.")).toBeTruthy();
    // The unchosen option carries no verdict of any kind.
    expect(screen.getByRole("checkbox", { name: /UPDATE/ }).closest("li")?.textContent).not.toMatch(/Верно|Неверно/);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("explains a correct-but-incomplete set without revealing which options are missing", async () => {
    renderMultiQuiz(async () =>
      jsonResponse({
        correct: false,
        options: [{ id: "insert", correct: true }],
        lesson: OPEN_LESSON,
        course: COURSE_OPEN,
      }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("Отмечены не все верные варианты.")).toBeTruthy());
    // Every chosen option is right — no red badge anywhere.
    expect(screen.queryByText("Неверно")).toBeNull();
  });

  it("clears every badge the moment any checkbox changes, so a stale verdict never lingers", async () => {
    renderMultiQuiz(async () =>
      jsonResponse({
        correct: false,
        options: [{ id: "insert", correct: true }],
        lesson: OPEN_LESSON,
        course: COURSE_OPEN,
      }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    await user.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() => expect(screen.getByText("Отмечены не все верные варианты.")).toBeTruthy());

    await user.click(screen.getByRole("checkbox", { name: /UPDATE/ }));
    expect(screen.queryByText("Отмечены не все верные варианты.")).toBeNull();
    expect(screen.queryByText("Верно")).toBeNull();
  });

  it("shows a generic error message and keeps the form usable when the request fails (edge case)", async () => {
    renderMultiQuiz(async () => jsonResponse({ error: "internal_error", message: "boom" }, 500));

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /INSERT/ }));
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("Не удалось отправить ответ. Попробуйте ещё раз.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Проверить" }).hasAttribute("disabled")).toBe(false);
  });
});
