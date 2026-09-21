import assert from "node:assert/strict";
import test from "node:test";

import { parseSkillsDocument, type SkillsLoadResult } from "./skills.js";

function invalid(yaml: string): readonly { path: string; message: string }[] {
  const result: SkillsLoadResult = parseSkillsDocument(yaml);
  assert.equal(result.kind, "invalid", `expected the document to be rejected, got ${result.kind}`);
  assert.ok(result.kind === "invalid");
  return result.errors;
}

void test("parseSkillsDocument accepts the documented shape", () => {
  const result = parseSkillsDocument(`
version: 1
skills:
  - id: turnover-formula
    title: "Посчитать текучесть"
    requires: [headcount-average]
lessons:
  - id: metrics-turnover
    teaches: [turnover-formula]
    requires: [metrics-headcount]
    verify: quiz
    hours: 2
modules:
  - id: metrics
    budget_hours: 24
`);

  assert.equal(result.kind, "ok");
  assert.ok(result.kind === "ok");
  assert.equal(result.skills.version, 1);
  assert.equal(result.skills.lessons[0]?.verify, "quiz");
  assert.equal(result.skills.lessons[0]?.hours, 2);
  assert.equal(result.skills.modules?.[0]?.budget_hours, 24);
});

void test("parseSkillsDocument accepts the minimum: a version and one lesson", () => {
  const result = parseSkillsDocument("version: 1\nlessons:\n  - id: only\n    verify: self\n");
  assert.equal(result.kind, "ok");
});

void test("parseSkillsDocument rejects an unknown verify value, naming the field", () => {
  // The one closed vocabulary of this file. A `verify` the lint does not
  // know is caught here, structurally — before any rule tries to decide
  // what it would even mean.
  const errors = invalid("version: 1\nlessons:\n  - id: a\n    verify: sql-explain\n");
  assert.ok(
    errors.some((error) => error.path === "lessons[0].verify" && /must be equal to one of the allowed values/.test(error.message)),
    JSON.stringify(errors),
  );
});

void test("parseSkillsDocument rejects a wrong format version and a missing lessons list", () => {
  assert.ok(invalid("version: 2\nlessons:\n  - id: a\n    verify: self\n").some((e) => e.path === "version"));
  assert.ok(invalid("version: 1\n").some((e) => e.path === "lessons"));
  // An empty plan is a file that says nothing — almost certainly a
  // half-finished edit rather than a deliberate statement.
  assert.ok(invalid("version: 1\nlessons: []\n").some((e) => e.path === "lessons"));
});

void test("parseSkillsDocument rejects unknown properties rather than ignoring them", () => {
  const errors = invalid("version: 1\nlessons:\n  - id: a\n    verify: self\n    hourz: 2\n");
  assert.ok(
    errors.some((error) => error.path === "lessons[0]" && /"hourz"/.test(error.message)),
    JSON.stringify(errors),
  );
});

void test("parseSkillsDocument rejects a lesson with no verify, and non-positive hours", () => {
  assert.ok(invalid("version: 1\nlessons:\n  - id: a\n").some((e) => e.path === "lessons[0].verify"));
  assert.ok(
    invalid("version: 1\nlessons:\n  - id: a\n    verify: self\n    hours: 0\n").some(
      (e) => e.path === "lessons[0].hours",
    ),
  );
});

void test("parseSkillsDocument reports bad YAML as a finding, never as a throw", () => {
  const errors = invalid("version: 1\nlessons:\n  - id: a\n   verify: self\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? "", /not valid YAML/);
});
