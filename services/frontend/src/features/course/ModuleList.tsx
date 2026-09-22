import { Link } from "@tanstack/react-router";
import type { ModuleProgress } from "../../api/types";
import { CheckIcon } from "../../ui/icons";

/**
 * Pure presentational list of a course's modules and lessons, each lesson a
 * link to its own page carrying its current status. No data fetching here —
 * `CoursePage` owns the query and passes the already-joined progress tree
 * down, keeping this component testable with plain props.
 *
 * Done and not-done are told apart by more than a word in the corner: a
 * completed lesson gets a filled check and a receded title, a completed
 * module gets the check in its own heading and an accent rule down its
 * side. Progress you can see at a glance from across the page is the whole
 * reason a list like this beats a bare table of contents.
 */
export function ModuleList({ courseId, modules }: { courseId: string; modules: readonly ModuleProgress[] }) {
  return (
    <ul className="module-list">
      {modules.map((module) => (
        <li key={module.id} className={`module-card${module.completed ? " module-card--completed" : ""}`}>
          <div className="module-head">
            <h3 className="module-title">{module.title}</h3>
            {module.completed ? (
              <span className="module-badge">
                <CheckIcon />
                Модуль пройден
              </span>
            ) : (
              <span className="module-counter">
                {module.completedLessons} / {module.totalLessons}
              </span>
            )}
          </div>

          <ul className="lesson-list">
            {module.lessons.map((lesson) => {
              const completed = lesson.status === "completed";
              return (
                <li key={lesson.id}>
                  <Link
                    to="/courses/$courseId/lessons/$lessonId"
                    params={{ courseId, lessonId: lesson.id }}
                    className={`lesson-link${completed ? " lesson-link--completed" : ""}`}
                  >
                    {/* Маркер несёт состояние глазом, слово «Пройден» —
                     * для чтения с экрана; поэтому иконка скрыта от
                     * ассистивных технологий, а текст остаётся. */}
                    <span className="lesson-marker" aria-hidden="true">
                      {completed && <CheckIcon size={12} />}
                    </span>
                    <span className="lesson-link-title">{lesson.title}</span>
                    <span className={`lesson-status lesson-status--${lesson.status}`}>
                      {completed ? "Пройден" : "Не начат"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
