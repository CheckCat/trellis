import assert from "node:assert/strict";
import test from "node:test";

import { createPool, redactPassword } from "./pool.js";
import { connectToDisposableTestDbOrSkip } from "./test-support.js";

// Final review, backend fixes round: this file used to read `DATABASE_URL`
// directly (a weaker guard than migrate.test.ts's `TRELLIS_TEST_DATABASE_URL`
// + `_test`-suffix check) on the reasoning that these two tests only
// create/drop their own scratch tables (`core._test_rollback_scratch`/
// `_commit_scratch`), never `core.lesson_progress`. That reasoning doesn't
// hold as a project-wide precedent: once task 007 puts real lesson progress
// behind `DATABASE_URL`, any test file copying this file's old pattern for a
// *new*, actually-destructive check inherits the weaker guard by example.
// Aligned to the same `connectToDisposableTestDbOrSkip` helper
// migrate.test.ts uses, not duplicated — see db/test-support.ts.

void test("withTransaction rolls back on error and returns the client to the pool", async (t) => {
  const pool = await connectToDisposableTestDbOrSkip(t, "scratch-table pool test");
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
  const pool = await connectToDisposableTestDbOrSkip(t, "scratch-table pool test");
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
