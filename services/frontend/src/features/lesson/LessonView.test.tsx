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
  // Возвращается ради тестов перехода: история здесь memory-история, и
  // `window.location` за ней не двигается — спросить, где мы оказались,
  // можно только у самого роутера.
  return router;
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
        // Заголовок второго уровня: первый в начале тела не рендерится —
        // название урока печатает страница, из манифеста (Markdown.tsx).
        jsonResponse({ id: "l1", title: "Lesson One", content: "## Heading\n\nSome text." }),
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

    // Отдельной кнопки «Отметить пройденным» больше нет: на текстовом уроке
    // отметка и переход — один жест. Этот урок в курсе единственный, значит
    // «дальше» ведёт не в следующий урок, а к завершению курса.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Завершить курс/ }));

    await waitFor(() => expect(screen.getByText("Урок пройден")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Завершить курс/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Вернуться к курсу" })).toBeTruthy();
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
    // Засчитывает механика, поэтому переход — обычная ссылка, а не кнопка,
    // которая по дороге что-то отмечает.
    expect(screen.queryByRole("button", { name: /дальше/i })).toBeNull();
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
    // Ungraded practice (completionMode "manual") is still completed by the
    // learner, not by the engine — running SQL alone never completes this
    // kind of lesson, so the forward control is the one that marks it.
    expect(screen.getByRole("button", { name: /Завершить курс/ })).toBeTruthy();
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

  describe("lesson-to-lesson navigation", () => {
    // Курс читают подряд. Пока единственной ссылкой со страницы урока была
    // «← К курсу», пройти курс из девяти уроков значило девять раз сходить
    // в оглавление и обратно. Порядок уроков берётся из того же дерева
    // прогресса, которое страница уже загружает, — плоско по модулям,
    // в порядке манифеста; отдельной ручки в API для этого не нужно.
    function threeLessonProgress() {
      const lesson = (id: string, title: string, status: "completed" | "not_started") => ({
        id,
        title,
        status,
        completionMode: "manual" as const,
        hasContent: true,
        hasQuiz: false,
        hasPractice: false,
      });

      return jsonResponse({
        courseId: "c1",
        courseVersion: "1.0.0",
        title: "Course One",
        totalLessons: 3,
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
            lessons: [lesson("l1", "Lesson One", "completed"), lesson("l2", "Lesson Two", "not_started")],
          },
          {
            id: "m2",
            title: "Module Two",
            totalLessons: 1,
            completedLessons: 0,
            completed: false,
            lessons: [lesson("l3", "Lesson Three", "not_started")],
          },
        ],
      });
    }

    function mockLessonPage(lessonId: string, title: string) {
      mockApi({
        "/api/health": healthOk,
        [`/api/courses/c1/lessons/${lessonId}`]: () => jsonResponse({ id: lessonId, title, content: "Body." }),
        "/api/courses/c1/progress": threeLessonProgress,
      });
    }

    it("leads to the next and previous lesson, naming both (happy path)", async () => {
      mockLessonPage("l2", "Lesson Two");
      renderAt("/courses/c1/lessons/l2");

      // l2 не пройден и засчитывается вручную, поэтому «дальше» — кнопка:
      // она отмечает урок и уходит. Назад — обычная ссылка, возврат ничего
      // не засчитывает.
      await waitFor(() => expect(screen.getByRole("button", { name: "Прочитал, дальше: Lesson Three" })).toBeTruthy());
      expect(screen.getByRole("link", { name: "Назад: Lesson One" })).toBeTruthy();
    });

    it("marks a text lesson as read on the way to the next one, and only then moves", async () => {
      const completions: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url === "/api/health") return healthOk();
          if (url === "/api/courses/c1/progress") return threeLessonProgress();
          if (url.endsWith("/complete")) {
            completions.push(url);
            return jsonResponse({
              lesson: {
                id: "l2",
                title: "Lesson Two",
                status: "completed",
                completionMode: "manual",
                hasContent: true,
                hasQuiz: false,
                hasPractice: false,
              },
              course: {
                courseId: "c1",
                courseVersion: "1.0.0",
                totalLessons: 3,
                completedLessons: 2,
                completed: false,
              },
            });
          }
          const lessonId = url.split("/").pop() ?? "";
          return jsonResponse({ id: lessonId, title: `Lesson ${lessonId}`, content: "Body." });
        }),
      );

      const router = renderAt("/courses/c1/lessons/l2");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Прочитал, дальше: Lesson Three" }));

      await waitFor(() => expect(completions).toEqual(["/api/courses/c1/lessons/l2/complete"]));
      // И только после записи — переход. Оптимистичный переход был бы тише,
      // но зачёт, который молча не записался, ученик обнаружит через неделю
      // по дырке в прогрессе.
      await waitFor(() => expect(router.state.location.pathname).toBe("/courses/c1/lessons/l3"));
    });

    it("crosses a module boundary (edge case — порядок уроков сквозной, не внутримодульный)", async () => {
      mockLessonPage("l3", "Lesson Three");
      renderAt("/courses/c1/lessons/l3");

      // l3 — первый урок второго модуля, его предыдущий лежит в первом.
      await waitFor(() => expect(screen.getByRole("link", { name: "Назад: Lesson Two" })).toBeTruthy());
    });

    it("offers no previous link on the first lesson, and closes the course on the last (edge case)", async () => {
      mockLessonPage("l1", "Lesson One");
      renderAt("/courses/c1/lessons/l1");

      // l1 уже пройден — отмечать нечего, поэтому переход обычной ссылкой.
      await waitFor(() => expect(screen.getByRole("link", { name: "Дальше: Lesson Two" })).toBeTruthy());
      expect(screen.queryByRole("link", { name: /^Назад:/ })).toBeNull();

      cleanup();
      mockLessonPage("l3", "Lesson Three");
      renderAt("/courses/c1/lessons/l3");

      await waitFor(() => expect(screen.getByRole("button", { name: /Завершить курс/ })).toBeTruthy());
      expect(screen.queryByRole("link", { name: /Дальше/ })).toBeNull();
    });

    it("counts the lesson inside its own module, with the course total kept quiet (happy path)", async () => {
      mockLessonPage("l2", "Lesson Two");
      renderAt("/courses/c1/lessons/l2");

      await waitFor(() => expect(screen.getByText("Module One")).toBeTruthy());
      // «Урок 2 из 2» — второй из двух В МОДУЛЕ, не «2 из 3 в курсе»: на
      // курсе из семидесяти пяти уроков сквозной номер обескураживает, а
      // модуль — обозримый отрезок с видимым концом.
      expect(screen.getByText(/Урок 2 из 2/)).toBeTruthy();
      expect(screen.getByText(/1 из 3 пройдено в курсе/)).toBeTruthy();
    });
  });
});
