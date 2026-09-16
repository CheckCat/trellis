# Review: task 008

## Commits (711625fa57d7df862e24df53832e6312cea33db8..HEAD)


## Diffstat (711625fa57d7df862e24df53832e6312cea33db8 -> working tree)

 services/backend/src/server.ts | 67 +++++++++++++++++++++++++++++++++++++++++-
 services/backend/tsconfig.json |  3 +-
 2 files changed, 68 insertions(+), 2 deletions(-)

## Diff (711625fa57d7df862e24df53832e6312cea33db8 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/services/backend/src/server.ts b/services/backend/src/server.ts
index 9e176b1..9361d75 100644
--- a/services/backend/src/server.ts
+++ b/services/backend/src/server.ts
@@ -8,10 +8,18 @@ import { runMigrations } from "./db/migrate.js";
 import { registerShutdown } from "./lifecycle.js";
 import { createCourseRegistry, type CourseRegistry } from "./courses/registry.js";
 import { createProgressRepository, type ProgressRepository } from "./progress/repository.js";
+import {
+  createPostgresSandboxDriver,
+  createUnconfiguredPostgresSandboxDriver,
+  type PostgresSandboxDriver,
+} from "./sandbox/postgres-sandbox.js";
+import { createSandboxProvisioner } from "./sandbox/provisioner.js";
+import type { SandboxProvisioner } from "./sandbox/types.js";
 import healthRoutes from "./routes/health.js";
 import coursesRoutes from "./routes/courses.js";
 import progressRoutes from "./routes/progress.js";
 import quizRoutes from "./routes/quiz.js";
+import sandboxRoutes from "./routes/sandbox.js";
 
 export interface BuildServerOptions {
   /**
@@ -58,6 +66,30 @@ export interface BuildServerOptions {
    * ended up with.
    */
   readonly progress?: ProgressRepository;
+  /**
+   * Injects a practice-sandbox provisioner (task 008) — same test pattern
+   * as `pool`/`registry`/`progress`: route tests build the real provisioner
+   * over the real Postgres driver on top of a recording fake pool (see
+   * sandbox/testSupport.ts) and never touch a database. An injected
+   * provisioner is the caller's own: `buildServer` does not close it.
+   */
+  readonly sandbox?: SandboxProvisioner<PostgresSandboxDriver>;
+  /**
+   * Builds the sandbox's own pool from this connection string — always
+   * `AppConfig.sandboxDatabaseUrl` (SANDBOX_DATABASE_URL), never
+   * `databaseUrl`: everything the sandbox runs must run under the sandbox
+   * role (project invariant). `buildServer` owns that pool and closes it on
+   * `app.close()`.
+   *
+   * Unlike `databaseUrl`, this is optional — and unlike `coursesDir` there
+   * is no safe default for it, so when it is absent the sandbox is wired to
+   * an "unconfigured" driver whose every operation fails with a stated
+   * reason (503), instead of `fastify.sandbox` being missing entirely. That
+   * keeps the many tests that build a server for unrelated reasons free of
+   * sandbox setup while still failing loudly if something actually tries to
+   * use a sandbox that was never configured.
+   */
+  readonly sandboxDatabaseUrl?: string;
   /**
    * Passed straight through to Fastify's own `logger` option — reuses
    * Fastify's own type rather than re-declaring it, so this stays correct
@@ -146,10 +178,39 @@ export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
   // own way into core.lesson_progress.
   app.decorate("progress", options.progress ?? createProgressRepository(pool));
 
+  // The sandbox gets its own pool under its own role — it is never given
+  // `pool` above, not even as a fallback. Mixing the two is the one thing
+  // the sandbox design exists to prevent (project invariant: seed, check and
+  // user SQL run as `trellis_sandbox`, never as the application role).
+  const ownsSandbox = options.sandbox === undefined;
+  if (!ownsSandbox && options.sandboxDatabaseUrl !== undefined) {
+    app.log.warn(
+      "buildServer: both `sandbox` and `sandboxDatabaseUrl` were given — `sandbox` wins, `sandboxDatabaseUrl` is ignored.",
+    );
+  }
+  const sandbox =
+    options.sandbox ??
+    createSandboxProvisioner({
+      courses: registry,
+      driver:
+        options.sandboxDatabaseUrl === undefined
+          ? createUnconfiguredPostgresSandboxDriver()
+          : createPostgresSandboxDriver(options.sandboxDatabaseUrl, {
+              onError: (err) => app.log.error({ err }, "practice sandbox pool error"),
+            }),
+    });
+  app.decorate("sandbox", sandbox);
+  if (ownsSandbox) {
+    app.addHook("onClose", async () => {
+      await sandbox.close();
+    });
+  }
+
   app.register(healthRoutes);
   app.register(coursesRoutes);
   app.register(progressRoutes);
   app.register(quizRoutes);
+  app.register(sandboxRoutes);
   return app;
 }
 
@@ -162,7 +223,11 @@ const isMainModule =
 
 if (isMainModule) {
   const config = parseConfig();
-  const app = buildServer({ databaseUrl: config.databaseUrl, coursesDir: config.coursesDir });
+  const app = buildServer({
+    databaseUrl: config.databaseUrl,
+    sandboxDatabaseUrl: config.sandboxDatabaseUrl,
+    coursesDir: config.coursesDir,
+  });
   const shutdownController = registerShutdown(app);
 
   runMigrations(app.db, {
diff --git a/services/backend/tsconfig.json b/services/backend/tsconfig.json
index 1e4e0c9..4af9eb4 100644
--- a/services/backend/tsconfig.json
+++ b/services/backend/tsconfig.json
@@ -27,6 +27,7 @@
     "src/**/*.test.ts",
     "src/courses/testSupport.ts",
     "src/db/testSupport.ts",
-    "src/progress/testSupport.ts"
+    "src/progress/testSupport.ts",
+    "src/sandbox/testSupport.ts"
   ]
 }
```

## Untracked files (new, not yet added)

### services/backend/src/routes/sandbox.test.ts

```
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
```

### services/backend/src/routes/sandbox.ts

```
// Sandbox API: see whether a course's practice sandbox is prepared, and
// "сбросить песочницу" — rebuild it from the course's seed files.
//
// Nothing here knows any SQL. The endpoint calls `fastify.sandbox` (the
// provisioner) and translates its one error type into an honest HTTP
// status; whether the sandbox is a Postgres schema or something else is not
// this file's business.
//
// Note what is NOT exposed: no endpoint returns seed SQL text, and none runs
// arbitrary SQL — running the user's own SQL in the sandbox is task 009's
// `routes/practice.ts`, deliberately a separate surface.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { isSandboxError, type SandboxErrorKind, type SandboxState } from "../sandbox/types.js";
import { sendCourseNotFound } from "./progress.js";

/** The whole mapping from "what went wrong" to "what the client sees". Kept
 * as data (and exhaustive by `Record<SandboxErrorKind, ...>`, so adding a
 * kind without deciding its status is a compile error) rather than a chain
 * of ifs that could quietly answer 500 for a new kind. */
const STATUS_BY_KIND: Record<SandboxErrorKind, number> = {
  course_not_found: 404,
  sandbox_not_found: 404,
  ambiguous_sandbox: 400,
  // Course content is broken (a seed file vanished, or the database rejected
  // it). The request was well-formed and the server is fine — 422.
  seed_unreadable: 422,
  seed_failed: 422,
  // The sandbox backend itself is unreachable or not configured — the same
  // class of answer /health gives when Postgres is down.
  unavailable: 503,
};

