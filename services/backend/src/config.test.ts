import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "./config.ts";

const validEnv = {
  DATABASE_URL: "postgres://trellis_app:pw@localhost:5432/trellis",
  SANDBOX_DATABASE_URL: "postgres://trellis_sandbox:pw@localhost:5432/trellis",
};

void test("parseConfig applies defaults for HOST, PORT, COURSES_DIR", () => {
  const config = parseConfig(validEnv);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3001);
  assert.equal(config.coursesDir, "/courses");
  assert.equal(config.databaseUrl, validEnv.DATABASE_URL);
  assert.equal(config.sandboxDatabaseUrl, validEnv.SANDBOX_DATABASE_URL);
});

void test("parseConfig overrides defaults from the given environment", () => {
  const config = parseConfig({
    ...validEnv,
    HOST: "0.0.0.0",
    PORT: "8080",
    COURSES_DIR: "/data/courses",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(config.coursesDir, "/data/courses");
});

void test("parseConfig throws a descriptive error when DATABASE_URL is missing", () => {
  const envWithoutDatabaseUrl = { SANDBOX_DATABASE_URL: validEnv.SANDBOX_DATABASE_URL };
  assert.throws(() => parseConfig(envWithoutDatabaseUrl), /DATABASE_URL/);
});

void test("parseConfig throws a descriptive error when SANDBOX_DATABASE_URL is blank", () => {
  assert.throws(
    () => parseConfig({ ...validEnv, SANDBOX_DATABASE_URL: "   " }),
    /SANDBOX_DATABASE_URL/,
  );
});

void test("parseConfig rejects a non-numeric PORT", () => {
  assert.throws(() => parseConfig({ ...validEnv, PORT: "not-a-number" }), /PORT/);
});

void test("parseConfig returns a frozen (immutable) object", () => {
  // ESM modules are always strict mode, so mutating a frozen object throws
  // a TypeError here rather than silently no-op'ing.
  const config = parseConfig(validEnv);
  assert.throws(() => {
    // @ts-expect-error intentional mutation attempt to prove the object is frozen
    config.host = "mutated";
  });
});
