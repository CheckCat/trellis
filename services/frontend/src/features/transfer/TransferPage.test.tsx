import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransferPage } from "./TransferPage";

// jsdom does not implement `URL.createObjectURL`/`revokeObjectURL` at all
// (verified: `typeof URL.createObjectURL === "undefined"` under this
// project's jsdom version, same class of gap testSetup.ts documents for
// CodeMirror's Range methods) — assigned directly rather than
// `vi.stubGlobal("URL", ...)`, which would have to reconstruct every other
// static member of the real `URL` class this file doesn't care about.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderPage(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TransferPage />
    </QueryClientProvider>,
  );
}

const EXPORT_URL = "/api/progress/export";

describe("TransferPage export", () => {
  it("downloads the export as a Windows-safe-named file (happy path)", async () => {
    renderPage(async (url) => {
      expect(url).toBe(EXPORT_URL);
      return jsonResponse({
        format: "trellis.progress",
        formatVersion: 1,
        exportedAt: "2026-09-16T17:40:27.625Z",
        courses: [],
      });
    });

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    let downloadedName: string | undefined;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Скачать файл прогресса" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    // Colons stripped (illegal in Windows filenames), milliseconds dropped —
    // same filename algorithm as the backend's own `progressExportFileName`.
    expect(downloadedName).toBe("trellis-progress-2026-09-16T17-40-27Z.json");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });

  it("shows the backend's error message when the export request fails (error path)", async () => {
    renderPage(async () => jsonResponse({ error: "internal_error", message: "boom" }, 500));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Скачать файл прогресса" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });
});
