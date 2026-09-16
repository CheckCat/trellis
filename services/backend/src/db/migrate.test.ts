import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import { runMigrations } from "./migrate.js";
import { createPool, type AppPool } from "./pool.js";

const REQUIRED_TEST_DB_SUFFIX = "_test";

/**
 * Every test in this file is destructive: it drops/recreates
 * `core.lesson_progress`/`core.schema_migrations` (or mutates
 * `core.schema_migrations` directly) to exercise `runMigrations` from a
 * known state. `DATABASE_URL` is deliberately NOT read here — a developer's
 * `DATABASE_URL` points at their working instance in the named
 * `trellis_pgdata` volume, and `npm test` silently wiping real lesson
 * progress there would violate the "progress data is never lost" invariant
 * (see task-005 fix round 1). These tests only ever run against
 * `TRELLIS_TEST_DATABASE_URL`, a connection string the developer points at
 * a disposable database, and additionally refuse to run if that database's
 * name doesn't end in `_test` — a guard against pointing this at the real
 * dev database by mistake (mistake → loud failure, not a silent skip that
 * would let the drop happen unnoticed... except it never gets that far:
 * the check runs *before* any query touches the database).
 */
async function connectToDisposableTestDbOrSkip(t: TestContext): Promise<AppPool | undefined> {
  const testDatabaseUrl = process.env.TRELLIS_TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    t.skip(
      "TRELLIS_TEST_DATABASE_URL is not set — skipping destructive migration test " +
        "(this suite drops/recreates core.lesson_progress and core.schema_migrations; " +
        "DATABASE_URL alone is deliberately not enough, see task-005 fix round 1)",
    );
    return undefined;
  }

  let databaseName: string;
  try {
    databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`TRELLIS_TEST_DATABASE_URL is not a valid connection string: "${testDatabaseUrl}"`);
  }
  if (!databaseName.endsWith(REQUIRED_TEST_DB_SUFFIX)) {
    // Not a skip: this is a misconfiguration that must fail loudly, not
    // quietly pass by "skipping" — the point is to stop a developer from
    // pointing this at their real database, not to let the run go green.
    throw new Error(
      `Refusing to run destructive migration tests against database "${databaseName}": ` +
        `TRELLIS_TEST_DATABASE_URL must point at a database whose name ends with "${REQUIRED_TEST_DB_SUFFIX}".`,
    );
  }

  const pool = createPool(testDatabaseUrl);
  try {
    await pool.query("select 1");
  } catch (err) {
    t.skip(
      `Postgres is not reachable at TRELLIS_TEST_DATABASE_URL (${err instanceof Error ? err.message : String(err)}) — skipping destructive migration test`,
    );
    await pool.end();
    return undefined;
  }
  return pool;
}

void test("runMigrations applies 001_progress from a clean core schema and is idempotent on repeat", async (t) => {
  const pool = await connectToDisposableTestDbOrSkip(t);
  if (!pool) return;
  try {
    await pool.query("drop table if exists core.lesson_progress");
    await pool.query("drop table if exists core.schema_migrations");

    await runMigrations(pool);
    const first = await pool.query<{ version: string }>(
      "select version from core.schema_migrations order by version",
    );
    assert.deepEqual(
      first.rows.map((row) => row.version),
      ["001_progress"],
    );

    // Re-running against the now-migrated DB must not fail or duplicate
    // the schema_migrations row.
    await runMigrations(pool);
    const second = await pool.query<{ version: string }>(
      "select version from core.schema_migrations order by version",
    );
    assert.deepEqual(
      second.rows.map((row) => row.version),
      ["001_progress"],
    );

    const tableCheck = await pool.query(
      "select 1 from information_schema.tables where table_schema = 'core' and table_name = 'lesson_progress'",
    );
    assert.equal(tableCheck.rowCount, 1);
  } finally {
    await pool.end();
  }
});

void test("runMigrations refuses to continue when an applied version's file is missing (error path)", async (t) => {
  const pool = await connectToDisposableTestDbOrSkip(t);
  if (!pool) return;
  try {
    // Make sure core.schema_migrations exists (with exactly "001_progress",
    // which does have a matching file), then record a bogus "applied"
    // version with no corresponding file anywhere — the real migrations
    // directory (the default) is used as-is, so "001_progress" itself stays
    // resolvable and only "999_ghost" is the mismatch under test.
    await runMigrations(pool);
    await pool.query(
      "insert into core.schema_migrations (version) values ($1) on conflict do nothing",
      ["999_ghost"],
    );

    await assert.rejects(() => runMigrations(pool), /999_ghost/);
  } finally {
    await pool.query("delete from core.schema_migrations where version = $1", ["999_ghost"]);
    await pool.end();
  }
});

void test("concurrent runMigrations calls on the same DB serialize via the advisory lock (edge case)", async (t) => {
  const pool = await connectToDisposableTestDbOrSkip(t);
  if (!pool) return;
  try {
    await pool.query("drop table if exists core.lesson_progress");
    await pool.query("drop table if exists core.schema_migrations");

    // Without the advisory lock in runMigrations, two concurrent callers
    // would both see version "001_progress" as unapplied and race to INSERT
    // it into schema_migrations, one of them failing on the primary key.
    await Promise.all([runMigrations(pool), runMigrations(pool)]);

    const result = await pool.query("select version from core.schema_migrations");
    assert.equal(result.rowCount, 1);
  } finally {
    await pool.end();
  }
});