export default async function sandboxRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/sandbox",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: sandboxStatusResponseSchema, 404: sandboxErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      // Scoped to this course on purpose: another course's live sandbox is
      // not this course's sandbox, and reporting it as "ready" would tell
      // the UI a practice lesson can run against seed data that isn't there.
      const state = fastify.sandbox.status(course.id);
      return toStatusPayload(state);
    },
  );

  fastify.post<{ Params: { courseId: string }; Body: { sandboxId?: string } | null }>(
    "/courses/:courseId/sandbox/reset",
    {
      schema: {
        params: courseParamsSchema,
        body: resetBodySchema,
        response: {
          200: sandboxStatusResponseSchema,
          400: sandboxErrorResponseSchema,
          404: sandboxErrorResponseSchema,
          422: sandboxErrorResponseSchema,
          503: sandboxErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        // Unconditional rebuild, even if this course's sandbox is already
        // live — that is the entire point of a reset: the user has made a
        // mess of the practice tables and wants the course's starting state
        // back.
        const state = await fastify.sandbox.reset(request.params.courseId, request.body?.sandboxId);
        return toStatusPayload(state);
      } catch (err) {
        return sendSandboxError(request, reply, err);
      }
    },
  );
}

/** One response shape for both endpoints: `active` first, everything else
 * only when there is something to describe. A client checks `active` — it
 * never has to infer readiness from the presence of some other field. */
function toStatusPayload(state: SandboxState | undefined) {
  if (state === undefined) {
    return { active: false };
  }
  return {
    active: true,
    courseId: state.courseId,
    sandboxId: state.sandboxId,
    type: state.type,
    // Package-relative paths (`sandbox/01-schema.sql`) — what a course
    // author wrote in the manifest. Absolute host paths would leak where
    // courses are mounted and mean nothing to the reader.
    seedFiles: [...state.seedFiles],
    readyAt: state.readyAt,
  };
}

function sendSandboxError(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
  if (!isSandboxError(err)) {
    // Not ours to translate — let Fastify's own error handler produce the
    // 500 and log it, rather than dressing an unknown bug up as a tidy
    // sandbox error.
    throw err;
  }
  const status = STATUS_BY_KIND[err.kind];
  if (status >= 500) {
    request.log.error({ err }, "practice sandbox is unavailable");
  } else {
    request.log.warn({ err }, "practice sandbox request rejected");
  }
  return reply.code(status).send({
    error: err.kind,
    message: err.message,
    ...(err.seedFile === undefined ? {} : { seedFile: err.seedFile }),
    ...(err.databaseError === undefined ? {} : { databaseError: err.databaseError }),
  });
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string" } },
} as const;

// The body is optional as a whole: a course with exactly one declared
// sandbox needs no argument at all, and a client that sends nothing is doing
// the normal thing. `"null"` is in the type list because that is what
// Fastify hands the validator for a bodyless POST — verified, not assumed:
// without it the request fails schema validation with `400 body must be
// object` before the handler ever runs. When a body IS sent,
// `additionalProperties: false` keeps everything but `sandboxId` out.
const resetBodySchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: { sandboxId: { type: "string", minLength: 1 } },
} as const;

const sandboxStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["active"],
  properties: {
    active: { type: "boolean" },
    courseId: { type: "string" },
    sandboxId: { type: "string" },
    type: { type: "string" },
    seedFiles: { type: "array", items: { type: "string" } },
    readyAt: { type: "string" },
  },
} as const;

// Like routes/progress.ts's `errorResponseSchema`, plus the two fields a
// broken seed needs: which file, and what the database said about it —
// verbatim, so a course author can act on it without reading server logs.
const sandboxErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    seedFile: { type: "string" },
    databaseError: { type: "string" },
  },
} as const;
```

### services/backend/src/sandbox/postgres-sandbox.test.ts

```
import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresSandboxDriverFromPool,
  createUnconfiguredPostgresSandboxDriver,
} from "./postgres-sandbox.js";
import { createRecordingPool } from "./testSupport.js";
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
```

### services/backend/src/sandbox/postgres-sandbox.ts

```
// The Postgres implementation of `SandboxDriver`: one pool under the
// SANDBOX role (`trellis_sandbox`), and a schema it wipes and rebuilds from
// the course's seed files.
//
// The two rules this file exists to enforce, both project invariants:
//   1. every statement here — DDL, course seed SQL, and (task 009) the
//      user's own practice SQL and the course's check query — runs on a
//      connection opened with SANDBOX_DATABASE_URL. The application role's
//      pool (`fastify.db`, db/pool.ts) is never used for any of it, and this
//      module never reads DATABASE_URL;
//   2. the sandbox role's rights stop at its own schema (see
//      docker/postgres/init/02-schemas.sql: `sandbox` is owned by
//      trellis_sandbox, `core` is explicitly revoked from it, and the single
//      database-level grant it has is CREATE — which exists precisely so the
//      DROP/CREATE SCHEMA pair below is possible).
//
// `createPool` is reused verbatim from db/pool.ts with a different
// connection string (task-005 report's interface digest endorses exactly
// this) — same limits, same `pool.on('error')` safety, no second
// implementation of "a pool" to keep in sync.

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { createPool, redactPassword, type AppPool } from "../db/pool.js";
import { SandboxError, isSandboxError, type SandboxDriver, type SandboxSpec } from "./types.js";

/** The schema the sandbox role owns (docker/postgres/init/02-schemas.sql).
 * Not configurable through the environment on purpose: it is fixed by the
 * database's own role/ownership setup, and a mismatch between the two would
 * fail at runtime with a permission error rather than do anything useful.
 * The option exists only so tests can prove the identifier is quoted and
 * validated rather than pasted into SQL. */
export const DEFAULT_SANDBOX_SCHEMA = "sandbox";

