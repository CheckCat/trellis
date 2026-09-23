// The Postgres implementation of `SandboxDriver`: one pool under the
// SANDBOX role (`trellis_sandbox`), and a schema it wipes and rebuilds from
// the course's seed files.
//
// The two rules this file exists to enforce, both project invariants:
//   1. every statement here — DDL, course seed SQL, and (task 009) the
//      user's own practice SQL and the course's check query — runs on a
//      connection opened with SANDBOX_DATABASE_URL. The application role's
//      pool (`fastify.db`, db/pool.ts) is never used for any of it, and this
//      module never reads DATABASE_URL;
//   2. the sandbox role's rights stop at its own schema (see
//      docker/postgres/init/02-schemas.sql: `sandbox` is owned by
//      trellis_sandbox, `core` is explicitly revoked from it, and the single
//      database-level grant it has is CREATE — which exists precisely so the
//      DROP/CREATE SCHEMA pair below is possible).
//
// `createPool` is reused verbatim from db/pool.ts with a different
// connection string (task-005 report's interface digest endorses exactly
// this) — same limits, same `pool.on('error')` safety, no second
// implementation of "a pool" to keep in sync.

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { createPool, redactPassword, type AppPool } from "../../db/pool.js";
import { SandboxError, isSandboxError, type SandboxDriver, type SandboxSpec } from "../../sandbox/types.js";

/** The schema the sandbox role owns (docker/postgres/init/02-schemas.sql).
 * Not configurable through the environment on purpose: it is fixed by the
 * database's own role/ownership setup, and a mismatch between the two would
 * fail at runtime with a permission error rather than do anything useful.
 * The option exists only so tests can prove the identifier is quoted and
 * validated rather than pasted into SQL. */
export const DEFAULT_SANDBOX_SCHEMA = "sandbox";

// Lower-case, ASCII, no quoting surprises. The schema name is the ONE piece
// of SQL here that cannot be a bound parameter (identifiers never can be),
// so it is validated against this before it is interpolated, and quoted even
// then.
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Narrows a driver from the provisioner's registry to this one.
 *
 * The registry is typed on the general `SandboxDriver`, because that is
 * what makes a second kind addable without touching anything above it. A
 * caller that needs operations only this driver has — the `sql` practice
 * strategy needs to execute SQL — asks for `"postgres"` and checks here,
 * rather than the provisioner being generic in a driver type that every
 * unrelated caller would then have to name.
 *
 * Structural, not `instanceof`: the driver is a plain object built by a
 * factory (there is no class), and the unconfigured stand-in below is a
 * legitimate `PostgresSandboxDriver` too — it just fails every call with a
 * stated reason, which is exactly the behaviour a caller should get.
 */
export function isPostgresSandboxDriver(driver: SandboxDriver | undefined): driver is PostgresSandboxDriver {
  return driver !== undefined && driver.type === "postgres" && typeof (driver as PostgresSandboxDriver).withClient === "function";
}

