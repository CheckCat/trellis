import { Link } from "@tanstack/react-router";
import type { ModuleProgress } from "../../api/types";

const LESSON_STATUS_LABEL: Record<"completed" | "not_started", string> = {
  completed: "Пройден",
  not_started: "Не начат",
};

/**
 * Pure presentational list of a course's modules and lessons, each lesson
 * a link to its own page carrying its current status. No data fetching here
 * — `CoursePage` owns the query and passes the already-joined progress tree
 * down, keeping this component testable with plain props.
 */
export function ModuleList({ courseId, modules }: { courseId: string; modules: readonly ModuleProgress[] }) {
  return (
    <ul className="card-list">
      {modules.map((module) => (
        <li key={module.id} className="card-list-item">
          <h3>{module.title}</h3>
          <p className="muted-note">
            {module.completedLessons} / {module.totalLessons} уроков пройдено
          </p>
          <ul className="lesson-list">
            {module.lessons.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  to="/courses/$courseId/lessons/$lessonId"
                  params={{ courseId, lessonId: lesson.id }}
                  className="lesson-link"
                >
                  <span>{lesson.title}</span>
                  <span className={`lesson-status lesson-status--${lesson.status}`}>
                    {LESSON_STATUS_LABEL[lesson.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
