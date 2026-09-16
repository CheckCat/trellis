import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { AppPool } from "../db/pool.js";
import { createPostgresSandboxDriverFromPool } from "../sandbox/postgres-sandbox.js";
import { createSandboxProvisioner } from "../sandbox/provisioner.js";
import {
  createRecordingPool,
  createSandboxFixture,
  fixtureFilePath,
  FIXTURE_COURSE_ID,
  FIXTURE_SEED_DATA,
  FIXTURE_SEED_SCHEMA,
  FIXTURE_SEED_SCHEMA_SQL,
  type CreateRecordingPoolOptions,
  type SandboxFixture,
} from "../sandbox/testSupport.js";
import { buildServer } from "../server.js";

/** The core db pool is irrelevant to these routes — they never touch
 * `core`. Anything reaching for it is a bug worth failing loudly on. */
const unusedCorePool = (): AppPool =>
  ({
    query: () => {
      throw new Error("the sandbox routes must not touch the application-role pool");
    },
    connect: () => {
      throw new Error("the sandbox routes must not touch the application-role pool");
    },
    withTransaction: () => {
      throw new Error("the sandbox routes must not touch the application-role pool");
    },
    end: async () => {},
  }) as unknown as AppPool;

interface AppUnderTest {
  readonly app: ReturnType<typeof buildServer>;
  readonly fixture: SandboxFixture;
  readonly statements: string[];
  close(): Promise<void>;
}

/**
 * A real server over the real provisioner and the real Postgres driver —
 * only the pool underneath is a recording fake, so these tests exercise
 * routing, schemas, error mapping and the driver's statement sequence in one
 * piece, without a database.
 */
function buildAppUnderTest(
  options: { fixture?: SandboxFixture; pool?: CreateRecordingPoolOptions; configured?: boolean } = {},
): AppUnderTest {
  const fixture = options.fixture ?? createSandboxFixture();
  const recording = createRecordingPool(options.pool);
  const app = buildServer({
    pool: unusedCorePool(),
    registry: fixture.registry,
    logger: false,
    // `configured: false` leaves the sandbox out entirely — the production
    // shape of "SANDBOX_DATABASE_URL wasn't provided".
    ...(options.configured === false
      ? {}
      : {
          sandbox: createSandboxProvisioner({
            courses: fixture.registry,
            driver: createPostgresSandboxDriverFromPool(recording.pool),
          }),
        }),
  });
  return {
    app,
    fixture,
    statements: recording.statements,
    close: async () => {
      await app.close();
      fixture.cleanup();
    },
  };
}

void test("GET /courses/:courseId/sandbox reports no live sandbox until one is prepared", async () => {
  const under = buildAppUnderTest();
  try {
    const before = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.equal(before.statusCode, 200);
    assert.deepEqual(before.json(), { active: false });

    const reset = await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });
    assert.equal(reset.statusCode, 200);

    const after = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.equal(after.statusCode, 200);
    const body = after.json<{ active: boolean; courseId: string; sandboxId: string; seedFiles: string[] }>();
    assert.equal(body.active, true);
    assert.equal(body.courseId, FIXTURE_COURSE_ID);
    assert.equal(body.sandboxId, "main");
    assert.deepEqual(body.seedFiles, [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA]);
  } finally {
    await under.close();
  }
});

void test("POST /courses/:courseId/sandbox/reset rebuilds the schema and applies the course's seeds in order", async () => {
  const under = buildAppUnderTest();
  try {
    const response = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{ active: boolean; type: string; readyAt: string; seedFiles: string[] }>();
    assert.equal(body.active, true);
    assert.equal(body.type, "postgres");
    assert.ok(!Number.isNaN(Date.parse(body.readyAt)), `readyAt should be an ISO timestamp, got ${body.readyAt}`);
    assert.deepEqual(under.statements, [
      "BEGIN",
      'set local search_path to "sandbox"',
      'drop schema if exists "sandbox" cascade',
      'create schema "sandbox"',
      FIXTURE_SEED_SCHEMA_SQL,
      "insert into widgets (id, label) values (1, 'first'), (2, 'second');",
      "COMMIT",
    ]);
    // Paths are package-relative — the response never says where courses are
    // mounted on the host.
    assert.deepEqual(body.seedFiles, [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA]);
    // And it never ships the seed SQL itself.
    assert.doesNotMatch(response.body, /create table/i);
  } finally {
    await under.close();
  }
});

void test("a second reset rebuilds again — that is the whole point of a reset", async () => {
  const under = buildAppUnderTest();
  try {
    await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });
    under.statements.length = 0;

    const response = await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });

    assert.equal(response.statusCode, 200);
    assert.ok(under.statements.includes('drop schema if exists "sandbox" cascade'), under.statements.join(" | "));
  } finally {
    await under.close();
  }
});

void test("an unknown course is a 404 on both endpoints (error path)", async () => {
  const under = buildAppUnderTest();
  try {
    const status = await under.app.inject({ method: "GET", url: "/courses/no-such-course/sandbox" });
    assert.equal(status.statusCode, 404);
    assert.equal(status.json<{ error: string }>().error, "course_not_found");

    const reset = await under.app.inject({ method: "POST", url: "/courses/no-such-course/sandbox/reset" });
    assert.equal(reset.statusCode, 404);
    assert.equal(reset.json<{ error: string }>().error, "course_not_found");
    assert.deepEqual(under.statements, []);
  } finally {
    await under.close();
  }
});

