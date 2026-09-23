import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITIES } from "../../capabilities/index.js";
import skillsSchema from "./skills.schema.json" with { type: "json" };
import { VERIFY_KINDS } from "./skills.js";
import { VERIFY_MECHANICS } from "../course/index.js";

/**
 * The plan's `verify` vocabulary has three ends, and none of them is the
 * authority over the others:
 *
 *  - skills.schema.json decides which values a plan may WRITE;
 *  - `VERIFY_KINDS` decides which values the lint may REASON about;
 *  - `VERIFY_MECHANICS` decides what each value DEMANDS of the engine.
 *
 * Left alone they drift in ways nothing reports. A value in the schema but
 * not the type parses and then falls through every rule. A value in the
 * type but not the schema is unreachable. A mapping onto a mechanic the
 * engine does not register turns `verify-unsupported` — an error meant for
 * an engine too old for the course — into an error every course sees.
 */

void test("skills.schema.json's verify enum is exactly the kinds the lint knows", () => {
  const verify = (skillsSchema as { $defs: Record<string, { properties?: Record<string, { enum?: string[] }> }> }).$defs
    .lesson?.properties?.verify;
  assert.ok(verify?.enum !== undefined, "skills.schema.json has no $defs.lesson.properties.verify.enum");
  assert.deepEqual(verify.enum, [...VERIFY_KINDS]);
});

void test("every verify kind maps onto a mechanic this engine actually registers", () => {
  for (const kind of VERIFY_KINDS) {
    const required = VERIFY_MECHANICS[kind];
    if (required.practiceType === undefined) {
      // `quiz` and `self` need no practice at all — the lesson's own
      // content is the whole story.
      assert.equal(required.mechanic, undefined, `"${kind}" names a mechanic without a practice type`);
      continue;
    }
    const capability = CAPABILITIES.practiceTypes.find((candidate) => candidate.type === required.practiceType);
    assert.ok(capability !== undefined, `verify "${kind}" needs practice type "${required.practiceType}", not registered`);
    assert.ok(
      capability.mechanics.some((mechanic) => mechanic.name === required.mechanic),
      `verify "${kind}" needs mechanic "${required.mechanic}" of practice type "${required.practiceType}", not registered`,
    );
  }
});
