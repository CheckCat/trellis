import { Link, Outlet } from "@tanstack/react-router";
import { TransferIcon } from "../shared/ui/icons";
import { HealthIndicator } from "./health-indicator";

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
