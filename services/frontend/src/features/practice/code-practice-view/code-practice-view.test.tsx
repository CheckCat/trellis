import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicCodePractice } from "../../../shared/api/types";
import { CodePracticeView } from "./code-practice-view";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const PRACTICE: PublicCodePractice = {
  type: "code",
  language: "typescript",
  prompt: "Напишите функцию sum(a, b).",
  entry: "sum",
  starter: "export function sum(a: number, b: number): number {\n  return 0;\n}",
};
const RUN_URL = "/api/courses/c1/lessons/l1/practice/code";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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
    course: {
      courseId: "c1",
      courseVersion: "1.0.0",
      totalLessons: 1,
      completedLessons: completed ? 1 : 0,
      completed,
    },
  };
}

function renderView(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, practice = PRACTICE) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <CodePracticeView courseId="c1" lessonId="l1" practice={practice} />
    </QueryClientProvider>,
  );
  return { queryClient, container };
}

describe("CodePracticeView", () => {
  it("opens with the starter when there is no draft, and sends it as the code", async () => {
    let sent: unknown;
    const { container } = renderView(async (url, init) => {
      expect(url).toBe(RUN_URL);
      sent = JSON.parse(String(init?.body));
      return jsonResponse({
        ok: true,
        durationMs: 5,
        passed: false,
        cases: [{ args: [2, 3], passed: false, value: 0, output: "", truncated: false }],
        ...lessonCourse(false),
      });
    });
    expect(container.querySelector('[contenteditable="true"]')?.textContent).toContain(
      "export function sum(a: number, b: number): number",
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(sent).toEqual({ code: PRACTICE.starter }));
  });

  it("shows every case with its input, the learner's value and a verdict, and the tally (failed path)", async () => {
    renderView(async () =>
      jsonResponse({
        ok: true,
        durationMs: 5,
        passed: false,
        cases: [
          { args: [2, 3], passed: true, value: 5, output: "adding\n", truncated: false },
          { args: [-1, 1], passed: false, value: { $undefined: true }, output: "", truncated: false },
          { args: [0, 0], passed: false, error: { message: "boom" }, output: "", truncated: false },
        ],
        ...lessonCourse(false),
      }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Пройдено 1 из 3.")).toBeTruthy());
    expect(screen.getByText("2, 3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("undefined")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByText("adding")).toBeTruthy();
    expect(screen.getAllByText("пройден")).toHaveLength(1);
    expect(screen.getAllByText("не пройден")).toHaveLength(2);
  });

  it("re-fetches progress when every case passed (happy path)", async () => {
    const { queryClient } = renderView(async () =>
      jsonResponse({
        ok: true,
        durationMs: 5,
        passed: true,
        cases: [{ args: [2, 3], passed: true, value: 5, output: "", truncated: false }],
        ...lessonCourse(true),
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Все случаи пройдены.")).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("shows node's own words for a module that did not load, and no case table", async () => {
    renderView(async () =>
      jsonResponse({
        ok: false,
        failure: { kind: "load_failed", message: "SyntaxError: Unexpected token '('" },
        durationMs: 2,
        passed: false,
        cases: [{ args: [2, 3], passed: false, output: "", truncated: false }],
        ...lessonCourse(false),
      }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Модуль не загрузился")).toBeTruthy());
    expect(screen.getByText(/Unexpected token/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains a 422 from a broken solution as the course's fault, not the learner's", async () => {
    renderView(async () =>
      jsonResponse({ error: "solution_failed", message: "The solution of this assignment could not be run" }, 422),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(screen.getByText(/The solution of this assignment could not be run/)).toBeTruthy());
  });

  it("keeps the run button disabled while the editor is empty", () => {
    renderView(async () => jsonResponse({}), { ...PRACTICE, starter: undefined });
    expect((screen.getByRole("button", { name: "Выполнить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Введите код, чтобы выполнить.")).toBeTruthy();
  });
});
