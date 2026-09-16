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
