import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../server.ts";

void test("GET /health responds 200 with { status: 'ok' }", async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

void test("GET /health rejects a non-GET method (edge case)", async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: "POST", url: "/health" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

void test("GET /unknown-route responds 404 (error path)", async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/unknown-route" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
