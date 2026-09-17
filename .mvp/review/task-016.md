# Review: task 016

## Commits (0af55cb5ba75a1fc44c9eacae7292769a1e08fd7..HEAD)


## Diffstat (0af55cb5ba75a1fc44c9eacae7292769a1e08fd7 -> working tree)

 .mvp/ledger.md                      |  4 ++
 services/frontend/src/api/client.ts | 19 +++++++
 services/frontend/src/api/types.ts  | 99 +++++++++++++++++++++++++++++++++++++
 services/frontend/src/index.css     | 70 ++++++++++++++++++++++++--
 services/frontend/src/routes.tsx    |  9 +++-
 services/frontend/src/ui/Layout.tsx |  3 ++
 6 files changed, 199 insertions(+), 5 deletions(-)

## Diff (0af55cb5ba75a1fc44c9eacae7292769a1e08fd7 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index b716261..e0cf182 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -21,3 +21,7 @@ Task 012: complete (0f47e8d6574564e44f4f977b8da54d863cc2e94c)
 Task 013: complete (9f395227edf81aa302c254d4dc072eee257e8065)
   concern (task 014): review split: 2 finding(s) came from a minority of 3 polls — the others approved
 Task 014: complete (31e2e2876d579e40265a4417e62170f356968294)
+  concern (task 015): reviewer-015-1 could not verify part of this task (2 of 3 polls could), read its prose for a defect its FINDINGS may have missed: none — the package's diff section only covered tracked-file changes, but its trailing "Untracked files (new, not yet added)" section supplied full content for all four brief-named files (PracticeView.tsx, SqlEditor.tsx, ResultTable.tsx, usePractice.ts) plus their tests and testSetup.ts, letting every brief requirement (CodeMirror editor, run, result table, verbatim Postgres error, check verdict, s
+  concern (task 015): review split: 4 finding(s) came from a minority of 3 polls — the others approved
+  concern (task 015): review finding refuted, not fixed: {"severity":"bug","file":"services/frontend/src/features/practice/PracticeView.tsx","line":862,"quote":"<SqlEditor value={sql} onChange={setSql} onRun={() => run(sql)} busy={isRunning} />","summary":"Run/reset race on the mutation observer.","verdict":"REFUTED"}
+Task 015: complete (0af55cb5ba75a1fc44c9eacae7292769a1e08fd7)
diff --git a/services/frontend/src/api/client.ts b/services/frontend/src/api/client.ts
index 8612e07..a7369a3 100644
--- a/services/frontend/src/api/client.ts
+++ b/services/frontend/src/api/client.ts
@@ -4,9 +4,11 @@ import type {
   CourseProgressResponse,
   CoursesListResponse,
   HealthResponse,
+  ImportResult,
   LessonCompletionResponse,
   LessonDetailResponse,
   PracticeRunResponse,
+  ProgressExportFile,
   QuizAnswerResponse,
   SandboxStatus,
 } from "./types";
@@ -111,4 +113,21 @@ export const api = {
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ sandboxId }),
     }),
+
+  exportProgress: (): Promise<ProgressExportFile> => apiFetch<ProgressExportFile>("/progress/export"),
+
+  /**
+   * `POST /progress/import`. `confirm: true` answers the "this file is
+   * older than what's here" warning — omit it (or pass `false`) for the
+   * first attempt; a stale file that would actually change something comes
+   * back as a rejected promise (`ApiError`, `status === 409`) whose `body`
+   * is an `ImportStaleWarning` (see api/types.ts), not a success value —
+   * callers must retry with `{ confirm: true }` to apply it.
+   */
+  importProgress: (file: ProgressExportFile, options?: { confirm?: boolean }): Promise<ImportResult> =>
+    apiFetch<ImportResult>(`/progress/import${options?.confirm === true ? "?confirm=true" : ""}`, {
+      method: "POST",
+      headers: { "Content-Type": "application/json" },
+      body: JSON.stringify(file),
+    }),
 };
diff --git a/services/frontend/src/api/types.ts b/services/frontend/src/api/types.ts
index 4190bbd..39b0c55 100644
--- a/services/frontend/src/api/types.ts
+++ b/services/frontend/src/api/types.ts
@@ -260,3 +260,102 @@ export interface SandboxStatus {
   seedFiles?: string[];
   readyAt?: string;
 }
