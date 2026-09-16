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
   * Postgres and a `DATABASE_URL`. When omitted, one is built from
   * `databaseUrl` (or, failing that, `parseConfig()`).
   */
  readonly pool?: AppPool;
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
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const pool =
    options.pool ??
    createPool(options.databaseUrl ?? parseConfig().databaseUrl, {
      onError: (err) => app.log.error({ err }, "postgres pool error"),
    });
  app.decorate("db", pool);
  // The single place the pool gets closed — every shutdown path (signals,
  // beforeExit, startup errors) goes through `app.close()` (see
  // lifecycle.ts), never a separate hardcoded `pool.end()` call.
  app.addHook("onClose", async () => {
    await pool.end();
  });

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

  runMigrations(app.db)
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
