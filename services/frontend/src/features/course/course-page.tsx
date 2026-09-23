import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiError, api } from "../../api/client";
import type { CourseProgressResponse } from "../../api/types";
import { nextUnfinishedLesson, studyStreakDays } from "../../entities/course/progress";
import { ArrowRightIcon, CheckIcon, FlameIcon } from "../../ui/icons";
import { plural } from "../../ui/plural";
import { ModuleList } from "./module-list";
import { RestartCourseButton } from "./restart-course-button";

/**
 * Course navigation page: where the learner is in this course, the one
 * action that moves them forward, and the module/lesson tree.
 *
 * Fetches `GET /courses/:courseId/progress` (not `CourseDetailResponse` —
 * that shape carries no status) so the tree it renders already has
 * completed/not_started joined onto every lesson, per task-011's report.
 *
 * `description` lives only on `CourseDetailResponse`, not on the progress
 * shape above (`courseProgressResponseSchema` has no such field), so a
 * second, non-blocking `getCourse` fetch supplies it — review finding on
 * task-013. Deliberately not gated on its own loading/error state: the
 * description is a supplementary enhancement to a page whose primary
 * content (title, counters, module tree) already renders from the
 * progress query; `courseQuery.data?.description` simply renders nothing
 * extra while pending or on failure, same "don't block the page for a
 * secondary field" call `LessonView`'s two-query split documents.
 */
export function CoursePage({ courseId }: { courseId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });
  const { data: courseData } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
  });

  if (isPending) {
    return <p className="muted-note">Загружаем курс…</p>;
  }

  if (isError) {
    // Same narrowing as the old CourseDetailPage (task-011 fix round): only
    // a genuine 404 means "no such course" — any other failure gets the
    // generic message CoursesIndexPage uses for the same failure class.
    if (error instanceof ApiError && error.status === 404) {
      return <p className="muted-note">Курс «{courseId}» не найден.</p>;
    }
    return <p className="muted-note">Не удалось загрузить курс.</p>;
  }

  return (
    <article className="course">
      <header className="course-header">
        <h1 className="page-heading">{data.title}</h1>
        {courseData?.description !== undefined && <p className="course-description">{courseData.description}</p>}
      </header>

      <CourseStatus courseId={courseId} progress={data} />

      <ModuleList courseId={courseId} modules={data.modules} />
    </article>
  );
}

/**
 * The band between the title and the tree: how far along the course is, the
 * single action that continues it, and the way back to the start.
 *
 * All three read from the same already-fetched tree — no extra request, and
 * no stored "current lesson" cursor anywhere (see entities/course/progress.ts).
 */
function CourseStatus({ courseId, progress }: { courseId: string; progress: CourseProgressResponse }) {
  const next = nextUnfinishedLesson(progress);
  const streak = studyStreakDays(progress);
  const started = progress.completedLessons > 0;

  return (
    <section className="course-status">
      <CourseProgressBar progress={progress} />

      <p className="course-counters">
        {/* Предложение целиком — один flex-элемент. Иначе зазор строки
         * раздвигает число и слова вокруг него, и «2 из 9» читается как
         * два куска текста, а не как одна фраза. */}
        <span>
          <strong>{progress.completedLessons}</strong> из {progress.totalLessons}{" "}
          {plural(progress.totalLessons, ["урока", "уроков", "уроков"])} пройдено
        </span>
        {/* Серия — единственная «игровая» механика здесь, и она ничего не
         * хранит: это арифметика по датам зачётов, которые и так уезжают в
         * файл переноса. Один день — не серия, поэтому порог 2. */}
        {streak >= 2 && (
          <span className="streak" title="Дней подряд с пройденными уроками">
            <FlameIcon />
            {streak} {plural(streak, ["день", "дня", "дней"])} подряд
          </span>
        )}
      </p>

      <div className="course-actions">
        {next === undefined ? (
          <p className="course-done">
            <CheckIcon />
            Курс пройден целиком
          </p>
        ) : (
          <Link
            className="button button--primary"
            to="/courses/$courseId/lessons/$lessonId"
            params={{ courseId, lessonId: next.lesson.id }}
          >
            {started ? "Продолжить" : "Начать курс"}
            <ArrowRightIcon />
          </Link>
        )}
        {/* Нечего стирать — нечего и предлагать: на нетронутом курсе кнопка
         * «Перепройти» была бы действием без последствий. */}
        {started && <RestartCourseButton courseId={courseId} progress={progress} />}
      </div>

      {next !== undefined && started && (
        <p className="course-next-hint muted-note">Следующий: {next.lesson.title}</p>
      )}
    </section>
  );
}

/** Course-level progress as a bar. Purely decorative for a screen reader —
 * the counters right beside it say the same in words, and a duplicate
 * `progressbar` role would just be read twice. */
function CourseProgressBar({ progress }: { progress: CourseProgressResponse }) {
  const share = progress.totalLessons === 0 ? 0 : progress.completedLessons / progress.totalLessons;
  return (
    <div className="course-progress" aria-hidden="true">
      <div className="course-progress-fill" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}