+
+/** One lesson entry inside a progress export/import file
+ * (`transfer/format.ts`'s `ExportedLessonProgress`). `status` is always
+ * `"completed"` — a progress file never carries "not started" rows, that's
+ * the absence of an entry. */
+export interface ExportedLessonProgress {
+  lessonId: string;
+  status: "completed";
+  completedAt: string;
+  /** Provenance only — never used to match rows on import. */
+  courseVersion?: string;
+}
+
+/** One course's worth of progress inside the file
+ * (`transfer/format.ts`'s `ExportedCourseProgress`). `installedVersion` is
+ * absent when the exporting machine didn't have this course installed. */
+export interface ExportedCourseProgress {
+  courseId: string;
+  installedVersion?: string;
+  lessons: ExportedLessonProgress[];
+}
+
+/** GET /progress/export's response body, and POST /progress/import's
+ * request body verbatim (`transfer/format.ts`'s `ProgressExportFile`). Carries
+ * progress only — no lesson titles, no module structure, no quiz/practice
+ * content (project invariant: course content and progress are separate
+ * entities). This is the file this app's UI saves to/reads from disk. */
+export interface ProgressExportFile {
+  format: string;
+  formatVersion: number;
+  /** ISO 8601 UTC — when this file was produced. Compared against the
+   * importing machine's own progress to decide whether the file is stale. */
+  exportedAt: string;
+  courses: ExportedCourseProgress[];
+}
+
+/** Per-course counters inside an import result (`routes/transfer.ts`'s
+ * `importCourseSchema`). `fileVersion` is the file's own
+ * `installedVersion` for this course, absent if the file never installed
+ * it either. */
+export interface ImportCourseSummary {
+  courseId: string;
+  /** Whether this course is installed on THIS (importing) machine right
+   * now — not whether it was installed where the file was made. */
+  installed: boolean;
+  fileVersion?: string;
+  lessons: number;
+  created: number;
+  earlierCompletions: number;
+  unchanged: number;
+}
+
+/** Aggregate counters across every course in the file
+ * (`routes/transfer.ts`'s `importResultSchema.summary`). */
+export interface ImportTotals {
+  courses: number;
+  lessons: number;
+  created: number;
+  earlierCompletions: number;
+  unchanged: number;
+}
+
+/** Shared body shape of both `POST /progress/import` outcomes
+ * (`routes/transfer.ts`'s `toImportPayload`) — a 200 with `applied: true`,
+ * or a 409 with `applied: false` (see `ImportStaleWarning` below for the
+ * 409's extra `error`/`message` fields). `records` is deliberately not
+ * part of this — the server never echoes the file's contents back. */
+export interface ImportResult {
+  applied: boolean;
+  /** `true` when the file's `exportedAt` is older than this machine's
+   * newest local progress change. Reported even when `applied` is `true`
+   * (a confirmed stale import) — it is information either way. */
+  stale: boolean;
+  fileExportedAt: string;
+  /** Absent only when this machine has no progress at all yet. */
+  localLatestProgressAt?: string;
+  summary: ImportTotals;
+  courses: ImportCourseSummary[];
+  coursesNotInstalled: string[];
+}
+
+/** `POST /progress/import`'s 409 body — `ImportResult` (`applied: false`)
+ * plus the warning to show the user before they decide whether to repeat
+ * the request with `?confirm=true`. Surfaces as `ApiError.body` when
+ * `ApiError.status === 409`. */
+export interface ImportStaleWarning extends ImportResult {
+  error: "import_older_than_local";
+  message: string;
+}
+
+/** `POST /progress/import`'s 400 body — the picked file is not a readable
+ * Trellis progress export (`routes/transfer.ts`'s `importRejectionSchema`).
+ * Surfaces as `ApiError.body` when `ApiError.status === 400`. `problems` is
+ * always non-empty, one human-readable sentence per issue found. */
+export interface ImportRejection {
+  error: string;
+  message: string;
+  problems: string[];
+}
diff --git a/services/frontend/src/index.css b/services/frontend/src/index.css
index 5a99c43..3eabc0c 100644
--- a/services/frontend/src/index.css
+++ b/services/frontend/src/index.css
@@ -65,6 +65,13 @@ a {
   padding: 1.5rem;
 }
 
