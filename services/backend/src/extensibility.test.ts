// Can a THIRD mechanic be added without touching the core?
//
// The project invariant says a sandbox type or a practice mechanic exists
// only if it is registered in capabilities.ts, and the promise attached to
// it is that registering one is an addition, not an edit: a new module,
// plus its entry. These tests are that promise, executable — they add a
// sandbox driver and a practice strategy the shipped build has never heard
// of, and assert the engine runs them.
//
// What "no core changes" means concretely, and what would break if it
// stopped being true:
//   - sandbox/provisioner.ts dispatches on the type the COURSE declares.
//     If it ever special-cased "postgres", the stub driver below would
//     never be called;
//   - plugins/practice/index.ts loops over the strategy registry and names
//     no type. If it ever registered handlers itself, the stub strategy
//     below would have no route.
//
// The `as SandboxType` / `as CoursePracticeType` casts are the whole point
// of the exercise, not a workaround: those unions are closed BY DESIGN
// (capabilities.ts is where a kind comes into existence), so a test for
// "what happens when a kind is added" has to stand in for that entry.
// Adding `code` or `file` for real means one line in capabilities.ts
// instead of the cast — and nothing else in this file's list above.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import type { CoursePracticeType } from "./capabilities/index.js";
import { createCourseRegistry } from "./courses/registry/index.js";
import { makeTempDir, writeCoursePackage } from "./courses/test-support.js";
import {
  createInMemoryProgressRepository,
  poolThatMustNotBeUsed,
  progressFixtureFiles,
  progressFixtureManifestYaml,
} from "./progress/test-support.js";
import { createSandboxProvisioner } from "./sandbox/provisioner/index.js";
import { SandboxError, type SandboxDriver, type SandboxSpec, type SandboxType } from "./sandbox/types.js";
import { practiceStrategies, type PracticeStrategy } from "./plugins/practice/index.js";
import { buildServer } from "./server/index.js";

/** A sandbox kind that does not exist yet — see the header. */
const FUTURE_SANDBOX_TYPE = "memory" as SandboxType;
/** A practice mechanic that does not exist yet. */
const FUTURE_PRACTICE_TYPE = "file" as CoursePracticeType;

/** The entire "new driver module" a future sandbox kind would need: it
 * declares its own type and knows how to rebuild itself. Nothing about it
 * is Postgres-shaped, and nothing above it is told what it is. */
function createStubSandboxDriver(): { driver: SandboxDriver; specs: SandboxSpec[]; closed: () => number } {
  const specs: SandboxSpec[] = [];
  let closes = 0;
  return {
    driver: {
      type: FUTURE_SANDBOX_TYPE,
      async provision(spec: SandboxSpec) {
        specs.push(spec);
      },
      async close() {
        closes += 1;
      },
    },
    specs,
    closed: () => closes,
  };
}

/** A course declaring a sandbox of the future kind. Hand-built rather than
 * loaded from YAML: the manifest schema legitimately rejects an unknown
 * type (that is requirement 3's job), and what is under test here is the
 * layer BELOW validation. */
function registryWithFutureSandbox(dir: string) {
  return {
    get: (courseId: string) =>
      courseId === "future-course"
        ? {
            id: "future-course",
            version: "1.0.0",
            title: "Course on a future sandbox",
            // A real directory: the provisioner resolves the package path
            // before it looks at the type, the same for every kind.
            dir,
            sandboxes: [{ id: "main", type: FUTURE_SANDBOX_TYPE, seed: [] }],
            modules: [{ id: "m", title: "M", lessons: [{ id: "l", title: "L", content: "# L" }] }],
          }
        : undefined,
    list: () => [],
    listRejected: () => [],
    rescan: () => ({ accepted: 0, rejected: 0, scanFailed: false }),
  } as unknown as Parameters<typeof createSandboxProvisioner>[0]["courses"];
}

void test("a sandbox driver for an unregistered-in-code type runs without provisioner changes", async () => {
  const dir = makeTempDir("trellis-future-sandbox-");
  try {
    const stub = createStubSandboxDriver();
    const provisioner = createSandboxProvisioner({ courses: registryWithFutureSandbox(dir), drivers: [stub.driver] });

    const state = await provisioner.withFreshSandbox("future-course", "main", async ({ state: ready }) => ready);

    // The provisioner picked the driver by the type the COURSE declared and
    // handed it a fully resolved spec — exactly what it does for Postgres.
    assert.equal(state.type, FUTURE_SANDBOX_TYPE);
    assert.equal(state.courseId, "future-course");
    assert.equal(stub.specs.length, 1);
    assert.equal(stub.specs[0]?.type, FUTURE_SANDBOX_TYPE);
    // And everything above the driver keeps working unchanged.
    assert.deepEqual(provisioner.status("future-course"), state);
    assert.deepEqual(provisioner.drivers.types, [FUTURE_SANDBOX_TYPE]);

    await provisioner.close();
    assert.equal(stub.closed(), 1, "every registered driver is released, not just a hardcoded one");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("a course whose sandbox type has no registered driver fails as unavailable, not as broken content", async () => {
  // The manifest was valid — this build simply cannot run it. That is a
  // 503-shaped answer (`unavailable`), never a course-content error, and
  // the message names what IS registered so the operator can act.
  const dir = makeTempDir("trellis-future-sandbox-");
  const provisioner = createSandboxProvisioner({ courses: registryWithFutureSandbox(dir), drivers: [] });

  try {
    await assert.rejects(
      () => provisioner.withFreshSandbox("future-course", "main", async ({ state }) => state),
      (err: unknown) => {
        assert.ok(err instanceof SandboxError);
        assert.equal(err.kind, "unavailable");
        assert.match(err.message, /has no driver for/);
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("two drivers claiming the same sandbox type is refused at wiring time", () => {
  const first = createStubSandboxDriver();
  const second = createStubSandboxDriver();
  assert.throws(
    () => createSandboxProvisioner({ courses: registryWithFutureSandbox("/tmp"), drivers: [first.driver, second.driver] }),
    /two drivers registered for sandbox type/,
  );
});

/** The entire "new strategy module" a future practice mechanic would need.
 * It owns its own endpoint and its own request/response shape — this one
 * just reports that it ran. */
const stubPracticeStrategy: PracticeStrategy = {
  type: FUTURE_PRACTICE_TYPE,
  register(fastify: FastifyInstance) {
    fastify.post("/courses/:courseId/lessons/:lessonId/practice/upload", async () => ({ mechanic: "file" }));
  },
};

void test("a practice strategy for an unregistered-in-code type serves without route changes", async () => {
  const coursesDir = makeTempDir("trellis-extensibility-");
  try {
    writeCoursePackage(coursesDir, "fixture", progressFixtureManifestYaml(), progressFixtureFiles());
    const app = buildServer({
      pool: poolThatMustNotBeUsed(),
      registry: createCourseRegistry(coursesDir),
      progress: createInMemoryProgressRepository([]),
      logger: false,
      // The one line a real `file` mechanic would add to
      // plugins/practice/registry.ts.
      practiceStrategies: [...practiceStrategies(), stubPracticeStrategy],
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/courses/progress-fixture/lessons/any/practice/upload",
        payload: {},
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { mechanic: "file" });

      // The built-in mechanics are still mounted beside it — adding one
      // replaces nothing.
      const builtIn = await app.inject({
        method: "POST",
        url: "/courses/progress-fixture/lessons/nope/practice/run",
        payload: { sql: "select 1" },
      });
      assert.equal(builtIn.statusCode, 404, "the sql strategy is still registered");
      assert.equal(builtIn.json().error, "lesson_not_found");
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
});
