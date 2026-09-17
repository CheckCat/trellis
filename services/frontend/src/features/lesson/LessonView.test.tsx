import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../routes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockApi(handlers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const handler = handlers[url];
      if (handler === undefined) {
        throw new Error(`unexpected fetch to ${url}`);
      }
      return handler();
    }),
  );
}

const healthOk = () => jsonResponse({ status: "ok", db: "ok" });

function manualProgress(status: "completed" | "not_started") {
  return jsonResponse({
    courseId: "c1",
    courseVersion: "1.0.0",
    title: "Course One",
    totalLessons: 1,
    completedLessons: status === "completed" ? 1 : 0,
    completed: status === "completed",
    orphanedLessons: [],
    recordedVersions: [],
    modules: [
      {
        id: "m1",
        title: "Module One",
        totalLessons: 1,
        completedLessons: status === "completed" ? 1 : 0,
        completed: status === "completed",
        lessons: [
          {
            id: "l1",
            title: "Lesson One",
            status,
            completionMode: "manual",
            hasContent: true,
            hasQuiz: false,
            hasPractice: false,
          },
        ],
      },
    ],
  });
}

describe("LessonView", () => {
  it("renders the lesson's Markdown content and marks it done on click (happy path)", async () => {
    let completed = false;
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () =>
        jsonResponse({ id: "l1", title: "Lesson One", content: "# Heading\n\nSome text." }),
      "/api/courses/c1/progress": () => manualProgress(completed ? "completed" : "not_started"),
      "/api/courses/c1/lessons/l1/complete": () => {
        completed = true;
        return jsonResponse({
          lesson: {
            id: "l1",
            title: "Lesson One",
            status: "completed",
            completionMode: "manual",
            hasContent: true,
            hasQuiz: false,
            hasPractice: false,
          },
          course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 1, completed: true },
        });
      },
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy());
    expect(screen.getByText("Some text.")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Отметить пройденным" });
    const user = userEvent.setup();
    await user.click(button);

    await waitFor(() => expect(screen.getByText("Урок отмечен как пройденный.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Отметить пройденным" })).toBeNull();
  });

  it("hides the mark-done button for a quiz-graded lesson and explains why (edge case)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () => jsonResponse({ id: "l1", title: "Quiz Lesson", content: "Body." }),
      "/api/courses/c1/progress": () =>
        jsonResponse({
          courseId: "c1",
          courseVersion: "1.0.0",
          title: "Course One",
          totalLessons: 1,
          completedLessons: 0,
          completed: false,
          orphanedLessons: [],
          recordedVersions: [],
          modules: [
            {
              id: "m1",
              title: "Module One",
              totalLessons: 1,
              completedLessons: 0,
              completed: false,
              lessons: [
                {
                  id: "l1",
                  title: "Quiz Lesson",
                  status: "not_started",
                  completionMode: "quiz",
                  hasContent: true,
                  hasQuiz: true,
                  hasPractice: false,
                },
              ],
            },
          ],
        }),
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByText("Урок завершается правильным ответом на квиз.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Отметить пройденным" })).toBeNull();
  });

  it("renders the quiz UI for a quiz-graded lesson whose content carries a quiz (task 014 wiring)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () =>
        jsonResponse({
          id: "l1",
          title: "Quiz Lesson",
          content: "Body.",
          quiz: {
            question: "2 + 2?",
            options: [
              { id: "a", text: "4" },
              { id: "b", text: "5" },
            ],
          },
        }),
      "/api/courses/c1/progress": () =>
        jsonResponse({
          courseId: "c1",
          courseVersion: "1.0.0",
          title: "Course One",
          totalLessons: 1,
          completedLessons: 0,
          completed: false,
          orphanedLessons: [],
          recordedVersions: [],
          modules: [
            {
              id: "m1",
              title: "Module One",
              totalLessons: 1,
              completedLessons: 0,
              completed: false,
              lessons: [
                {
                  id: "l1",
                  title: "Quiz Lesson",
                  status: "not_started",
                  completionMode: "quiz",
                  hasContent: true,
                  hasQuiz: true,
                  hasPractice: false,
                },
              ],
            },
          ],
        }),
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByText("2 + 2?")).toBeTruthy());
    expect(screen.getByRole("button", { name: "4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "5" })).toBeTruthy();
  });

  it("renders the practice UI for a manual-mode lesson with an ungraded practice (task 015 wiring)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () =>
        jsonResponse({
          id: "l1",
          title: "Practice Lesson",
          content: "Body.",
          practice: { sandbox: "main", prompt: "Select every row from widgets." },
        }),
      "/api/courses/c1/progress": () => manualProgress("not_started"),
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByText("Select every row from widgets.")).toBeTruthy());
    // Ungraded practice (completionMode "manual") still gets the mark-done
    // button — running SQL alone never completes this kind of lesson.
    expect(screen.getByRole("button", { name: "Отметить пройденным" })).toBeTruthy();
  });

  it("shows a not-found message for an unknown lesson (error path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/missing": () => jsonResponse({ error: "lesson_not_found", message: "nope" }, 404),
      "/api/courses/c1/progress": () => manualProgress("not_started"),
    });

    renderAt("/courses/c1/lessons/missing");

    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
  });
});
