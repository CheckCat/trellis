import type { PracticeCodeCaseResult, PracticeCodeFailureKind, PublicCodePractice } from "../../../shared/api/types";
import { formatApiError } from "../../../shared/lib/format-api-error";
import { PlayIcon } from "../../../shared/ui/icons";
import { CodeEditor } from "../code-editor";
import { formatCodeArgs, formatCodeValue } from "../code-value";
import { draftKey, useDraft } from "../draft";
import { useCodePractice } from "../use-code-practice";

/**
 * The `code` kind: an editor in the assignment's language, one run
 * button, and — after a run — either the reason the module could not be
 * run at all, or a table of every case with the learner's own result.
 *
 * The editor opens with the course's `starter` until the learner has a
 * draft of their own (draft.ts). Clearing the editor completely brings the
 * starter back: an empty draft is not a draft, and "forget what I wrote"
 * returning the learner to the signature is the least surprising reading.
 */
export function CodePracticeView({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicCodePractice;
}) {
  const [draft, setDraft] = useDraft(draftKey(courseId, lessonId));
  const code = draft.length === 0 ? (practice.starter ?? "") : draft;
  const isEmpty = code.trim().length === 0;
  const { execution, isRunning, runError, run } = useCodePractice(courseId, lessonId);

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <CodeEditor value={code} language={practice.language} onChange={setDraft} busy={isRunning} />

      <div className="practice-toolbar">
        <button
          type="button"
          className="icon-button icon-button--primary"
          onClick={() => run(code)}
          // Mirrors the body schema's `pattern: "\\S"` (route.ts): a
          // submission that would come back 400 never leaves the browser.
          disabled={isRunning || isEmpty}
          aria-label={isRunning ? "Выполняем…" : "Выполнить"}
          title={isRunning ? "Выполняем…" : isEmpty ? "Введите код, чтобы выполнить" : "Выполнить код"}
        >
          <PlayIcon />
        </button>
        {isEmpty && !isRunning && <span className="practice-toolbar-note">Введите код, чтобы выполнить.</span>}
      </div>

      {runError !== null && (
        <p className="muted-note">{formatApiError(runError, "Не удалось выполнить код. Попробуйте ещё раз.")}</p>
      )}

      {execution !== undefined && (
        <div className="practice-result">
          {execution.failure !== undefined && (
            <CodeFailureView kind={execution.failure.kind} message={execution.failure.message} />
          )}
          {execution.ok && <CaseTable cases={execution.cases} />}
          {execution.ok && (
            <p
              className={
                execution.passed
                  ? "practice-verdict practice-verdict--passed"
                  : "practice-verdict practice-verdict--failed"
              }
            >
              {execution.passed
                ? "Все случаи пройдены."
                : `Пройдено ${execution.cases.filter((c) => c.passed).length} из ${execution.cases.length}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const FAILURE_TITLES: Record<PracticeCodeFailureKind, string> = {
  load_failed: "Модуль не загрузился",
  entry_missing: "Экспорт не найден",
  timeout: "Превышено время выполнения",
  crashed: "Процесс завершился аварийно",
};

/** Why the module could not be run at all — a heading in the app's words
 * and node's own text underneath, verbatim (same rule as Postgres errors
 * in the sql kind: a learner debugging needs the real message). */
function CodeFailureView({ kind, message }: { kind: PracticeCodeFailureKind; message: string }) {
  return (
    <div className="practice-code-failure">
      <p className="practice-verdict practice-verdict--failed">{FAILURE_TITLES[kind]}</p>
      <pre className="practice-code-error">{message}</pre>
    </div>
  );
}

/** One row per case: what the function was called with, what the
 * learner's version returned (or threw), what it printed, and whether
 * that matched. The reference is never here — it never left the server. */
function CaseTable({ cases }: { cases: PracticeCodeCaseResult[] }) {
  return (
    <table className="code-cases">
      <thead>
        <tr>
          <th scope="col">Вход</th>
          <th scope="col">Результат</th>
          <th scope="col">Вывод</th>
          <th scope="col">Вердикт</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c, index) => (
          <tr key={index} className={c.passed ? "code-case--passed" : "code-case--failed"}>
            <td>
              <code>{formatCodeArgs(c.args)}</code>
            </td>
            <td>
              {c.error !== undefined ? (
                <code className="code-case-error">{c.error.message}</code>
              ) : c.value !== undefined ? (
                <code>{formatCodeValue(c.value)}</code>
              ) : (
                <span className="muted-note">—</span>
              )}
            </td>
            <td>
              {c.output.length > 0 && (
                <pre className="code-case-output">
                  {c.output}
                  {c.truncated && "…"}
                </pre>
              )}
            </td>
            <td>{c.passed ? "пройден" : "не пройден"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
