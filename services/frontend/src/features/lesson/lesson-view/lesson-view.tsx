import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiError, api } from "../../../shared/api/client";
import type { CourseProgressResponse } from "../../../shared/api/types";
import { flattenLessons, type PlacedLesson } from "../../../entities/course/progress";
import { ArrowLeftIcon } from "../../../shared/ui/icons";
import { PracticeView } from "../../practice/practice-view";
import { QuizView } from "../../quiz/quiz-view";
import { LessonFooter } from "../lesson-footer";
import { Markdown } from "../markdown";

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

