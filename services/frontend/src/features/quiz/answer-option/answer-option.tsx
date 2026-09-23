import type { PublicQuizOption } from "../../../shared/api/types";

export type AnswerOptionStatus = "idle" | "pending" | "correct" | "incorrect";

const STATUS_LABEL: Record<Exclude<AnswerOptionStatus, "idle">, string> = {
  pending: "Проверяем…",
  correct: "Верно",
  incorrect: "Неверно",
};

/**
 * One selectable quiz option. Purely presentational — `QuizView` decides
 * `status` per render from `useQuiz`'s verdict, this component just paints
 * it: an unanswered option is a plain button, the option most recently
 * submitted turns green (with its own explanation, if it has one) when
 * right or red (with its explanation) when wrong. No other option's status
 * is ever implied, matching the backend's "reveals nothing about options
 * the caller didn't pick" contract (`routes/quiz.ts`).
 */
export function AnswerOption({
  option,
  status,
  explanation,
  disabled,
  onSelect,
}: {
  option: PublicQuizOption;
  status: AnswerOptionStatus;
  explanation?: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const isGraded = status === "correct" || status === "incorrect";

  return (
    <li>
      <button
        type="button"
        className={`answer-option${status === "idle" ? "" : ` answer-option--${status}`}`}
        onClick={onSelect}
        disabled={disabled}
      >
        <span>{option.text}</span>
        {status !== "idle" && <span className="answer-option-status">{STATUS_LABEL[status]}</span>}
      </button>
      {isGraded && explanation !== undefined && <p className="answer-option-explanation">{explanation}</p>}
    </li>
  );
}
