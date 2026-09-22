import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";

/**
 * The learner's SQL input for a practice exercise. Purely controlled —
 * `PracticeView` owns the text and decides when a run is allowed; this
 * component only renders CodeMirror (SQL syntax highlighting, no schema
 * completion — the sandbox's actual tables vary per course and aren't known
 * client-side).
 *
 * The run button used to live here. It moved out to the practice view's
 * toolbar: an editor component that also owns a submit button cannot be
 * placed anywhere that submit doesn't belong. (The toolbar once held a
 * second button, «сбросить песочницу» — that one is gone entirely, since
 * the sandbox is now re-seeded before every attempt.)
 */
export function SqlEditor({
  value,
  onChange,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="sql-editor">
      <div className="sql-editor-frame">
        <CodeMirror value={value} height="180px" extensions={[sql()]} editable={!busy} onChange={onChange} />
      </div>
    </div>
  );
}