// Lower-case, ASCII, no quoting surprises. The schema name is the ONE piece
// of SQL here that cannot be a bound parameter (identifiers never can be),
// so it is validated against this before it is interpolated, and quoted even
// then.
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface PostgresSandboxDriver extends SandboxDriver {
  readonly type: "postgres";
  readonly schema: string;
  /**
   * Runs one statement under the sandbox role. This is the primitive task
   * 009 builds practice execution and the check query on — it exists here
   * so that nothing above ever has a reason to open its own connection (and
   * risk opening it under the application role).
   *
   * Errors are passed through exactly as `pg` produced them — no wrapping,
   * no rewording: the practice UI shows the database's own message, and 009
   * needs the original `code`/`position` fields to do that.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /** A dedicated sandbox-role client for the rare multi-statement case
   * (009's "run the user's SQL, then the check query, then roll back", for
   * instance). Released automatically. */
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export interface CreatePostgresSandboxDriverOptions {
  readonly schema?: string;
  /** Same role as `CreatePoolOptions.onError` — observes background pool
   * errors so an idle-connection failure can't crash the process. */
  readonly onError?: (err: Error) => void;
}

export interface CreatePostgresSandboxDriverFromPoolOptions extends CreatePostgresSandboxDriverOptions {
  /** `false` (the default) means the pool was handed in and is somebody
   * else's to close — `close()` leaves it alone, exactly like
   * `buildServer({ pool })` leaves an injected `AppPool` alone. */
  readonly ownsPool?: boolean;
  /** Redacted connection target, used only in "can't reach the sandbox"
   * messages. */
  readonly describeTarget?: string;
}

/**
 * Builds a driver over its own pool, connected as the sandbox role.
 * `sandboxDatabaseUrl` is `AppConfig.sandboxDatabaseUrl` (SANDBOX_DATABASE_URL)
 * — never DATABASE_URL.
 */
export function createPostgresSandboxDriver(
  sandboxDatabaseUrl: string,
  options: CreatePostgresSandboxDriverOptions = {},
): PostgresSandboxDriver {
  const pool = createPool(sandboxDatabaseUrl, { onError: options.onError });
  return createPostgresSandboxDriverFromPool(pool, {
    ...options,
    ownsPool: true,
    describeTarget: redactPassword(sandboxDatabaseUrl),
  });
}

/**
 * The same driver over a pool somebody else made — the test seam (inject a
 * recording fake and assert on the exact statement sequence, the way
 * `buildServer({ pool })` lets route tests run without Postgres), and the
 * escape hatch if a future caller ever needs to share one sandbox pool.
 */
export function createPostgresSandboxDriverFromPool(
  pool: AppPool,
  options: CreatePostgresSandboxDriverFromPoolOptions = {},
): PostgresSandboxDriver {
  const schema = options.schema ?? DEFAULT_SANDBOX_SCHEMA;
  if (!SAFE_IDENTIFIER.test(schema)) {
    throw new Error(
      `Invalid sandbox schema name "${schema}": expected a lower-case identifier matching ${String(SAFE_IDENTIFIER)}.`,
    );
  }
  const quotedSchema = `"${schema}"`;
  const target = options.describeTarget ?? "the practice sandbox database";
  const ownsPool = options.ownsPool ?? false;

  return {
    type: "postgres",
    schema,

    async provision(spec: SandboxSpec): Promise<void> {
      try {
        await pool.withTransaction(async (client) => {
          // One transaction for the whole rebuild. Postgres makes DDL
          // transactional, so a seed that fails on its third statement
          // leaves the sandbox exactly as it was instead of half-built —
          // there is no such thing as a partially provisioned sandbox for a
          // caller to trip over. (A seed file that contains its own
          // COMMIT/ROLLBACK breaks that guarantee; that is course-authoring
          // breakage and shows up as a Postgres warning/error, not as
          // something this driver can paper over.)
          //
          // `set local` — scoped to this transaction, never leaking into
          // the next user of this pooled connection. It makes unqualified
          // names in seed SQL land in the sandbox schema regardless of the
          // role's configured search_path, so a seed can't accidentally
          // depend on server-side role settings.
          await client.query(`set local search_path to ${quotedSchema}`);

          try {
            // `if exists` covers the very first provision on a fresh
            // database; `cascade` is what makes this a real reset — tables,
            // views, functions and data the previous course (or the user's
            // own practice) left behind all go.
            await client.query(`drop schema if exists ${quotedSchema} cascade`);
            await client.query(`create schema ${quotedSchema}`);
          } catch (err) {
            throw new SandboxError(
              "unavailable",
              `Could not recreate the practice sandbox schema "${schema}": ${describeDatabaseError(err)}. ` +
                "Check that SANDBOX_DATABASE_URL points at the sandbox role and that it owns this schema.",
              { databaseError: describeDatabaseError(err), cause: err },
            );
          }

          for (const seed of spec.seedFiles) {
            try {
              // The file is executed as one unit (multi-statement simple
              // query), not split on `;` — splitting SQL text with a regex
              // is wrong the moment a seed contains a dollar-quoted
              // function body or a semicolon inside a string literal.
              await client.query(seed.content);
            } catch (err) {
              throw new SandboxError(
                "seed_failed",
                `Seed file "${seed.relativePath}" of course "${spec.courseId}" failed: ${describeDatabaseError(err)}`,
                { seedFile: seed.relativePath, databaseError: describeDatabaseError(err), cause: err },
              );
            }
          }
        });
      } catch (err) {
        // Anything already classified (a failed seed, a failed recreate)
        // keeps its kind and its verbatim database message.
        if (isSandboxError(err)) {
          throw err;
        }
        // Everything left is the transaction itself failing — in practice,
        // not being able to connect at all. db/pool.ts's `connect()` wraps
        // that in a message ending with "check that DATABASE_URL is
        // correct", which would be actively misleading here, so the cause
        // is unwrapped and re-described against the variable that actually
        // governs this pool.
        throw new SandboxError("unavailable", `Could not reach ${target}: ${describeRootCause(err)}. ` +
          "Check that SANDBOX_DATABASE_URL is correct and Postgres is running and reachable.", {
          cause: err,
        });
      }
    },

    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]) {
      return pool.query<T>(text, params);
    },

    async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

/**
 * A driver for "there is no sandbox configured here". Every operation fails
 * with a stated reason instead of the app either crashing at startup or
 * pretending a sandbox exists.
 *
 * It exists because a sandbox, unlike the core database, has no safe
 * default: `buildServer()` is called by plenty of tests that care about
 * courses or progress and have no business supplying SANDBOX_DATABASE_URL.
 * Rather than let `fastify.sandbox` be absent (which turns any future
 * caller's mistake into a Fastify decorator crash) the server decorates it
 * with this, and practice endpoints answer 503 with the reason.
 */
export function createUnconfiguredPostgresSandboxDriver(
  reason = "SANDBOX_DATABASE_URL was not provided to buildServer()",
): PostgresSandboxDriver {
  const fail = (): never => {
    throw new SandboxError("unavailable", `The practice sandbox is not configured: ${reason}.`);
  };
  return {
    type: "postgres",
    schema: DEFAULT_SANDBOX_SCHEMA,
    async provision() {
      return fail();
    },
    async query() {
      return fail();
    },
    async withClient() {
      return fail();
    },
    async close() {
      // Nothing was ever opened.
    },
  };
}

/**
 * The database's own words for an error, unchanged — the named function
 * carries the contract ("verbatim, never reworded"), which is why it is not
 * inlined at its two call sites. `pg` puts the server's message in
 * `.message` already complete with the `LINE n: ...` context a course author
 * needs to find the broken statement, so there is nothing to add to it.
 */
function describeDatabaseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Unwraps one level of `{ cause }` so a wrapper's own advice (db/pool.ts's
 * `describeConnectionError`) doesn't get quoted back at the user alongside
 * this module's. */
function describeRootCause(err: unknown): string {
  if (err instanceof Error && err.cause instanceof Error) {
    return err.cause.message;
  }
  return err instanceof Error ? err.message : String(err);
}
```

### services/backend/src/sandbox/provisioner.test.ts

```
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createSandboxProvisioner } from "./provisioner.js";
import {
  createSandboxFixture,
  fixtureFilePath,
  FIXTURE_COURSE_ID,
  FIXTURE_SEED_DATA,
  FIXTURE_SEED_DATA_SQL,
  FIXTURE_SEED_SCHEMA,
  FIXTURE_SEED_SCHEMA_SQL,
} from "./testSupport.js";
import { SandboxError, type SandboxDriver, type SandboxSpec } from "./types.js";

/** A driver that records the specs it was handed instead of touching a
 * database — the provisioner's whole job is producing those specs and
 * deciding when to hand one over. */
