import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";

/**
 * The learner's SQL input for a practice exercise. Purely controlled —
 * `PracticeView` owns the text and decides when a run is allowed; this
 * component only renders CodeMirror (SQL syntax highlighting, no schema
 * completion — the sandbox's actual tables vary per course and aren't known
 * client-side) and a "Выполнить" button.
 *
 * The run button is disabled whenever `value` is empty/whitespace-only or
 * `busy` is true (a request is already in flight) — mirrors the backend's
 * own `pattern: "\\S"` guard on the request body (routes/practice.ts), so a
 * submission that would just 400 never leaves the browser.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const canRun = !busy && value.trim().length > 0;

  return (
    <div className="sql-editor">
      <CodeMirror
        value={value}
        height="180px"
        extensions={[sql()]}
        editable={!busy}
        onChange={onChange}
      />
      <button type="button" className="run-button" onClick={onRun} disabled={!canRun}>
        {busy ? "Выполняем…" : "Выполнить"}
      </button>
    </div>
  );
}
