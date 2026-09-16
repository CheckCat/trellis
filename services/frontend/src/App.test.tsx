import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

// `@testing-library/jest-dom` is not in the brief's fixed dependency list
// for this task, so assertions read `.textContent` directly instead of
// matchers like `toHaveTextContent`. vitest.config's `test` block also does
// not set `globals: true` (deliberately, see report) — test hooks are
// imported explicitly, and RTL's automatic cleanup (which only wires up
// when it detects global test hooks) is done by hand here.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("App", () => {
  it("shows a loading state before the health check settles", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves during this assertion
    );

    render(<App />);

    expect(statusText()).toContain("Проверяем связь с ядром");
  });

  it("shows connected once GET /api/health succeeds", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/health");
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(statusText()).toContain("Связь с ядром есть"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows disconnected when the health check request fails (error path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    render(<App />);

    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
  });

  it("shows disconnected when the backend responds with a non-ok HTTP status (edge case)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );

    render(<App />);

    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
  });
});
