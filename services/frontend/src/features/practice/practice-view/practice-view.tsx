import type { PracticeResultSet, PracticeSqlError, PublicPractice, PublicSqlPractice } from "../../../shared/api/types";
import { formatApiError } from "../../../shared/lib/format-api-error";
import { PlayIcon } from "../../../shared/ui/icons";
import { AnswerForm } from "../answer-form";
import { draftKey, useDraft } from "../draft";
import { ResultTable } from "../result-table";
import { SqlEditor } from "../sql-editor";
import { usePractice } from "../use-practice";

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
 *
 * Every kind is named, and an unnamed one says so. There is no `else`
 * branch falling through to the SQL editor: `shared/api/types.ts` is written by
 * hand, so a backend that learns a third practice type before this app
 * does sends a `type` TypeScript here believes impossible. Falling through
 * would point an SQL editor at a sandbox the assignment does not have and
 * blame the learner for the empty result.
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
  switch (practice.type) {
    case "answer":
      return <AnswerForm courseId={courseId} lessonId={lessonId} practice={practice} />;
    case "sql":
      return <SqlPracticeView courseId={courseId} lessonId={lessonId} practice={practice} />;
    default:
      // Unreachable by the types above — which is exactly the case worth
      // handling, since the types describe what this build knows, not what
      // the backend serves. Adding a kind to `PublicPractice` and
      // forgetting it here is a compile error; meeting one at runtime is
      // this.
      return <UnsupportedPractice practice={practice} />;
  }
}

/**
 * A practice kind this build cannot display.
 *
 * Says what happened and what to do about it, in the app's own voice: the
 * course is fine, the app is behind. The prompt is shown anyway — it is
 * plain text the learner can act on, and showing it beats an empty box.
 */
function UnsupportedPractice({ practice }: { practice: never }) {
  const { type, prompt } = practice as unknown as { type: string; prompt?: string };
  return (
    <section className="practice-view">
      {prompt !== undefined && <p className="practice-prompt">{prompt}</p>}
      <p className="muted-note">
        Это задание типа «{type}» — курс рассчитан на более новую версию платформы, чем установлена. Обновите
        приложение, чтобы выполнить его здесь.
      </p>
    </section>
  );
}

/**
 * The SQL kind: an editor against the course's sandbox, the raw result (or
 * Postgres' own error text) of the last run, and the verdict of each
 * grading mechanic the lesson declares.
 *
 * There is no "reset the sandbox" control, because there is nothing to
 * reset: the backend rebuilds the sandbox from the course's seed before
 * every single attempt. That is also why the editor says so after a
 * statement that changed data — otherwise the next run looks like the
 * previous one silently failed.
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
  // Черновик переживает уход с урока: вернувшись, ученик видит своё
  // решение, а не пустое поле (см. draft.ts — почему localStorage, а не
  // файл переноса).
  const [sql, setSql] = useDraft(draftKey(courseId, lessonId));
  // Тот же предикат, что блокирует кнопку, — и он же решает, что написать
  // рядом. Одно условие на два следствия: иначе кнопка и подпись начинают
  // расходиться на пробельной строке.
  const isEmpty = sql.trim().length === 0;
  const { execution, isRunning, runError, run } = usePractice(courseId, lessonId);

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <SqlEditor value={sql} onChange={setSql} busy={isRunning} />

      {/* Запуск — единственное действие над песочницей: сбрасывать её
       * вручную больше не нужно, движок пересевает её сам перед каждой
       * попыткой. Иконка вместо слова: подпись живёт в `aria-label`/`title`,
       * а форма значка узнаётся быстрее. */}
      <div className="practice-toolbar">
        <button
          type="button"
          className="icon-button icon-button--primary"
          onClick={() => run(sql)}
          // Зеркалит серверную проверку `pattern: "\\S"` на теле запроса
          // (routes/practice/sql.ts): отправка, которая гарантированно
          // вернёт 400, из браузера не уходит.
          disabled={isRunning || isEmpty}
          aria-label={isRunning ? "Выполняем…" : "Выполнить"}
          title={isRunning ? "Выполняем…" : isEmpty ? "Введите запрос, чтобы выполнить" : "Выполнить запрос"}
        >
          <PlayIcon />
        </button>
        {/* Выключенный вид кнопки говорит «нельзя», эта строка — «чего не
         * хватает»; без неё ученику остаётся догадываться. */}
        {isEmpty && !isRunning && <span className="practice-toolbar-note">Введите запрос, чтобы выполнить.</span>}
      </div>

      {runError !== null && (
        <p className="muted-note">{formatApiError(runError, "Не удалось выполнить запрос. Попробуйте ещё раз.")}</p>
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
          {execution.solution.present && execution.solution.passed !== undefined && (
            <p className={verdictClassName(execution.solution.passed)}>
              {execution.solution.passed
                ? "База пришла в нужное состояние."
                : `База пришла не в то состояние${
                    execution.solution.reason === undefined ? "" : `: ${execution.solution.reason}`
                  }.`}
            </p>
          )}
          {execution.ok && execution.result !== undefined && <ChangeNote result={execution.result} />}
        </div>
      )}

    </section>
  );
}

/**
 * Says what a data-changing statement did — and that it will not stick.
 *
 * Without this the engine looks broken: the learner runs an UPDATE, sees
 * "UPDATE 1", runs a SELECT to admire it, and the row is unchanged, because
 * the second run started from the seed like every run does. Postgres' own
 * command tag is what decides whether to say anything, so nothing here
 * parses the learner's SQL.
 */
function ChangeNote({ result }: { result: PracticeResultSet }) {
  const changed = result.command !== undefined && CHANGING_COMMANDS.has(result.command);
  if (!changed || result.rowCount === null || result.rowCount === undefined) {
    return null;
  }
  return (
    <p className="practice-change-note">
      Изменено строк: {result.rowCount}. Перед следующим запуском песочница вернётся к исходному состоянию — чтобы
      увидеть результат, выполните изменение и запрос одним запуском.
    </p>
  );
}

/** Command tags Postgres reports for statements that wrote something. */
const CHANGING_COMMANDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

/** Shared by all verdict lines. `passed` is `undefined` only for a
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
