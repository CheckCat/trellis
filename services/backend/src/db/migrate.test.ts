import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import { runMigrations } from "./migrate.js";
import { createPool, type AppPool } from "./pool.js";

/**
 * See pool.test.ts for why this self-diagnoses instead of failing when
 * Postgres isn't available — same reasoning applies here.
 */
async function connectOrSkip(t: TestContext): Promise<AppPool | undefined> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip("DATABASE_URL is not set — skipping test that requires a live Postgres");
    return undefined;
  }
  const pool = createPool(databaseUrl);
  try {
    await pool.query("select 1");
  } catch (err) {
    t.skip(
      `Postgres is not reachable at DATABASE_URL (${err instanceof Error ? err.message : String(err)}) — skipping test that requires a live Postgres`,
    );
    await pool.end();
    return undefined;
  }
  return pool;
}

void test("runMigrations applies 001_progress from a clean core schema and is idempotent on repeat", async (t) => {
  const pool = await connectOrSkip(t);
  if (!pool) return;
  try {
    // This task owns core.lesson_progress/core.schema_migrations
    // exclusively (see task-005 brief) — dropping them here to assert a
    // from-scratch apply does not risk any other task's data.
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
  const pool = await connectOrSkip(t);
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
  const pool = await connectOrSkip(t);
  if (!pool) return;
  try {
    await pool.query("drop table if exists core.lesson_progress");
    await pool.query("drop table if exists core.schema_migrations");

    // Without the pg_advisory_lock in runMigrations, two concurrent callers
    // would both see version "001_progress" as unapplied and race to INSERT
    // it into schema_migrations, one of them failing on the primary key.
    await Promise.all([runMigrations(pool), runMigrations(pool)]);

    const result = await pool.query("select version from core.schema_migrations");
    assert.equal(result.rowCount, 1);
  } finally {
    await pool.end();
  }
});
