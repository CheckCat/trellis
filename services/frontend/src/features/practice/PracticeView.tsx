import { useState } from "react";
import { ApiError } from "../../api/client";
import type { PracticeSqlError, PublicPractice } from "../../api/types";
import { ResultTable } from "./ResultTable";
import { SqlEditor } from "./SqlEditor";
import { usePractice } from "./usePractice";

/**
 * A lesson's practice exercise: an SQL editor against the course's sandbox,
 * the raw result (or Postgres' own error text) of the last run, the check
 * query's verdict when the lesson has one, and a way to reset the sandbox
 * back to its seeded state.
 *
 * Rendered whenever the lesson carries a `practice` assignment at all —
 * not gated on `completionMode` the way `QuizView` is gated on `"quiz"`.
 * A practice without a check (`completionMode: "manual"`) still needs this
 * UI to let the learner run SQL; `LessonView`'s existing "mark as done"
 * button (unchanged by this task) is what completes that kind of lesson,
 * exactly as task-009's report describes ("Задание без check —
 * самоотметка... это уже закрывает существующий .../complete").
 */
export function PracticeView({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicPractice;
}) {
  const [sql, setSql] = useState("");
  const { execution, isRunning, runError, run, isResetting, resetError, resetSucceeded, reset } = usePractice(
    courseId,
    lessonId,
    practice.sandbox,
  );

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <SqlEditor value={sql} onChange={setSql} onRun={() => run(sql)} busy={isRunning} />
      {runError !== null && (
        <p className="muted-note">
          {runError instanceof ApiError ? runError.message : "Не удалось выполнить запрос. Попробуйте ещё раз."}
        </p>
      )}

      {execution !== undefined && (
        <div className="practice-result">
          {execution.ok
            ? execution.result !== undefined && <ResultTable result={execution.result} />
            : execution.error !== undefined && <PracticeSqlErrorView error={execution.error} />}
          {execution.check.present && (
            <p
              className={
                execution.check.passed === true
                  ? "practice-verdict practice-verdict--passed"
                  : "practice-verdict practice-verdict--failed"
              }
            >
              {execution.check.passed === true ? "Проверка пройдена." : "Проверка не пройдена."}
            </p>
          )}
        </div>
      )}

      <div className="practice-sandbox-controls">
        {/* Not gated on `isRunning`: a reset targets the sandbox itself, not
         * the in-flight run, and react-query's `MutationObserver.reset()`
         * (called by `usePractice`'s reset `onSuccess`) detaches this view's
         * run-mutation observer from whatever `Mutation` instance is still
         * executing — that instance's eventual success/error can no longer
         * reach `execution`/`runError` here, so a run finishing after a
         * reset cannot repaint a stale result over the freshly-reset
         * sandbox. Letting the learner reset without waiting out a slow
         * query is a deliberate UX choice, not an oversight. */}
        <button type="button" className="reset-sandbox-button" onClick={reset} disabled={isResetting}>
          {isResetting ? "Сбрасываем…" : "Сбросить песочницу"}
        </button>
        {resetError !== null && (
          <p className="muted-note">
            {resetError instanceof ApiError ? resetError.message : "Не удалось сбросить песочницу. Попробуйте ещё раз."}
          </p>
        )}
        {resetSucceeded && <p className="muted-note">Песочница сброшена до исходного состояния.</p>}
      </div>
    </section>
  );
}

/** Postgres' own error, verbatim — see `PracticeSqlError`'s doc comment for
 * why nothing here rewrites or summarizes it. `position` is not (yet) used
 * to place a caret in the editor; kept in the type for a later task. */
function PracticeSqlErrorView({ error }: { error: PracticeSqlError }) {
  return (
    <pre className="practice-sql-error">
      {error.message}
      {error.hint !== undefined && `\nHint: ${error.hint}`}
    </pre>
  );
}
