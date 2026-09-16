import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import { connectToDisposableTestDbOrSkip } from "./testSupport.js";

/**
 * A minimal stand-in for `TestContext` that only records `.skip()` calls
 * instead of actually marking the calling test skipped — using the real
 * `t` from the enclosing `test(...)` here would make these regression tests
 * themselves report as "skipped" in the TAP output, which is confusing for
 * a test whose entire point is "assert that skip happens" (final review,
 * backend fixes round, Important 2's regression coverage).
 */
function fakeTestContext(): { readonly skipMessages: string[]; readonly context: TestContext } {
  const skipMessages: string[] = [];
  const context = { skip: (message?: string) => skipMessages.push(message ?? "") } as unknown as TestContext;
  return { skipMessages, context };
}

/** Saves/restores `DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL` around `run` —
 * these tests deliberately manipulate both, and must not leak a change into
 * whatever test runs next in the same process. */
async function withEnv(
  overrides: { databaseUrl?: string; testDatabaseUrl?: string },
  run: () => Promise<void>,
): Promise<void> {
  const original = { databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TRELLIS_TEST_DATABASE_URL };
  if (overrides.databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = overrides.databaseUrl;
  }
  if (overrides.testDatabaseUrl === undefined) {
    delete process.env.TRELLIS_TEST_DATABASE_URL;
  } else {
    process.env.TRELLIS_TEST_DATABASE_URL = overrides.testDatabaseUrl;
  }
  try {
    await run();
  } finally {
    if (original.databaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original.databaseUrl;
    }
    if (original.testDatabaseUrl === undefined) {
      delete process.env.TRELLIS_TEST_DATABASE_URL;
    } else {
      process.env.TRELLIS_TEST_DATABASE_URL = original.testDatabaseUrl;
    }
  }
}

void test(
  "connectToDisposableTestDbOrSkip skips — never touches DATABASE_URL — when only DATABASE_URL is set (fix round: Important 2 regression guard)",
  async () => {
    await withEnv(
      { databaseUrl: "postgres://trellis_app:whatever@127.0.0.1:5432/trellis", testDatabaseUrl: undefined },
      async () => {
        const { skipMessages, context } = fakeTestContext();
        const pool = await connectToDisposableTestDbOrSkip(context, "regression check");
        assert.equal(pool, undefined);
        assert.equal(skipMessages.length, 1);
        assert.match(skipMessages[0] ?? "", /TRELLIS_TEST_DATABASE_URL is not set/);
      },
    );
  },
);

void test(
  "connectToDisposableTestDbOrSkip throws (not skip) when TRELLIS_TEST_DATABASE_URL doesn't end in \"_test\", even with a valid DATABASE_URL set",
  async () => {
    await withEnv(
      {
        databaseUrl: "postgres://trellis_app:whatever@127.0.0.1:5432/trellis",
        testDatabaseUrl: "postgres://trellis_app:whatever@127.0.0.1:5432/trellis",
      },
      async () => {
        const { context } = fakeTestContext();
        await assert.rejects(
          () => connectToDisposableTestDbOrSkip(context, "regression check"),
          /must point at a database whose name ends with "_test"/,
        );
      },
    );
  },
);

void test(
  "connectToDisposableTestDbOrSkip skips with a reachability reason when TRELLIS_TEST_DATABASE_URL is _test-suffixed but unreachable (edge case)",
  async () => {
    await withEnv(
      { databaseUrl: undefined, testDatabaseUrl: "postgres://someuser:pw@127.0.0.1:1/trellis_test" },
      async () => {
        const { skipMessages, context } = fakeTestContext();
        const pool = await connectToDisposableTestDbOrSkip(context, "regression check");
        assert.equal(pool, undefined);
        assert.equal(skipMessages.length, 1);
        assert.match(skipMessages[0] ?? "", /Postgres is not reachable at TRELLIS_TEST_DATABASE_URL/);
      },
    );
  },
);
