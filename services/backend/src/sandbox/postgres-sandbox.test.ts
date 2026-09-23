import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresSandboxDriverFromPool,
  createUnconfiguredPostgresSandboxDriver,
} from "./postgres-sandbox.js";
import { createRecordingPool } from "./test-support.js";
import { SandboxError, type SandboxSpec } from "./types.js";

function spec(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    courseId: "fixture-course",
    sandboxId: "main",
    type: "postgres",
    seedFiles: [
      { relativePath: "sandbox/01-schema.sql", absolutePath: "/tmp/x/sandbox/01-schema.sql", content: "create table t (id int);" },
      { relativePath: "sandbox/02-data.sql", absolutePath: "/tmp/x/sandbox/02-data.sql", content: "insert into t values (1);" },
    ],
    ...overrides,
  };
}

void test("provision wipes and recreates the schema, then applies seeds in manifest order, all in one transaction", async () => {
  const recording = createRecordingPool();
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  await driver.provision(spec());

  assert.deepEqual(recording.statements, [
    "BEGIN",
    'set local search_path to "sandbox"',
    'drop schema if exists "sandbox" cascade',
    'create schema "sandbox"',
    "create table t (id int);",
    "insert into t values (1);",
    "COMMIT",
  ]);
  // Seed files are executed as whole files, not split into statements: the
  // second seed's text arrived verbatim, semicolon and all.
  assert.equal(recording.clientsOpen(), 0);
});

void test("a seed the database rejects aborts the whole rebuild and is reported verbatim (error path)", async () => {
  const recording = createRecordingPool({
    failOn: (sql) =>
      sql.startsWith("insert into t")
        ? new Error('relation "t" does not exist\nLINE 1: insert into t values (1);\n                    ^')
        : undefined,
  });
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  const err = await driver.provision(spec()).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(err instanceof SandboxError, `expected a SandboxError, got ${String(err)}`);
  assert.equal(err.kind, "seed_failed");
  assert.equal(err.seedFile, "sandbox/02-data.sql");
  // The database's own words, including its LINE context — not a paraphrase.
  assert.match(err.databaseError ?? "", /relation "t" does not exist/);
  assert.match(err.databaseError ?? "", /LINE 1:/);
  assert.match(err.message, /"sandbox\/02-data\.sql"/);
  assert.match(err.message, /"fixture-course"/);
  // Rolled back, never committed: a failed seed leaves no half-built sandbox.
  assert.ok(recording.statements.includes("ROLLBACK"), recording.statements.join(" | "));
  assert.ok(!recording.statements.includes("COMMIT"), recording.statements.join(" | "));
  assert.equal(recording.clientsOpen(), 0);
});

void test("a failing DROP/CREATE SCHEMA is reported as unavailable, not blamed on a seed (error path)", async () => {
  const recording = createRecordingPool({
    failOn: (sql) => (sql.startsWith("drop schema") ? new Error("permission denied for database trellis") : undefined),
  });
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  const err = await driver.provision(spec()).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(err instanceof SandboxError);
  assert.equal(err.kind, "unavailable");
  assert.equal(err.seedFile, undefined);
  assert.match(err.databaseError ?? "", /permission denied/);
  assert.match(err.message, /SANDBOX_DATABASE_URL/);
  assert.ok(!recording.statements.includes("COMMIT"));
});

void test("an unreachable database is described against SANDBOX_DATABASE_URL, never DATABASE_URL (error path)", async () => {
  const recording = createRecordingPool({
    failToConnect: () =>
      // Exactly what db/pool.ts's connect() wrapper produces — its advice
      // names DATABASE_URL, which is the wrong variable for this pool.
      new Error(
        "Could not connect to Postgres at postgres://trellis_sandbox:***@127.0.0.1:5433/trellis: connect ECONNREFUSED. " +
          "Check that DATABASE_URL is correct and Postgres is running and reachable.",
        { cause: new Error("connect ECONNREFUSED 127.0.0.1:5433") },
      ),
  });
  const driver = createPostgresSandboxDriverFromPool(recording.pool, {
    describeTarget: "postgres://trellis_sandbox:***@127.0.0.1:5433/trellis",
  });

  const err = await driver.provision(spec()).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  assert.ok(err instanceof SandboxError);
  assert.equal(err.kind, "unavailable");
  assert.match(err.message, /connect ECONNREFUSED 127\.0\.0\.1:5433/);
  assert.match(err.message, /SANDBOX_DATABASE_URL is correct/);
  // No bare "DATABASE_URL" anywhere — only the "SANDBOX_DATABASE_URL" form.
  // (A plain `includes("DATABASE_URL")` check would pass on the wrapper's
  // misleading advice too, since it is a substring of the right name.)
  assert.doesNotMatch(err.message, /(^|[^_])DATABASE_URL/);
  // The redacted target is quoted back, so the password never reaches a log
  // or an HTTP response.
  assert.match(err.message, /trellis_sandbox:\*\*\*@/);
  assert.doesNotMatch(err.message, /trellis_sandbox:[^*]/);
});

void test("a sandbox with no seed files still rebuilds the schema (edge case)", async () => {
  const recording = createRecordingPool();
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  await driver.provision(spec({ seedFiles: [] }));

  assert.deepEqual(recording.statements, [
    "BEGIN",
    'set local search_path to "sandbox"',
    'drop schema if exists "sandbox" cascade',
    'create schema "sandbox"',
    "COMMIT",
  ]);
});

void test("a schema name that isn't a plain identifier is refused instead of interpolated into SQL (error path)", () => {
  const recording = createRecordingPool();
  assert.throws(
    () => createPostgresSandboxDriverFromPool(recording.pool, { schema: 'sandbox"; drop schema core cascade; --' }),
    /Invalid sandbox schema name/,
  );
  assert.deepEqual(recording.statements, []);
});

void test("query() and withClient() go through the sandbox pool, and close() leaves an injected pool alone", async () => {
  const recording = createRecordingPool({ rows: [{ answer: 42 }] });
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  const result = await driver.query("select 42 as answer");
  assert.deepEqual(result.rows, [{ answer: 42 }]);

  const viaClient = await driver.withClient(async (client) => client.query("select 1"));
  assert.ok(viaClient);
  assert.equal(recording.clientsOpen(), 0, "withClient must release its client");

  await driver.close();
  assert.equal(recording.endCalls(), 0, "a pool this driver did not create is not this driver's to end");
});

void test("withClient releases its client even when the callback throws (error path)", async () => {
  const recording = createRecordingPool();
  const driver = createPostgresSandboxDriverFromPool(recording.pool);

  await assert.rejects(
    driver.withClient(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(recording.clientsOpen(), 0);
});

void test("close() ends a pool the driver owns", async () => {
  const recording = createRecordingPool();
  const driver = createPostgresSandboxDriverFromPool(recording.pool, { ownsPool: true });

  await driver.close();

  assert.equal(recording.endCalls(), 1);
});

void test("the unconfigured driver fails every operation with a stated reason (error path)", async () => {
  const driver = createUnconfiguredPostgresSandboxDriver();

  for (const operation of [
    () => driver.provision(spec()),
    () => driver.query("select 1"),
    () => driver.withClient(async () => undefined),
  ]) {
    const err = await operation().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    assert.ok(err instanceof SandboxError, `expected a SandboxError, got ${String(err)}`);
    assert.equal(err.kind, "unavailable");
    assert.match(err.message, /not configured/);
    assert.match(err.message, /SANDBOX_DATABASE_URL/);
  }
  // Nothing was opened, so closing is a no-op rather than an error.
  await driver.close();
});
