import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicPractice } from "../../api/types";
import { PracticeView } from "./PracticeView";

afterEach(() => {
  cleanup();
});

const PRACTICE: PublicPractice = { sandbox: "main", prompt: "Select every row from widgets." };
const RUN_URL = "/api/courses/c1/lessons/l1/practice/run";
const RESET_URL = "/api/courses/c1/sandbox/reset";

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
 * disabled for empty SQL (`SqlEditor`'s own guard), so every test that runs
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

  it("resets the sandbox on request and clears the previous run's result (edge case)", async () => {
    const { container } = renderView(async (url) => {
      if (url === RUN_URL) {
        return jsonResponse({
          ok: true,
          result: { rowCount: 0, columns: [], rows: [], truncated: false, statementCount: 1 },
          durationMs: 1,
          check: { present: false },
          ...lessonCourse(false),
        });
      }
      expect(url).toBe(RESET_URL);
      return jsonResponse({
        active: true,
        courseId: "c1",
        sandboxId: "main",
        type: "postgres",
        seedFiles: [],
        readyAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const user = await typeSql(container, "create table t (x int);");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(screen.getByText(/выполнена/)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Сбросить песочницу" }));

    await waitFor(() => expect(screen.getByText("Песочница сброшена до исходного состояния.")).toBeTruthy());
    expect(screen.queryByText(/выполнена/)).toBeNull();
  });

  it("shows the backend's own error text when resetting the sandbox fails (error path)", async () => {
    renderView(async (url) => {
      expect(url).toBe(RESET_URL);
      return jsonResponse(
        { error: "seed_failed", message: "Не удалось применить seed-скрипт 02-widgets.sql" },
        500,
      );
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Сбросить песочницу" }));

    await waitFor(() =>
      expect(screen.getByText("Не удалось применить seed-скрипт 02-widgets.sql")).toBeTruthy(),
    );
  });
});
