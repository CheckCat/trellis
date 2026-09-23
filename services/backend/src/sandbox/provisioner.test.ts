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
} from "./test-support.js";
import { SandboxError, type SandboxDriver, type SandboxProvisioner, type SandboxSpec } from "./types.js";

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

/** The practice path in miniature: take the sandbox, freshly seeded, and do
 * nothing else with it. Every caller below used to be `ensure()`; the
 * difference the rewrite is about is that this one always re-seeds. */
function seedOnce(provisioner: SandboxProvisioner, courseId: string, sandboxId?: string) {
  return provisioner.withFreshSandbox(courseId, sandboxId, async ({ state }) => state);
}

// Was "ensure provisions once and does nothing on the next call" — the
// opposite claim, and the reason `ensure` no longer exists. A sandbox that
// survived the previous attempt is a sandbox the previous attempt can have
// broken, which made both grading mechanics answerable by the learner's own
// earlier statements.
void test("every attempt gets the sandbox rebuilt from seed, not the one the last attempt left", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver], now: FIXED_CLOCK });

    const first = await seedOnce(provisioner, FIXTURE_COURSE_ID);
    const second = await seedOnce(provisioner, FIXTURE_COURSE_ID);

    assert.equal(specs.length, 2, "state must not carry over between attempts");
    assert.deepEqual(second, first, "and each rebuild must produce the same starting state");
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
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    await seedOnce(provisioner, FIXTURE_COURSE_ID);

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
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    await seedOnce(provisioner, FIXTURE_COURSE_ID);
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
      const provisioner = createSandboxProvisioner({ courses: registry, drivers: [driver] });

      await seedOnce(provisioner, "course-one");
      assert.ok(provisioner.status("course-one"));

      await seedOnce(provisioner, "course-two");

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
    const provisioner = createSandboxProvisioner({ courses: withSandbox.registry, drivers: [driver] });

    const unknownCourse = await seedOnce(provisioner, "no-such-course").catch((err: unknown) => err);
    assert.ok(unknownCourse instanceof SandboxError);
    assert.equal(unknownCourse.kind, "course_not_found");

    const unknownSandbox = await seedOnce(provisioner, FIXTURE_COURSE_ID, "no-such-sandbox").catch((err: unknown) => err);
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
    const provisioner = createSandboxProvisioner({ courses: withoutSandbox.registry, drivers: [driver] });

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
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    const err = await seedOnce(provisioner, FIXTURE_COURSE_ID).catch((thrown: unknown) => thrown);
    assert.ok(err instanceof SandboxError);
    assert.equal(err.kind, "ambiguous_sandbox");
    assert.match(err.message, /"main"/);
    assert.match(err.message, /"reporting"/);

    // Naming one is enough — and the second sandbox declares no seeds at
    // all, which is a legitimate "give me an empty schema" case.
    const state = await seedOnce(provisioner, FIXTURE_COURSE_ID, "reporting");
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
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });
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

void test("a failed rebuild leaves nothing claiming to be live, and the next attempt retries it", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver({ failOnce: new Error("simulated seed failure") });
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    await assert.rejects(seedOnce(provisioner, FIXTURE_COURSE_ID), /simulated seed failure/);
    assert.equal(provisioner.status(), undefined, "a half-wiped sandbox is not a live one");

    const state = await seedOnce(provisioner, FIXTURE_COURSE_ID);

    assert.equal(specs.length, 2, "the failed attempt must not be remembered as success");
    assert.equal(state.courseId, FIXTURE_COURSE_ID);
    assert.ok(provisioner.status(FIXTURE_COURSE_ID));
  } finally {
    fixture.cleanup();
  }
});

void test("concurrent attempts serialize: rebuilds queue up, they never overlap (edge case)", async () => {
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
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    const [a, b] = await Promise.all([
      seedOnce(provisioner, FIXTURE_COURSE_ID),
      seedOnce(provisioner, FIXTURE_COURSE_ID),
    ]);
    await firstProvisionStarted;

    assert.equal(maxInFlight, 1, "two rebuilds must never run against the same schema at once");
    assert.equal(specs.length, 2, "each attempt seeds for itself — the queue orders them, it does not skip one");
    // Everything but the timestamp: two rebuilds are two moments, and that
    // is the only thing about them that may legitimately differ.
    assert.deepEqual({ ...a, readyAt: "" }, { ...b, readyAt: "" });
  } finally {
    fixture.cleanup();
  }
});

void test("a rejected operation does not poison the queue for the next caller (error path)", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    const failed = seedOnce(provisioner, "no-such-course");
    const succeeded = seedOnce(provisioner, FIXTURE_COURSE_ID);

    await assert.rejects(failed);
    assert.equal((await succeeded).courseId, FIXTURE_COURSE_ID);
    assert.equal(specs.length, 1);
  } finally {
    fixture.cleanup();
  }
});

void test("reseed inside the exclusive window rebuilds without waiting on the queue (edge case)", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, specs } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    // Grading by the course's solution needs the seeded state twice inside
    // one attempt. Calling the provisioner's own `reset` there would wait
    // for the queue slot this very call is holding — forever. The handle
    // exists so that cannot be written by accident.
    const seen = await provisioner.withFreshSandbox(FIXTURE_COURSE_ID, undefined, async ({ state, reseed }) => {
      const again = await reseed();
      return [state.readyAt !== undefined, again.courseId];
    });

    assert.deepEqual(seen, [true, FIXTURE_COURSE_ID]);
    assert.equal(specs.length, 2, "reseed must actually rebuild, not hand back the same schema");
  } finally {
    fixture.cleanup();
  }
});

void test("close() closes the driver", async () => {
  const fixture = createSandboxFixture();
  try {
    const { driver, closeCalls } = recordingDriver();
    const provisioner = createSandboxProvisioner({ courses: fixture.registry, drivers: [driver] });

    await provisioner.close();

    assert.equal(closeCalls(), 1);
  } finally {
    fixture.cleanup();
  }
});
