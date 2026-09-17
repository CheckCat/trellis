# Review: task 011

## Commits (ef5b165088ce97781679ac01da85f9b2fb44a5c5..HEAD)


## Diffstat (ef5b165088ce97781679ac01da85f9b2fb44a5c5 -> working tree)

 .mvp/ledger.md                     |   3 +
 package-lock.json                  | 171 +++++++++++++++++++++++++++++++++++++
 services/frontend/package.json     |   3 +
 services/frontend/src/App.test.tsx | 130 ++++++++++++++++++----------
 services/frontend/src/App.tsx      |  66 +++-----------
 services/frontend/src/index.css    | 107 ++++++++++++++++-------
 6 files changed, 351 insertions(+), 129 deletions(-)

## Diff (ef5b165088ce97781679ac01da85f9b2fb44a5c5 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index 2afaa1e..df8090f 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -10,3 +10,6 @@ Task 009: complete (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402)
 Task 010: complete (b8ed32f068bf522a35f2186e468bb3c0d8fc23cf)
   concern (task 020): - Gate wired via root `pretest` npm script (new `scripts/check-text-sources.mjs`), firing identically in `.mvp/ci-mirror.sh` and `.github/workflows/ci.yml` without editing either — both already run the byte-identical `npm run test --if-present`. - Scoped `.mvp/` out of the scan: two pre-existing review reports legitimately quote a NUL byte from reviewed source; rewriting historical review records was out of scope/inappropriate. Full rationale in `.mvp/reports/task-020.md`. - `bash .mvp/ci-mirror`
 Task 020: complete (e3617d6cbfa23be8f8a03e809635ca104561db4e)
