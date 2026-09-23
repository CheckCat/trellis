import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../shared/api/client";
import type { PublicAnswerPractice } from "../../../shared/api/types";
import { EyeIcon } from "../../../shared/ui/icons";
import { formatApiError } from "../../../shared/lib/format-api-error";
import { useAnswerPractice } from "../use-answer-practice";

/**
 * A practice assignment done outside the platform: the learner works in
 * Excel or a dashboard and types the values they arrived at into this
 * form, one input per declared field.
 *
 * Deliberately a plain, re-submittable form rather than a one-shot quiz:
 * "можно исправить и отправить снова" is the whole point — getting a
 * number wrong here usually means a mistake in the spreadsheet, and the
 * learner is expected to go back, fix it, and try again. A passed lesson
 * never un-passes (progress invariant), so re-submitting is free.
 *
 * Every input is `type="text"`, including numeric ones: the backend reads
 * "18,5" and "1 234" itself (practice/answer.ts), while `type="number"`
 * would have the browser silently reject a comma in most locales and hand
 * over an empty string instead — the learner would see their own typing
 * disappear.
 */
export function AnswerForm({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicAnswerPractice;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { verdict, isSubmitting, submitError, submit } = useAnswerPractice(courseId, lessonId);

  // «Показать ответ». The reference values are never part of the lesson —
  // they come from their own endpoint, on their own request, and only once
  // the learner asks (routes/practice/answer.ts explains why that door
  // exists at all). `enabled` is what keeps this honest: until the button
  // is pressed, the request is not made and the answers are not in the
  // page at all, not merely hidden by CSS.
  const [revealed, setRevealed] = useState(false);
  const solutionQuery = useQuery({
    queryKey: ["answerSolution", courseId, lessonId],
    queryFn: () => api.getAnswerSolution(courseId, lessonId),
    enabled: revealed,
    staleTime: Infinity,
  });
  const solutionByField = new Map(solutionQuery.data?.fields.map((field) => [field.id, field]) ?? []);

  // The verdict describes the values that were submitted. Once the learner
  // starts editing, it no longer describes what is on screen — so an edit
  // clears the marks rather than leaving a stale "неверно" next to a field
  // that has just been corrected.
  const [showVerdict, setShowVerdict] = useState(false);
  const change = (fieldId: string, value: string) => {
    setShowVerdict(false);
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  };

  const marks = showVerdict ? verdict : undefined;
  // Once shown, the button stays — hiding it again on the next edit would
  // make "I pressed it a second ago" a thing the learner has to re-earn.
  const showReveal = revealed || (verdict !== undefined && !verdict.ok);

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <form
        className="answer-form"
        onSubmit={(event) => {
          event.preventDefault();
          setShowVerdict(true);
          submit(answers);
        }}
      >
        {practice.fields.map((field) => {
          const mark = marks?.fields[field.id];
          const solution = solutionByField.get(field.id);
          return (
            <div className="answer-field" key={field.id}>
              <label className="answer-field-label" htmlFor={`answer-${field.id}`}>
                {field.label}
              </label>
              <input
                id={`answer-${field.id}`}
                className={
                  mark === undefined
                    ? "answer-field-input"
                    : `answer-field-input answer-field-input--${mark.correct ? "correct" : "incorrect"}`
                }
                type="text"
                // A numeric field still gets the numeric soft keyboard on
                // touch devices, without `type="number"`'s locale parsing.
                inputMode={field.kind === "number" ? "decimal" : "text"}
                value={answers[field.id] ?? ""}
                disabled={isSubmitting}
                onChange={(event) => change(field.id, event.target.value)}
              />
              {mark !== undefined && (
                <span
                  className={`answer-field-mark answer-field-mark--${mark.correct ? "correct" : "incorrect"}`}
                >
                  {mark.correct ? "верно" : "неверно"}
                </span>
              )}
              {solution !== undefined && (
                // Эталон показывается рядом с полем, а не вместо него: то,
                // что ученик написал сам, остаётся на экране — иначе
                // непонятно, в чём именно была ошибка.
                <span className="answer-field-solution">
                  Ответ: <b>{solution.expected}</b>
                  {solution.tolerance !== undefined && ` (±${solution.tolerance})`}
                </span>
              )}
            </div>
          );
        })}

        <div className="answer-actions">
          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {isSubmitting ? "Проверяем…" : "Проверить"}
          </button>
          {/* Появляется только после неудачной попытки: до неё это был бы
           * спойлер к заданию, которое ученик ещё не пробовал решать.
           * Гарантии в этом нет и быть не может — эндпоинт открыт, и
           * серверная «защита» здесь была бы декорацией (см. маршрут), —
           * но по умолчанию задание остаётся заданием. */}
          {showReveal && (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setRevealed(true)}
              disabled={solutionQuery.isFetching}
            >
              <EyeIcon />
              {solutionQuery.isFetching ? "Показываем…" : "Показать ответ"}
            </button>
          )}
        </div>
      </form>

      {solutionQuery.isError && <p className="muted-note">Не удалось показать ответ. Попробуйте ещё раз.</p>}

      {submitError !== null && (
        <p className="muted-note">{formatApiError(submitError, "Не удалось отправить ответы. Попробуйте ещё раз.")}</p>
      )}

      {marks !== undefined && (
        <p className={marks.ok ? "practice-verdict practice-verdict--passed" : "practice-verdict practice-verdict--failed"}>
          {marks.ok ? "Все ответы верны." : "Пока не всё верно — исправьте отмеченные поля и проверьте снова."}
        </p>
      )}
    </section>
  );
}
