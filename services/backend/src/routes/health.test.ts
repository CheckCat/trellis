import assert from "node:assert/strict";
import test from "node:test";

import type { AppPool } from "../db/pool.js";
import { buildServer } from "../server.js";

/**
 * A fake `AppPool` whose `query()` is fully controlled by the test — no
 * real Postgres involved. `/health` only ever calls `query()`, so
 * `connect`/`withTransaction` deliberately throw if exercised: that would
 * mean the route started depending on something this fake doesn't model.
 */
function fakePool(query: () => Promise<unknown>): AppPool {
  return {
    query: (async () => query()) as unknown as AppPool["query"],
    connect: (() => {
      throw new Error("fakePool.connect is not implemented — /health only uses query()");
    }) as unknown as AppPool["connect"],
    withTransaction: (() => {
      throw new Error("fakePool.withTransaction is not implemented — /health only uses query()");
    }) as unknown as AppPool["withTransaction"],
    end: async () => {},
  };
}

void test("GET /health responds 200 with { status: 'ok', db: 'ok' } when the db is reachable", async () => {
  const app = buildServer({ pool: fakePool(async () => ({ rows: [{ "?column?": 1 }] })), logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", db: "ok" });
  } finally {
    await app.close();
  }
});

void test("GET /health responds 503 with { status: 'degraded', db: 'down' } when the db check fails (error path)", async () => {
  const app = buildServer({
    pool: fakePool(async () => {
      throw new Error("simulated db outage");
    }),
    // Silenced: this test intentionally simulates a db outage, whose full
    // stack trace would otherwise get logged by /health's own error
    // handler and read like a real failure in `npm test` output (final
    // review, backend fixes round).
    logger: false,
  });
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: "degraded", db: "down" });
  } finally {
    await app.close();
  }
});

void test("GET /health rejects a non-GET method (edge case)", async () => {
  const app = buildServer({ pool: fakePool(async () => ({ rows: [] })), logger: false });
  try {
    const response = await app.inject({ method: "POST", url: "/health" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

void test("GET /unknown-route responds 404 (error path)", async () => {
  const app = buildServer({ pool: fakePool(async () => ({ rows: [] })), logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/unknown-route" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