+  concern (task 021): agentType "devops-engineer" did not dispatch — this task ran on general-purpose, WITHOUT the _common.md contract (boundary rules, report format, blocker protocol) that mvp:bootstrap assembled for it. Agents register at session start, so a bootstrap run in this same session yields files that are not dispatchable until the next one. Restart the session and re-run this task if the role's rules mattered.
+Task 021: complete (ef5b165088ce97781679ac01da85f9b2fb44a5c5)
+  Ruling (task 021): не переигрываю задачу — изменение сводилось к сужению glob-области гейта и правке комментариев, диффы проверены и закоммичены (ef5b165); контракт _common.md добавил бы форму отчёта, но не изменил бы результат. Цена ошибки: низкая — граница задачи в один скрипт, регресс виден первым же прогоном pretest. Роли зарегистрированы в текущей сессии, дальнейшие задачи диспатчатся штатно.
diff --git a/package-lock.json b/package-lock.json
index dbe4173..72f6a4b 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -956,6 +956,115 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/@tanstack/history": {
+      "version": "1.162.4",
+      "resolved": "https://registry.npmjs.org/@tanstack/history/-/history-1.162.4.tgz",
+      "integrity": "sha512-utTS5L2OkeYUzXGohL1Z8sefu1GLNOJcxe8Hd6iIdc/Xo1K1nDB2JEp4iSFhvYh33xKC9V91TxrS8qfrpoKobQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=20.19"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      }
+    },
+    "node_modules/@tanstack/query-core": {
+      "version": "5.103.1",
+      "resolved": "https://registry.npmjs.org/@tanstack/query-core/-/query-core-5.103.1.tgz",
+      "integrity": "sha512-rms8HqTGp6zA00dM+cUQ2eBcgzNJefuu5CAMB37i/6MiGT1zulPOytCFu2a0qjLqVR2n1jENPj9woqFQNuCzWA==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      }
+    },
+    "node_modules/@tanstack/react-query": {
+      "version": "5.103.1",
+      "resolved": "https://registry.npmjs.org/@tanstack/react-query/-/react-query-5.103.1.tgz",
+      "integrity": "sha512-rmAPPApNEK17VXRJhtE1rja53n23VV5w30C0saCgJhhX+EpdUnVqMGV/s5nnzV43X75KTHKzuoiuxSzGTBIkag==",
+      "license": "MIT",
+      "dependencies": {
+        "@tanstack/query-core": "5.103.1"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      },
+      "peerDependencies": {
+        "react": "^18 || ^19"
+      }
+    },
+    "node_modules/@tanstack/react-router": {
+      "version": "1.170.38",
+      "resolved": "https://registry.npmjs.org/@tanstack/react-router/-/react-router-1.170.38.tgz",
+      "integrity": "sha512-iHM9b0aDJbuvftmkiQXawzoqsdV68p2Re2safbVLCnxafe+iLKV++2i3hI/BMAP6uR92/Mjw94JKJJfD7pbwHQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@tanstack/history": "1.162.4",
+        "@tanstack/react-store": "^0.11.0",
+        "@tanstack/router-core": "1.171.32",
+        "isbot": "^5.1.22"
+      },
+      "engines": {
+        "node": ">=20.19"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      },
+      "peerDependencies": {
+        "react": ">=18.0.0 || >=19.0.0",
+        "react-dom": ">=18.0.0 || >=19.0.0"
+      }
+    },
+    "node_modules/@tanstack/react-store": {
+      "version": "0.11.1",
+      "resolved": "https://registry.npmjs.org/@tanstack/react-store/-/react-store-0.11.1.tgz",
+      "integrity": "sha512-HaIGKI3YLmjBYIvy5DFDY23oNaYZIsTZfngey07Uh5iLVJgM3bIGCnZeOFOqzjFld9JHWcaHJnasD/bKoGKwJQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@tanstack/store": "0.11.1",
+        "use-sync-external-store": "^1.6.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      },
+      "peerDependencies": {
+        "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0",
+        "react-dom": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"
+      }
+    },
+    "node_modules/@tanstack/router-core": {
+      "version": "1.171.32",
+      "resolved": "https://registry.npmjs.org/@tanstack/router-core/-/router-core-1.171.32.tgz",
+      "integrity": "sha512-X86Jqk3vB2KJcUfS6oLi7B7yxbaa59QEhZRPPP1fRx3k+Jw/Fu1UYVBcRtdwK/OccQnrlQdVoKvNO3QXmyEBOw==",
+      "license": "MIT",
+      "dependencies": {
+        "@tanstack/history": "1.162.4",
+        "cookie-es": "^3.0.0",
+        "seroval": "^1.6.2",
+        "seroval-plugins": "^1.6.2"
+      },
+      "engines": {
+        "node": ">=20.19"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      }
+    },
+    "node_modules/@tanstack/store": {
+      "version": "0.11.1",
+      "resolved": "https://registry.npmjs.org/@tanstack/store/-/store-0.11.1.tgz",
+      "integrity": "sha512-mzTOBhypOuDJAy/D8n2MfUZ1HFkXnmSETviRyhqEC8LUE7/IZQExOTxMANj3KjTofYTkFNpBY67qaVrT41YccA==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/tannerlinsley"
+      }
+    },
     "node_modules/@testing-library/dom": {
       "version": "10.4.2",
       "resolved": "https://registry.npmjs.org/@testing-library/dom/-/dom-10.4.2.tgz",
@@ -1005,6 +1114,20 @@
         }
       }
     },
+    "node_modules/@testing-library/user-event": {
+      "version": "14.6.7",
+      "resolved": "https://registry.npmjs.org/@testing-library/user-event/-/user-event-14.6.7.tgz",
+      "integrity": "sha512-MPCpX8bxe8zS+JmmTwLp8jd0dy1rAm60Te/SL8JrQM3qvQJcBOs1d7IefJMyZzqM3EWBrDn/LWDt1BCGu4ASfg==",
+      "dev": true,
+      "license": "MIT",
+      "engines": {
+        "node": ">=12",
+        "npm": ">=6"
+      },
+      "peerDependencies": {
+        "@testing-library/dom": ">=7.21.4"
+      }
+    },
     "node_modules/@trellis/backend": {
       "resolved": "services/backend",
       "link": true
@@ -1646,6 +1769,12 @@
         "url": "https://opencollective.com/express"
       }
     },
