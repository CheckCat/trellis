import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import { createPool, redactPassword, type AppPool } from "./pool.js";

/**
 * Tests below that need a real Postgres self-diagnose: no CI environment
 * runs Postgres for this project (see task-005 brief), so a missing/
 * unreachable `DATABASE_URL` skips with a stated reason rather than
 * failing — `npm test` must stay green without Postgres. Run locally via
 * `cp .env.example .env` + `docker compose up -d postgres` (task-002
 * report) to actually exercise these.
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

void test("withTransaction rolls back on error and returns the client to the pool", async (t) => {
  const pool = await connectOrSkip(t);
  if (!pool) return;
  try {
    await pool.query("create table if not exists core._test_rollback_scratch (id int primary key)");
    try {
      await assert.rejects(
        () =>
          pool.withTransaction(async (client) => {
            await client.query("insert into core._test_rollback_scratch (id) values (1)");
            throw new Error("boom");
          }),
        /boom/,
      );

      const result = await pool.query<{ count: number }>(
        "select count(*)::int as count from core._test_rollback_scratch",
      );
      assert.equal(result.rows[0]?.count, 0, "the insert must not have been committed");

      // Proves the client was released back to the pool healthy (not
      // leaked/left mid-transaction) rather than merely that the error
      // propagated.
      const followUp = await pool.query<{ one: number }>("select 1 as one");
      assert.equal(followUp.rows[0]?.one, 1);
    } finally {
      await pool.query("drop table if exists core._test_rollback_scratch");
    }
  } finally {
    await pool.end();
  }
});

void test("withTransaction commits when fn succeeds", async (t) => {
  const pool = await connectOrSkip(t);
  if (!pool) return;
  try {
    await pool.query("create table if not exists core._test_commit_scratch (id int primary key)");
    try {
      await pool.withTransaction(async (client) => {
        await client.query("insert into core._test_commit_scratch (id) values (1)");
      });

      const result = await pool.query<{ count: number }>(
        "select count(*)::int as count from core._test_commit_scratch",
      );
      assert.equal(result.rows[0]?.count, 1);
    } finally {
      await pool.query("drop table if exists core._test_commit_scratch");
    }
  } finally {
    await pool.end();
  }
});

void test("createPool surfaces a descriptive, redacted error when Postgres is unreachable (edge case, no live DB needed)", async () => {
  // Port 1 on loopback refuses connections immediately (nothing ever binds
  // to a privileged low port like this in a test sandbox) — no real
  // Postgres required to exercise the connection-error path.
  const pool = createPool("postgres://someuser:secret-password@127.0.0.1:1/nonexistent");
  try {
    await assert.rejects(() => pool.connect(), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Could not connect to Postgres at/);
      assert.doesNotMatch(err.message, /secret-password/);
      return true;
    });
  } finally {
    await pool.end();
  }
});

void test("redactPassword masks the password and leaves the rest of the URL intact", () => {
  assert.equal(
    redactPassword("postgres://trellis_app:hunter2@localhost:5432/trellis"),
    "postgres://trellis_app:***@localhost:5432/trellis",
  );
});
