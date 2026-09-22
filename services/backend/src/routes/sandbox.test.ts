import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { AppPool } from "../db/pool.js";
import { createPostgresSandboxDriverFromPool } from "../sandbox/postgres-sandbox.js";
import { createSandboxProvisioner } from "../sandbox/provisioner.js";
import {
  createRecordingPool,
  createSandboxFixture,
  FIXTURE_COURSE_ID,
  FIXTURE_SEED_DATA,
  FIXTURE_SEED_SCHEMA,
  type CreateRecordingPoolOptions,
  type SandboxFixture,
} from "../sandbox/testSupport.js";
import type { SandboxProvisioner } from "../sandbox/types.js";
import { buildServer } from "../server.js";

// This file used to be twice as long, because there used to be a second
// endpoint here: POST /courses/:id/sandbox/reset, "сбросить песочницу".
// It went away when every practice attempt began re-seeding on its own —
// a manual reset restores a starting state the engine never leaves.
//
// What its tests covered did NOT go away, it moved to where it belongs:
//   - the SQL a rebuild issues, and a seed the database rejects
//     -> sandbox/postgres-sandbox.test.ts (the driver, with a recording
//        pool, which is what actually produces those statements);
//   - an unknown course, an ambiguous sandbox, a vanished seed file
//     -> sandbox/provisioner.test.ts (the resolution rules, none of which
//        are HTTP-shaped);
//   - SandboxError -> HTTP status, the one genuinely route-level thing
//     -> routes/practice.test.ts, since `POST practice/run` is now the
//        only surface that can hit a sandbox failure.
// What remains here is this file's own subject: the status endpoint.

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
  /** `undefined` when the server was built without a sandbox at all. */
  readonly sandbox?: SandboxProvisioner;
  close(): Promise<void>;
}

/**
 * A real server over the real provisioner and the real Postgres driver —
 * only the pool underneath is a recording fake, so the status the endpoint
 * reports is the status a real rebuild would have produced.
 */
function buildAppUnderTest(
  options: { fixture?: SandboxFixture; pool?: CreateRecordingPoolOptions; configured?: boolean } = {},
): AppUnderTest {
  const fixture = options.fixture ?? createSandboxFixture();
  const recording = createRecordingPool(options.pool);
  const sandbox =
    options.configured === false
      ? undefined
      : createSandboxProvisioner({
          courses: fixture.registry,
          drivers: [createPostgresSandboxDriverFromPool(recording.pool)],
        });
  const app = buildServer({
    pool: unusedCorePool(),
    registry: fixture.registry,
    logger: false,
    // No `sandbox` at all is the production shape of "SANDBOX_DATABASE_URL
    // wasn't provided".
    ...(sandbox === undefined ? {} : { sandbox }),
  });
  return {
    app,
    fixture,
    statements: recording.statements,
    ...(sandbox === undefined ? {} : { sandbox }),
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

    // What a practice attempt does to the sandbox, without going through
    // practice: this endpoint reports state, it does not create it.
    await under.sandbox?.reset(FIXTURE_COURSE_ID);

    const after = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.equal(after.statusCode, 200);
    const body = after.json<{
      active: boolean;
      courseId: string;
      sandboxId: string;
      type: string;
      readyAt: string;
      seedFiles: string[];
    }>();
    assert.equal(body.active, true);
    assert.equal(body.courseId, FIXTURE_COURSE_ID);
    assert.equal(body.sandboxId, "main");
    assert.equal(body.type, "postgres");
    assert.ok(!Number.isNaN(Date.parse(body.readyAt)), `readyAt should be an ISO timestamp, got ${body.readyAt}`);
    // Paths are package-relative — the response never says where courses
    // are mounted on the host.
    assert.deepEqual(body.seedFiles, [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA]);
    // And it never ships the seed SQL itself.
    assert.doesNotMatch(after.body, /create table/i);
  } finally {
    await under.close();
  }
});

void test("an unknown course is a 404, and nothing is touched (error path)", async () => {
  const under = buildAppUnderTest();
  try {
    const status = await under.app.inject({ method: "GET", url: "/courses/no-such-course/sandbox" });

    assert.equal(status.statusCode, 404);
    assert.equal(status.json<{ error: string }>().error, "course_not_found");
    assert.deepEqual(under.statements, []);
  } finally {
    await under.close();
  }
});

void test("a failed rebuild leaves the status saying no sandbox is live (error path)", async () => {
  const under = buildAppUnderTest({
    pool: {
      failOn: (sql) =>
        sql.startsWith("insert into widgets")
          ? new Error('column "label" of relation "widgets" does not exist')
          : undefined,
    },
  });
  try {
    await assert.rejects(() => under.sandbox?.reset(FIXTURE_COURSE_ID) ?? Promise.resolve());

    // Half-wiped is not live. Claiming otherwise would tell the UI a
    // practice lesson can run against seed data that was just dropped.
    const status = await under.app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/sandbox` });
    assert.deepEqual(status.json(), { active: false });
    assert.ok(under.statements.includes("ROLLBACK"));
  } finally {
    await under.close();
  }
});

void test("a server built without SANDBOX_DATABASE_URL still answers the status (error path)", async () => {
  const under = buildAppUnderTest({ configured: false });
  try {
    // Status needs no sandbox backend at all — it reports what is live,
    // and "nothing" is a truthful answer on a server that cannot run
    // practice in the first place.
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
    await under.sandbox?.reset("course-one");

    const one = await under.app.inject({ method: "GET", url: "/courses/course-one/sandbox" });
    const two = await under.app.inject({ method: "GET", url: "/courses/course-two/sandbox" });

    assert.equal(one.json<{ active: boolean }>().active, true);
    assert.deepEqual(two.json(), { active: false });
  } finally {
    await under.close();
  }
});
