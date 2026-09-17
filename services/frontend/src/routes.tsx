import { useQuery } from "@tanstack/react-query";
import { Link, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { api } from "./api/client";
import { CoursePage } from "./features/course/CoursePage";
import { LessonView } from "./features/lesson/LessonView";
import { TransferPage } from "./features/transfer/TransferPage";
import { Layout } from "./ui/Layout";

/**
 * Route tree, built with TanStack Router's code-based API (no file-based
 * routing plugin — nothing in this package generates route files, so
 * there's nothing extra to wire into vite.config.ts). `CoursePage` and
 * `LessonView` (task 013) do the real course-navigation work; this file
 * only wires their routes into the tree, the same way task 004's App.tsx
 * proved the dev-proxy worked by doing the smallest possible real fetch
 * before this grew.
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
  component: () => <CoursePage courseId={courseRoute.useParams().courseId} />,
});

// Deliberately a top-level route (parent: rootRoute), not a child of
// courseRoute — task-011's report left the choice open ("сама выберет
// форму"). Nesting it under courseRoute would force CoursePage to render an
// `<Outlet />` and keep the module list mounted behind the lesson, i.e. a
// master-detail layout nobody asked for; a lesson is its own full page here,
// same shape as courseRoute itself.
const lessonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses/$courseId/lessons/$lessonId",
  component: () => {
    const { courseId, lessonId } = lessonRoute.useParams();
    return <LessonView courseId={courseId} lessonId={lessonId} />;
  },
});

const transferRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transfer",
  component: TransferPage,
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

const routeTree = rootRoute.addChildren([indexRoute, courseRoute, lessonRoute, transferRoute]);

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
