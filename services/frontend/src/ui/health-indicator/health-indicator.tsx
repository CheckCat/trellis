import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

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
