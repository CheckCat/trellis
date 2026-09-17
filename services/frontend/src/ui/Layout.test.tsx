import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HealthIndicator } from "./Layout";

// Same testing conventions as task 004's App.test.tsx (see that report):
// no `@testing-library/jest-dom`, no vitest `globals: true` — hooks are
// imported explicitly and RTL cleanup runs by hand in `afterEach`.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderIndicator() {
  // `retry: false` — without it a failing query retries with backoff and
  // `waitFor` below would have to wait through that instead of failing fast.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HealthIndicator />
    </QueryClientProvider>,
  );
}

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("HealthIndicator", () => {
  it("shows a loading state before the health check settles", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves during this assertion
    );

    renderIndicator();

    expect(statusText()).toContain("Проверяем связь с ядром");
  });

  it("shows connected once GET /api/health reports ok", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("/api/health");
      return new Response(JSON.stringify({ status: "ok", db: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderIndicator();

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

    renderIndicator();

    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
  });

  it("shows disconnected when the backend responds degraded/503 (edge case)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "degraded", db: "down" }), { status: 503 })),
    );

    renderIndicator();

    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
  });
});
