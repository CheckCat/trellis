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
