import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiError, api } from "../../api/client";
import type { CourseProgressResponse, LessonCompletionMode } from "../../api/types";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "../../ui/icons";
import { flattenLessons, type PlacedLesson } from "../course/progress";
import { PracticeView } from "../practice/PracticeView";
import { QuizView } from "../quiz/QuizView";
import { Markdown } from "./Markdown";

const NON_MANUAL_NOTE: Record<Exclude<LessonCompletionMode, "manual">, string> = {
  quiz: "Урок завершается правильным ответом на квиз.",
  practice: "Урок завершается прохождением проверки практики.",
};

/**
 * Single lesson page: its Markdown body, whatever the lesson is graded by,
 * and the two moves that matter — back to the course, on to the next
 * lesson.
 *
 * Two queries instead of one: the lesson's Markdown body comes from
 * `GET /courses/:courseId/lessons/:lessonId` (no status field on that
 * shape), its status/completionMode comes from the course's progress tree
 * (`GET /courses/:courseId/progress`, the same query `CoursePage` uses —
 * same `queryKey`, so completing a lesson here and going back to the course
 * list re-renders both from one cache entry). Дерево прогресса заодно
 * задаёт порядок уроков, из которого страница строит шапку и переходы
 * «назад/дальше» (`flattenLessons`).
 */
export function LessonView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const contentQuery = useQuery({
    queryKey: ["lesson", courseId, lessonId],
    queryFn: () => api.getLesson(courseId, lessonId),
  });

  const progressQuery = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });

  if (contentQuery.isPending || progressQuery.isPending) {
    return <p className="muted-note">Загружаем урок…</p>;
  }

  if (contentQuery.isError || progressQuery.isError) {
    const notFound =
      (contentQuery.error instanceof ApiError && contentQuery.error.status === 404) ||
      (progressQuery.error instanceof ApiError && progressQuery.error.status === 404);
    return (
      <p className="muted-note">{notFound ? `Урок «${lessonId}» не найден.` : "Не удалось загрузить урок."}</p>
    );
  }

  const placed = flattenLessons(progressQuery.data);
  const position = placed.findIndex((candidate) => candidate.lesson.id === lessonId);
  // Одна проверка на оба случая: `findIndex` вернул -1, либо индекс есть, но
  // элемента по нему нет. Второе недостижимо, но под `noUncheckedIndexedAccess`
  // это надо доказать компилятору — а доказывать двумя ветками то, что для
  // читателя один и тот же случай, значит только запутать.
  const current = placed[position];

  if (current === undefined) {
    // Lesson exists in content (contentQuery succeeded) but not in the
    // progress tree — only reachable if the course changed on disk between
    // the two requests (a rescan). Same "not found" wording as the 404 path
    // above; the cause doesn't change what the user should do about it.
    return <p className="muted-note">Урок «{lessonId}» не найден.</p>;
  }

  const previous = placed[position - 1];
  const next = placed[position + 1];

  return (
    <article className="lesson">
      {/* Выведена из потока влево: возврат к оглавлению нужен на любом
       * уроке и не должен занимать строку над заголовком. На узком экране
       * места слева нет — там она встаёт обратно в поток (index.css). */}
      <Link className="lesson-back" to="/courses/$courseId" params={{ courseId }} title="К курсу">
        <ArrowLeftIcon />
        <span>К курсу</span>
      </Link>

      <header className="lesson-header">
        <p className="lesson-module">{current.moduleTitle}</p>
        <h1 className="lesson-title">{contentQuery.data.title}</h1>
        <ModuleRail placed={placed} current={current} progress={progressQuery.data} />
      </header>

      {contentQuery.data.content !== undefined && <Markdown source={contentQuery.data.content} />}

      {current.lesson.completionMode === "quiz" && contentQuery.data.quiz !== undefined && (
        // `LessonDetailResponse.quiz` and the tree's `completionMode` come
        // from two separate queries (see the module doc comment above) —
        // guarding on both, rather than trusting `completionMode` alone, is
        // what keeps this from ever rendering `QuizView` with `quiz` typed
        // as possibly-undefined.
        <section className="lesson-section">
          <h2 className="lesson-section-title">Проверьте себя</h2>
          <QuizView courseId={courseId} lessonId={lessonId} quiz={contentQuery.data.quiz} />
        </section>
      )}

      {contentQuery.data.practice !== undefined && (
        // Rendered regardless of `completionMode` (unlike QuizView above) —
        // see PracticeView's own doc comment: an unchecked practice still
        // needs the editor, it just doesn't gate completion here.
        <section className="lesson-section">
          <h2 className="lesson-section-title">Практика</h2>
          <PracticeView courseId={courseId} lessonId={lessonId} practice={contentQuery.data.practice} />
        </section>
      )}

      <LessonFooter courseId={courseId} lessonId={lessonId} current={current} previous={previous} next={next} />
    </article>
  );
}

/**
 * «Шпалера» — по сегменту на урок ТЕКУЩЕГО МОДУЛЯ.
 *
 * Раньше сегменты шли на весь курс. На курсе из девяти уроков это читалось,
 * на курсе из семидесяти пяти превращалось в пунктир, в котором текущий
 * сегмент было невозможно найти, а сама полоса вылезала за колонку. Модуль —
 * тот масштаб, в котором полоса что-то значит: это обозримый отрезок, у него
 * есть конец, и до конца видно, сколько осталось.
 *
 * Текущий сегмент выше остальных, а не обведён рамкой: рамка на полосе
 * высотой 3px — это два пикселя контура вокруг одного пикселя заливки, её
 * не видно. Место курса целиком ушло в тихую строку рядом.
 *
 * Для чтения с экрана полоса избыточна — строка «Урок 2 из 7» рядом говорит
 * то же самое словами, — поэтому она скрыта.
 */
function ModuleRail({
  placed,
  current,
  progress,
}: {
  placed: readonly PlacedLesson[];
  current: PlacedLesson;
  progress: CourseProgressResponse;
}) {
  const inModule = placed.filter((candidate) => candidate.moduleId === current.moduleId);

  return (
    <div className="lesson-rail-row">
      <ol className="trellis-rail" aria-hidden="true">
        {inModule.map(({ lesson }) => {
          const state =
            lesson.id === current.lesson.id ? "current" : lesson.status === "completed" ? "completed" : "upcoming";
          return <li key={lesson.id} className={`trellis-segment trellis-segment--${state}`} />;
        })}
      </ol>
      <p className="lesson-position">
        Урок {current.numberInModule} из {current.moduleLessonCount}
        {/* Место в курсе целиком — второй по важности факт, поэтому он и
         * набран вторым голосом. «Урок 7 из 75» в заголовке обескураживал;
         * «12 из 75 пройдено» сбоку — это уже про сделанное. */}
        <span className="lesson-position-course">
          {progress.completedLessons} из {progress.totalLessons} пройдено в курсе
        </span>
      </p>
    </div>
  );
}

/**
 * Низ урока: чем он засчитывается и куда идти дальше.
 *
 * Отдельной кнопки «Отметить пройденным» больше нет. На текстовом уроке
 * отметка и переход — один и тот же жест («прочитал — дальше»), и две
 * кнопки подряд заставляли делать его дважды; теперь переход и есть
 * отметка. Уроки с квизом или проверяемой практикой этим не затронуты:
 * их засчитывает механика, и переход для них — обычная ссылка.
 */
function LessonFooter({
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
