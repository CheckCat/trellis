import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { api } from "../api/client";

const STATUS_LABEL: Record<"loading" | "connected" | "disconnected", string> = {
  loading: "Проверяем связь с ядром…",
  connected: "Связь с ядром есть",
  disconnected: "Связи с ядром нет",
};

/**
 * Small header widget replacing task-004's full-screen health check
 * (App.tsx used to be nothing but this). Exported separately so it can be
 * unit-tested without going through the router (see Layout.test.tsx) — it
 * has no dependency on route context, only on QueryClientProvider.
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
  // `apiFetch` throw before `data` is ever populated, so `data` is only
  // ever `undefined` or `{ status: "ok" }` once `isPending` is false.
  const state = isPending ? "loading" : isError ? "disconnected" : "connected";

  return (
    <div className="status-row">
      <span className={`status-dot status-dot--${state}`} aria-hidden="true" />
      <p className="status-label" role="status" aria-live="polite">
        {STATUS_LABEL[state]}
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
        <HealthIndicator />
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