function recordingDriver(options: { failOnce?: Error; onProvision?: () => Promise<void> } = {}) {
  const specs: SandboxSpec[] = [];
  let failures = options.failOnce === undefined ? 0 : 1;
  let closeCalls = 0;
  const driver: SandboxDriver = {
    type: "postgres",
    async provision(spec) {
      specs.push(spec);
      await options.onProvision?.();
      if (failures > 0 && options.failOnce !== undefined) {
        failures -= 1;
        throw options.failOnce;
      }
    },
    async close() {
      closeCalls += 1;
    },
  };
  return { driver, specs, closeCalls: () => closeCalls };
}

const FIXED_CLOCK = () => new Date("2026-03-01T10:00:00.000Z");

void test("ensure provisions the course's sandbox once and does nothing on the next call", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver, now: FIXED_CLOCK });

    const first = await provisioner.ensure(FIXTURE_COURSE_ID);
    const second = await provisioner.ensure(FIXTURE_COURSE_ID);

    assert.equal(specs.length, 1, "a live sandbox must not be rebuilt under the user's feet");
    assert.deepEqual(second, first);
    assert.deepEqual(first, {
      courseId: FIXTURE_COURSE_ID,
      sandboxId: "main",
      type: "postgres",
      seedFiles: [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA],
      readyAt: "2026-03-01T10:00:00.000Z",
    });
  } finally {
    fixture.cleanup();
  }
});

void test("the spec handed to the driver carries every seed, in manifest order, with its contents read", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    await provisioner.ensure(FIXTURE_COURSE_ID);

    const spec = specs[0];
    assert.ok(spec);
    assert.equal(spec.courseId, FIXTURE_COURSE_ID);
    assert.equal(spec.sandboxId, "main");
    assert.equal(spec.type, "postgres");
    assert.deepEqual(
      spec.seedFiles.map((seed) => seed.relativePath),
      [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA],
    );
    assert.equal(spec.seedFiles[0]?.content, FIXTURE_SEED_SCHEMA_SQL);
    assert.equal(spec.seedFiles[1]?.content, FIXTURE_SEED_DATA_SQL);
    // Package-relative, not absolute — even though the registry stores
    // realpath'd absolute paths and the temp dir is itself a symlink on
    // macOS (/var -> /private/var). A naive `path.relative(course.dir, ...)`
    // would produce a "../../.." escape here and reject every seed.
    for (const seed of spec.seedFiles) {
      assert.doesNotMatch(seed.relativePath, /\.\./);
      assert.ok(fs.existsSync(seed.absolutePath));
    }
  } finally {
    fixture.cleanup();
  }
});

void test("reset rebuilds even when this course's sandbox is already live", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    await provisioner.ensure(FIXTURE_COURSE_ID);
    await provisioner.reset(FIXTURE_COURSE_ID);

    assert.equal(specs.length, 2);
  } finally {
    fixture.cleanup();
  }
});

void test("switching courses rebuilds, and the previous course stops reporting a live sandbox", async () => {
  const first = createSandboxFixture({ courseId: "course-one" });
  try {
    // Both courses live under one courses directory, so one registry sees
    // both — the way two installed courses really share one sandbox schema.
    const second = createSandboxFixture({ courseId: "course-two" });
    try {
      fs.cpSync(second.packageDir, `${first.coursesDir}/course-two`, { recursive: true });
      const registry = first.registry;
      registry.rescan();
      const { driver, specs } = recordingDriver();
      const provisioner = createSandboxProvisioner({ courses: registry, driver });

      await provisioner.ensure("course-one");
      assert.ok(provisioner.status("course-one"));

      await provisioner.ensure("course-two");

      assert.equal(specs.length, 2);
      assert.equal(specs[1]?.courseId, "course-two");
      assert.equal(
        provisioner.status("course-one"),
        undefined,
        "course-one's seed data was just dropped — claiming its sandbox is ready would be a lie",
      );
      assert.equal(provisioner.status("course-two")?.courseId, "course-two");
      assert.equal(provisioner.status()?.courseId, "course-two");
    } finally {
      second.cleanup();
    }
  } finally {
    first.cleanup();
  }
});

void test("an unknown course, a course without a sandbox, and an unknown sandbox id each say which (error path)", async () => {
  const withSandbox = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: withSandbox.registry, driver });

    const unknownCourse = await provisioner.ensure("no-such-course").catch((err: unknown) => err);
    assert.ok(unknownCourse instanceof SandboxError);
    assert.equal(unknownCourse.kind, "course_not_found");

    const unknownSandbox = await provisioner.ensure(FIXTURE_COURSE_ID, "no-such-sandbox").catch((err: unknown) => err);
    assert.ok(unknownSandbox instanceof SandboxError);
    assert.equal(unknownSandbox.kind, "sandbox_not_found");
    assert.match(unknownSandbox.message, /"no-such-sandbox"/);

    assert.deepEqual(specs, [], "nothing may be rebuilt on a request that could not even be resolved");
  } finally {
    withSandbox.cleanup();
  }

  const withoutSandbox = createSandboxFixture({ courseId: "no-sandbox-course", sandboxIds: [] });
  try {
    const { driver } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: withoutSandbox.registry, driver });

    const err = await provisioner.reset("no-sandbox-course").catch((thrown: unknown) => thrown);

    assert.ok(err instanceof SandboxError);
    assert.equal(err.kind, "sandbox_not_found");
    assert.match(err.message, /does not declare a practice sandbox/);
  } finally {
    withoutSandbox.cleanup();
  }
});

void test("a course declaring several sandboxes requires the caller to say which one (edge case)", async () => {
  const fixture = createSandboxFixture({ sandboxIds: ["main", "reporting"] });
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    const err = await provisioner.ensure(FIXTURE_COURSE_ID).catch((thrown: unknown) => thrown);
    assert.ok(err instanceof SandboxError);
    assert.equal(err.kind, "ambiguous_sandbox");
    assert.match(err.message, /"main"/);
    assert.match(err.message, /"reporting"/);

    // Naming one is enough — and the second sandbox declares no seeds at
    // all, which is a legitimate "give me an empty schema" case.
    const state = await provisioner.ensure(FIXTURE_COURSE_ID, "reporting");
    assert.equal(state.sandboxId, "reporting");
    assert.deepEqual(state.seedFiles, []);
    assert.equal(specs.length, 1);
  } finally {
    fixture.cleanup();
  }
});

void test("a seed file deleted after the scan is reported before anything is dropped (error path)", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });
    // The registry still believes this file exists — it was validated at
    // scan time and nothing watches the filesystem since.
    fs.rmSync(fixtureFilePath(fixture, FIXTURE_SEED_DATA));

    const err = await provisioner.reset(FIXTURE_COURSE_ID).catch((thrown: unknown) => thrown);

    assert.ok(err instanceof SandboxError);
    assert.equal(err.kind, "seed_unreadable");
    assert.equal(err.seedFile, FIXTURE_SEED_DATA);
    assert.match(err.message, /rescan/i);
    assert.deepEqual(specs, [], "the sandbox must not be wiped for a rebuild that cannot complete");
    assert.equal(provisioner.status(), undefined);
  } finally {
    fixture.cleanup();
  }
});

void test("a failed rebuild leaves nothing claiming to be live, and the next ensure retries it", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver({ failOnce: new Error("simulated seed failure") });
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    await assert.rejects(provisioner.ensure(FIXTURE_COURSE_ID), /simulated seed failure/);
    assert.equal(provisioner.status(), undefined, "a half-wiped sandbox is not a live one");

    const state = await provisioner.ensure(FIXTURE_COURSE_ID);

    assert.equal(specs.length, 2, "the failed attempt must not be remembered as success");
    assert.equal(state.courseId, FIXTURE_COURSE_ID);
    assert.ok(provisioner.status(FIXTURE_COURSE_ID));
  } finally {
    fixture.cleanup();
  }
});

