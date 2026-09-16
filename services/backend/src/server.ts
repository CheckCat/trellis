import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { parseConfig } from "./config.js";
import { createPool, type AppPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { registerShutdown } from "./lifecycle.js";
import healthRoutes from "./routes/health.js";

export interface BuildServerOptions {
  /**
   * Injects a db pool directly — the pattern tests use to substitute a fake
   * `AppPool` (see routes/health.test.ts) instead of requiring a real
   * Postgres. An injected pool is the caller's own — `buildServer` decorates
   * `app.db` with it but never calls `pool.end()` on it (see `AppPool#end`'s
   * doc comment on why: closing a pool you don't own would break whatever
   * else is still using it, e.g. another `buildServer({ pool })` call
   * sharing the same pool in a test).
   */
  readonly pool?: AppPool;
  /**
   * Builds a fresh pool from this connection string; `buildServer` owns
   * that pool and closes it itself on `app.close()`. Ignored if `pool` is
   * also given.
   */
  readonly databaseUrl?: string;
}

/**
 * Builds a configured Fastify instance with all core plugins registered,
 * but never starts listening. Tests use this directly with `app.inject()`
 * (no real socket opened); pass `{ pool: fakePool }` to avoid touching a
 * real database or environment at all. Tasks 006+ register their own
 * plugins on this same instance (course registry, progress API) the same
 * way: `app.register(yourPlugin)` inside `buildServer()`, before `return
 * app;`.
 *
 * Requires exactly one of `options.pool`/`options.databaseUrl` — it never
 * falls back to `parseConfig()` itself. An implicit fallback would make
 * even a zero-arg `buildServer()` call transitively require
 * `SANDBOX_DATABASE_URL` (parseConfig() validates both URLs together),
 * which this data layer explicitly never reads (see pool.ts).
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const ownsPool = options.pool === undefined;
  if (!ownsPool && options.databaseUrl !== undefined) {
    app.log.warn("buildServer: both `pool` and `databaseUrl` were given — `pool` wins, `databaseUrl` is ignored.");
  }
  let pool: AppPool;
  if (options.pool !== undefined) {
    pool = options.pool;
  } else if (options.databaseUrl !== undefined) {
    pool = createPool(options.databaseUrl, {
      onError: (err) => app.log.error({ err }, "postgres pool error"),
    });
  } else {
    throw new Error(
      "buildServer requires either options.pool (tests: inject a fake or real AppPool) or " +
        "options.databaseUrl (production: pass config.databaseUrl) — it does not fall back to parseConfig() itself.",
    );
  }

  app.decorate("db", pool);
  // The single place a self-created pool gets closed — every shutdown path
  // (signals, beforeExit, startup errors) goes through `app.close()` (see
  // lifecycle.ts), never a separate hardcoded `pool.end()` call. A pool
  // injected via `options.pool` is not ours to close (see BuildServerOptions
  // above).
  if (ownsPool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  app.register(healthRoutes);
  return app;
}

// Only starts listening when this file is executed directly (`node
// dist/server.js` / `npm start`), never on import — so `buildServer` stays
// safe to import from tests without requiring DATABASE_URL/
// SANDBOX_DATABASE_URL to be set or opening a real socket.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = parseConfig();
  const app = buildServer({ databaseUrl: config.databaseUrl });
  const shutdownController = registerShutdown(app);

  runMigrations(app.db, {
    logger: {
      info: (message) => app.log.info(message),
      warn: (message) => app.log.warn(message),
    },
  })
    .then(() => app.listen({ host: config.host, port: config.port }))
    .catch((err: unknown) => {
      app.log.fatal({ err }, "startup failed");
      // Startup failed before (or instead of) listening — still route
      // through the same idempotent shutdown path so the pool (and any
      // future onClose hook) closes exactly the same way a signal would
      // close it, instead of a bespoke cleanup call here.
      void shutdownController.shutdown(1);
    });
}
