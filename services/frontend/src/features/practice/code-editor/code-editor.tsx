import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import type { CodeLanguage } from "../../../shared/api/types";

/**
 * The learner's code for a `code` practice. Controlled, like `SqlEditor`:
 * the practice view owns the text and the run button; this only renders
 * CodeMirror in the assignment's language. `typescript: true` switches
 * the same JavaScript mode to accept type annotations — one editor, two
 * dialects, exactly as node runs them.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  busy,
}: {
  value: string;
  language: CodeLanguage;
  onChange: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="code-editor">
      <div className="code-editor-frame">
        <CodeMirror
          value={value}
          height="260px"
          extensions={[javascript({ typescript: language === "typescript" })]}
          editable={!busy}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
