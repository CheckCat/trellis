import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../server.js";
import { CAPABILITIES, PRACTICE_TYPES, SANDBOX_TYPES } from "../capabilities.js";
import { poolThatMustNotBeUsed } from "../progress/testSupport.js";

async function withApp(run: (app: ReturnType<typeof buildServer>) => Promise<void>): Promise<void> {
  // No database, no courses directory, no sandbox: `GET /capabilities`
  // describes the BUILD, not any installed content, and a pool that throws
  // on use is what keeps that honest.
  const app = buildServer({ pool: poolThatMustNotBeUsed(), logger: false });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

void test("GET /capabilities serves the registry verbatim", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/capabilities" });

    assert.equal(response.statusCode, 200);
    // Verbatim, not a re-shaped subset: the whole point of the endpoint is
    // that a course generator reads the same document the repo commits.
    // A response schema that dropped a field would be exactly the drift
    // this is meant to prevent, which is why the route declares none.
    assert.deepEqual(response.json(), JSON.parse(JSON.stringify(CAPABILITIES)));
  });
});

void test("GET /capabilities names every registered type and the manifest contract version", async () => {
  await withApp(async (app) => {
    const body = response(await app.inject({ method: "GET", url: "/capabilities" }));

    assert.equal(typeof body.manifestContractVersion, "number");
    assert.deepEqual(
      body.practiceTypes.map((practice) => practice.type),
      [...PRACTICE_TYPES],
    );
    assert.deepEqual(
      body.sandboxTypes.map((sandbox) => sandbox.type),
      [...SANDBOX_TYPES],
    );
    // The limits a course author has to design around are part of the
    // contract, not folklore.
    for (const limit of ["maxResultRows", "maxComparisonRows", "sandboxStatementTimeoutSeconds"]) {
      assert.equal(typeof body.limits[limit], "number", `limits.${limit} is missing`);
    }
    // Each practice type says where an attempt goes and how the lesson is
    // completed — the two things a generator cannot guess.
    for (const practice of body.practiceTypes) {
      assert.match(practice.endpoint, /^POST \/courses\/\{courseId\}\/lessons\/\{lessonId\}\//);
      assert.ok(practice.completion.length > 0);
      assert.ok(practice.mechanics.length > 0);
    }
  });
});

void test("GET /capabilities never carries a course's own answers", async () => {
  await withApp(async (app) => {
    const raw = (await app.inject({ method: "GET", url: "/capabilities" })).body;
    // It is a description of the engine; nothing here is derived from an
    // installed course, so no course's check query, reference query or
    // expected value can appear in it. (`"expected"` DOES appear as the
    // NAME of a manifest field — what must not appear is any value.)
    assert.doesNotMatch(raw, /select |SELECT /);
  });
});

interface CapabilitiesBody {
  manifestContractVersion: number;
  practiceTypes: { type: string; endpoint: string; completion: string; mechanics: unknown[] }[];
  sandboxTypes: { type: string }[];
  limits: Record<string, number>;
}

function response(injected: { json: () => unknown }): CapabilitiesBody {
  return injected.json() as CapabilitiesBody;
}
