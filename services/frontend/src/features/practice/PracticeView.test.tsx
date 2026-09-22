import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicPractice } from "../../api/types";
import { PracticeView } from "./PracticeView";

afterEach(() => {
  cleanup();
  // Черновик редактора живёт в localStorage и переживает размонтирование —
  // это его смысл. Между тестами он должен уходить, иначе следующий тест
  // стартует с текстом предыдущего.
  window.localStorage.clear();
});

const PRACTICE: PublicPractice = { type: "sql", sandbox: "main", prompt: "Select every row from widgets." };
const RUN_URL = "/api/courses/c1/lessons/l1/practice/run";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderView(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <PracticeView courseId="c1" lessonId="l1" practice={PRACTICE} />
    </QueryClientProvider>,
  );
  return { queryClient, container };
}

/** Types into CodeMirror's contenteditable surface — the run button stays
 * disabled for empty SQL (the toolbar's own guard), so every test that runs
 * a query needs real text in the editor first. */
async function typeSql(container: HTMLElement, text: string) {
  const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
  const user = userEvent.setup();
  await user.click(editable);
  await user.type(editable, text);
  return user;
}

function lessonCourse(completed: boolean) {
  return {
    lesson: {
      id: "l1",
      title: "Lesson",
      status: completed ? "completed" : "not_started",
      completionMode: "practice",
      hasContent: true,
      hasQuiz: false,
      hasPractice: true,
      ...(completed ? { completedAt: "2026-01-01T00:00:00.000Z" } : {}),
    },
    course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: completed ? 1 : 0, completed },
  };
}

