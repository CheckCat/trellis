import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import manifestSchema from "../courses/manifest.schema.json" with { type: "json" };
import { MAX_CODE_CASES } from "../plugins/practice/code/limits.js";
import {
  ANSWER_FIELD_KINDS,
  CAPABILITIES,
  CODE_LANGUAGES,
  MANIFEST_CONTRACT_VERSION,
  PRACTICE_TYPES,
  practiceTypeCapability,
  SANDBOX_STATEMENT_TIMEOUT_SECONDS,
  SANDBOX_TYPES,
} from "./capabilities.js";
import { CAPABILITIES_CONTRACT_PATH, renderCapabilitiesContract } from "../capabilities-cli.js";
import { PRACTICE_STRATEGIES } from "../plugins/practice/index.js";
import { repoPath } from "../repo-root.js";

/** Reads an `enum` out of the checked-in manifest schema by `$defs` path,
 * failing loudly if the schema was restructured — a silently-missing enum
 * would make every assertion below vacuous. */
function schemaEnum(...pathSegments: string[]): readonly string[] {
  let node: unknown = manifestSchema;
  for (const segment of pathSegments) {
    assert.ok(
      typeof node === "object" && node !== null && segment in (node as Record<string, unknown>),
      `manifest.schema.json has no "${pathSegments.join(".")}" (missing at "${segment}")`,
    );
    node = (node as Record<string, unknown>)[segment];
  }
  assert.ok(Array.isArray(node), `manifest.schema.json's "${pathSegments.join(".")}" is not an enum array`);
  return node as readonly string[];
}

// --- The schema may not disagree with the registry -----------------------
// The registry is the authority on what exists; the schema is a
// checked-in contract artifact that keeps its literal enums (so it stays
// readable and usable standalone). These tests are the seam between them.

void test("manifest.schema.json's sandboxes[].type enum is exactly the registered sandbox types", () => {
  assert.deepEqual(schemaEnum("$defs", "sandbox", "properties", "type", "enum"), [...SANDBOX_TYPES]);
});

void test("manifest.schema.json's practice.type enum is exactly the registered practice types", () => {
  assert.deepEqual(schemaEnum("$defs", "practice", "properties", "type", "enum"), [...PRACTICE_TYPES]);
});

void test("manifest.schema.json's fields[].kind enum is exactly the registered answer-field kinds", () => {
  assert.deepEqual(schemaEnum("$defs", "answerField", "properties", "kind", "enum"), [...ANSWER_FIELD_KINDS]);
});

void test("manifest.schema.json's practice.language enum is exactly the registered code languages", () => {
  assert.deepEqual(schemaEnum("$defs", "practice", "properties", "language", "enum"), [...CODE_LANGUAGES]);
});

void test("manifest.schema.json's cases maxItems is the registered case limit", () => {
  const cases = (manifestSchema as { $defs: { practice: { properties: { cases: { maxItems?: number } } } } }).$defs
    .practice.properties.cases;
  assert.equal(cases.maxItems, MAX_CODE_CASES);
});

void test("manifest.schema.json's practice properties are exactly the union of what the types declare", () => {
  // The seam courses/validate.ts now stands on: it derives "which property
  // belongs to which practice type" from the registry, and leans on the
  // schema's `additionalProperties: false` to have already rejected a
  // property nobody declares. Both halves have to be true at once.
  //
  // A field in the registry but not the schema is the worse direction: an
  // author follows the capability document, writes the field, and ajv
  // rejects it as unknown — the engine contradicting its own contract.
  const practice = (manifestSchema as { $defs: Record<string, { properties?: Record<string, unknown> }> }).$defs
    .practice;
  assert.ok(practice?.properties !== undefined, "manifest.schema.json has no $defs.practice.properties");
  const declared = new Set<string>();
  for (const capability of CAPABILITIES.practiceTypes) {
    for (const field of capability.manifestFields) {
      declared.add(field.name);
    }
  }
  assert.deepEqual(Object.keys(practice.properties).sort(), [...declared].sort());
});

