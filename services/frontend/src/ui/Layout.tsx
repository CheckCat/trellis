import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { api } from "../api/client";
import { TransferIcon } from "./icons";

/**
 * Backend connectivity, reported only when there is something to report.
 *
 * It used to announce «Связь с ядром есть» permanently. That line was true
 * and useless: the app is a local page talking to a local backend, so "it
 * works" is the assumption, not news — and a status widget that is green
 * 100% of the time trains people to stop looking at it, which is the one
 * job it has. Now it renders nothing at all while things are fine and
 * appears only when the backend cannot be reached, which is also the only
 * moment its wording («что делать») matters.
 */
export function HealthIndicator() {
  const { isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    // A dev/prod health probe that keeps refetching in the background would
    // just be noise for a single local user watching their own screen — one
    // check on mount is enough signal ("is the backend up right now").
    staleTime: Infinity,
    retry: false,
  });

  // `isError` alone decides "disconnected": a 200 response always carries
  // `status: "ok"` (see backend routes/health.ts) and any non-2xx makes
  // `apiFetch` throw before `data` is ever populated. Pending is silent
  // too — a flash of "проверяем…" on every page load is the same noise in
  // a shorter costume.
  if (isPending || !isError) {
    return null;
  }

  return (
    <div className="status-row">
      <span className="status-dot status-dot--disconnected" aria-hidden="true" />
      <p className="status-label" role="status" aria-live="polite">
        Связи с ядром нет
      </p>
    </div>
  );
}

/** Root layout: header (title + connection status) wraps every route's
 * content, rendered through `<Outlet />`. Route pages only own their own
 * content area, never the chrome around it. */
export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-title">
          Trellis
        </Link>
        <nav className="app-nav">
          <HealthIndicator />
          {/* Progress transfer is a once-in-a-while errand — moving to
           * another computer — so it sits as a quiet icon rather than the
           * only worded link in the header, where it read as a main section
           * of the app. `aria-label` carries the name the link used to
           * show, and `title` brings it back on hover. */}
          <Link to="/transfer" className="icon-button" aria-label="Перенос прогресса" title="Перенос прогресса">
            <TransferIcon />
          </Link>
        </nav>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
