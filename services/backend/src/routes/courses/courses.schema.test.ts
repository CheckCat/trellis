import assert from "node:assert/strict";
import test from "node:test";

import { ANSWER_FIELD_KINDS, PRACTICE_TYPES } from "../../capabilities/index.js";
import { publicAnswerFieldSchema, publicPracticeSchema } from "./courses.js";

/**
 * The response schemas are not validation — they are what
 * fast-json-stringify SERIALIZES by. `additionalProperties: false` means a
 * property the schema does not name is dropped from the response without a
 * word, so a schema that has fallen behind the registry does not fail; it
 * quietly ships less than the course wrote.
 *
 * The enums are spread from capabilities.ts's PRACTICE_TYPES/
 * ANSWER_FIELD_KINDS, not written out by hand — so a type the registry
 * gains shows up here without anyone touching courses.ts. These assertions
 * are a regression guard (a future edit could still re-literal one by
 * accident), not the only thing keeping the two in sync.
 */

void test("the lesson response's practice.type enum is exactly the registered practice types", () => {
  assert.deepEqual(publicPracticeSchema.properties.type.enum, [...PRACTICE_TYPES]);
});

void test("the lesson response's answer-field kind enum is exactly the registered kinds", () => {
  assert.deepEqual(publicAnswerFieldSchema.properties.kind.enum, [...ANSWER_FIELD_KINDS]);
});

void test("the practice response carries no field that holds an answer", () => {
  // Project invariant, restated where the shape is actually decided: a
  // learner's copy of an assignment never contains `check`, `expected`,
  // `solution`, or `fields[].expected`. Written as a denylist rather than
  // an allowlist so that adding a legitimate public field does not require
  // touching this test — only adding a SECRET one does.
  const secrets = ["check", "expected", "solution", "ordered"];
  for (const secret of secrets) {
    assert.ok(
      !(secret in publicPracticeSchema.properties),
      `the public practice schema would serialize "${secret}" — that is the answer to the exercise`,
    );
  }
  assert.ok(!("expected" in publicAnswerFieldSchema.properties));
});
