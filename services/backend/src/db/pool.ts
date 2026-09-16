// The core data layer's only connection to Postgres: a pool under the
// application role (`trellis_app`, schema `core`). SANDBOX_DATABASE_URL is
// never read here — the practice sandbox is a separate implementation
// (task 008) with its own role/connection, deliberately not unified behind
// a "generic pool with a role parameter" (see task-005 brief).

import pg from "pg";

import type { Pool as PgPool, PoolClient, QueryResult, QueryResultRow } from "pg";

const { Pool } = pg;

// Reasonable fixed limits for a single-instance local app talking to a
// local Postgres — no need for these to be configurable yet (YAGNI; revisit
// if a real need shows up).
const MAX_CONNECTIONS = 10;
// Kept below the backend healthcheck's `timeout: 5s` (docker-compose.yml) on
// purpose: if Postgres is unreachable, /health must have already produced
// its own 503 before Docker's own probe would time out on the same wait —
// otherwise the healthcheck's generic timeout failure is what shows up in
// `docker inspect`, not our descriptive "db": "down" response.
const CONNECTION_TIMEOUT_MS = 2_000;
const IDLE_TIMEOUT_MS = 30_000;

export interface AppPool {
  /** Thin passthrough to `pg.Pool#query` — no query builder, no ORM. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /**
   * Checks out a dedicated client. Callers must `client.release()` it
   * (`withTransaction` below does this for the common case; use `connect`
   * directly only when a single client must span multiple statements
   * outside a plain BEGIN/COMMIT transaction — e.g. migrate.ts's advisory
   * lock, which must be taken and released on the same session).
   */
  connect(): Promise<PoolClient>;
  /**
   * Runs `fn` inside BEGIN/COMMIT, rolling back on any thrown error. The
   * client is always released back to the pool in `finally`, whether the
   * transaction committed, rolled back, or `fn` threw something unrelated
   * to Postgres.
   */
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  /**
   * Closes every connection in the pool. Calling this more than once on the
   * *same* `AppPool` is safe (a flag inside `createPool` makes the second
   * call a no-op) — but note `pg`'s own `Pool#end()` is NOT idempotent (a
   * second call rejects with "Called end on pool more than once"), which is
   * exactly the guard this wrapper adds.
   *
   * Ownership matters more than idempotency here: whoever *created* the
   * pool (via `createPool`) is responsible for ending it. A pool injected
   * into `buildServer({ pool })` from outside is NOT closed by
   * `buildServer`'s `onClose` hook — the injector still owns it and must
   * end it itself. Closing someone else's pool out from under them (e.g.
   * two servers sharing one pool in a test) would break the other holder's
   * next `query()`/`connect()` call.
   */
  end(): Promise<void>;
}

export interface CreatePoolOptions {
  /**
   * Observes connection errors on already-checked-out-then-idle clients
   * (e.g. Postgres restarts under a live pool). Without *some* listener on
   * `pool.on('error', ...)`, Node treats that as an unhandled 'error' event
   * and crashes the whole process — the pool itself recovers fine on the
   * next acquire, so this is purely observability. No `console.*` here per
   * project convention (Fastify's `app.log` is the logger); callers thread
   * their logger through this callback.
   */
  onError?: (err: Error) => void;
}

/**
 * Builds a redacted (password-masked) form of a Postgres connection string,
 * safe to put in an error message or log line.
 */
export function redactPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

/**
 * Wraps a raw connection-establishment error (e.g. `ECONNREFUSED`) with
 * context an operator can act on: which (redacted) URL we tried, and a
 * pointer at what to check. Applied only around `connect()` — never around
 * `query()` on an already-established connection, where the same try/catch
 * shape would otherwise mask real query errors (syntax, constraint
 * violations, ...) behind a misleading "can't reach Postgres" message.
 */
export function describeConnectionError(err: unknown, databaseUrl: string): Error {
  const cause = err instanceof Error ? err.message : String(err);
  return new Error(
    `Could not connect to Postgres at ${redactPassword(databaseUrl)}: ${cause}. ` +
      "Check that DATABASE_URL is correct and Postgres is running and reachable.",
    { cause: err },
  );
}

export function createPool(databaseUrl: string, options: CreatePoolOptions = {}): AppPool {
  const pool: PgPool = new Pool({
    connectionString: databaseUrl,
    max: MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  pool.on("error", (err) => {
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  async function connect(): Promise<PoolClient> {
    try {
      return await pool.connect();
    } catch (err) {
      throw describeConnectionError(err, databaseUrl);
    }
  }

  let ended = false;

  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    connect,
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // `err` below (from BEGIN/COMMIT/fn) is the real cause the caller
          // needs to see — a ROLLBACK that also fails (e.g. the connection
          // already dropped) must not replace it. Nothing to log to: this
          // generic pool wrapper has no logger dependency by design.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async end(): Promise<void> {
      if (ended) {
        return;
      }
      ended = true;
      await pool.end();
    },
  };
}

// Makes `fastify.db` (decorated in server.ts) known to the type system
// everywhere `FastifyInstance` is used, without every route file needing to
// import this module just for the side-effecting augmentation — this file
// is always part of the TS program (tsconfig's `include: ["src"]`), so the
// ambient declaration is always active.
declare module "fastify" {
  interface FastifyInstance {
    db: AppPool;
  }
}
