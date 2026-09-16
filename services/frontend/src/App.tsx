import { useEffect, useState } from "react";

// Skeleton screen for task 004: full navigation/layout is task 011. The only
// job here is to prove the frontend can reach the backend through the
// relative `/api` prefix (dev-proxy in Vite, nginx in the container image —
// never an absolute `http://localhost:3001`, or it breaks in the container).
type ConnectionState = "loading" | "connected" | "disconnected";

interface HealthResponse {
  status: string;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  loading: "Проверяем связь с ядром…",
  connected: "Связь с ядром есть",
  disconnected: "Связи с ядром нет",
};

export function App() {
  const [state, setState] = useState<ConnectionState>("loading");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`unexpected status ${response.status}`);
        }
        const body = (await response.json()) as HealthResponse;
        setState(body.status === "ok" ? "connected" : "disconnected");
      } catch (error) {
        // AbortError fires on unmount (StrictMode double-invoke, or the
        // component unmounting mid-request) — not a real connectivity
        // failure, so it must not flip the visible state.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState("disconnected");
      }
    }

    void checkHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <div className="status-card">
        <h1>Trellis</h1>
        <div className="status-row">
          <span className={`status-dot status-dot--${state}`} aria-hidden="true" />
          <p className="status-label" role="status" aria-live="polite">
            {STATUS_LABEL[state]}
          </p>
        </div>
      </div>
    </main>
  );
}

export default App;
