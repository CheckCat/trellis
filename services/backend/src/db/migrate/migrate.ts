// Runs schema migrations for the `core` schema at startup, before the API
// starts accepting requests. Hand-rolled on purpose (see task-005 brief: no
// migration framework, no ORM) — the logic is small enough that a framework
// would cost more (another dependency, another config surface) than it
// saves.
//
// To add a migration: drop a new `NNN_description.sql` file into
// `migrations/`, one more than the current highest number, zero-padded to
// keep lexicographic order equal to numeric order (e.g. `002_...`, not
// `2_...` — `010` would otherwise sort before `2`). Write its SQL to be
// safe to fail out of full session and reasonably idempotent (`if not
// exists` / `if exists` guards) as a second line of defense — the primary
// guard against re-applying is `core.schema_migrations`, tracked below. Do
// not edit an already-applied migration file; add a new one instead
// (already-applied files are load-bearing history, not source you refactor).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import type { AppPool } from "../pool/index.js";

// Arbitrary fixed key identifying "trellis core schema migrations" as a
// distinct advisory-lock namespace, so two backend instances/restarts
// racing on startup serialize instead of both trying to apply the same
// migration concurrently. No other significance to the number itself.
const MIGRATION_LOCK_KEY = 84_637_201;

// How long we're willing to poll for the lock before giving up loudly. A
// real migration run takes milliseconds — this only guards against a truly
// stuck concurrent instance (crashed mid-migration while still holding the
// session) turning "wait for the lock" into "hang forever with no log
// output", which is what a plain blocking `pg_advisory_lock` would do.
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 200;

export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

// Silent by default so importing/calling this from a test never produces
// console noise — server.ts wires a real logger (Fastify's `app.log`) in
// production, where these messages are meant to read like an installer's
// ("applying migration X" / "schema is up to date").
const noopLogger: MigrationLogger = {
  info: () => {},
  warn: () => {},
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// migrate.js/migrate.ts always ends up exactly two directories below
// services/backend (dist/db/migrate.js, dist-test/db/migrate.js, and
// src/db/migrate.ts alike), so this resolves to services/backend/migrations
// in every one of those layouts.
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

interface MigrationFile {
  readonly version: string;
  readonly path: string;
}

async function loadMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort() // lexicographic order, per brief — relies on zero-padded numeric prefixes
    .map((name) => ({ version: name.slice(0, -".sql".length), path: path.join(dir, name) }));
}

async function schemaMigrationsTableExists(client: PoolClient): Promise<boolean> {
  const result = await client.query(
    `select 1 from information_schema.tables where table_schema = 'core' and table_name = 'schema_migrations'`,
  );
  return (result.rowCount ?? 0) > 0;
}

async function loadAppliedVersions(client: PoolClient): Promise<Set<string>> {
  if (!(await schemaMigrationsTableExists(client))) {
    // Nothing has ever been applied yet — including migration 001 itself,
    // which is what creates this very table.
    return new Set();
  }
  const result = await client.query<{ version: string }>("select version from core.schema_migrations");
  return new Set(result.rows.map((row) => row.version));
}

async function applyPendingMigrations(
  client: PoolClient,
  migrationsDir: string,
  logger: MigrationLogger,
): Promise<void> {
  const files = await loadMigrationFiles(migrationsDir);
  const applied = await loadAppliedVersions(client);

  // A version recorded as applied whose file no longer exists on disk means
  // the DB and the codebase have diverged (wrong migrations directory, a
  // file deleted by mistake, ...). Fail loudly rather than silently
  // continuing as if nothing were wrong.
  const fileVersions = new Set(files.map((file) => file.version));
  for (const version of applied) {
    if (!fileVersions.has(version)) {
      throw new Error(
        `core.schema_migrations records "${version}" as applied, but no matching file exists in ` +
          `${migrationsDir}. Refusing to run migrations against a mismatched migrations directory.`,
      );
    }
  }

  const pending = files.filter((file) => !applied.has(file.version));
  if (pending.length === 0) {
    logger.info("Database schema is up to date — no pending migrations.");
    return;
  }

  for (const file of pending) {
    logger.info(`Applying migration "${file.version}"...`);
    const sql = await readFile(file.path, "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("insert into core.schema_migrations (version) values ($1)", [file.version]);
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        // The migration failure below is the real cause an operator needs
        // to see — a ROLLBACK that itself fails (e.g. the connection
        // already dropped mid-migration) must not replace it with a
        // confusing "connection terminated" instead. Still worth a log
        // line since it means the lock below may also fail to release
        // cleanly.
        logger.warn(
          `ROLLBACK after failed migration "${file.version}" also failed: ` +
            `${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      }
      throw new Error(
        `Migration "${file.version}" failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  logger.info(`Applied ${pending.length} migration(s).`);
}

/**
 * Polls `pg_try_advisory_lock` (rather than blocking on `pg_advisory_lock`)
 * so a stuck concurrent instance produces a warning and, eventually, a
 * clear timeout error — not a silent indefinite hang.
 */
async function acquireAdvisoryLock(client: PoolClient, logger: MigrationLogger): Promise<void> {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  let warned = false;
  for (;;) {
    const result = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) as acquired", [
      MIGRATION_LOCK_KEY,
    ]);
    if (result.rows[0]?.acquired) {
      return;
    }
    if (!warned) {
      logger.warn(
        `Waiting for the migrations lock (another instance appears to be migrating already, key ${MIGRATION_LOCK_KEY})...`,
      );
      warned = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${LOCK_ACQUIRE_TIMEOUT_MS}ms waiting for the migrations advisory lock ` +
          `(key ${MIGRATION_LOCK_KEY}). Another instance may be stuck mid-migration.`,
      );
    }
    await sleep(LOCK_POLL_INTERVAL_MS);
  }
}

export interface RunMigrationsOptions {
  readonly migrationsDir?: string;
  /** Defaults to a silent no-op logger; server.ts wires `app.log` in. */
  readonly logger?: MigrationLogger;
}

/**
 * Applies every migration file not yet recorded in `core.schema_migrations`,
 * each in its own transaction, guarded end-to-end by a session-level
 * advisory lock so concurrent instances/restarts never race each other.
 * Safe to call on every startup: already-applied files are skipped, and an
 * empty pending set is a fast no-op.
 */
export async function runMigrations(pool: AppPool, options: RunMigrationsOptions = {}): Promise<void> {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const logger = options.logger ?? noopLogger;
  const client = await pool.connect();
  try {
    await acquireAdvisoryLock(client, logger);
    try {
      await applyPendingMigrations(client, migrationsDir, logger);
    } finally {
      // Released explicitly (rather than relying on connection teardown) so
      // the lock doesn't outlive this call if the client gets reused from
      // the pool for something else afterwards. If applyPendingMigrations
      // above already threw, that is the error the operator needs to see —
      // a failed unlock (e.g. the connection dropped) must not replace it,
      // so it's logged rather than rethrown; the lock is released anyway
      // once this session's connection eventually closes.
      try {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch (unlockErr) {
        logger.warn(
          `Failed to release the migrations advisory lock cleanly (it will still be released when this ` +
            `connection closes): ${unlockErr instanceof Error ? unlockErr.message : String(unlockErr)}`,
        );
      }
    }
  } finally {
    client.release();
  }
}
