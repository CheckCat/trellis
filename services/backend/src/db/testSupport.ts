// Shared test-only helper for connecting to a disposable test Postgres
// database, or skipping. Not a *.test.ts file itself (same treatment as
// courses/testSupport.ts — see tsconfig.json's `exclude`), because
// pool.test.ts and migrate.test.ts both need the exact same guard logic and
// duplicating it would be duplicating real logic, not just similar lines
// (backend-implementer role: SRP > DRY, but DRY still applies once it's
// actual logic).
//
// `DATABASE_URL` is deliberately NEVER read here: it's a developer's
// connection to their working instance in the named `trellis_pgdata`
// volume, and any test that creates/drops tables against it risks the
// "progress data is never lost" invariant once task 007 puts real lesson
// progress in that database (see task-005 fix round 1, and final review
// backend fixes round — the whole reason this file exists is to make that
// the ONE guard every such test uses, not a pattern that only some files
// happened to adopt).

import type { TestContext } from "node:test";

import { createPool, type AppPool } from "./pool.js";

const REQUIRED_TEST_DB_SUFFIX = "_test";

/**
 * Connects to `TRELLIS_TEST_DATABASE_URL`, refusing (loudly, via `throw` —
 * not a skip) to proceed if that database's name doesn't end in `_test`.
 * Skips (via `t.skip`, so the test run stays green) when the variable isn't
 * set at all, or when the database it points at isn't reachable.
 *
 * `whatIsSkipped` is folded into both skip messages and identifies what the
 * caller's tests actually do to the database (e.g. "destructive migration
 * test (this suite drops/recreates core.lesson_progress and
 * core.schema_migrations)") — every call site should describe its own
 * blast radius rather than share one generic sentence.
 */
export async function connectToDisposableTestDbOrSkip(
  t: TestContext,
  whatIsSkipped: string,
): Promise<AppPool | undefined> {
  const testDatabaseUrl = process.env.TRELLIS_TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    t.skip(`TRELLIS_TEST_DATABASE_URL is not set — skipping ${whatIsSkipped}`);
    return undefined;
  }

  let databaseName: string;
  try {
    databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`TRELLIS_TEST_DATABASE_URL is not a valid connection string: "${testDatabaseUrl}"`);
  }
  if (!databaseName.endsWith(REQUIRED_TEST_DB_SUFFIX)) {
    // Not a skip: a misconfigured TRELLIS_TEST_DATABASE_URL must fail the
    // run loudly, not quietly pass by "skipping" — the point is to stop a
    // developer from pointing this at their real database, not to let the
    // run go green regardless.
    throw new Error(
      `Refusing to run tests against database "${databaseName}": TRELLIS_TEST_DATABASE_URL must point ` +
        `at a database whose name ends with "${REQUIRED_TEST_DB_SUFFIX}".`,
    );
  }

  const pool = createPool(testDatabaseUrl);
  try {
    await pool.query("select 1");
  } catch (err) {
    t.skip(
      `Postgres is not reachable at TRELLIS_TEST_DATABASE_URL (${err instanceof Error ? err.message : String(err)}) — skipping ${whatIsSkipped}`,
    );
    await pool.end();
    return undefined;
  }
  return pool;
}
