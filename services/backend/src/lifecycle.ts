// Graceful shutdown, wired to a single path: `app.close()`. This module
// only owns *when* to shut down (which signals/events trigger it); *what*
// gets cleaned up is entirely up to whichever `onClose` hooks the rest of
// the app registered (the db pool's `pool.end()`, today — see server.ts).
// That split is deliberate: a bespoke `pool.end()` call hardcoded into a
// signal handler here would silently drift from reality the moment another
// resource needs its own cleanup on shutdown.

import type { FastifyInstance } from "fastify";

const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export interface ShutdownOptions {
  /** Signals that trigger a graceful shutdown. Defaults to SIGINT + SIGTERM. */
  readonly signals?: readonly NodeJS.Signals[];
  /**
   * Also shut down on Node's `beforeExit` event (per brief: SIGINT, SIGTERM
   * and `beforeExit` are three distinct paths that must all close the
   * pool). Defaults to `true`; tests set this to `false` to avoid attaching
   * a listener to the shared `process` object that would outlive the test.
   */
  readonly installBeforeExit?: boolean;
  /**
   * Called once shutdown has finished (`app.close()` settled). Defaults to
   * `process.exit`. Overridable so tests can observe the exit code without
   * actually terminating the test runner's process.
   */
  readonly exit?: (code: number) => void;
}

export interface ShutdownController {
  /**
   * Triggers the same path a signal/`beforeExit` would. Idempotent: calling
   * this more than once (or once from a signal handler and once manually,
   * e.g. from a startup-error path) only ever runs `app.close()` once —
   * later calls resolve once the first shutdown finishes rather than
   * re-entering it (which would re-run every `onClose` hook, e.g. calling
   * `pool.end()` on an already-ended pool).
   */
  shutdown(exitCode?: number): Promise<void>;
}

/**
 * Registers process-level triggers for graceful shutdown of `app`. Returns
 * a controller whose `shutdown()` the caller can also invoke directly (e.g.
 * on a startup error, before `listen()` ever succeeded) and get the exact
 * same idempotent, single-run-of-`app.close()` behavior.
 */
export function registerShutdown(app: FastifyInstance, options: ShutdownOptions = {}): ShutdownController {
  const signals = options.signals ?? DEFAULT_SIGNALS;
  const installBeforeExit = options.installBeforeExit ?? true;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let shuttingDown: Promise<void> | undefined;

  const shutdown = (exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      return shuttingDown;
    }
    shuttingDown = (async () => {
      try {
        await app.close();
      } catch (err) {
        app.log.error({ err }, "error while closing server during shutdown");
      } finally {
        exit(exitCode);
      }
    })();
    return shuttingDown;
  };

  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }

  if (installBeforeExit) {
    // `beforeExit` fires only when the event loop would otherwise drain
    // naturally (no pending timers/handles) — it never fires on a signal or
    // on an explicit `process.exit()`, so this is a genuinely separate path
    // from the signal handlers above, not a duplicate of them.
    process.on("beforeExit", () => {
      void shutdown(0);
    });
  }

  return { shutdown };
}
