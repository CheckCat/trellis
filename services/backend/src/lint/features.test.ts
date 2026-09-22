import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzerFor,
  FEATURE_ANALYZERS,
  grantId,
  isKnownGrant,
  knownGrants,
  parseGrant,
} from "./features.js";
import type { CoursePractice } from "../courses/types.js";

const SQL_PRACTICE: CoursePractice = {
  type: "sql",
  prompt: "Filter.",
  sandbox: "main",
  expected: "select a from t where b = 1",
  ordered: false,
};

const ANSWER_PRACTICE: CoursePractice = {
  type: "answer",
  prompt: "Report it.",
  fields: [{ id: "n", label: "How many?", kind: "number", expected: 1, tolerance: 0 }],
};

void test("a grant is kind and feature, and nothing else parses", () => {
  assert.deepEqual(parseGrant("sql:order-by"), { kind: "sql", feature: "order-by" });
  // The forms that must NOT silently become a kind of their own.
  assert.equal(parseGrant("where"), undefined);
  assert.equal(parseGrant(":where"), undefined);
  assert.equal(parseGrant("sql:"), undefined);
});

void test("only what an analyzer registers is a known grant", () => {
  assert.ok(isKnownGrant("sql:where"));
  // A typo must be a finding, not an entry that quietly grants nothing.
  assert.equal(isKnownGrant("sql:wehre"), false);
  // And a language nobody has written an analyzer for is not a grant
  // either — that is the honest answer until one exists.
  assert.equal(isKnownGrant("python:loop"), false);
});

void test("the exercise picks its analyzer by practice type", () => {
  assert.equal(analyzerFor(SQL_PRACTICE)?.kind, "sql");
  // An `answer` exercise is done outside the platform: there is no
  // artefact to read, so nothing claims it can check one.
  assert.equal(analyzerFor(ANSWER_PRACTICE), undefined);
});

void test("the sql analyzer reports what solving the exercise requires", () => {
  const analyzer = analyzerFor(SQL_PRACTICE);
  assert.ok(analyzer !== undefined);
  assert.deepEqual(analyzer.extract(SQL_PRACTICE), ["select", "where"]);
});

void test("every registered feature has a well-formed grant id", () => {
  // The plan's schema only accepts `^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`,
  // so a feature that cannot be written in a plan is a feature no term
  // can ever grant.
  const shape = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
  for (const grant of knownGrants()) {
    assert.match(grant, shape);
  }
});

void test("kinds are unique, so an exercise never has two answers", () => {
  const kinds = FEATURE_ANALYZERS.map((analyzer) => analyzer.kind);
  assert.equal(new Set(kinds).size, kinds.length);

  // Same for practice types: `analyzerFor` returns the first match, and
  // two analyzers claiming one type would make that order significant.
  const claimed = FEATURE_ANALYZERS.flatMap((analyzer) => analyzer.practiceTypes);
  assert.equal(new Set(claimed).size, claimed.length);
});

void test("adding a language means adding an analyzer, and nothing else", () => {
  // The shape a future `practice-code` plugin would register. This test
  // is the contract: a new kind must need no change to the plan's schema
  // (one `grants` field, forever) and none to the rule in course.ts.
  const python = {
    kind: "python",
    practiceTypes: ["code"],
    features: ["loop", "function"],
    extract: () => ["loop"],
  };

  assert.equal(grantId(python.kind, python.features[0] ?? ""), "python:loop");
  assert.match(grantId(python.kind, "function"), /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
});
