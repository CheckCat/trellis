import { useState } from "react";
import { ApiError } from "../../api/client";
import type { PublicAnswerPractice } from "../../api/types";
import { useAnswerPractice } from "./useAnswerPractice";

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
            </div>
          );
        })}

        <button type="submit" className="run-button" disabled={isSubmitting}>
          {isSubmitting ? "Проверяем…" : "Проверить"}
        </button>
      </form>

      {submitError !== null && (
        <p className="muted-note">
          {submitError instanceof ApiError
            ? submitError.message
            : "Не удалось отправить ответы. Попробуйте ещё раз."}
        </p>
      )}

      {marks !== undefined && (
        <p className={marks.ok ? "practice-verdict practice-verdict--passed" : "practice-verdict practice-verdict--failed"}>
          {marks.ok ? "Все ответы верны." : "Пока не всё верно — исправьте отмеченные поля и проверьте снова."}
        </p>
      )}
    </section>
  );
}
