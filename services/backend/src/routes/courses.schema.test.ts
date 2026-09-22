import assert from "node:assert/strict";
import test from "node:test";

import { ANSWER_FIELD_KINDS, PRACTICE_TYPES } from "../capabilities.js";
import { publicAnswerFieldSchema, publicPracticeSchema } from "./courses.js";

/**
 * The response schemas are not validation — they are what
 * fast-json-stringify SERIALIZES by. `additionalProperties: false` means a
 * property the schema does not name is dropped from the response without a
 * word, so a schema that has fallen behind the registry does not fail; it
 * quietly ships less than the course wrote.
 *
 * The enums here are literals on purpose (the schemas are compiled once at
 * startup, and a spread would make them unreadable standalone). These
 * assertions are what keeps the literals honest — the same arrangement
 * capabilities.test.ts uses for manifest.schema.json.
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