void test("concurrent ensure calls serialize: the sandbox is rebuilt once, not raced (edge case)", async () => {
  const fixture = createSandboxFixture();
  try {
    let releaseProvision: (() => void) | undefined;
    const firstProvisionStarted = new Promise<void>((resolve) => {
      releaseProvision = resolve;
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const { driver, specs } = recordingDriver({
      onProvision: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Hold the first rebuild open long enough that the second call
        // would overlap it if the provisioner didn't serialize.
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        releaseProvision?.();
      },
    });
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    const [a, b] = await Promise.all([
      provisioner.ensure(FIXTURE_COURSE_ID),
      provisioner.ensure(FIXTURE_COURSE_ID),
    ]);
    await firstProvisionStarted;

    assert.equal(maxInFlight, 1, "two rebuilds must never run against the same schema at once");
    assert.equal(specs.length, 1, "the second caller must see the first caller's freshly built sandbox");
    assert.deepEqual(a, b);
  } finally {
    fixture.cleanup();
  }
});

void test("a rejected operation does not poison the queue for the next caller (error path)", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    const failed = provisioner.ensure("no-such-course");
    const succeeded = provisioner.ensure(FIXTURE_COURSE_ID);

    await assert.rejects(failed);
    assert.equal((await succeeded).courseId, FIXTURE_COURSE_ID);
    assert.equal(specs.length, 1);
  } finally {
    fixture.cleanup();
  }
});

void test("close() closes the driver", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, closeCalls } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, driver });

    await provisioner.close();

    assert.equal(closeCalls(), 1);
  } finally {
    fixture.cleanup();
  }
});
```

### services/backend/src/sandbox/provisioner.ts

```
// Everything course-shaped about the sandbox: which sandbox a course
// declares, whether its seed files are still where the scan said they were,
// and which course's sandbox is live right now. The driver below it
// (postgres-sandbox.ts) sees none of this — it gets a resolved `SandboxSpec`
// and nothing else.
//
// One live sandbox at a time, deliberately. The physical sandbox is a single
// schema in a single Postgres instance (docs/product/technical-solutions.md:
// "не отдельный сервис/контейнер: отдельная схема/роль внутри того же
// Postgres-инстанса"), so "course B's sandbox" and "course A's sandbox" are
// the same schema with different contents. Making that a visible, single
// slot of state — rather than pretending each course has its own — is what
// keeps `ensure()` honest: switching courses rebuilds, staying on one
// course doesn't.
//
// The state lives in memory only. After a restart nothing is known to be
// live, so the next `ensure()` rebuilds from seed — which is the correct
// answer for a sandbox by definition (its contents are disposable; the
// user's progress lives in `core`, under the application role, and is never
// touched here).

import fs from "node:fs";
import path from "node:path";

import type { CourseRegistry } from "../courses/registry.js";
import type { Course, CourseSandbox } from "../courses/types.js";
import { describeError } from "../courses/fsErrors.js";
import { resolveSafePath } from "../courses/validate.js";
import {
  SandboxError,
  type SandboxDriver,
  type SandboxProvisioner,
  type SandboxSeedFile,
  type SandboxSpec,
  type SandboxState,
} from "./types.js";

export interface CreateSandboxProvisionerOptions<TDriver extends SandboxDriver> {
  /** The same registry `fastify.courses` serves from — the sandbox must
   * never build a second view of what's installed. */
  readonly courses: CourseRegistry;
  readonly driver: TDriver;
  /** Injectable clock, so tests can assert on `readyAt` without sleeping. */
  readonly now?: () => Date;
}

export function createSandboxProvisioner<TDriver extends SandboxDriver>(
  options: CreateSandboxProvisionerOptions<TDriver>,
): SandboxProvisioner<TDriver> {
  const { courses, driver } = options;
  const now = options.now ?? (() => new Date());

  let state: SandboxState | undefined;

  // Provisioning is not re-entrant: two concurrent rebuilds would race over
  // the same schema (the second `drop schema ... cascade` blocking on the
  // first's locks until the sandbox role's 30s statement_timeout kills it),
  // and — worse — a `reset` interleaved with an `ensure` could leave `state`
  // describing a course whose seeds were then dropped by the other call.
  // Every state-changing operation goes through this queue, so they happen
  // one after another in call order. In-process serialization is sufficient
  // by construction: the product is a single local backend process.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    // `.then(op, op)` — a failed operation must not poison the queue for the
    // next caller (a broken seed is a normal outcome here, not a fatal one).
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  async function provisionNow(courseId: string, sandboxId: string | undefined): Promise<SandboxState> {
    const spec = resolveSpec(courses, courseId, sandboxId);
    // Cleared BEFORE the rebuild, not after: from here until the driver
    // reports success, what is actually in the sandbox is unknown (the
    // driver is mid-wipe). If the rebuild fails, "nothing is live" is the
    // truthful answer and the next `ensure()` will try again from scratch —
    // whereas leaving the old state would claim a course's seed data is
    // there when it may have just been dropped.
    state = undefined;
    await driver.provision(spec);
    state = {
      courseId: spec.courseId,
      sandboxId: spec.sandboxId,
      type: spec.type,
      seedFiles: spec.seedFiles.map((seed) => seed.relativePath),
      readyAt: now().toISOString(),
    };
    return state;
  }

  return {
    driver,

    ensure(courseId: string, sandboxId?: string): Promise<SandboxState> {
      return serialize(async () => {
        // Resolved even on the fast path: a caller naming a course that
        // isn't installed, or a sandbox the course doesn't declare, must get
        // the same error whether or not something else is live.
        const target = resolveSandbox(courses, courseId, sandboxId);
        if (state !== undefined && state.courseId === courseId && state.sandboxId === target.sandbox.id) {
          return state;
        }
        return await provisionNow(courseId, target.sandbox.id);
      });
    },

    reset(courseId: string, sandboxId?: string): Promise<SandboxState> {
      return serialize(() => provisionNow(courseId, sandboxId));
    },

    status(courseId?: string): SandboxState | undefined {
      if (state === undefined) {
        return undefined;
      }
      if (courseId !== undefined && state.courseId !== courseId) {
        return undefined;
      }
      return state;
    },

    close(): Promise<void> {
      return driver.close();
    },
  };
}

interface ResolvedSandbox {
  readonly course: Course;
  readonly sandbox: CourseSandbox;
}

/** Finds the course and the sandbox within it, or explains precisely which
 * of the two was the problem. No filesystem access — `ensure()`'s fast path
 * calls this on every request. */
function resolveSandbox(courses: CourseRegistry, courseId: string, sandboxId: string | undefined): ResolvedSandbox {
  const course = courses.get(courseId);
  if (course === undefined) {
    throw new SandboxError("course_not_found", `Course "${courseId}" was not found.`);
  }
  if (course.sandboxes.length === 0) {
    throw new SandboxError(
      "sandbox_not_found",
      `Course "${courseId}" does not declare a practice sandbox, so there is nothing to prepare or reset.`,
    );
  }
  if (sandboxId === undefined) {
    const [only] = course.sandboxes;
    if (course.sandboxes.length > 1 || only === undefined) {
      throw new SandboxError(
        "ambiguous_sandbox",
        `Course "${courseId}" declares several sandboxes (${course.sandboxes.map((s) => `"${s.id}"`).join(", ")}) ` +
          "— say which one to use.",
      );
    }
    return { course, sandbox: only };
  }
  const sandbox = course.sandboxes.find((candidate) => candidate.id === sandboxId);
  if (sandbox === undefined) {
    throw new SandboxError(
      "sandbox_not_found",
      `Course "${courseId}" does not declare a sandbox with id "${sandboxId}".`,
    );
  }
  return { course, sandbox };
}

