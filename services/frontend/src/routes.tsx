import { useQuery } from "@tanstack/react-query";
import { Link, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { ApiError, api } from "./api/client";
import { Layout } from "./ui/Layout";

/**
 * Route tree, built with TanStack Router's code-based API (no file-based
 * routing plugin — nothing in this package generates route files, so
 * there's nothing extra to wire into vite.config.ts). Pages here are
 * intentionally thin: full course navigation (module/lesson tree, status,
 * Markdown rendering, mark-as-done) is task 013's job, not this one's — this
 * file only proves the routing + typed client + layout all wire together
 * end to end, the same way task 004's App.tsx proved the dev-proxy worked
 * by doing the smallest possible real fetch instead of a stub.
 */

// `Layout` renders the shared header + `<Outlet />`; every route's own
// content lands inside it.
const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: CoursesIndexPage,
});

const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses/$courseId",
  component: CourseDetailPage,
});

function CoursesIndexPage() {
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
              <h3>{course.title}</h3>
              {course.description !== undefined && <p>{course.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function CourseDetailPage() {
  const { courseId } = courseRoute.useParams();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
  });

  if (isPending) {
    return <p className="muted-note">Загружаем курс…</p>;
  }

  if (isError) {
    // Only an actual 404 from the backend means "no such course" — any
    // other failure (network error, 500, etc.) gets the same generic
    // message CoursesIndexPage uses for the same failure class above.
    if (error instanceof ApiError && error.status === 404) {
      return <p className="muted-note">Курс «{courseId}» не найден.</p>;
    }
    return <p className="muted-note">Не удалось загрузить курс.</p>;
  }

  return (
    <>
      <h1 className="page-heading">{data.title}</h1>
      {data.description !== undefined && <p className="muted-note">{data.description}</p>}
      {/* Interactive module/lesson navigation (statuses, content, mark-as-done)
          is task 013 — this only proves the course was fetched by id. */}
      <ul className="card-list">
        {data.modules.map((module) => (
          <li key={module.id} className="card-list-item">
            <h3>{module.title}</h3>
            <p>{module.lessons.length} урок(ов)</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <h1 className="page-heading">Страница не найдена</h1>
      <p className="muted-note">
        <Link to="/">Вернуться к списку курсов</Link>
      </p>
    </>
  );
}

const routeTree = rootRoute.addChildren([indexRoute, courseRoute]);

/**
 * Factory instead of a single module-level singleton so tests can build a
 * router with `createMemoryHistory` instead of the real browser history
 * (see App.test.tsx) — the app's own entry point (App.tsx) calls this
 * with no arguments and gets the default browser-history router.
 */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: NotFoundPage,
    ...(history === undefined ? {} : { history }),
  });
}

export const router = createAppRouter();

// Registers this router's types globally so `Link`'s `to`/`params` props
// and `useParams()` are checked against the real route tree everywhere in
// the app, not just inside this file.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
