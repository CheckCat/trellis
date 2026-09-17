import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../routes";

// Same routing test pattern as App.test.tsx / task-011's report ("Тестовый
// паттерн для страниц с роутингом"): CoursePage renders `<Link>`s, which
// need real router context, so it's exercised through `createAppRouter`
// with a memory history rather than mounted standalone.
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

describe("CoursePage", () => {
  it("renders modules with per-lesson status and links each lesson (happy path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1": () =>
        jsonResponse({
          id: "c1",
          version: "1.0.0",
          title: "Course One",
          description: "Learn the basics.",
          modules: [],
        }),
      "/api/courses/c1/progress": () =>
        jsonResponse({
          courseId: "c1",
          courseVersion: "1.0.0",
          title: "Course One",
          totalLessons: 2,
          completedLessons: 1,
          completed: false,
          orphanedLessons: [],
          recordedVersions: [],
          modules: [
            {
              id: "m1",
              title: "Module One",
              totalLessons: 2,
              completedLessons: 1,
              completed: false,
              lessons: [
                {
                  id: "l1",
                  title: "Lesson One",
                  status: "completed",
                  completionMode: "manual",
                  hasContent: true,
                  hasQuiz: false,
                  hasPractice: false,
                },
                {
                  id: "l2",
                  title: "Lesson Two",
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

    renderAt("/courses/c1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Course One" })).toBeTruthy());
    // description comes from a second, non-blocking `getCourse` fetch
    // (`CourseProgressResponse` itself has no such field) — review finding
    // on task-013's fix round.
    await waitFor(() => expect(screen.getByText("Learn the basics.")).toBeTruthy());
    // Both the course header and its single module report the same "1 / 2"
    // counters here (one module holding both lessons) — assert there are
    // two, not that the text is unique.
    expect(screen.getAllByText("1 / 2 уроков пройдено")).toHaveLength(2);
    expect(screen.getByText("Пройден")).toBeTruthy();
    expect(screen.getByText("Не начат")).toBeTruthy();

    const lessonLink = screen.getByRole("link", { name: /Lesson One/ });
    expect(lessonLink.getAttribute("href")).toBe("/courses/c1/lessons/l1");
  });

  it("shows a generic error message on a non-404 failure (error path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/progress": () => jsonResponse({ error: "internal_error", message: "boom" }, 500),
    });

    renderAt("/courses/c1");

    await waitFor(() => expect(screen.getByText("Не удалось загрузить курс.")).toBeTruthy());
  });

  it("shows a not-found message for a missing course (edge case)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/missing/progress": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
    });

    renderAt("/courses/missing");

    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
  });
});