/**
 * Turns "course X's sandbox Y" into the fully resolved, already-read
 * `SandboxSpec` the driver runs.
 *
 * Seed paths are re-validated here even though courses/validate.ts already
 * checked them at scan time: a scan can be arbitrarily old (there is no
 * filesystem watcher — rescanning is explicit), so between then and now a
 * seed file may have been deleted, replaced by a directory, or swapped for a
 * symlink pointing outside the package. task-006's report asks the executing
 * task to re-run `resolveSafePath` immediately before use for exactly this
 * reason; this is that call.
 */
function resolveSpec(courses: CourseRegistry, courseId: string, sandboxId: string | undefined): SandboxSpec {
  const { course, sandbox } = resolveSandbox(courses, courseId, sandboxId);
  const packageDir = course.dir;
  // `CourseSandbox.seed` holds absolute, realpath'd paths while `course.dir`
  // is the path as written under coursesDir — on macOS those differ for any
  // course under a symlinked directory (`/var/...` vs `/private/var/...`),
  // so the package-relative form is computed against the realpath of the
  // package directory, not against `course.dir` itself. Without this, every
  // relative path would come out as a `../../..` escape and every seed would
  // be rejected as "resolves outside the package directory".
  let realPackageDir: string;
  try {
    realPackageDir = fs.realpathSync(packageDir);
  } catch (err) {
    throw new SandboxError(
      "seed_unreadable",
      `The package directory of course "${courseId}" ("${packageDir}") could not be read: ${describeError(err)}.`,
      { cause: err },
    );
  }

  const seedFiles: SandboxSeedFile[] = sandbox.seed.map((absoluteSeedPath) => {
    const relativePath = path.relative(realPackageDir, absoluteSeedPath);
    const resolved = resolveSafePath(packageDir, relativePath);
    if (!resolved.ok) {
      throw new SandboxError(
        "seed_unreadable",
        `Seed file "${relativePath}" of course "${courseId}" is no longer usable: ${resolved.reason} ` +
          "Re-scan the courses folder (POST /courses/rescan) after fixing the package.",
        { seedFile: relativePath },
      );
    }
    let content: string;
    try {
      content = fs.readFileSync(resolved.absolutePath, "utf8");
    } catch (err) {
      throw new SandboxError(
        "seed_unreadable",
        `Seed file "${relativePath}" of course "${courseId}" could not be read: ${describeError(err)}.`,
        { seedFile: relativePath, cause: err },
      );
    }
    return { relativePath, absolutePath: resolved.absolutePath, content };
  });

  return { courseId: course.id, sandboxId: sandbox.id, type: sandbox.type, seedFiles };
}

// Makes `fastify.sandbox` (decorated in server.ts) visible to every route
// file, the same way db/pool.ts declares `fastify.db`. It is typed with the
// concrete Postgres driver because that is what the server actually wires
// today and because task 009 reaches through `.driver` to run SQL; when a
// second driver appears, this becomes a union (or the routes that need a
// specific driver narrow on `driver.type`) — the provisioner itself, and
// everything that only calls ensure/reset/status, needs no change either
// way.
declare module "fastify" {
  interface FastifyInstance {
    sandbox: SandboxProvisioner<import("./postgres-sandbox.js").PostgresSandboxDriver>;
  }
}
```

### services/backend/src/sandbox/testSupport.ts

```
// Test-only helpers for the sandbox layer, shared by
// sandbox/postgres-sandbox.test.ts, sandbox/provisioner.test.ts and
// routes/sandbox.test.ts. Kept out of the production build exactly like
// courses/testSupport.ts, db/testSupport.ts and progress/testSupport.ts —
// see tsconfig.json's `exclude`.
//
// The recording pool below is what lets the REAL Postgres driver be tested
// without a Postgres: the driver's whole contract is "which statements, in
// which order, inside which transaction", and that is exactly what this
// records. (The driver against a live database under the sandbox role is
// verified manually — see the task-008 report: neither CI nor
// .mvp/ci-mirror.sh hands the test run a SANDBOX_DATABASE_URL today, and
// wiring one up is outside this task's service boundary.)
//
// Every fixture here is synthetic — no real course's ids, titles or SQL.

import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import { createCourseRegistry, type CourseRegistry } from "../courses/registry.js";
import { makeTempDir, writeCoursePackage, type FixtureFile } from "../courses/testSupport.js";
import type { AppPool } from "../db/pool.js";

export interface RecordingPool {
  readonly pool: AppPool;
  /** Every statement the driver issued, in order, including the `BEGIN` /
   * `COMMIT` / `ROLLBACK` this fake emits itself (the real
   * `AppPool#withTransaction` issues them, so a fake that skipped them would
   * hide whether the rebuild is actually transactional). */
  readonly statements: string[];
  /** How many times the pool was asked for a client — `connect()` and
   * `withTransaction()` both count, since both check one out. */
  clientsCheckedOut(): number;
  /** Clients handed out and not yet released — must be 0 after every
   * operation, or the driver leaks pool connections. */
  clientsOpen(): number;
  endCalls(): number;
}

export interface CreateRecordingPoolOptions {
  /** Returns an error to throw instead of executing `sql`, or `undefined` to
   * let it "succeed". This is how a test simulates Postgres rejecting one
   * specific statement (a broken seed, a permission error on DROP SCHEMA). */
  readonly failOn?: (sql: string) => Error | undefined;
  /** Throws instead of ever handing out a client — simulates Postgres being
   * unreachable, including db/pool.ts's own wrapping of connect errors. */
  readonly failToConnect?: () => Error;
  /** Rows `query()` resolves with; the driver only cares that it resolved. */
  readonly rows?: readonly Record<string, unknown>[];
}

/**
 * An `AppPool` that records instead of connecting. `withTransaction`
 * reproduces db/pool.ts's real behaviour — BEGIN, the callback,
 * COMMIT-or-ROLLBACK, release in `finally` — so a test can assert that a
 * failed seed really did roll the rebuild back.
 */
export function createRecordingPool(options: CreateRecordingPoolOptions = {}): RecordingPool {
  const statements: string[] = [];
  let checkedOut = 0;
  let open = 0;
  let ended = 0;

  const run = async (sql: string): Promise<{ rows: readonly Record<string, unknown>[] }> => {
    statements.push(sql);
    const failure = options.failOn?.(sql);
    if (failure !== undefined) {
      throw failure;
    }
    return { rows: options.rows ?? [] };
  };

  const checkOutClient = (): PoolClient => {
    if (options.failToConnect !== undefined) {
      throw options.failToConnect();
    }
    checkedOut += 1;
    open += 1;
    let released = false;
    return {
      query: (text: string) => run(text),
      release: () => {
        if (released) {
          throw new Error("recording pool: the same client was released twice");
        }
        released = true;
        open -= 1;
      },
    } as unknown as PoolClient;
  };

  const pool: AppPool = {
    query: ((text: string) => run(text)) as unknown as AppPool["query"],
    connect: (async () => checkOutClient()) as unknown as AppPool["connect"],
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = checkOutClient();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Same rule as the real pool: a failing ROLLBACK must not replace
          // the error the caller actually needs to see.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async end(): Promise<void> {
      ended += 1;
    },
  };

  return {
    pool,
    statements,
    clientsCheckedOut: () => checkedOut,
    clientsOpen: () => open,
    endCalls: () => ended,
  };
}