+    "node_modules/cookie-es": {
+      "version": "3.1.1",
+      "resolved": "https://registry.npmjs.org/cookie-es/-/cookie-es-3.1.1.tgz",
+      "integrity": "sha512-UaXxwISYJPTr9hwQxMFYZ7kNhSXboMXP+Z3TRX6f1/NyaGPfuNUZOWP1pUEb75B2HjfklIYLVRfWiFZJyC6Npg==",
+      "license": "MIT"
+    },
     "node_modules/cross-spawn": {
       "version": "7.0.6",
       "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
@@ -2331,6 +2460,15 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/isbot": {
+      "version": "5.2.2",
+      "resolved": "https://registry.npmjs.org/isbot/-/isbot-5.2.2.tgz",
+      "integrity": "sha512-iQcBXcd+Rv/pkubRyGh2utW2j1oPG5hZY6TUhVPpqK4G+o3IbxpJNx04hgksjc/N7GK5pEorUxDeg31cFgEk/w==",
+      "license": "Unlicense",
+      "engines": {
+        "node": ">=18"
+      }
+    },
     "node_modules/isexe": {
       "version": "2.0.0",
       "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
@@ -3427,6 +3565,27 @@
         "node": ">=10"
       }
     },
+    "node_modules/seroval": {
+      "version": "1.6.7",
+      "resolved": "https://registry.npmjs.org/seroval/-/seroval-1.6.7.tgz",
+      "integrity": "sha512-AeDcLh0yO2SFm9W71essgnSzLV9DI8ZH0x0knXn2DMnUZj728mpLbxjlbB6IqKCmqh8JA3cEqRyGoNkt584JcQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=10"
+      }
+    },
+    "node_modules/seroval-plugins": {
+      "version": "1.6.7",
+      "resolved": "https://registry.npmjs.org/seroval-plugins/-/seroval-plugins-1.6.7.tgz",
+      "integrity": "sha512-4Nk35ttD3DTDJW4hgw5StsVAPeU6qnDFnULAouw6tQ7oLTV/ICXrWpsXo2EE52eSP2joUMazbVf52mFEcADqRw==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=10"
+      },
+      "peerDependencies": {
+        "seroval": "^1.0"
+      }
+    },
     "node_modules/set-cookie-parser": {
       "version": "2.7.2",
       "resolved": "https://registry.npmjs.org/set-cookie-parser/-/set-cookie-parser-2.7.2.tgz",
@@ -3713,6 +3872,15 @@
         "punycode": "^2.1.0"
       }
     },
