import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api } from "../../api/client";
import type { LessonCompletionMode } from "../../api/types";
import type { PlacedLesson } from "../../entities/course/progress";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "../../ui/icons";

const NON_MANUAL_NOTE: Record<Exclude<LessonCompletionMode, "manual">, string> = {
  quiz: "Урок завершается правильным ответом на квиз.",
  practice: "Урок завершается прохождением проверки практики.",
};

/**
 * Низ урока: чем он засчитывается и куда идти дальше.
 *
 * Отдельной кнопки «Отметить пройденным» больше нет. На текстовом уроке
 * отметка и переход — один и тот же жест («прочитал — дальше»), и две
 * кнопки подряд заставляли делать его дважды; теперь переход и есть
 * отметка. Уроки с квизом или проверяемой практикой этим не затронуты:
 * их засчитывает механика, и переход для них — обычная ссылка.
 */
export function LessonFooter({
  courseId,
  lessonId,
  current,
  previous,
  next,
}: {
  courseId: string;
  lessonId: string;
  current: PlacedLesson;
  previous: PlacedLesson | undefined;
  next: PlacedLesson | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const completeMutation = useMutation({
    mutationFn: () => api.completeLesson(courseId, lessonId),
    onSuccess: () => {
      // Re-fetch rather than hand-patch the cache: the response also carries
      // fresh module/course counters this component doesn't otherwise see.
      void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
    },
  });

  const isCompleted = current.lesson.status === "completed";
  const mode = current.lesson.completionMode;
  const marksOnLeaving = mode === "manual" && !isCompleted;

  /** Отмечает урок и уходит дальше — и уходит ТОЛЬКО если отметка удалась.
   * Оптимистичный переход был бы тише, но зачёт, который молча не записался,
   * ученик обнаружит через неделю по дырке в прогрессе. */
  const completeAndGo = (targetLessonId?: string): void => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        if (targetLessonId !== undefined) {
          void navigate({
            to: "/courses/$courseId/lessons/$lessonId",
            params: { courseId, lessonId: targetLessonId },
          });
        }
      },
    });
  };

  return (
    <footer className="lesson-footer">
      <CompletionNote mode={mode} isCompleted={isCompleted} />

      <nav className="lesson-nav" aria-label="Переход между уроками">
        {previous === undefined ? (
          <span className="lesson-nav-empty" />
        ) : (
          <Link
            className="lesson-nav-link lesson-nav-link--previous"
            to="/courses/$courseId/lessons/$lessonId"
            params={{ courseId, lessonId: previous.lesson.id }}
            // Имя задано явно, а не собрано из двух соседних <span>: без
            // разделителя между ними доступное имя склеивалось бы в
            // «НазадУрок про текучесть».
            aria-label={`Назад: ${previous.lesson.title}`}
          >
            <ArrowLeftIcon />
            <span className="lesson-nav-body">
              <span className="lesson-nav-label">Назад</span>
              <span className="lesson-nav-title">{previous.lesson.title}</span>
            </span>
          </Link>
        )}

        {next === undefined ? (
          <LastLessonControl
            courseId={courseId}
            marksOnLeaving={marksOnLeaving}
            busy={completeMutation.isPending}
            onFinish={() => completeAndGo()}
          />
        ) : marksOnLeaving ? (
          <button
            type="button"
            className="lesson-nav-link lesson-nav-link--next"
            disabled={completeMutation.isPending}
            onClick={() => completeAndGo(next.lesson.id)}
            aria-label={`Прочитал, дальше: ${next.lesson.title}`}
          >
            <span className="lesson-nav-body">
              <span className="lesson-nav-label">
                {completeMutation.isPending ? "Отмечаем…" : "Прочитал, дальше"}
              </span>
              <span className="lesson-nav-title">{next.lesson.title}</span>
            </span>
            <ArrowRightIcon />
          </button>
        ) : (
          <Link
            className="lesson-nav-link lesson-nav-link--next"
            to="/courses/$courseId/lessons/$lessonId"
            params={{ courseId, lessonId: next.lesson.id }}
            aria-label={`Дальше: ${next.lesson.title}`}
          >
            <span className="lesson-nav-body">
              <span className="lesson-nav-label">Дальше</span>
              <span className="lesson-nav-title">{next.lesson.title}</span>
            </span>
            <ArrowRightIcon />
          </Link>
        )}
      </nav>

      {completeMutation.isError && (
        <p className="muted-note">Не удалось отметить урок пройденным — прогресс не записан.</p>
      )}
    </footer>
  );
}

/** Последний урок курса: дальше идти некуда, поэтому действие — закрыть
 * курс и вернуться к нему. */
function LastLessonControl({
  courseId,
  marksOnLeaving,
  busy,
  onFinish,
}: {
  courseId: string;
  marksOnLeaving: boolean;
  busy: boolean;
  onFinish: () => void;
}) {
  if (marksOnLeaving) {
    return (
      <button
        type="button"
        className="lesson-nav-link lesson-nav-link--next"
        disabled={busy}
        onClick={onFinish}
        aria-label="Завершить курс"
      >
        <span className="lesson-nav-body">
          <span className="lesson-nav-label">{busy ? "Отмечаем…" : "Последний урок"}</span>
          <span className="lesson-nav-title">Завершить курс</span>
        </span>
        <CheckIcon />
      </button>
    );
  }

  return (
    // Не просто «К курсу»: так же называется кнопка возврата в шапке урока,
    // и два одинаковых имени на одной странице — это две ссылки, которые на
    // слух не отличить.
    <Link
      className="lesson-nav-link lesson-nav-link--next"
      to="/courses/$courseId"
      params={{ courseId }}
      aria-label="Вернуться к курсу"
    >
      <span className="lesson-nav-body">
        <span className="lesson-nav-label">Последний урок</span>
        <span className="lesson-nav-title">К курсу</span>
      </span>
      <ArrowRightIcon />
    </Link>
  );
}

/** Одна строка о том, чем урок засчитывается — и засчитан ли уже. Для
 * текстового урока молчит: там об этом говорит сама кнопка перехода. */
function CompletionNote({ mode, isCompleted }: { mode: LessonCompletionMode; isCompleted: boolean }) {
  if (isCompleted) {
    return (
      <p className="lesson-done">
        <CheckIcon />
        Урок пройден
      </p>
    );
  }
  if (mode === "manual") {
    return null;
  }
  return <p className="muted-note">{NON_MANUAL_NOTE[mode]}</p>;
}