export const FIXTURE_COURSE_ID = "sandbox-fixture";
export const FIXTURE_SANDBOX_ID = "main";
export const FIXTURE_SEED_SCHEMA = "sandbox/01-schema.sql";
export const FIXTURE_SEED_DATA = "sandbox/02-data.sql";
export const FIXTURE_SEED_SCHEMA_SQL = "create table widgets (id int primary key, label text);";
export const FIXTURE_SEED_DATA_SQL = "insert into widgets (id, label) values (1, 'first'), (2, 'second');";

export interface SandboxFixtureOptions {
  readonly courseId?: string;
  /** Declared sandbox ids, in manifest order. More than one is how the
   * "which sandbox did you mean?" path gets exercised. */
  readonly sandboxIds?: readonly string[];
  /** Package-relative seed paths for the FIRST sandbox, in the order they
   * must be applied. */
  readonly seedPaths?: readonly string[];
}

export interface SandboxFixture {
  readonly coursesDir: string;
  readonly packageDir: string;
  readonly registry: CourseRegistry;
  /** Removes the temp tree — call it in a `finally`. */
  cleanup(): void;
}

/**
 * Writes a synthetic course package declaring one (or several) postgres
 * sandboxes with real seed files on disk, and returns a live registry over
 * it — the same registry type `fastify.courses` serves from, so the
 * provisioner under test resolves seeds exactly the way it does in
 * production.
 */
export function createSandboxFixture(options: SandboxFixtureOptions = {}): SandboxFixture {
  const courseId = options.courseId ?? FIXTURE_COURSE_ID;
  const sandboxIds = options.sandboxIds ?? [FIXTURE_SANDBOX_ID];
  const seedPaths = options.seedPaths ?? [FIXTURE_SEED_SCHEMA, FIXTURE_SEED_DATA];
  const coursesDir = makeTempDir("trellis-sandbox-");

  const lines: string[] = [
    `id: ${courseId}`,
    "version: 1.0.0",
    "title: Sandbox fixture course",
  ];
  if (sandboxIds.length > 0) {
    lines.push("sandboxes:");
    for (const [index, sandboxId] of sandboxIds.entries()) {
      lines.push(`  - id: ${sandboxId}`, "    type: postgres");
      // Only the first sandbox carries seeds: a sandbox with none is a valid
      // manifest and a useful case in its own right (rebuild an empty
      // schema).
      const paths = index === 0 ? seedPaths : [];
      if (paths.length > 0) {
        lines.push("    seed:");
        for (const seedPath of paths) {
          lines.push(`      - ${seedPath}`);
        }
      }
    }
  }
  lines.push("modules:", "  - id: only-module", "    title: Only module", "    lessons:");
  const firstSandboxId = sandboxIds[0];
  if (firstSandboxId === undefined) {
    // A course that declares no sandbox can't have a practice lesson either
    // — `practice.sandbox` must reference a declared sandbox or the whole
    // package is rejected at validation (courses/validate.ts). A quiz lesson
    // keeps the fixture valid for the "this course has no sandbox at all"
    // case.
    lines.push(
      "      - id: quiz-lesson",
      "        title: Quiz lesson",
      "        quiz:",
      '          question: "Which one?"',
      "          options:",
      "            - id: a",
      '              text: "This one"',
      "              correct: true",
      "            - id: b",
      '              text: "Not this one"',
      "              explanation: It is not this one.",
    );
  } else {
    lines.push(
      "      - id: practice-lesson",
      "        title: Practice lesson",
      "        practice:",
      `          sandbox: ${firstSandboxId}`,
      "          prompt: Do the thing.",
    );
  }
  lines.push("");

  const files: FixtureFile[] = seedPaths.map((seedPath) => ({
    path: seedPath,
    content: seedPath === FIXTURE_SEED_DATA ? FIXTURE_SEED_DATA_SQL : FIXTURE_SEED_SCHEMA_SQL,
  }));
  const packageDir = writeCoursePackage(coursesDir, courseId, lines.join("\n"), files);

  return {
    coursesDir,
    packageDir,
    registry: createCourseRegistry(coursesDir),
    cleanup: () => fs.rmSync(coursesDir, { recursive: true, force: true }),
  };
}

/** Absolute path of one of the fixture's files, for tests that delete or
 * rewrite a seed behind the registry's back. */
export function fixtureFilePath(fixture: SandboxFixture, relativePath: string): string {
  return path.join(fixture.packageDir, relativePath);
}
```

### services/backend/src/sandbox/types.ts

```
// The practice sandbox as an INTERFACE, with Postgres as one implementation
// (project invariant: "песочница практики — интерфейс с реализациями;
// Postgres — лишь одна из них"). Nothing in this file mentions SQL, pools,
// schemas or `pg`: a second sandbox type (a filesystem workspace, a
// container, ...) implements `SandboxDriver` and everything above it —
// provisioner.ts, routes/sandbox.ts, task 009's practice runner — keeps
// working unchanged.
//
// The split of responsibilities the interface encodes:
//   - the PROVISIONER (provisioner.ts) owns everything course-shaped:
//     finding the declared sandbox, re-validating its seed paths against the
//     package directory, reading them, remembering which course's sandbox is
//     currently live;
//   - the DRIVER (postgres-sandbox.ts) owns everything backend-shaped:
//     wiping whatever the previous course left behind and applying the seed
//     material it is handed. A driver never touches the filesystem and never
//     looks at a `Course` — it receives a fully resolved `SandboxSpec`.

/** The sandbox kinds this core knows how to run. Mirrors the manifest's
 * `sandboxes[].type` enum (courses/manifest.schema.json) — widening one
 * means widening the other. */
export type SandboxType = "postgres";

/** One seed unit, already read off disk by the provisioner. `content` is
 * raw text handed to the driver as-is (for the Postgres driver: SQL). */
export interface SandboxSeedFile {
  /** Path relative to the course package directory, exactly as a course
   * author would recognize it (`sandbox/01-schema.sql`). This is what goes
   * into API responses and error messages — never the absolute host path,
   * which is an implementation detail of where courses happen to be
   * mounted. */
  readonly relativePath: string;
  /** Absolute, re-validated path the content was actually read from. Kept
   * for logs/diagnostics, not for display. */
  readonly absolutePath: string;
  readonly content: string;
}

/** Everything a driver needs to (re)build one course's sandbox, with no
 * course/filesystem knowledge left in it. */
export interface SandboxSpec {
  readonly courseId: string;
  readonly sandboxId: string;
  readonly type: SandboxType;
  /** In manifest order — seeds are applied in the order the course declares
   * them (`01-schema.sql` before `02-data.sql`), never sorted or
   * parallelized. */
  readonly seedFiles: readonly SandboxSeedFile[];
}

