import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "./routes";

// Task 004's App.test.tsx exercised a single health-check component; App is
// now just Router + Query providers, so its meaningful behavior is routing
// end to end (home -> course detail, unknown routes, error states) rather
// than App.tsx's own (trivial) body. `createAppRouter` takes a memory
// history precisely so this test controls the URL instead of touching the
// real browser location.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
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

describe("App routing", () => {
  it("lists courses on the home route and navigates to the course detail route on click", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses": () =>
        jsonResponse({
          courses: [{ id: "c1", version: "1.0.0", title: "Course One", description: "Desc" }],
        }),
      "/api/courses/c1": () =>
        jsonResponse({
          id: "c1",
          version: "1.0.0",
          title: "Course One",
          modules: [
            {
              id: "m1",
              title: "Module One",
              lessons: [{ id: "l1", title: "Lesson", hasContent: true, hasQuiz: false, hasPractice: false }],
            },
          ],
        }),
    });

    renderApp("/");

    await waitFor(() => expect(screen.getByText("Course One")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: /Course One/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Course One" })).toBeTruthy());
    expect(screen.getByText("Module One")).toBeTruthy();
  });

  it("shows a not-found page for an unknown route (edge case)", async () => {
    mockApi({ "/api/health": healthOk });

    renderApp("/does-not-exist");

    await waitFor(() => expect(screen.getByText("Страница не найдена")).toBeTruthy());
  });

  it("shows an error message when the course list request fails (error path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses": () => jsonResponse({ error: "internal_error", message: "boom" }, 500),
    });

    renderApp("/");

    await waitFor(() => expect(screen.getByText("Не удалось загрузить список курсов.")).toBeTruthy());
  });

  it("shows a not-found message when the requested course id doesn't exist", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/missing": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
    });

    renderApp("/courses/missing");

    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
  });
});
