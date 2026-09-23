import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicPractice } from "../../api/types";
import { PracticeView } from "./practice-view";

afterEach(() => {
  cleanup();
});

const PRACTICE: PublicPractice = {
  type: "answer",
  prompt: "Откройте romashka.xlsx и посчитайте показатели.",
  fields: [
    { id: "headcount", label: "Сколько сотрудников работает сейчас?", kind: "number" },
    { id: "reason", label: "Самая частая причина увольнения", kind: "text" },
  ],
};
const ANSWER_URL = "/api/courses/c1/lessons/l1/practice/answer";

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
    course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: completed ? 1 : 0, completed },
  };
}

/** Renders the dispatcher, not `AnswerForm` directly — "a lesson with an
 * `answer` practice shows a form and not the SQL editor" is part of what
 * these tests are for. */
function renderView(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PracticeView courseId="c1" lessonId="l1" practice={PRACTICE} />
    </QueryClientProvider>,
  );
  return { queryClient, fetchMock };
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("PracticeView with a type: answer practice", () => {
  it("renders a form instead of the SQL editor and submits what was typed, verbatim (happy path)", async () => {
    const { queryClient, fetchMock } = renderView(async () =>
      jsonResponse({
        ok: true,
        fields: { headcount: { correct: true }, reason: { correct: true } },
        ...lessonCourse(true),
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // No sandbox UI at all: nothing to run, nothing to reset.
    expect(screen.queryByRole("button", { name: "Выполнить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Сбросить песочницу" })).toBeNull();

    const user = userEvent.setup();
    await user.type(field("Сколько сотрудников работает сейчас?"), "18,5");
    await user.type(field("Самая частая причина увольнения"), "По собственному желанию");
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("Все ответы верны.")).toBeTruthy());
    expect(screen.getAllByText("верно")).toHaveLength(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });

    // The comma survives the trip: reading "18,5" as a number is the
    // backend's rule, and parsing it here would be a second copy of it.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANSWER_URL);
    expect(JSON.parse(init.body as string)).toEqual({
      answers: { headcount: "18,5", reason: "По собственному желанию" },
    });
  });

  it("marks the wrong fields, keeps the right ones, and lets the learner fix and resubmit (error path)", async () => {
    let call = 0;
    const { queryClient } = renderView(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({
            ok: false,
            fields: { headcount: { correct: false }, reason: { correct: true } },
            ...lessonCourse(false),
          })
        : jsonResponse({
            ok: true,
            fields: { headcount: { correct: true }, reason: { correct: true } },
            ...lessonCourse(true),
          });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = userEvent.setup();
    const headcount = field("Сколько сотрудников работает сейчас?");
    await user.type(headcount, "100");
    await user.type(field("Самая частая причина увольнения"), "По собственному желанию");
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("неверно")).toBeTruthy());
    expect(screen.getByText("верно")).toBeTruthy();
    expect(screen.getByText(/Пока не всё верно/)).toBeTruthy();
    // Nothing was completed, so no progress re-fetch.
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Editing clears the stale marks: they described the previous values,
    // not what is on screen now.
    await user.clear(headcount);
    await user.type(headcount, "112");
    expect(screen.queryByText("неверно")).toBeNull();
    expect(screen.queryByText(/Пока не всё верно/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() => expect(screen.getByText("Все ответы верны.")).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("submits blank fields as-is and shows the backend's error text when the request fails (edge case)", async () => {
    const empty = renderView(async () =>
      jsonResponse({
        ok: false,
        fields: { headcount: { correct: false }, reason: { correct: false } },
        ...lessonCourse(false),
      }),
    );

    let user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    // A field never typed into is marked, not omitted — the backend
    // answers for every declared field.
    await waitFor(() => expect(screen.getAllByText("неверно")).toHaveLength(2));
    expect(JSON.parse((empty.fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      answers: {},
    });
    cleanup();

    renderView(async () =>
      jsonResponse({ error: "practice_type_mismatch", message: "Это задание отправляется в другой обработчик." }, 409),
    );
    user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    await waitFor(() => expect(screen.getByText("Это задание отправляется в другой обработчик.")).toBeTruthy());
  });

  it("offers the reference answer only after a wrong attempt, and only on request", async () => {
    const calls: string[] = [];
    renderView(async (url) => {
      calls.push(url);
      if (url.endsWith("/solution")) {
        return jsonResponse({
          fields: [
            { id: "headcount", label: "Сколько сотрудников работает сейчас?", expected: "112" },
            { id: "reason", label: "Самая частая причина увольнения", expected: "По собственному желанию" },
          ],
        });
      }
      return jsonResponse({ ok: false, fields: { headcount: { correct: false }, reason: { correct: true } }, ...lessonCourse(false) });
    });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Сколько сотрудников работает сейчас?")).toBeTruthy());

    // Пока ученик не пробовал — кнопки нет: иначе это спойлер к заданию,
    // которое ещё не решали.
    expect(screen.queryByRole("button", { name: /Показать ответ/ })).toBeNull();

    await user.type(screen.getByLabelText("Сколько сотрудников работает сейчас?"), "50");
    await user.click(screen.getByRole("button", { name: "Проверить" }));

    const reveal = await screen.findByRole("button", { name: /Показать ответ/ });
    // Кнопка появилась, но эталон ещё не запрашивался — он не «спрятан»
    // в странице, его в ней нет.
    expect(calls.some((url) => url.endsWith("/solution"))).toBe(false);

    await user.click(reveal);

    await waitFor(() => expect(screen.getByText("112")).toBeTruthy());
    expect(screen.getByText("По собственному желанию")).toBeTruthy();
    expect(calls.filter((url) => url.endsWith("/solution"))).toHaveLength(1);
  });

  it("shows a numeric field's tolerance with the answer, and nothing when it is exact", async () => {
    renderView(async (url) => {
      if (url.endsWith("/solution")) {
        return jsonResponse({
          fields: [
            { id: "headcount", label: "Сколько сотрудников работает сейчас?", expected: "18.5", tolerance: 0.2 },
            { id: "reason", label: "Самая частая причина увольнения", expected: "Переезд" },
          ],
        });
      }
      return jsonResponse({ ok: false, fields: { headcount: { correct: false }, reason: { correct: false } }, ...lessonCourse(false) });
    });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Сколько сотрудников работает сейчас?")).toBeTruthy());
    await user.type(screen.getByLabelText("Сколько сотрудников работает сейчас?"), "1");
    await user.click(screen.getByRole("button", { name: "Проверить" }));
    await user.click(await screen.findByRole("button", { name: /Показать ответ/ }));

    const shown = await screen.findByText(/18\.5/);
    expect(shown.parentElement?.textContent).toContain("(±0.2)");
    expect(screen.getByText("Переезд").parentElement?.textContent).not.toContain("±");
  });
});
