import type { PublicQuiz, PublicQuizOption } from "../../../shared/api/types";
import { useMultiQuiz } from "../use-multi-quiz";

/**
 * A multi-select quiz (`quiz.multiple: true`): check a set, submit it as a
 * whole, get graded per CHOSEN option — the backend says nothing about the
 * ones left unchecked (`routes/quiz.ts`), so neither does this view. Same
 * product model as the single-choice `QuizView`: unlimited attempts, no
 * locked state, safe to resubmit after passing.
 */
export function MultiQuizView({ courseId, lessonId, quiz }: { courseId: string; lessonId: string; quiz: PublicQuiz }) {
  const { selected, toggle, submit, verdict, isPending, isError } = useMultiQuiz(courseId, lessonId, quiz);
  const failed = verdict !== undefined && !verdict.correct;

  return (
    <section className="quiz-view">
      <p className="quiz-question">{quiz.question}</p>
      <ul className="answer-option-list">
        {quiz.options.map((option) => (
          <CheckOption
            key={option.id}
            option={option}
            verdict={verdict?.options[option.id]}
            checked={selected.has(option.id)}
            disabled={isPending}
            onToggle={() => toggle(option.id)}
          />
        ))}
      </ul>
      <button
        type="button"
        className="button button--primary"
        disabled={selected.size === 0 || isPending}
        onClick={submit}
      >
        Проверить
      </button>
      {failed && <p className="muted-note">Не зачтено.</p>}
      {failed && verdict.allChosenCorrect && (
        // Every pick was right, yet the set is wrong — the one hint the
        // backend's verdict shape allows. Which options are missing is
        // deliberately unknowable here.
        <p className="muted-note">Отмечены не все верные варианты.</p>
      )}
      {isError && <p className="muted-note">Не удалось отправить ответ. Попробуйте ещё раз.</p>}
    </section>
  );
}

/** One checkbox row. Reuses the single-choice option's visual language
 * (`answer-option` + status modifiers), with a label+checkbox instead of a
 * submit-on-click button. An option without a verdict — unchosen, or not
 * yet submitted — renders plain: no badge, no explanation. */
function CheckOption({
  option,
  verdict,
  checked,
  disabled,
  onToggle,
}: {
  option: PublicQuizOption;
  verdict?: { correct: boolean; explanation?: string };
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const status = verdict === undefined ? undefined : verdict.correct ? "correct" : "incorrect";

  return (
    <li>
      <label className={`answer-option${status === undefined ? "" : ` answer-option--${status}`}`}>
        <span className="answer-option-main">
          <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
          <span>{option.text}</span>
        </span>
        {status !== undefined && (
          <span className="answer-option-status">{status === "correct" ? "Верно" : "Неверно"}</span>
        )}
      </label>
      {verdict?.explanation !== undefined && <p className="answer-option-explanation">{verdict.explanation}</p>}
    </li>
  );
}
