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

// A single, distinct advisory-lock key meaning "I need this test database to
// myself for the duration of this test". Deliberately NOT migrate.ts's own
// key (84637201): runMigrations takes that one itself, and a test holding it
// would deadlock against the very function it is testing.
//
// Why this exists at all: `node --test 'dist-test/**/*.test.js'` runs test
// FILES concurrently (one process each), and they all point at the same
// disposable database. migrate.test.ts drops core.lesson_progress outright,
// while progress/repository.test.ts inserts into it — without serialization
// those two files race, and the failure ("relation core.lesson_progress does
// not exist") would look like a bug in the code under test rather than in
// the test setup. Any test that either destroys shared tables or depends on
// them existing must take this lock (see `ConnectToTestDbOptions.exclusive`).
const EXCLUSIVE_TEST_DB_LOCK_KEY = 84_637_202;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_ACQUIRE_TIMEOUT_MS = 60_000;

export interface ConnectToTestDbOptions {
  /**
   * Serializes this test against every other test that asks for the same
   * thing, via a session-level advisory lock held for the whole test and
   * released automatically afterwards (`t.after`).
   *
   * The lock is held on a SEPARATE pool created here, not on the pool
   * returned to the caller: a checked-out client would make the caller's own
   * `pool.end()` wait forever for it to be released, and that release only
   * happens after the test body finishes — a deadlock.
   */
  readonly exclusive?: boolean;
}

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
  options: ConnectToTestDbOptions = {},
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

  if (options.exclusive === true) {
    try {
      await holdExclusiveTestDbLock(t, testDatabaseUrl);
    } catch (err) {
      await pool.end();
      throw err;
    }
  }
  return pool;
}

/**
 * Takes the exclusive test-database lock on its own connection and arranges
 * (via `t.after`) for it to be released once the test finishes, whatever the
 * outcome. Polls `pg_try_advisory_lock` instead of blocking in
 * `pg_advisory_lock` so a stuck holder surfaces as a stated timeout rather
 * than a test run that hangs forever with no explanation (same reasoning as
 * migrate.ts's own lock acquisition).
 */
async function holdExclusiveTestDbLock(t: TestContext, testDatabaseUrl: string): Promise<void> {
  const lockPool = createPool(testDatabaseUrl);
  let client;
  try {
    client = await lockPool.connect();
  } catch (err) {
    await lockPool.end();
    throw err;
  }

  const lockClient = client;
  const release = async (): Promise<void> => {
    try {
      await lockClient.query("select pg_advisory_unlock($1)", [EXCLUSIVE_TEST_DB_LOCK_KEY]);
    } finally {
      lockClient.release();
      await lockPool.end();
    }
  };

  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  for (;;) {
    let acquired: boolean;
    try {
      const result = await lockClient.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [EXCLUSIVE_TEST_DB_LOCK_KEY],
      );
      acquired = result.rows[0]?.locked === true;
    } catch (err) {
      lockClient.release();
      await lockPool.end();
      throw err;
    }
    if (acquired) {
      t.after(release);
      return;
    }
    if (Date.now() >= deadline) {
      lockClient.release();
      await lockPool.end();
      throw new Error(
        `Timed out after ${LOCK_ACQUIRE_TIMEOUT_MS}ms waiting for exclusive access to the test database ` +
          `(advisory lock ${EXCLUSIVE_TEST_DB_LOCK_KEY}) — another test file is still holding it.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }
}