describe("PracticeView", () => {
  it("runs the SQL, shows the result table, and reports a passing check while re-fetching progress (happy path)", async () => {
    const { queryClient, container } = renderView(async (url) => {
      expect(url).toBe(RUN_URL);
      return jsonResponse({
        ok: true,
        result: {
          command: "SELECT",
          rowCount: 1,
          columns: [{ name: "id", dataTypeId: 23 }],
          rows: [["1"]],
          truncated: false,
          statementCount: 1,
        },
        durationMs: 3,
        check: { present: true, passed: true },
        expected: { present: false },
        solution: { present: false },
        ...lessonCourse(true),
      });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await typeSql(container, "select * from widgets;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByRole("columnheader", { name: "id" })).toBeTruthy());
    expect(screen.getByText("Проверка пройдена.")).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("shows Postgres' own error text as-is for a failing statement, without touching progress (error path)", async () => {
    const { queryClient, container } = renderView(async () =>
      jsonResponse({
        ok: false,
        error: { message: 'relation "widgts" does not exist', code: "42P01", position: "15" },
        durationMs: 1,
        check: { present: false },
        expected: { present: false },
        solution: { present: false },
        ...lessonCourse(false),
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await typeSql(container, "select * from widgts;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText('relation "widgts" does not exist')).toBeTruthy());
    expect(screen.queryByText("Проверка пройдена.")).toBeNull();
    expect(screen.queryByText("Проверка не пройдена.")).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });


  it("reports an expected-query verdict, with the backend's reason when it did not match", async () => {
    const runResponse = (expected: unknown, completed: boolean) => ({
      ok: true,
      result: {
        command: "SELECT",
        rowCount: 1,
        columns: [{ name: "id", dataTypeId: 23 }],
        rows: [["1"]],
        truncated: false,
        statementCount: 1,
      },
      durationMs: 2,
      check: { present: false },
      expected,
      solution: { present: false },
      ...lessonCourse(completed),
    });

    const mismatch = renderView(async () =>
      jsonResponse(runResponse({ present: true, passed: false, reason: "ожидалось строк: 19, получено: 22" }, false)),
    );
    const invalidateSpy = vi.spyOn(mismatch.queryClient, "invalidateQueries");

    let user = await typeSql(mismatch.container, "select * from widgets;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() =>
      expect(
        screen.getByText("Результат не совпал с ожидаемым: ожидалось строк: 19, получено: 22."),
      ).toBeTruthy(),
    );
    // Nothing was completed, so the progress tree is not re-fetched.
    expect(invalidateSpy).not.toHaveBeenCalled();
    cleanup();

    const match = renderView(async () => jsonResponse(runResponse({ present: true, passed: true }, true)));
    const matchInvalidateSpy = vi.spyOn(match.queryClient, "invalidateQueries");

    user = await typeSql(match.container, "select * from widgets;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Результат совпал с ожидаемым.")).toBeTruthy());
    expect(matchInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("says nothing about the expected query when the learner's own SQL failed (edge case)", async () => {
    const { container } = renderView(async () =>
      jsonResponse({
        ok: false,
        error: { message: 'relation "widgts" does not exist', code: "42P01" },
        durationMs: 1,
        check: { present: false },
        // The comparison never ran — neither "совпал" nor "не совпал" is
        // true, and claiming either would be a lie about what happened.
        expected: { present: true },
        solution: { present: false },
        ...lessonCourse(false),
      }),
    );

    const user = await typeSql(container, "select * from widgts;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText('relation "widgts" does not exist')).toBeTruthy());
    expect(screen.queryByText(/совпал с ожидаемым/)).toBeNull();
  });

  it("shows both verdicts when the lesson declares both grading mechanics", async () => {
    const { container } = renderView(async () =>
      jsonResponse({
        ok: true,
        result: { rowCount: 0, columns: [], rows: [], truncated: false, statementCount: 1 },
        durationMs: 1,
        check: { present: true, passed: true },
        expected: { present: true, passed: false, reason: "ожидалось столбцов: 2, получено: 3" },
        solution: { present: false },
        ...lessonCourse(false),
      }),
    );

    const user = await typeSql(container, "select * from widgets;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    // Both must be visible: the lesson is only completed when both pass,
    // so a single collapsed line would hide which half is missing.
    await waitFor(() => expect(screen.getByText("Проверка пройдена.")).toBeTruthy());
    expect(screen.getByText("Результат не совпал с ожидаемым: ожидалось столбцов: 2, получено: 3.")).toBeTruthy();
  });


  // Moved here from SqlEditor's own tests when the run/reset buttons left
  // the editor for the practice toolbar: the guard is still the same one
  // (mirror of the backend's `pattern: "\\S"`), it just has a new home.
  it("reports the state verdict, and explains a mismatch in the backend's own words", async () => {
    const { container } = renderView(async () =>
      jsonResponse({
        ok: true,
        result: { command: "UPDATE", rowCount: 5, columns: [], rows: [], truncated: false, statementCount: 1 },
        durationMs: 1,
        check: { present: false },
        expected: { present: false },
        // What an `update` without a `where` gets: the assignment was done
        // AND four rows it never mentioned were changed too.
        solution: { present: true, passed: false, reason: 'таблица "books": строк столько же, но содержимое отличается' },
        ...lessonCourse(false),
      }),
    );

    const user = await typeSql(container, "update books set in_stock = false;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'База пришла не в то состояние: таблица "books": строк столько же, но содержимое отличается.',
        ),
      ).toBeTruthy(),
    );
  });

  it("warns that a data change will not survive the next run", async () => {
    const { container } = renderView(async () =>
      jsonResponse({
        ok: true,
        result: { command: "UPDATE", rowCount: 1, columns: [], rows: [], truncated: false, statementCount: 1 },
        durationMs: 1,
        check: { present: false },
        expected: { present: false },
        solution: { present: false },
        ...lessonCourse(false),
      }),
    );

    const user = await typeSql(container, "update books set in_stock = false where id = 1;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    // Without this line the engine looks broken: the learner runs an
    // UPDATE, then a SELECT to admire it, and sees the row unchanged —
    // because the second run started from the seed like every run does.
    await waitFor(() => expect(screen.getByText(/Изменено строк: 1\./)).toBeTruthy());
    expect(screen.getByText(/песочница вернётся к исходному состоянию/)).toBeTruthy();
  });

  it("says nothing about changed rows after a plain SELECT (edge case)", async () => {
    const { container } = renderView(async () =>
      jsonResponse({
        ok: true,
        result: {
          command: "SELECT",
          rowCount: 3,
          columns: [{ name: "id", dataTypeId: 23 }],
          rows: [["1"]],
          truncated: false,
          statementCount: 1,
        },
        durationMs: 1,
        check: { present: false },
        expected: { present: false },
        solution: { present: false },
        ...lessonCourse(false),
      }),
    );

    const user = await typeSql(container, "select * from books;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    // Postgres' own command tag decides this — nothing here reads the SQL.
    expect(screen.queryByText(/Изменено строк/)).toBeNull();
  });

  it("brings back what the learner wrote when they come back to the lesson", async () => {
    const first = renderView(async () => jsonResponse({}));
    await typeSql(first.container, "select 42;");
    cleanup();

    // A different mount of the same lesson — what navigating away and back
    // produces. The editor must not be empty: the text is the one thing
    // the learner made, and re-reading the lesson does not bring it back.
    const again = renderView(async () => jsonResponse({}));
    const editable = again.container.querySelector('[contenteditable="true"]');
    expect(editable?.textContent).toContain("select 42;");
    // And the run button is live again straight away, without retyping.
    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the run button disabled until there is something to run (edge case)", async () => {
    const { container } = renderView(async () => {
      throw new Error("nothing should be submitted");
    });

    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(true);
    await typeSql(container, "   ");
    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(true);
    await typeSql(container, "select 1;");
    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(false);
  });

  // Выключенная кнопка обязана объяснять себя словами: цвет сообщает
  // «нельзя», подпись — «чего не хватает». Подсказка и блокировка стоят на
  // одном предикате, и этот тест держит их вместе — иначе подпись может
  // пережить условие, которое её вызвало.
  it("says what is missing while the run button is disabled (edge case)", async () => {
    const { container } = renderView(async () => {
      throw new Error("nothing should be submitted");
    });

    expect(screen.getByText("Введите запрос, чтобы выполнить.")).toBeTruthy();
    await typeSql(container, "select 1;");
    expect(screen.queryByText("Введите запрос, чтобы выполнить.")).toBeNull();
  });

  it("renames the run button and disables it while a run is in flight (edge case)", async () => {
    let release: (() => void) | undefined;
    const { container } = renderView(
      async () =>
        await new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ ok: true, durationMs: 1, check: { present: false }, expected: { present: false }, solution: { present: false }, ...lessonCourse(false) }));
        }),
    );

    const user = await typeSql(container, "select 1;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    const busy = await screen.findByRole("button", { name: "Выполняем…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    release?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Выполнить" })).toBeTruthy());
  });
});
