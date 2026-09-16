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

import type { AppPool } from "./pool.js";

// Arbitrary fixed key identifying "trellis core schema migrations" as a
// distinct advisory-lock namespace, so two backend instances/restarts
// racing on startup serialize instead of both trying to apply the same
// migration concurrently. No other significance to the number itself.
const MIGRATION_LOCK_KEY = 84_637_201;

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

async function applyPendingMigrations(client: PoolClient, migrationsDir: string): Promise<void> {
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

  for (const file of files) {
    if (applied.has(file.version)) {
      continue;
    }
    const sql = await readFile(file.path, "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("insert into core.schema_migrations (version) values ($1)", [file.version]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `Migration "${file.version}" failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

/**
 * Applies every migration file not yet recorded in `core.schema_migrations`,
 * each in its own transaction, guarded end-to-end by a session-level
 * `pg_advisory_lock` so concurrent instances/restarts never race each
 * other. Safe to call on every startup: already-applied files are skipped,
 * and an empty pending set is a fast no-op.
 */
export async function runMigrations(pool: AppPool, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await applyPendingMigrations(client, migrationsDir);
    } finally {
      // Released explicitly (rather than relying on connection teardown) so
      // the lock doesn't outlive this call if the client gets reused from
      // the pool for something else afterwards.
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
