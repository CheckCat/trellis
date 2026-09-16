import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { parseConfig, DEFAULT_COURSES_DIR } from "./config.js";
import { createPool, type AppPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { registerShutdown } from "./lifecycle.js";
import { createCourseRegistry, type CourseRegistry } from "./courses/registry.js";
import healthRoutes from "./routes/health.js";
import coursesRoutes from "./routes/courses.js";

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
  /**
   * Injects a course registry directly — the same test pattern as `pool`
   * above (see courses/registry.test.ts and routes/courses.test.ts): builds
   * a registry against a fixture directory instead of relying on
   * `COURSES_DIR`. Wins over `coursesDir` if both are given.
   */
  readonly registry?: CourseRegistry;
  /**
   * Builds a fresh registry (task 006) rooted at this directory; scanned
   * synchronously before `buildServer` returns (see
   * courses/registry.ts's createCourseRegistry doc comment), so `GET
   * /courses` is accurate from the very first request. Ignored if
   * `registry` is also given. Defaults to `DEFAULT_COURSES_DIR` — unlike
   * the db pool, a missing/unset courses directory is not an error (see
   * courses/loader.ts), so there is a safe default here, and tests that
   * don't care about courses (e.g. routes/health.test.ts) don't need to
   * pass anything.
   */
  readonly coursesDir?: string;
  /**
   * Passed straight through to Fastify's own `logger` option — reuses
   * Fastify's own type rather than re-declaring it, so this stays correct
   * across whatever shapes Fastify itself accepts (`boolean`, pino options,
   * ...). Defaults to `true` (current/production behavior — full request
   * logging), same as before this option existed.
   *
   * Final review, backend fixes round: every test in this codebase that
   * calls `buildServer()` should pass `logger: false` — a passing `npm
   * test` run used to interleave a JSON log line per HTTP request *and* the
   * full stack trace of every intentionally-simulated failure (e.g.
   * routes/health.test.ts's "simulated db outage") into the TAP output,
   * which reads like real breakage and will only get harder to scan as
   * tasks 007+ add more integration tests. Production (the main-module
   * block below) doesn't pass this, so it keeps the default `true`.
   */
  readonly logger?: FastifyServerOptions["logger"];
}

/**
 * Builds a configured Fastify instance with all core plugins registered,
 * but never starts listening. Tests use this directly with `app.inject()`
 * (no real socket opened); pass `{ pool: fakePool }` and/or
 * `{ registry: fakeRegistry }` to avoid touching a real database or a real
 * `COURSES_DIR` at all. Tasks 007+ register their own plugins on this same
 * instance (progress API, practice sandbox) the same way: `app.register(
 * yourPlugin)` inside `buildServer()`, before `return app;`.
 *
 * Requires exactly one of `options.pool`/`options.databaseUrl` — it never
 * falls back to `parseConfig()` itself. An implicit fallback would make
 * even a zero-arg `buildServer()` call transitively require
 * `SANDBOX_DATABASE_URL` (parseConfig() validates both URLs together),
 * which this data layer explicitly never reads (see pool.ts). The course
 * registry has no such requirement — `registry`/`coursesDir` are both
 * optional, defaulting to a registry over `DEFAULT_COURSES_DIR` (see
 * BuildServerOptions above).
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

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

  if (options.registry !== undefined && options.coursesDir !== undefined) {
    app.log.warn(
      "buildServer: both `registry` and `coursesDir` were given — `registry` wins, `coursesDir` is ignored.",
    );
  }
  const registry =
    options.registry ??
    createCourseRegistry(options.coursesDir ?? DEFAULT_COURSES_DIR, {
      warn: (message) => app.log.warn(message),
    });
  app.decorate("courses", registry);

  app.register(healthRoutes);
  app.register(coursesRoutes);
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
  const app = buildServer({ databaseUrl: config.databaseUrl, coursesDir: config.coursesDir });
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