export interface PostgresSandboxDriver extends SandboxDriver {
  readonly type: "postgres";
  readonly schema: string;
  /**
   * Runs one statement under the sandbox role. This is the primitive task
   * 009 builds practice execution and the check query on — it exists here
   * so that nothing above ever has a reason to open its own connection (and
   * risk opening it under the application role).
   *
   * Errors are passed through exactly as `pg` produced them — no wrapping,
   * no rewording: the practice UI shows the database's own message, and 009
   * needs the original `code`/`position` fields to do that.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /** A dedicated sandbox-role client for the rare multi-statement case
   * (009's "run the user's SQL, then the check query, then roll back", for
   * instance). Released automatically. */
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export interface CreatePostgresSandboxDriverOptions {
  readonly schema?: string;
  /** Same role as `CreatePoolOptions.onError` — observes background pool
   * errors so an idle-connection failure can't crash the process. */
  readonly onError?: (err: Error) => void;
}

export interface CreatePostgresSandboxDriverFromPoolOptions extends CreatePostgresSandboxDriverOptions {
  /** `false` (the default) means the pool was handed in and is somebody
   * else's to close — `close()` leaves it alone, exactly like
   * `buildServer({ pool })` leaves an injected `AppPool` alone. */
  readonly ownsPool?: boolean;
  /** Redacted connection target, used only in "can't reach the sandbox"
   * messages. */
  readonly describeTarget?: string;
}

/**
 * Builds a driver over its own pool, connected as the sandbox role.
 * `sandboxDatabaseUrl` is `AppConfig.sandboxDatabaseUrl` (SANDBOX_DATABASE_URL)
 * — never DATABASE_URL.
 */
export function createPostgresSandboxDriver(
  sandboxDatabaseUrl: string,
  options: CreatePostgresSandboxDriverOptions = {},
): PostgresSandboxDriver {
  const pool = createPool(sandboxDatabaseUrl, { onError: options.onError });
  return createPostgresSandboxDriverFromPool(pool, {
    ...options,
    ownsPool: true,
    describeTarget: redactPassword(sandboxDatabaseUrl),
  });
}

/**
 * The same driver over a pool somebody else made — the test seam (inject a
 * recording fake and assert on the exact statement sequence, the way
 * `buildServer({ pool })` lets route tests run without Postgres), and the
 * escape hatch if a future caller ever needs to share one sandbox pool.
 */
export function createPostgresSandboxDriverFromPool(
  pool: AppPool,
  options: CreatePostgresSandboxDriverFromPoolOptions = {},
): PostgresSandboxDriver {
  const schema = options.schema ?? DEFAULT_SANDBOX_SCHEMA;
  if (!SAFE_IDENTIFIER.test(schema)) {
    throw new Error(
      `Invalid sandbox schema name "${schema}": expected a lower-case identifier matching ${String(SAFE_IDENTIFIER)}.`,
    );
  }
  const quotedSchema = `"${schema}"`;
  const target = options.describeTarget ?? "the practice sandbox database";
  const ownsPool = options.ownsPool ?? false;

  return {
    type: "postgres",
    schema,

    async provision(spec: SandboxSpec): Promise<void> {
      try {
        await pool.withTransaction(async (client) => {
          // One transaction for the whole rebuild. Postgres makes DDL
          // transactional, so a seed that fails on its third statement
          // leaves the sandbox exactly as it was instead of half-built —
          // there is no such thing as a partially provisioned sandbox for a
          // caller to trip over. (A seed file that contains its own
          // COMMIT/ROLLBACK breaks that guarantee; that is course-authoring
          // breakage and shows up as a Postgres warning/error, not as
          // something this driver can paper over.)
          //
          // `set local` — scoped to this transaction, never leaking into
          // the next user of this pooled connection. It makes unqualified
          // names in seed SQL land in the sandbox schema regardless of the
          // role's configured search_path, so a seed can't accidentally
          // depend on server-side role settings.
          await client.query(`set local search_path to ${quotedSchema}`);

          try {
            // `if exists` covers the very first provision on a fresh
            // database; `cascade` is what makes this a real reset — tables,
            // views, functions and data the previous course (or the user's
            // own practice) left behind all go.
            await client.query(`drop schema if exists ${quotedSchema} cascade`);
            await client.query(`create schema ${quotedSchema}`);
          } catch (err) {
            throw new SandboxError(
              "unavailable",
              `Could not recreate the practice sandbox schema "${schema}": ${describeDatabaseError(err)}. ` +
                "Check that SANDBOX_DATABASE_URL points at the sandbox role and that it owns this schema.",
              { databaseError: describeDatabaseError(err), cause: err },
            );
          }

          for (const seed of spec.seedFiles) {
            try {
              // The file is executed as one unit (multi-statement simple
              // query), not split on `;` — splitting SQL text with a regex
              // is wrong the moment a seed contains a dollar-quoted
              // function body or a semicolon inside a string literal.
              await client.query(seed.content);
            } catch (err) {
              throw new SandboxError(
                "seed_failed",
                `Seed file "${seed.relativePath}" of course "${spec.courseId}" failed: ${describeDatabaseError(err)}`,
                { seedFile: seed.relativePath, databaseError: describeDatabaseError(err), cause: err },
              );
            }
          }
        });
      } catch (err) {
        // Anything already classified (a failed seed, a failed recreate)
        // keeps its kind and its verbatim database message.
        if (isSandboxError(err)) {
          throw err;
        }
        // Everything left is the transaction itself failing — in practice,
        // not being able to connect at all. db/pool.ts's `connect()` wraps
        // that in a message ending with "check that DATABASE_URL is
        // correct", which would be actively misleading here, so the cause
        // is unwrapped and re-described against the variable that actually
        // governs this pool.
        throw new SandboxError("unavailable", `Could not reach ${target}: ${describeRootCause(err)}. ` +
          "Check that SANDBOX_DATABASE_URL is correct and Postgres is running and reachable.", {
          cause: err,
        });
      }
    },

    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]) {
      return pool.query<T>(text, params);
    },

    async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

/**
 * A driver for "there is no sandbox configured here". Every operation fails
 * with a stated reason instead of the app either crashing at startup or
 * pretending a sandbox exists.
 *
 * It exists because a sandbox, unlike the core database, has no safe
 * default: `buildServer()` is called by plenty of tests that care about
 * courses or progress and have no business supplying SANDBOX_DATABASE_URL.
 * Rather than let `fastify.sandbox` be absent (which turns any future
 * caller's mistake into a Fastify decorator crash) the server decorates it
 * with this, and practice endpoints answer 503 with the reason.
 */
export function createUnconfiguredPostgresSandboxDriver(
  reason = "SANDBOX_DATABASE_URL was not provided to buildServer()",
): PostgresSandboxDriver {
  const fail = (): never => {
    throw new SandboxError("unavailable", `The practice sandbox is not configured: ${reason}.`);
  };
  return {
    type: "postgres",
    schema: DEFAULT_SANDBOX_SCHEMA,
    async provision() {
      return fail();
    },
    async query() {
      return fail();
    },
    async withClient() {
      return fail();
    },
    async close() {
      // Nothing was ever opened.
    },
  };
}

/**
 * The database's own words for an error, unchanged — the named function
 * carries the contract ("verbatim, never reworded"), which is why it is not
 * inlined at its two call sites. `pg` puts the server's message in
 * `.message` already complete with the `LINE n: ...` context a course author
 * needs to find the broken statement, so there is nothing to add to it.
 */
function describeDatabaseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Unwraps one level of `{ cause }` so a wrapper's own advice (db/pool.ts's
 * `describeConnectionError`) doesn't get quoted back at the user alongside
 * this module's. */
function describeRootCause(err: unknown): string {
  if (err instanceof Error && err.cause instanceof Error) {
    return err.cause.message;
  }
  return err instanceof Error ? err.message : String(err);
}