+    "node_modules/use-sync-external-store": {
+      "version": "1.7.0",
+      "resolved": "https://registry.npmjs.org/use-sync-external-store/-/use-sync-external-store-1.7.0.tgz",
+      "integrity": "sha512-6L+EeigHMQhdaIPNIFUKwfWJSwWFQ8gJbJ2DLOs5sDIegTwR9fRxvnM3uciHKjIZhFz+KAv2emhWMRvDmMcY8A==",
+      "license": "MIT",
+      "peerDependencies": {
+        "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"
+      }
+    },
     "node_modules/vite": {
       "version": "8.3.0",
       "resolved": "https://registry.npmjs.org/vite/-/vite-8.3.0.tgz",
@@ -4073,11 +4241,14 @@
     "services/frontend": {
       "name": "@trellis/frontend",
       "dependencies": {
+        "@tanstack/react-query": "^5.103.1",
+        "@tanstack/react-router": "^1.170.38",
         "react": "^19.3.0",
         "react-dom": "^19.3.0"
       },
       "devDependencies": {
         "@testing-library/react": "^16.3.3",
+        "@testing-library/user-event": "^14.6.7",
         "@types/react": "^19.3.0",
         "@types/react-dom": "^19.3.0",
         "@vitejs/plugin-react": "^6.1.1",
diff --git a/services/frontend/package.json b/services/frontend/package.json
index 20c5484..3f85ef6 100644
--- a/services/frontend/package.json
+++ b/services/frontend/package.json
@@ -10,11 +10,14 @@
     "test": "vitest run"
   },
   "dependencies": {
+    "@tanstack/react-query": "^5.103.1",
+    "@tanstack/react-router": "^1.170.38",
     "react": "^19.3.0",
     "react-dom": "^19.3.0"
   },
   "devDependencies": {
     "@testing-library/react": "^16.3.3",
+    "@testing-library/user-event": "^14.6.7",
     "@types/react": "^19.3.0",
     "@types/react-dom": "^19.3.0",
     "@vitejs/plugin-react": "^6.1.1",
diff --git a/services/frontend/src/App.test.tsx b/services/frontend/src/App.test.tsx
index 10e578d..71b6516 100644
--- a/services/frontend/src/App.test.tsx
+++ b/services/frontend/src/App.test.tsx
@@ -1,68 +1,112 @@
 import { afterEach, describe, expect, it, vi } from "vitest";
 import { cleanup, render, screen, waitFor } from "@testing-library/react";
-import { App } from "./App";
-
-// `@testing-library/jest-dom` is not in the brief's fixed dependency list
-// for this task, so assertions read `.textContent` directly instead of
-// matchers like `toHaveTextContent`. vitest.config's `test` block also does
-// not set `globals: true` (deliberately, see report) — test hooks are
-// imported explicitly, and RTL's automatic cleanup (which only wires up
-// when it detects global test hooks) is done by hand here.
+import userEvent from "@testing-library/user-event";
+import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
+import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
+import { createAppRouter } from "./routes";
+
+// Task 004's App.test.tsx exercised a single health-check component; App is
+// now just Router + Query providers, so its meaningful behavior is routing
+// end to end (home -> course detail, unknown routes, error states) rather
+// than App.tsx's own (trivial) body. `createAppRouter` takes a memory
+// history precisely so this test controls the URL instead of touching the
+// real browser location.
 afterEach(() => {
   cleanup();
   vi.unstubAllGlobals();
 });
 
-function statusText(): string {
-  return screen.getByRole("status").textContent ?? "";
+function renderApp(initialPath: string) {
+  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
+  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
+  render(
+    <QueryClientProvider client={queryClient}>
+      <RouterProvider router={router} />
+    </QueryClientProvider>,
+  );
 }
 
-describe("App", () => {
-  it("shows a loading state before the health check settles", () => {
-    vi.stubGlobal(
-      "fetch",
-      vi.fn(() => new Promise(() => {})), // never resolves during this assertion
-    );
+function jsonResponse(body: unknown, status = 200): Response {
+  return new Response(JSON.stringify(body), { status });
+}
 
-    render(<App />);
+function mockApi(handlers: Record<string, () => Response>) {
+  vi.stubGlobal(
+    "fetch",
+    vi.fn(async (input: string | URL | Request) => {
+      const url = String(input);
+      const handler = handlers[url];
+      if (handler === undefined) {
+        throw new Error(`unexpected fetch to ${url}`);
+      }
+      return handler();
+    }),
+  );
+}
 
-    expect(statusText()).toContain("Проверяем связь с ядром");
-  });
+const healthOk = () => jsonResponse({ status: "ok", db: "ok" });
 
-  it("shows connected once GET /api/health succeeds", async () => {
-    const fetchMock = vi.fn(async (input: string | URL | Request) => {
-      expect(String(input)).toBe("/api/health");
-      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
+describe("App routing", () => {
+  it("lists courses on the home route and navigates to the course detail route on click", async () => {
+    mockApi({
+      "/api/health": healthOk,
+      "/api/courses": () =>
+        jsonResponse({
+          courses: [{ id: "c1", version: "1.0.0", title: "Course One", description: "Desc" }],
+        }),
+      "/api/courses/c1": () =>
+        jsonResponse({
+          id: "c1",
+          version: "1.0.0",
+          title: "Course One",
+          modules: [
+            {
+              id: "m1",
+              title: "Module One",
+              lessons: [{ id: "l1", title: "Lesson", hasContent: true, hasQuiz: false, hasPractice: false }],
+            },
+          ],
+        }),
     });
-    vi.stubGlobal("fetch", fetchMock);
 
-    render(<App />);
+    renderApp("/");
+
+    await waitFor(() => expect(screen.getByText("Course One")).toBeTruthy());
+
+    const user = userEvent.setup();
+    await user.click(screen.getByRole("link", { name: /Course One/ }));
 
-    await waitFor(() => expect(statusText()).toContain("Связь с ядром есть"));
-    expect(fetchMock).toHaveBeenCalledTimes(1);
+    await waitFor(() => expect(screen.getByRole("heading", { name: "Course One" })).toBeTruthy());
+    expect(screen.getByText("Module One")).toBeTruthy();
   });
 
-  it("shows disconnected when the health check request fails (error path)", async () => {
-    vi.stubGlobal(
-      "fetch",
-      vi.fn(async () => {
-        throw new Error("network down");
-      }),
-    );
+  it("shows a not-found page for an unknown route (edge case)", async () => {
+    mockApi({ "/api/health": healthOk });
 
-    render(<App />);
+    renderApp("/does-not-exist");
 
-    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
+    await waitFor(() => expect(screen.getByText("Страница не найдена")).toBeTruthy());
   });
 
-  it("shows disconnected when the backend responds with a non-ok HTTP status (edge case)", async () => {
-    vi.stubGlobal(
-      "fetch",
-      vi.fn(async () => new Response("", { status: 500 })),
-    );
+  it("shows an error message when the course list request fails (error path)", async () => {
+    mockApi({
+      "/api/health": healthOk,
+      "/api/courses": () => jsonResponse({ error: "internal_error", message: "boom" }, 500),
+    });
+
+    renderApp("/");
+
+    await waitFor(() => expect(screen.getByText("Не удалось загрузить список курсов.")).toBeTruthy());
+  });
+
+  it("shows a not-found message when the requested course id doesn't exist", async () => {
+    mockApi({
+      "/api/health": healthOk,
+      "/api/courses/missing": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
+    });
 
-    render(<App />);
+    renderApp("/courses/missing");
 
-    await waitFor(() => expect(statusText()).toContain("Связи с ядром нет"));
+    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
   });
 });
diff --git a/services/frontend/src/App.tsx b/services/frontend/src/App.tsx
index 62efced..106e15b 100644
--- a/services/frontend/src/App.tsx
+++ b/services/frontend/src/App.tsx
@@ -1,63 +1,17 @@
-import { useEffect, useState } from "react";
+import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
+import { RouterProvider } from "@tanstack/react-router";
+import { router } from "./routes";
 
-// Skeleton screen for task 004: full navigation/layout is task 011. The only
-// job here is to prove the frontend can reach the backend through the
-// relative `/api` prefix (dev-proxy in Vite, nginx in the container image —
-// never an absolute `http://localhost:3001`, or it breaks in the container).
-type ConnectionState = "loading" | "connected" | "disconnected";
-
-interface HealthResponse {
-  status: string;
-}
-
-const STATUS_LABEL: Record<ConnectionState, string> = {
-  loading: "Проверяем связь с ядром…",
-  connected: "Связь с ядром есть",
-  disconnected: "Связи с ядром нет",
-};
+// One QueryClient for the whole app's lifetime — created outside the
+// component so it survives re-renders (a `new QueryClient()` inside `App`
+// would reset every cache on every render).
+const queryClient = new QueryClient();
 
 export function App() {
-  const [state, setState] = useState<ConnectionState>("loading");
-
-  useEffect(() => {
-    const controller = new AbortController();
-
-    async function checkHealth() {
-      try {
-        const response = await fetch("/api/health", { signal: controller.signal });
-        if (!response.ok) {
-          throw new Error(`unexpected status ${response.status}`);
-        }
-        const body = (await response.json()) as HealthResponse;
-        setState(body.status === "ok" ? "connected" : "disconnected");
-      } catch (error) {
-        // AbortError fires on unmount (StrictMode double-invoke, or the
-        // component unmounting mid-request) — not a real connectivity
-        // failure, so it must not flip the visible state.
-        if (error instanceof DOMException && error.name === "AbortError") {
-          return;
-        }
-        setState("disconnected");
-      }
-    }
-
-    void checkHealth();
-
-    return () => controller.abort();
-  }, []);
-
   return (
-    <main className="app-shell">
-      <div className="status-card">
-        <h1>Trellis</h1>
-        <div className="status-row">
-          <span className={`status-dot status-dot--${state}`} aria-hidden="true" />
-          <p className="status-label" role="status" aria-live="polite">
-            {STATUS_LABEL[state]}
-          </p>
-        </div>
-      </div>
-    </main>
+    <QueryClientProvider client={queryClient}>
+      <RouterProvider router={router} />
+    </QueryClientProvider>
   );
 }
 
diff --git a/services/frontend/src/index.css b/services/frontend/src/index.css
index 1265c7a..83738bf 100644
--- a/services/frontend/src/index.css
+++ b/services/frontend/src/index.css
@@ -1,21 +1,12 @@
+@import "./ui/theme.css";
+
 /*
- * Minimal palette for the skeleton screen. Full layout arrives in task 011 —
- * this file only fixes the design tokens (soft green, minimalist) so later
- * tasks inherit a consistent starting point instead of inventing their own.
+ * Global resets + the app shell's structural classes (header/content) and
+ * the small building blocks (status indicator, course/module/lesson lists)
+ * shared across pages. Page-specific one-offs belong in the page's own
+ * component, not here — this file is for the layout skeleton, not for every
+ * future screen's styling.
  */
-:root {
-  --color-bg: #f3f8f4;
-  --color-surface: #ffffff;
-  --color-border: #d9e8dd;
-  --color-text: #1e2b22;
-  --color-text-muted: #5c6f61;
-  --color-accent: #3f8858;
-  --color-accent-soft: #e4f2e8;
-  --color-status-ok: #2f7a4f;
-  --color-status-error: #b3543f;
-  --color-status-pending: #a9bcae;
-}
-
 * {
   box-sizing: border-box;
 }
@@ -38,40 +29,51 @@ body {
     sans-serif;
 }
 
+a {
+  color: var(--color-accent);
+}
+
 .app-shell {
   min-height: 100%;
   display: flex;
-  align-items: center;
-  justify-content: center;
-  padding: 1.5rem;
+  flex-direction: column;
 }
 
-.status-card {
+.app-header {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 1rem;
+  padding: 1rem 1.5rem;
   background-color: var(--color-surface);
-  border: 1px solid var(--color-border);
-  border-radius: 0.75rem;
-  padding: 2rem 2.5rem;
-  text-align: center;
-  min-width: 20rem;
+  border-bottom: 1px solid var(--color-border);
 }
 
-.status-card h1 {
-  margin: 0 0 0.5rem;
-  font-size: 1.5rem;
+.app-title {
+  margin: 0;
+  font-size: 1.25rem;
   font-weight: 600;
   color: var(--color-accent);
+  text-decoration: none;
+}
+
+.app-content {
+  flex: 1;
+  width: 100%;
+  max-width: 48rem;
+  margin: 0 auto;
+  padding: 1.5rem;
 }
 
 .status-row {
   display: flex;
   align-items: center;
-  justify-content: center;
   gap: 0.5rem;
-  margin-top: 0.75rem;
 }
 
 .status-label {
   margin: 0;
+  font-size: 0.875rem;
   color: var(--color-text-muted);
 }
 
@@ -90,3 +92,48 @@ body {
 .status-dot--disconnected {
   background-color: var(--color-status-error);
 }
+
+.card-list {
+  list-style: none;
+  margin: 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 0.75rem;
+}
+
+.card-list-item {
+  display: block;
+  background-color: var(--color-surface);
+  border: 1px solid var(--color-border);
+  border-radius: 0.75rem;
+  padding: 1rem 1.25rem;
+  text-decoration: none;
+  color: inherit;
+}
+
+.card-list-item:hover {
+  border-color: var(--color-accent);
+}
+
+.card-list-item h3 {
+  margin: 0 0 0.25rem;
+  font-size: 1.05rem;
+  color: var(--color-accent);
+}
+
+.card-list-item p {
+  margin: 0;
+  font-size: 0.9rem;
+  color: var(--color-text-muted);
+}
+
+.page-heading {
+  margin: 0 0 1rem;
+  font-size: 1.5rem;
+  font-weight: 600;
+}
+
+.muted-note {
+  color: var(--color-text-muted);
+}
```

## Untracked files (new, not yet added)

### services/frontend/src/api/client.ts

```
import type { ApiErrorResponse, CourseDetailResponse, CoursesListResponse, HealthResponse } from "./types";

/**
 * Thrown for any non-2xx response. Carries the parsed JSON body (when the
 * response had one) so callers that care about the specific `error` code
 * (e.g. `course_not_found`) can branch on it instead of parsing `.message`.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(isApiErrorBody(body) ? body.message : `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Partial<ApiErrorResponse>).error === "string" &&
    typeof (body as Partial<ApiErrorResponse>).message === "string"
  );
}

/**
 * Single fetch chokepoint for the whole app. Always relative and always
 * prefixed with `/api` — the dev-proxy (vite.config.ts) and the production
 * nginx.conf both strip that prefix before forwarding to the backend, so
 * this code never needs to know the backend's actual host/port (task-004
 * report's "как ходить в API" — this client just wraps that same contract,
 * doesn't change it).
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const rawBody = await response.text();
  // Every endpoint here returns JSON or nothing (no empty-200 route
  // currently exists, but this keeps the client from throwing on one).
  const body: unknown = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body as T;
}

/**
 * Typed surface for the backend HTTP API. Grows as later tasks (013+) need
 * more endpoints (progress, quiz, practice, transfer) — add methods here
 * rather than calling `fetch` directly from a component, so the `/api`
 * prefix and error handling stay in one place.
 */
export const api = {
  getHealth: (): Promise<HealthResponse> => apiFetch<HealthResponse>("/health"),

  listCourses: (): Promise<CoursesListResponse> => apiFetch<CoursesListResponse>("/courses"),

  getCourse: (courseId: string): Promise<CourseDetailResponse> =>
    apiFetch<CourseDetailResponse>(`/courses/${encodeURIComponent(courseId)}`),
};
```

### services/frontend/src/api/types.ts

```
// Response shapes for the backend HTTP API. Mirrors the JSON Schemas in
// services/backend/src/routes/*.ts byte-for-byte (fields, optionality) — do
// not widen/narrow a type here without checking the matching schema first,
// or the client silently drifts from what the server actually sends.

/** GET /health — see routes/health.ts. 200 and 503 share the same shape
 * (both fields always present), only the enum values differ. */
export interface HealthResponse {
  status: "ok" | "degraded";
  db: "ok" | "down";
}

/** One entry of GET /courses's `courses` array (routes/courses.ts,
 * `courseSummarySchema`). `description` is optional in the schema. */
export interface CourseSummary {
  id: string;
  version: string;
  title: string;
  description?: string;
}

export interface CoursesListResponse {
  courses: CourseSummary[];
}

/** A lesson as it appears inside a course's module tree (`GET
 * /courses/:courseId`) — summary only, no content/quiz/practice bodies.
 * Task 013's lesson page fetches those separately via
 * `GET /courses/:courseId/lessons/:lessonId`. */
export interface CourseLessonSummary {
  id: string;
  title: string;
  hasContent: boolean;
  hasQuiz: boolean;
  hasPractice: boolean;
}

export interface CourseModuleSummary {
  id: string;
  title: string;
  lessons: CourseLessonSummary[];
}

/** GET /courses/:courseId — routes/courses.ts, `courseDetailResponseSchema`. */
export interface CourseDetailResponse {
  id: string;
  version: string;
  title: string;
  description?: string;
  modules: CourseModuleSummary[];
}

/** Every 4xx/5xx JSON body this API sends follows this shape
 * (`notFoundResponseSchema` and friends across routes/*.ts). */
export interface ApiErrorResponse {
  error: string;
  message: string;
}
```

### services/frontend/src/routes.tsx

```
import { useQuery } from "@tanstack/react-query";
import { Link, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { ApiError, api } from "./api/client";
import { Layout } from "./ui/Layout";

/**
 * Route tree, built with TanStack Router's code-based API (no file-based
 * routing plugin — nothing in this package generates route files, so
 * there's nothing extra to wire into vite.config.ts). Pages here are
 * intentionally thin: full course navigation (module/lesson tree, status,
 * Markdown rendering, mark-as-done) is task 013's job, not this one's — this
 * file only proves the routing + typed client + layout all wire together
 * end to end, the same way task 004's App.tsx proved the dev-proxy worked
 * by doing the smallest possible real fetch instead of a stub.
 */

// `Layout` renders the shared header + `<Outlet />`; every route's own
// content lands inside it.
const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: CoursesIndexPage,
});

const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses/$courseId",
  component: CourseDetailPage,
});

function CoursesIndexPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["courses"],
    queryFn: api.listCourses,
  });

  if (isPending) {
    return <p className="muted-note">Загружаем список курсов…</p>;
  }

  if (isError) {
    return <p className="muted-note">Не удалось загрузить список курсов.</p>;
  }

  if (data.courses.length === 0) {
    return <p className="muted-note">Курсы не найдены. Добавьте контент-пакет в courses/.</p>;
  }

  return (
    <>
      <h1 className="page-heading">Курсы</h1>
      <ul className="card-list">
        {data.courses.map((course) => (
          <li key={course.id}>
            <Link to="/courses/$courseId" params={{ courseId: course.id }} className="card-list-item">
              <h3>{course.title}</h3>
              {course.description !== undefined && <p>{course.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function CourseDetailPage() {
  const { courseId } = courseRoute.useParams();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
  });

  if (isPending) {
    return <p className="muted-note">Загружаем курс…</p>;
  }

  if (isError) {
    // Only an actual 404 from the backend means "no such course" — any
    // other failure (network error, 500, etc.) gets the same generic
    // message CoursesIndexPage uses for the same failure class above.
    if (error instanceof ApiError && error.status === 404) {
      return <p className="muted-note">Курс «{courseId}» не найден.</p>;
    }
    return <p className="muted-note">Не удалось загрузить курс.</p>;
  }

  return (
    <>
      <h1 className="page-heading">{data.title}</h1>
      {data.description !== undefined && <p className="muted-note">{data.description}</p>}
      {/* Interactive module/lesson navigation (statuses, content, mark-as-done)
          is task 013 — this only proves the course was fetched by id. */}
      <ul className="card-list">
        {data.modules.map((module) => (
          <li key={module.id} className="card-list-item">
            <h3>{module.title}</h3>
            <p>{module.lessons.length} урок(ов)</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <h1 className="page-heading">Страница не найдена</h1>
      <p className="muted-note">
        <Link to="/">Вернуться к списку курсов</Link>
      </p>
    </>
  );
}

const routeTree = rootRoute.addChildren([indexRoute, courseRoute]);

/**
 * Factory instead of a single module-level singleton so tests can build a
 * router with `createMemoryHistory` instead of the real browser history
 * (see App.test.tsx) — the app's own entry point (App.tsx) calls this
 * with no arguments and gets the default browser-history router.
 */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: NotFoundPage,
    ...(history === undefined ? {} : { history }),
  });
}

export const router = createAppRouter();

// Registers this router's types globally so `Link`'s `to`/`params` props
// and `useParams()` are checked against the real route tree everywhere in
// the app, not just inside this file.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

### services/frontend/src/ui/Layout.test.tsx

```
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
```

### services/frontend/src/ui/Layout.tsx

```
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { api } from "../api/client";

const STATUS_LABEL: Record<"loading" | "connected" | "disconnected", string> = {
  loading: "Проверяем связь с ядром…",
  connected: "Связь с ядром есть",
  disconnected: "Связи с ядром нет",
};

/**
 * Small header widget replacing task-004's full-screen health check
 * (App.tsx used to be nothing but this). Exported separately so it can be
 * unit-tested without going through the router (see Layout.test.tsx) — it
 * has no dependency on route context, only on QueryClientProvider.
 */
export function HealthIndicator() {
  const { isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    // A dev/prod health probe that keeps refetching in the background would
    // just be noise for a single local user watching their own screen — one
    // check on mount is enough signal ("is the backend up right now").
    staleTime: Infinity,
    retry: false,
  });

  // `isError` alone decides "disconnected": a 200 response always carries
  // `status: "ok"` (see backend routes/health.ts) and any non-2xx makes
  // `apiFetch` throw before `data` is ever populated, so `data` is only
  // ever `undefined` or `{ status: "ok" }` once `isPending` is false.
  const state = isPending ? "loading" : isError ? "disconnected" : "connected";

  return (
    <div className="status-row">
      <span className={`status-dot status-dot--${state}`} aria-hidden="true" />
      <p className="status-label" role="status" aria-live="polite">
        {STATUS_LABEL[state]}
      </p>
    </div>
  );
}

/** Root layout: header (title + connection status) wraps every route's
 * content, rendered through `<Outlet />`. Route pages only own their own
 * content area, never the chrome around it. */
export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-title">
          Trellis
        </Link>
        <HealthIndicator />
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
```

### services/frontend/src/ui/theme.css

```
/*
 * Design tokens only — soft green, minimalist palette (product invariant:
 * "базовая палитра — мягкие зелёные тона", docs/product/business-logic.md).
 * Carried over unchanged from the task-004 skeleton (src/index.css) so every
 * later screen (013–016) keeps reusing the same tokens instead of picking
 * new green shades "by eye" — see task-004 report's interface digest.
 */
:root {
  --color-bg: #f3f8f4;
  --color-surface: #ffffff;
  --color-border: #d9e8dd;
  --color-text: #1e2b22;
  --color-text-muted: #5c6f61;
  --color-accent: #3f8858;
  --color-accent-soft: #e4f2e8;
  --color-status-ok: #2f7a4f;
  --color-status-error: #b3543f;
  --color-status-pending: #a9bcae;
}
```

