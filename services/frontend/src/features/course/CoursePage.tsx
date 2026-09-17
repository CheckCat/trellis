import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import { ModuleList } from "./ModuleList";

/**
 * Course navigation page: module/lesson tree with per-lesson statuses.
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
    <>
      <h1 className="page-heading">{data.title}</h1>
      {courseData?.description !== undefined && <p className="muted-note">{courseData.description}</p>}
      <p className="muted-note">
        {data.completedLessons} / {data.totalLessons} уроков пройдено
      </p>
      <ModuleList courseId={courseId} modules={data.modules} />
    </>
  );
}
