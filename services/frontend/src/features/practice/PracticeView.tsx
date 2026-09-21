import { useState } from "react";
import { ApiError } from "../../api/client";
import type { PracticeSqlError, PublicPractice, PublicSqlPractice } from "../../api/types";
import { AnswerForm } from "./AnswerForm";
import { ResultTable } from "./ResultTable";
import { SqlEditor } from "./SqlEditor";
import { usePractice } from "./usePractice";

/**
 * A lesson's practice exercise, in whichever kind the course declared.
 *
 * Rendered whenever the lesson carries a `practice` assignment at all —
 * not gated on `completionMode` the way `QuizView` is gated on `"quiz"`.
 * A `sql` practice with no grading mechanic (`completionMode: "manual"`)
 * still needs this UI to let the learner run SQL; `LessonView`'s "mark as
 * done" button is what completes that kind of lesson.
 *
 * The two kinds share the prompt and nothing else — a different input, a
 * different endpoint, a different verdict shape, and one of them has no
 * sandbox at all — so this dispatches instead of branching inside one
 * component.
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
  if (practice.type === "answer") {
    return <AnswerForm courseId={courseId} lessonId={lessonId} practice={practice} />;
  }
  return <SqlPracticeView courseId={courseId} lessonId={lessonId} practice={practice} />;
}

/**
 * The SQL kind: an editor against the course's sandbox, the raw result (or
 * Postgres' own error text) of the last run, the verdict of each grading
 * mechanic the lesson declares, and a way to reset the sandbox back to its
 * seeded state.
 */
function SqlPracticeView({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicSqlPractice;
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
          {/* One line per grading mechanic the lesson declares. A lesson
           * carrying both is only completed when both pass
           * (routes/practice.ts), so both verdicts are shown — collapsing
           * them into a single line would hide which half is missing. */}
          {execution.check.present && (
            <p className={verdictClassName(execution.check.passed)}>
              {execution.check.passed === true ? "Проверка пройдена." : "Проверка не пройдена."}
            </p>
          )}
          {execution.expected.present && execution.expected.passed !== undefined && (
            <p className={verdictClassName(execution.expected.passed)}>
              {execution.expected.passed
                ? "Результат совпал с ожидаемым."
                : `Результат не совпал с ожидаемым${
                    execution.expected.reason === undefined ? "" : `: ${execution.expected.reason}`
                  }.`}
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

/** Shared by both verdict lines. `passed` is `undefined` only for a
 * mechanic that did not run (the learner's SQL errored), which the callers
 * already filter out — the failed styling is the safe default. */
function verdictClassName(passed: boolean | undefined): string {
  return passed === true ? "practice-verdict practice-verdict--passed" : "practice-verdict practice-verdict--failed";
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