// --- The registry may not disagree with itself ---------------------------

void test("every registered practice type has a capability document, and vice versa", () => {
  assert.deepEqual(
    CAPABILITIES.practiceTypes.map((capability) => capability.type),
    [...PRACTICE_TYPES],
  );
  for (const type of PRACTICE_TYPES) {
    const capability = practiceTypeCapability(type);
    assert.ok(capability !== undefined, `no capability document for practice type "${type}"`);
    assert.ok(capability.mechanics.length > 0, `practice type "${type}" declares no grading mechanic`);
    // A mechanic is switched on by a manifest field, and that field has to
    // be one the type actually accepts — otherwise the document tells a
    // course author to write something validation would reject.
    const fieldNames = new Set(capability.manifestFields.map((field) => field.name));
    for (const mechanic of capability.mechanics) {
      for (const field of mechanic.manifestFields) {
        assert.ok(
          fieldNames.has(field),
          `mechanic "${mechanic.name}" of practice type "${type}" names field "${field}", which the type does not declare`,
        );
      }
    }
    // `endpoint` is documentation of `submitPath`; they may not drift.
    assert.ok(capability.endpoint.endsWith(`/${capability.submitPath}`), capability.endpoint);
  }
});

void test("every registered sandbox type has a capability document", () => {
  assert.deepEqual(
    CAPABILITIES.sandboxTypes.map((capability) => capability.type),
    [...SANDBOX_TYPES],
  );
});

void test("every registered practice type has a strategy — the two registries are one", () => {
  // `PRACTICE_STRATEGIES` is typed as a total map over `CoursePracticeType`,
  // so a missing entry is a compile error rather than a test failure. This
  // asserts the other half: no strategy registered under a key the
  // capability registry never declared, and each strategy grading the type
  // it is filed under.
  assert.deepEqual(Object.keys(PRACTICE_STRATEGIES).sort(), [...PRACTICE_TYPES].sort());
  for (const [type, strategy] of Object.entries(PRACTICE_STRATEGIES)) {
    assert.equal(strategy.type, type);
  }
});

// --- The registry may not disagree with the world ------------------------

void test("the reported sandbox statement timeout is the one the sandbox ROLE actually carries", () => {
  // The authority is the SQL that configures the role, not this process —
  // which is exactly why no code sets the timeout per query. If the two
  // ever part ways, `GET /capabilities` starts lying about how long a
  // learner's query may run.
  const sql = fs.readFileSync(repoPath("docker", "postgres", "init", "02-schemas.sql"), "utf8");
  const match = /ALTER ROLE trellis_sandbox SET statement_timeout = '(\d+)s'/.exec(sql);
  assert.ok(match !== null, "02-schemas.sql no longer sets statement_timeout on trellis_sandbox in the expected form");
  assert.equal(Number(match[1]), SANDBOX_STATEMENT_TIMEOUT_SECONDS);
});

void test(`${CAPABILITIES_CONTRACT_PATH} is committed and up to date`, () => {
  // The same comparison `npm run capabilities:check` makes in CI, run here
  // too so a developer sees it in a plain `npm test` instead of only after
  // pushing.
  const committed = fs.readFileSync(repoPath(CAPABILITIES_CONTRACT_PATH), "utf8");
  assert.equal(
    committed,
    renderCapabilitiesContract(),
    `${CAPABILITIES_CONTRACT_PATH} is out of date — run \`npm run capabilities:write\` and commit the result.`,
  );
});

void test("the capability document is frozen and carries a contract version", () => {
  assert.equal(CAPABILITIES.manifestContractVersion, MANIFEST_CONTRACT_VERSION);
  // It is handed out by `GET /capabilities` and serialized into the
  // contract file; a caller mutating it would change what every later
  // caller is told.
  assert.ok(Object.isFrozen(CAPABILITIES));
});