+.app-nav {
+  display: flex;
+  align-items: center;
+  gap: 1rem;
+  font-size: 0.9rem;
+}
+
 .status-row {
   display: flex;
   align-items: center;
@@ -190,7 +197,8 @@ a {
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
 }
 
-.mark-done-button {
+.mark-done-button,
+.import-confirm-button {
   background-color: var(--color-accent);
   color: var(--color-bg);
   border: none;
@@ -201,7 +209,8 @@ a {
   cursor: pointer;
 }
 
-.mark-done-button:disabled {
+.mark-done-button:disabled,
+.import-confirm-button:disabled {
   opacity: 0.6;
   cursor: default;
 }
@@ -384,7 +393,8 @@ a {
   border-top: 1px solid var(--color-border);
 }
 
-.reset-sandbox-button {
+.reset-sandbox-button,
+.import-cancel-button {
   background-color: transparent;
   color: var(--color-text);
   border: 1px solid var(--color-border);
@@ -394,7 +404,59 @@ a {
   cursor: pointer;
 }
 
-.reset-sandbox-button:disabled {
+.reset-sandbox-button:disabled,
+.import-cancel-button:disabled {
   opacity: 0.6;
   cursor: default;
 }
+
+.transfer-section {
+  margin-bottom: 1.5rem;
+  padding: 1rem;
+  background-color: var(--color-surface);
+  border: 1px solid var(--color-border);
+  border-radius: 0.75rem;
+}
+
+.transfer-section h2 {
+  margin: 0 0 0.5rem;
+  font-size: 1.1rem;
+}
+
+.import-file-label {
+  display: block;
+  margin: 0.75rem 0;
+}
+
+.import-summary {
+  margin: 0.5rem 0;
+  padding-left: 1.25rem;
+  font-size: 0.9rem;
+  color: var(--color-text-muted);
+}
+
+.import-warning {
+  margin-top: 0.75rem;
+  padding: 0.75rem 1rem;
+  background-color: var(--color-bg);
+  border: 1px solid var(--color-status-pending);
+  border-radius: 0.5rem;
+}
+
+.import-warning .import-confirm-button {
+  margin-right: 0.5rem;
+}
+
+.import-rejection {
+  margin-top: 0.75rem;
+  padding: 0.75rem 1rem;
+  background-color: var(--color-bg);
+  border: 1px solid var(--color-status-error);
+  border-radius: 0.5rem;
+  font-size: 0.85rem;
+}
+
+.import-rejection ul {
+  margin: 0.5rem 0 0;
+  padding-left: 1.25rem;
+}
diff --git a/services/frontend/src/routes.tsx b/services/frontend/src/routes.tsx
index 22b7f43..8ad4494 100644
--- a/services/frontend/src/routes.tsx
+++ b/services/frontend/src/routes.tsx
@@ -4,6 +4,7 @@ import type { RouterHistory } from "@tanstack/react-router";
 import { api } from "./api/client";
 import { CoursePage } from "./features/course/CoursePage";
 import { LessonView } from "./features/lesson/LessonView";
+import { TransferPage } from "./features/transfer/TransferPage";
 import { Layout } from "./ui/Layout";
 
 /**
@@ -49,6 +50,12 @@ const lessonRoute = createRoute({
   },
 });
 
+const transferRoute = createRoute({
+  getParentRoute: () => rootRoute,
+  path: "/transfer",
+  component: TransferPage,
+});
+
 function CoursesIndexPage() {
   const { data, isPending, isError } = useQuery({
     queryKey: ["courses"],
@@ -95,7 +102,7 @@ function NotFoundPage() {
   );
 }
 
-const routeTree = rootRoute.addChildren([indexRoute, courseRoute, lessonRoute]);
+const routeTree = rootRoute.addChildren([indexRoute, courseRoute, lessonRoute, transferRoute]);
 
 /**
  * Factory instead of a single module-level singleton so tests can build a
diff --git a/services/frontend/src/ui/Layout.tsx b/services/frontend/src/ui/Layout.tsx
index 642c6d6..106670f 100644
--- a/services/frontend/src/ui/Layout.tsx
+++ b/services/frontend/src/ui/Layout.tsx
@@ -51,6 +51,9 @@ export function Layout() {
         <Link to="/" className="app-title">
           Trellis
         </Link>
+        <nav className="app-nav">
+          <Link to="/transfer">Перенос прогресса</Link>
+        </nav>
         <HealthIndicator />
       </header>
       <main className="app-content">
```

## Untracked files (new, not yet added)

### services/frontend/src/features/transfer/ImportDialog.test.tsx

```
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
```

### services/frontend/src/features/transfer/ImportDialog.tsx

```
import { useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type { ImportRejection, ImportResult, ProgressExportFile } from "../../api/types";

/** Narrows an `ApiError`'s `unknown` body to `ImportResult` — true for both
 * of `POST /progress/import`'s outcomes that carry counters: the 200 body
 * and the 409 body (`ImportStaleWarning`, which is `ImportResult` plus
 * `error`/`message` — see api/types.ts). Only `applied`/`stale` are
 * checked: they're the two fields no other endpoint's error body has. */
function isImportResultBody(body: unknown): body is ImportResult {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Partial<ImportResult>).applied === "boolean" &&
    typeof (body as Partial<ImportResult>).stale === "boolean"
  );
}

/** Narrows an `ApiError`'s body to the 400 shape (`routes/transfer.ts`'s
 * `importRejectionSchema`) — the file wasn't readable at all, so there is
 * no `ImportResult` to show, only `problems`. */
function isImportRejectionBody(body: unknown): body is ImportRejection {
  return typeof body === "object" && body !== null && Array.isArray((body as Partial<ImportRejection>).problems);
}

/** Renders an import outcome's counters — shared between a completed
 * import (200) and the stale-file preview (409, before the user decides
 * whether to confirm) since both carry the same `ImportResult` shape. */
function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <ul className="import-summary">
      <li>Новых зачётов: {result.summary.created}</li>
      <li>Обновлено более ранней датой: {result.summary.earlierCompletions}</li>
      <li>Без изменений: {result.summary.unchanged}</li>
      {result.coursesNotInstalled.length > 0 && (
        <li>Прогресс сохранён для ещё не установленных курсов: {result.coursesNotInstalled.join(", ")}</li>
      )}
    </ul>
  );
}

type ImportVariables = { file: ProgressExportFile; confirm: boolean };

/**
 * Import half of the transfer page: pick a previously exported file, send
 * it to `POST /progress/import`, and — if the file is older than the
 * progress already on this machine (409, `import_older_than_local`) — show
 * that warning with a preview of what it would change and let the user
 * confirm or cancel, per `routes/transfer.ts`'s two-answer contract (the
 * warning is a real question, so the backend refuses to guess for the
 * client).
 *
 * No file-format validation happens here beyond "is this JSON, is it an
 * object" — `parseProgressExport` on the server is the one source of truth
 * for what a valid export file looks like (it collects every problem in
 * `problems`, not just the first), so a genuinely broken file's rejection
 * message always comes from there, never duplicated here.
 */
export function ImportDialog() {
  const queryClient = useQueryClient();
  const [readError, setReadError] = useState<string | undefined>(undefined);

  const importMutation = useMutation({
    mutationFn: ({ file, confirm }: ImportVariables) => api.importProgress(file, { confirm }),
    onSuccess: () => {
      // Progress may have changed for any number of courses — re-fetch
      // every mounted course's progress tree rather than guessing which
      // ones the file touched (query key prefix match, same pattern
      // LessonView/useQuiz/usePractice use after their own mutations).
      void queryClient.invalidateQueries({ queryKey: ["courseProgress"] });
    },
  });

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target;
    const selected = input.files?.[0];
    // Clears the input's value so picking the SAME file again still fires a
    // change event (browsers don't re-fire `change` for an unchanged
    // selection, and a user re-picking the same file after fixing it on
    // disk is exactly the workflow this dialog needs to support).
    input.value = "";
    if (selected === undefined) {
      return;
    }

    setReadError(undefined);
    importMutation.reset();

    let parsed: unknown;
    try {
      parsed = JSON.parse(await selected.text());
    } catch {
      setReadError("Не удалось прочитать файл: это не корректный JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      setReadError("Не удалось прочитать файл: это не объект JSON.");
      return;
    }

    importMutation.mutate({ file: parsed as ProgressExportFile, confirm: false });
  }

  function confirmStaleImport(): void {
    if (importMutation.variables !== undefined) {
      importMutation.mutate({ file: importMutation.variables.file, confirm: true });
    }
  }

  const error = importMutation.error;
  const staleWarning =
    error instanceof ApiError && error.status === 409 && isImportResultBody(error.body) ? error.body : undefined;
  const rejection =
    error instanceof ApiError && error.status === 400 && isImportRejectionBody(error.body) ? error.body : undefined;
  const genericError = error !== null && staleWarning === undefined && rejection === undefined;

  return (
    <div className="import-dialog">
      <p className="muted-note">Выберите ранее сохранённый файл прогресса, чтобы восстановить его на этом компьютере.</p>
      <label className="import-file-label">
        Файл прогресса
        <input type="file" accept="application/json,.json" onChange={(event) => void handleFileChange(event)} />
      </label>

      {readError !== undefined && <p className="muted-note">{readError}</p>}

      {importMutation.isPending && <p className="muted-note">Импортируем…</p>}

      {importMutation.isSuccess && (
        <div className="import-result">
          <p className="muted-note">Импорт завершён.</p>
          <ImportSummary result={importMutation.data} />
        </div>
      )}

      {staleWarning !== undefined && (
        <div className="import-warning">
          <p>{error instanceof ApiError ? error.message : ""}</p>
          <ImportSummary result={staleWarning} />
          <button type="button" className="import-confirm-button" onClick={confirmStaleImport}>
            Импортировать всё равно
          </button>
          <button type="button" className="import-cancel-button" onClick={() => importMutation.reset()}>
            Отмена
          </button>
        </div>
      )}

      {rejection !== undefined && (
        <div className="import-rejection">
          <p className="muted-note">{rejection.message}</p>
          <ul>
            {rejection.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {genericError && <p className="muted-note">Не удалось импортировать файл. Попробуйте ещё раз.</p>}
    </div>
  );
}
```

### services/frontend/src/features/transfer/TransferPage.test.tsx

```
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
```

### services/frontend/src/features/transfer/TransferPage.tsx

```
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import type { ProgressExportFile } from "../../api/types";
import { ImportDialog } from "./ImportDialog";

/**
 * Suggested download name for an export, mirroring the backend's own
 * `content-disposition` filename byte-for-byte
 * (`services/backend/src/transfer/format.ts`'s `progressExportFileName`) —
 * this page fetches the file as plain JSON (`api.exportProgress`) rather
 * than following a browser navigation, so the header is never read (see
 * `api/client.ts`'s doc comment on `apiFetch`'s single fetch chokepoint;
 * `routes/transfer.ts`'s own comment on the export route says exactly this:
 * "a fetch-based client (task 016) ignores it and names its own download").
 * Colons are stripped because they are not legal in Windows filenames — the
 * launcher scripts' target platform, per this project's invariants.
 */
function exportFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `trellis-progress-${stamp}.json`;
}

/** Saves the export file to disk via a throwaway `<a download>` — the
 * standard way to turn an in-memory value into a browser download without a
 * server-rendered URL to navigate to (the file only exists as a fetch
 * response body at this point). */
function downloadFile(file: ProgressExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(file.exportedAt);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Progress transfer page: download the local progress as one JSON file
 * (export), or restore progress from a previously downloaded one (import,
 * `ImportDialog` — this task's other component). This is the UI for the
 * app-level, versioned JSON transfer format described in
 * `services/backend/src/transfer/format.ts` and this project's invariants
 * — never a database dump, and never course content.
 */
export function TransferPage() {
  const exportMutation = useMutation({
    mutationFn: api.exportProgress,
    onSuccess: downloadFile,
  });

  return (
    <>
      <h1 className="page-heading">Перенос прогресса</h1>

      <section className="transfer-section">
        <h2>Экспорт</h2>
        <p className="muted-note">
          Сохраните файл со всем пройденным прогрессом, чтобы перенести его на другой компьютер.
        </p>
        <button
          type="button"
          className="mark-done-button"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          {exportMutation.isPending ? "Готовим файл…" : "Скачать файл прогресса"}
        </button>
        {exportMutation.isError && (
          <p className="muted-note">
            {exportMutation.error instanceof ApiError
              ? exportMutation.error.message
              : "Не удалось подготовить файл экспорта. Попробуйте ещё раз."}
          </p>
        )}
      </section>

      <section className="transfer-section">
        <h2>Импорт</h2>
        <ImportDialog />
      </section>
    </>
  );
}
```

