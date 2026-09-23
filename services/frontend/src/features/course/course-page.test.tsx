import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** A one-module progress tree from `[lessonId, completed]` pairs — every
 * test below cares about which lessons are done and nothing else. */
function progressBody(lessons: readonly (readonly [string, boolean])[]) {
  const completedLessons = lessons.filter(([, done]) => done).length;
  return {
    courseId: "c1",
    courseVersion: "1.0.0",
    title: "Course One",
    totalLessons: lessons.length,
    completedLessons,
    completed: completedLessons === lessons.length,
    orphanedLessons: [],
    recordedVersions: [],
    modules: [
      {
        id: "m1",
        title: "Module One",
        totalLessons: lessons.length,
        completedLessons,
        completed: completedLessons === lessons.length,
        lessons: lessons.map(([id, done], index) => ({
          id,
          title: `Lesson ${index + 1}`,
          status: done ? "completed" : "not_started",
          // Фиксированная дата, а не «сегодня»: серия дней считается от
          // текущей даты, и с сегодняшней датой эти тесты начали бы
          // проверять ещё и плашку серии заодно.
          ...(done ? { completedAt: "2026-01-01T00:00:00.000Z" } : {}),
          completionMode: "manual",
          hasContent: true,
          hasQuiz: false,
          hasPractice: false,
        })),
      },
    ],
  };
}

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
    // The course counter is one sentence split across elements (the number
    // is emphasised), so it is matched on the container's text rather than
    // on a single node; the module carries the compact "1 / 2".
    expect(screen.getByText(/из 2 уроков пройдено/).textContent).toContain("1");
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Пройден")).toBeTruthy();
    expect(screen.getByText("Не начат")).toBeTruthy();

    const lessonLink = screen.getByRole("link", { name: /Lesson One/ });
    expect(lessonLink.getAttribute("href")).toBe("/courses/c1/lessons/l1");
  });

  it("sends «Продолжить» to the first unfinished lesson, not past it (happy path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1": () => jsonResponse({ id: "c1", version: "1.0.0", title: "Course One", modules: [] }),
      // l1 done, l2 skipped, l3 done — «Продолжить» must go back to the gap.
      "/api/courses/c1/progress": () =>
        jsonResponse(progressBody([["l1", true], ["l2", false], ["l3", true]])),
    });

    renderAt("/courses/c1");

    const resume = await screen.findByRole("link", { name: /Продолжить/ });
    expect(resume.getAttribute("href")).toBe("/courses/c1/lessons/l2");
    expect(screen.getByText("Следующий: Lesson 2")).toBeTruthy();
  });

  it("offers «Начать курс» on an untouched course and no way to reset it (edge case)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1": () => jsonResponse({ id: "c1", version: "1.0.0", title: "Course One", modules: [] }),
      "/api/courses/c1/progress": () => jsonResponse(progressBody([["l1", false], ["l2", false]])),
    });

    renderAt("/courses/c1");

    const start = await screen.findByRole("link", { name: /Начать курс/ });
    expect(start.getAttribute("href")).toBe("/courses/c1/lessons/l1");
    // Nothing to erase, so nothing to offer erasing.
    expect(screen.queryByRole("button", { name: /Перепройти/ })).toBeNull();
  });

  it("reports a finished course instead of a way to continue it", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1": () => jsonResponse({ id: "c1", version: "1.0.0", title: "Course One", modules: [] }),
      "/api/courses/c1/progress": () => jsonResponse(progressBody([["l1", true], ["l2", true]])),
    });

    renderAt("/courses/c1");

    await waitFor(() => expect(screen.getByText("Курс пройден целиком")).toBeTruthy());
    expect(screen.queryByRole("link", { name: /Продолжить/ })).toBeNull();
    expect(screen.getByText("Модуль пройден")).toBeTruthy();
  });

  it("asks before «Перепройти» erases anything, and only deletes after the confirmation", async () => {
    const deletes: string[] = [];
    let completed = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/health") return healthOk();
        if (url === "/api/courses/c1") {
          return jsonResponse({ id: "c1", version: "1.0.0", title: "Course One", modules: [] });
        }
        if (url === "/api/courses/c1/progress" && init?.method === "DELETE") {
          deletes.push(url);
          completed = false;
          return jsonResponse({
            deletedLessons: 1,
            course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 2, completedLessons: 0, completed: false },
          });
        }
        if (url === "/api/courses/c1/progress") {
          return jsonResponse(progressBody([["l1", completed], ["l2", false]]));
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    renderAt("/courses/c1");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Перепройти/ }));

    // The question names what will be lost rather than asking "are you
    // sure" — and nothing has been deleted just by asking.
    const dialog = screen.getByRole("dialog", { name: "Перепройти курс?" });
    expect(dialog.textContent).toContain("1 пройденный урок");
    expect(deletes).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deletes).toEqual([]);

    await user.click(screen.getByRole("button", { name: /Перепройти/ }));
    await user.click(screen.getByRole("button", { name: "Стереть и начать заново" }));

    await waitFor(() => expect(deletes).toHaveLength(1));
    // The page redraws from the re-fetched tree: nothing left to reset.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Перепройти/ })).toBeNull());
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
