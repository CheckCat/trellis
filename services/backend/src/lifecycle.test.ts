import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { registerShutdown } from "./lifecycle.js";

function fakeApp(close: () => Promise<void>): FastifyInstance {
  return { close, log: { error: () => {} } } as unknown as FastifyInstance;
}

void test("shutdown() closes the app exactly once, even when called multiple times", async () => {
  let closeCalls = 0;
  const app = fakeApp(async () => {
    closeCalls += 1;
  });
  const exits: number[] = [];

  const controller = registerShutdown(app, {
    signals: [],
    installBeforeExit: false,
    exit: (code) => exits.push(code),
  });

  // Concurrent calls (as SIGINT-then-SIGTERM in quick succession would
  // produce) must not re-enter app.close().
  await Promise.all([controller.shutdown(0), controller.shutdown(0)]);
  // A later call (e.g. a startup-error path calling shutdown() after a
  // signal already triggered it) is also a no-op.
  await controller.shutdown(1);

  assert.equal(closeCalls, 1);
  assert.deepEqual(exits, [0]);
});

void test("shutdown() logs and still exits when app.close() rejects (error path)", async () => {
  const errors: unknown[] = [];
  const exits: number[] = [];
  const app = {
    close: async () => {
      throw new Error("close failed");
    },
    log: { error: (obj: unknown) => errors.push(obj) },
  } as unknown as FastifyInstance;

  const controller = registerShutdown(app, {
    signals: [],
    installBeforeExit: false,
    exit: (code) => exits.push(code),
  });

  await controller.shutdown(1);

  assert.equal(errors.length, 1);
  assert.deepEqual(exits, [1]);
});

void test("registerShutdown attaches a listener for each given signal (edge case: real signal wiring)", () => {
  const app = fakeApp(async () => {});
  const before = process.listenerCount("SIGUSR2");
  registerShutdown(app, { signals: ["SIGUSR2"], installBeforeExit: false, exit: () => {} });
  try {
    assert.equal(process.listenerCount("SIGUSR2"), before + 1);
  } finally {
    // Don't leak this test's listener into the rest of the suite/process.
    process.removeAllListeners("SIGUSR2");
  }
});
