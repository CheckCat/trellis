import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportDialog } from "./ImportDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function progressFile(): File {
  const content = {
    format: "trellis.progress",
    formatVersion: 1,
    exportedAt: "2026-09-16T12:00:00.000Z",
    courses: [{ courseId: "c1", lessons: [{ lessonId: "l1", status: "completed", completedAt: "2020-01-01T00:00:00.000Z" }] }],
  };
  return new File([JSON.stringify(content)], "trellis-progress.json", { type: "application/json" });
}

function renderDialog(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ImportDialog />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

const IMPORT_URL = "/api/progress/import";
const IMPORT_URL_CONFIRMED = "/api/progress/import?confirm=true";

const IMPORT_RESULT = {
  applied: true,
  stale: false,
  fileExportedAt: "2026-09-16T12:00:00.000Z",
  localLatestProgressAt: "2026-01-01T00:00:00.000Z",
  summary: { courses: 1, lessons: 1, created: 1, earlierCompletions: 0, unchanged: 0 },
  courses: [{ courseId: "c1", installed: true, lessons: 1, created: 1, earlierCompletions: 0, unchanged: 0 }],
  coursesNotInstalled: [],
};

describe("ImportDialog", () => {
  it("imports a picked file and shows its summary, and re-fetches course progress (happy path)", async () => {
    const { invalidateSpy } = renderDialog(async (url, init) => {
      expect(url).toBe(IMPORT_URL);
      expect(init?.method).toBe("POST");
      return jsonResponse(IMPORT_RESULT);
    });

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Файл прогресса"), progressFile());

    await waitFor(() => expect(screen.getByText("Импорт завершён.")).toBeTruthy());
    expect(screen.getByText("Новых зачётов: 1")).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress"] });
  });

  it("shows a client-side error for a file that isn't JSON, without calling the API (edge case)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ImportDialog />
      </QueryClientProvider>,
    );

    const notJson = new File(["not json at all"], "notes.json", { type: "application/json" });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Файл прогресса"), notJson);

    await waitFor(() =>
      expect(screen.getByText("Не удалось прочитать файл: это не корректный JSON.")).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the stale-file warning on 409 and applies it only after explicit confirmation (error path)", async () => {
    const { invalidateSpy } = renderDialog(async (url) => {
      if (url === IMPORT_URL) {
        return jsonResponse(
          {
            error: "import_older_than_local",
            message: "This progress file was saved on 2026-09-16T12:00:00.000Z, which is older...",
            ...IMPORT_RESULT,
            applied: false,
            stale: true,
          },
          409,
        );
      }
      if (url === IMPORT_URL_CONFIRMED) {
        return jsonResponse({ ...IMPORT_RESULT, stale: true });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Файл прогресса"), progressFile());

    await waitFor(() =>
      expect(screen.getByText(/This progress file was saved on/)).toBeTruthy(),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Импортировать всё равно" }));

    await waitFor(() => expect(screen.getByText("Импорт завершён.")).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress"] });
  });

  it("shows every listed problem when the server rejects the file as invalid (400)", async () => {
    renderDialog(async () =>
      jsonResponse(
        {
          error: "invalid_export_file",
          message: "That progress file could not be read — see the problems listed below.",
          problems: ['courses[0].courseId: expected a non-empty string, got null.'],
        },
        400,
      ),
    );

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Файл прогресса"), progressFile());

    await waitFor(() =>
      expect(screen.getByText("That progress file could not be read — see the problems listed below.")).toBeTruthy(),
    );
    expect(screen.getByText("courses[0].courseId: expected a non-empty string, got null.")).toBeTruthy();
  });
});
