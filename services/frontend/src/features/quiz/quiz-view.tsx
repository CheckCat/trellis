import type { PublicQuiz, PublicQuizOption } from "../../api/types";
import { AnswerOption, type AnswerOptionStatus } from "./answer-option";
import { useQuiz, type QuizVerdict } from "./use-quiz";

function optionStatus(
  option: PublicQuizOption,
  verdict: QuizVerdict | undefined,
  pendingOptionId: string | undefined,
): AnswerOptionStatus {
  if (pendingOptionId === option.id) {
    return "pending";
  }
  if (verdict !== undefined && verdict.optionId === option.id) {
    return verdict.correct ? "correct" : "incorrect";
  }
  return "idle";
}

/**
 * A lesson's quiz: pick an option, get graded, try again if wrong —
 * unlimited attempts, no attempt history kept (`routes/quiz.ts`'s product
 * model). Deliberately doesn't take an `isCompleted` prop: a right answer
 * is always safe to resubmit (the backend never un-completes a passed
 * lesson), so this renders interactive the same way whether the lesson was
 * already completed in an earlier session or not — `LessonView` is the one
 * that shows the "already completed" note above this, from the progress
 * tree it already has.
 */
export function QuizView({ courseId, lessonId, quiz }: { courseId: string; lessonId: string; quiz: PublicQuiz }) {
  const { verdict, pendingOptionId, isError, submit } = useQuiz(courseId, lessonId);
  const disabled = pendingOptionId !== undefined;

  return (
    <section className="quiz-view">
      <p className="quiz-question">{quiz.question}</p>
      <ul className="answer-option-list">
        {quiz.options.map((option) => (
          <AnswerOption
            key={option.id}
            option={option}
            status={optionStatus(option, verdict, pendingOptionId)}
            explanation={verdict?.optionId === option.id ? verdict.explanation : undefined}
            disabled={disabled}
            onSelect={() => submit(option.id)}
          />
        ))}
      </ul>
      {isError && <p className="muted-note">Не удалось отправить ответ. Попробуйте ещё раз.</p>}
    </section>
  );
}