/** Which course's sandbox is live right now, and since when. */
export interface SandboxState {
  readonly courseId: string;
  readonly sandboxId: string;
  readonly type: SandboxType;
  /** Package-relative paths of the seeds that were applied, in order. */
  readonly seedFiles: readonly string[];
  /** ISO-8601, the same string shape progress timestamps use. */
  readonly readyAt: string;
}

export interface SandboxDriver {
  readonly type: SandboxType;
  /**
   * Discards everything currently in the sandbox and rebuilds it from
   * `spec.seedFiles`. Implementations must be all-or-nothing: on failure
   * the sandbox is left in a state the next `provision` can recover from,
   * and the error explains which seed failed and what the backend said —
   * a broken seed is course-content breakage, reported verbatim, never
   * swallowed into a generic "sandbox error".
   *
   * Always a full rebuild: there is no incremental/"only if changed" path
   * on purpose. "Сбросить песочницу" and "prepare this course's sandbox"
   * are the same operation, so a reset can never drift from a first-time
   * provision.
   */
  provision(spec: SandboxSpec): Promise<void>;
  /** Releases the driver's own resources (connections, handles). Closing a
   * driver built over an injected resource must not close that resource —
   * ownership rules follow db/pool.ts's `AppPool#end`. */
  close(): Promise<void>;
}

/**
 * The single entry point everything above the sandbox uses: routes, and
 * task 009's practice runner (`await fastify.sandbox.ensure(courseId,
 * sandboxId)` before running user SQL). Generic in its driver so a caller
 * that legitimately needs implementation-specific operations — 009 needs to
 * execute SQL, which only a Postgres sandbox can do — reaches them through
 * `driver` with full typing, while everything written against the plain
 * `SandboxProvisioner` stays implementation-agnostic.
 */
export interface SandboxProvisioner<TDriver extends SandboxDriver = SandboxDriver> {
  readonly driver: TDriver;
  /**
   * Makes this course's sandbox live, doing nothing if it already is. This
   * is the "подключение курса" path: the first practice run of a course
   * pays for the seed, later runs don't (and must not — a reset on every
   * query would wipe the user's own tables mid-lesson).
   */
  ensure(courseId: string, sandboxId?: string): Promise<SandboxState>;
  /** "Сбросить песочницу": rebuild unconditionally, even if this course's
   * sandbox is already live. */
  reset(courseId: string, sandboxId?: string): Promise<SandboxState>;
  /**
   * The live sandbox, or `undefined` if none is. With `courseId`, answers
   * "is THIS course's sandbox live" — a different course's live sandbox
   * reads as `undefined`, because from that course's point of view its own
   * sandbox has not been prepared.
   */
  status(courseId?: string): SandboxState | undefined;
  close(): Promise<void>;
}

/**
 * Why a sandbox operation could not be carried out. Deliberately split fine
 * enough for routes/sandbox.ts to answer with an honest HTTP status without
 * re-deriving anything from message text:
 *   - `course_not_found`   — no such course is installed (404)
 *   - `sandbox_not_found`  — the course declares no such sandbox (404)
 *   - `ambiguous_sandbox`  — the course declares several and the caller
 *                            didn't say which (400)
 *   - `seed_unreadable`    — a declared seed file is gone, unreadable, or
 *                            no longer resolves inside the package (422)
 *   - `seed_failed`        — the backend rejected a seed (422)
 *   - `unavailable`        — the sandbox backend itself is unreachable or
 *                            not configured (503)
 */
export type SandboxErrorKind =
  | "course_not_found"
  | "sandbox_not_found"
  | "ambiguous_sandbox"
  | "seed_unreadable"
  | "seed_failed"
  | "unavailable";

export interface SandboxErrorDetails {
  /** Package-relative path of the seed involved, for `seed_*` kinds. */
  readonly seedFile?: string;
  /** The backend's own error text, passed through verbatim (a Postgres
   * message with its `LINE n:` context, say). The product rule for practice
   * — "результат или ошибка Postgres показываются как есть" — applies to a
   * course's seed SQL too: a course author fixing a broken seed needs the
   * database's own words, not a paraphrase. */
  readonly databaseError?: string;
  readonly cause?: unknown;
}

/** The one error type the sandbox layer throws. Anything else escaping a
 * driver is a bug in that driver. */
export class SandboxError extends Error {
  readonly kind: SandboxErrorKind;
  readonly seedFile?: string;
  readonly databaseError?: string;

  constructor(kind: SandboxErrorKind, message: string, details: SandboxErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "SandboxError";
    this.kind = kind;
    this.seedFile = details.seedFile;
    this.databaseError = details.databaseError;
  }
}

export function isSandboxError(err: unknown): err is SandboxError {
  return err instanceof SandboxError;
}
```

### services/backend/src/server.test.ts

```
// buildServer's own option-precedence logic (warn-and-ignore when two ways
// of configuring the same thing are given at once) — not covered by the
// route test suites, which only ever pass one of each pair. See
// server.ts's `!ownsSandbox && options.sandboxDatabaseUrl !== undefined`
// branch (task-008 fix round: flagged as reachable but untested).

import assert from "node:assert/strict";
import test from "node:test";

import type { AppPool } from "./db/pool.js";
import { createPostgresSandboxDriverFromPool } from "./sandbox/postgres-sandbox.js";
import { createSandboxProvisioner } from "./sandbox/provisioner.js";
import { createRecordingPool, createSandboxFixture, FIXTURE_COURSE_ID } from "./sandbox/testSupport.js";
import { buildServer } from "./server.js";

/** The core db pool this test's server needs to satisfy `buildServer`'s
 * pool/databaseUrl requirement — never actually queried, since nothing here
 * touches `core`. */
const unusedCorePool = (): AppPool =>
  ({
    query: () => {
      throw new Error("this test's core pool must never be queried");
    },
    connect: () => {
      throw new Error("this test's core pool must never be queried");
    },
    withTransaction: () => {
      throw new Error("this test's core pool must never be queried");
    },
    end: async () => {},
  }) as unknown as AppPool;

void test(
  "buildServer given both `sandbox` and `sandboxDatabaseUrl` keeps the injected `sandbox` and never touches the URL (edge case)",
  async () => {
    const fixture = createSandboxFixture();
    const recording = createRecordingPool();
    const injectedSandbox = createSandboxProvisioner({
      courses: fixture.registry,
      driver: createPostgresSandboxDriverFromPool(recording.pool),
    });

    const app = buildServer({
      pool: unusedCorePool(),
      registry: fixture.registry,
      logger: false,
      sandbox: injectedSandbox,
      // Deliberately bogus and unreachable: if this branch ever regressed
      // into building a real driver from the URL instead of keeping
      // `sandbox`, the reset below would try to connect here and fail,
      // rather than running against `recording`.
      sandboxDatabaseUrl: "postgres://ignored-because-sandbox-wins/db",
    });
    try {
      // Identity, not just similar behaviour: the decorator must literally
      // be the object passed in, proving `sandboxDatabaseUrl` was never
      // used to construct a competing provisioner.
      assert.equal(app.sandbox, injectedSandbox);

      const response = await app.inject({
        method: "POST",
        url: `/courses/${FIXTURE_COURSE_ID}/sandbox/reset`,
      });

      assert.equal(response.statusCode, 200);
      // Proof the request actually ran against `injectedSandbox`'s
      // recording pool, not some other driver built from the bogus URL.
      assert.ok(recording.statements.includes("COMMIT"), recording.statements.join(" | "));
    } finally {
      await app.close();
      fixture.cleanup();
    }
  },
);
```

