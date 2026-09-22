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
          className="button button--primary"
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
