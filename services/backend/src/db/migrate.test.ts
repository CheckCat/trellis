import assert from "node:assert/strict";
import test from "node:test";

import { runMigrations } from "./migrate.js";
import { connectToDisposableTestDbOrSkip } from "./test-support.js";

const DESTRUCTIVE_MIGRATION_TEST_REASON =
  "destructive migration test (this suite drops/recreates core.lesson_progress and " +
  "core.schema_migrations; DATABASE_URL alone is deliberately not enough, see task-005 fix round 1)";

void test("runMigrations applies 001_progress from a clean core schema and is idempotent on repeat", async (t) => {
  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
    // Serialized against every other test that needs core.lesson_progress/
    // core.schema_migrations to exist (progress/repository.test.ts): test
    // FILES run concurrently, and these tests drop those tables.
    exclusive: true,
  });
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
  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
    // Same exclusive access as the first test in this file.
    exclusive: true,
  });
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
  const pool = await connectToDisposableTestDbOrSkip(t, DESTRUCTIVE_MIGRATION_TEST_REASON, {
    // Same exclusive access as the first test in this file.
    exclusive: true,
  });
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