void test("a course declaring several sandboxes answers 400 until the caller names one (edge case)", async () => {
  const under = buildAppUnderTest({ fixture: createSandboxFixture({ sandboxIds: ["main", "reporting"] }) });
  try {
    const ambiguous = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
    });
    assert.equal(ambiguous.statusCode, 400);
    assert.equal(ambiguous.json<{ error: string }>().error, "ambiguous_sandbox");

    const named = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
      payload: { sandboxId: "reporting" },
    });
    assert.equal(named.statusCode, 200);
    assert.equal(named.json<{ sandboxId: string }>().sandboxId, "reporting");

    const unknown = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
      payload: { sandboxId: "nope" },
    });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json<{ error: string }>().error, "sandbox_not_found");
  } finally {
    await under.close();
  }
});

void test("a seed the database rejects answers 422 with the file and the database's own message (error path)", async () => {
  const under = buildAppUnderTest({
    pool: {
      failOn: (sql) =>
        sql.startsWith("insert into widgets")
          ? new Error('column "label" of relation "widgets" does not exist\nLINE 1: insert into widgets ...')
          : undefined,
    },
  });
  try {
    const response = await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });

    assert.equal(response.statusCode, 422);
    const body = response.json<{ error: string; message: string; seedFile: string; databaseError: string }>();
    assert.equal(body.error, "seed_failed");
    assert.equal(body.seedFile, FIXTURE_SEED_DATA);
    assert.match(body.databaseError, /column "label" of relation "widgets" does not exist/);
    assert.match(body.databaseError, /LINE 1:/);
    // Rolled back, and still no live sandbox afterwards.
    assert.ok(under.statements.includes("ROLLBACK"));
    const status = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.deepEqual(status.json(), { active: false });
  } finally {
    await under.close();
  }
});

void test("a seed file that vanished after the scan answers 422 and names it (error path)", async () => {
  const under = buildAppUnderTest();
  try {
    fs.rmSync(fixtureFilePath(under.fixture, FIXTURE_SEED_SCHEMA));

    const response = await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });

    assert.equal(response.statusCode, 422);
    const body = response.json<{ error: string; seedFile: string; message: string }>();
    assert.equal(body.error, "seed_unreadable");
    assert.equal(body.seedFile, FIXTURE_SEED_SCHEMA);
    assert.deepEqual(under.statements, [], "nothing may be dropped for a rebuild that cannot complete");
  } finally {
    await under.close();
  }
});

void test("a server built without SANDBOX_DATABASE_URL answers 503 with the reason (error path)", async () => {
  const under = buildAppUnderTest({ configured: false });
  try {
    const response = await under.app.inject({ method: "POST", url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset` });

    assert.equal(response.statusCode, 503);
    const body = response.json<{ error: string; message: string }>();
    assert.equal(body.error, "unavailable");
    assert.match(body.message, /not configured/);
    assert.match(body.message, /SANDBOX_DATABASE_URL/);

    // Status still answers (it needs no sandbox backend at all).
    const status = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), { active: false });
  } finally {
    await under.close();
  }
});

void test("another course's live sandbox does not read as this course's (edge case)", async () => {
  const fixture = createSandboxFixture({ courseId: "course-one" });
  const second = createSandboxFixture({ courseId: "course-two" });
  fs.cpSync(second.packageDir, `${fixture.coursesDir}/course-two`, { recursive: true });
  second.cleanup();
  fixture.registry.rescan();
  const under = buildAppUnderTest({ fixture });
  try {
    await under.app.inject({ method: "POST", url: "/courses/course-one/sandbox/reset" });

    const one = await under.app.inject({ method: "GET", url: "/courses/course-one/sandbox" });
    const two = await under.app.inject({ method: "GET", url: "/courses/course-two/sandbox" });

    assert.equal(one.json<{ active: boolean }>().active, true);
    assert.deepEqual(two.json(), { active: false });
  } finally {
    await under.close();
  }
});

void test("a field the reset body doesn't declare is dropped, never smuggled into the sandbox (error path)", async () => {
  const under = buildAppUnderTest();
  try {
    const response = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
      payload: { sandboxId: "main", sql: "drop schema core cascade" },
    });

    // Fastify's ajv runs with `removeAdditional: true`, so an undeclared
    // field is stripped rather than 400'd (verified behaviour, not assumed)
    // — what matters is that it can never reach the database.
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ sandboxId: string }>().sandboxId, "main");
    for (const statement of under.statements) {
      assert.doesNotMatch(statement, /core/i, `smuggled SQL reached the sandbox: ${statement}`);
    }
  } finally {
    await under.close();
  }
});

void test("a reset body whose sandboxId is not a string is rejected before anything runs (error path)", async () => {
  const under = buildAppUnderTest();
  try {
    const response = await under.app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
      payload: { sandboxId: "" },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(under.statements, []);
  } finally {
    await under.close();
  }
});
