import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../shared/api/client";
import { CheckIcon } from "../../shared/ui/icons";

/**
 * The home screen: every installed course, with how far along each one is.
 *
 * `GET /courses` deliberately carries no progress — the course registry
 * reads content off disk and knows nothing about the database (project
 * invariant: content and progress are separate entities) — so the per-course
 * state comes from one `GET /courses/:id/progress` per card. One request per
 * installed course sounds wasteful and is not: this is a local app with a
 * handful of course packages, and the query key is the very same
 * `["courseProgress", id]` the course page uses, so opening a course after
 * seeing it here is served from cache instead of refetching.
 */
export function CoursesIndexPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["courses"],
    queryFn: api.listCourses,
  });

  if (isPending) {
    return <p className="muted-note">Загружаем список курсов…</p>;
  }

  if (isError) {
    return <p className="muted-note">Не удалось загрузить список курсов.</p>;
  }

  if (data.courses.length === 0) {
    return <p className="muted-note">Курсы не найдены. Добавьте контент-пакет в courses/.</p>;
  }

  return (
    <>
      <h1 className="page-heading">Курсы</h1>
      <ul className="card-list">
        {data.courses.map((course) => (
          <li key={course.id}>
            <Link to="/courses/$courseId" params={{ courseId: course.id }} className="card-list-item">
              <div className="card-head">
                <h3>{course.title}</h3>
                <CourseCardProgress courseId={course.id} />
              </div>
              {course.description !== undefined && <p>{course.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One course's standing, as a badge on its card.
 *
 * Renders nothing at all while loading or on failure, and nothing for a
 * course nobody has started: an empty badge on every untouched card would
 * be noise, and "0 / 12" says less than the absence of a mark. A finished
 * course says so in words — that is the one state worth interrupting the
 * card for.
 */
function CourseCardProgress({ courseId }: { courseId: string }) {
  const { data } = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });

  if (data === undefined || data.completedLessons === 0) {
    return null;
  }

  if (data.completed) {
    return (
      <span className="course-badge course-badge--done">
        <CheckIcon size={13} />
        Курс пройден
      </span>
    );
  }

  return (
    <span className="course-badge">
      {data.completedLessons} / {data.totalLessons}
    </span>
  );
}
