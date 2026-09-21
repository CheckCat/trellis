// Reading a course's optional `skills.yaml` — the teaching plan the ENGINE
// never looks at.
//
// Why it is not part of the manifest: the manifest is what the engine runs,
// and everything in it has a runtime meaning. A skills map has none — it
// describes intent (what this course builds, in what order, checked how) so
// that a machine can review a course SKELETON before any content exists.
// Keeping the two files apart is what lets the plan be rewritten, or
// dropped entirely, without touching a manifest that already works.
//
// Structural validation here mirrors courses/validate.ts: one precompiled
// ajv schema, and never an exception for a broken file — a bad skills.yaml
// is a lint finding like any other, reported with a path the author can act
// on.

import fs from "node:fs";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { parse as parseYaml } from "yaml";

import skillsSchema from "./skills.schema.json" with { type: "json" };
import { describeError } from "../courses/fsErrors.js";
import type { ValidationError } from "../courses/types.js";

/** The file the lint looks for beside `manifest.yaml`. */
export const SKILLS_FILE_NAME = "skills.yaml";

/** How a lesson is meant to be verified — see skills.schema.json. */
export type VerifyKind = "quiz" | "sql-state" | "sql-result" | "answer" | "self";

export interface SkillEntry {
  readonly id: string;
  readonly title: string;
  readonly requires?: readonly string[];
}

export interface SkillsLessonEntry {
  readonly id: string;
  readonly teaches?: readonly string[];
  readonly requires?: readonly string[];
  readonly verify: VerifyKind;
  readonly hours?: number;
}

export interface SkillsModuleEntry {
  readonly id: string;
  readonly budget_hours: number;
}

export interface SkillsDocument {
  readonly version: 1;
  readonly skills?: readonly SkillEntry[];
  readonly lessons: readonly SkillsLessonEntry[];
  readonly modules?: readonly SkillsModuleEntry[];
}

export type SkillsLoadResult =
  /** The file is there and structurally sound. */
  | { readonly kind: "ok"; readonly skills: SkillsDocument }
  /** No skills.yaml in the package. Not an error: the file is optional,
   * and the lint simply runs the rules that do not need it. */
  | { readonly kind: "absent" }
  /** The file is there and unusable — unreadable, not YAML, or not
   * matching the schema. */
  | { readonly kind: "invalid"; readonly errors: readonly ValidationError[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateStructure = ajv.compile<SkillsDocument>(skillsSchema);

/**
 * Reads `<packageDir>/skills.yaml`. Never throws: every failure mode comes
 * back as a result the caller turns into findings.
 */
export function loadSkillsDocument(packageDir: string): SkillsLoadResult {
  const file = path.join(packageDir, SKILLS_FILE_NAME);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (isNotFound(err)) {
      return { kind: "absent" };
    }
    return { kind: "invalid", errors: [{ path: "", message: `Could not be read: ${describeError(err)}.` }] };
  }
  return parseSkillsDocument(source);
}

/**
 * The same thing for an in-memory document — what the tests use, so a rule
 * can be exercised without a temp directory per case.
 */
export function parseSkillsDocument(source: string): SkillsLoadResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    return {
      kind: "invalid",
      errors: [{ path: "", message: `Is not valid YAML: ${err instanceof Error ? err.message : String(err)}.` }],
    };
  }
  if (!validateStructure(parsed)) {
    return { kind: "invalid", errors: (validateStructure.errors ?? []).map(describeAjvError) };
  }
  return { kind: "ok", skills: parsed };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/** Same `{ path, message }` shape and the same dotted/bracket notation
 * courses/validate.ts produces, so one reporter can print both. */
function describeAjvError(err: ErrorObject): ValidationError {
  const segments = err.instancePath.split("/").filter((segment) => segment !== "");
  let where = "";
  for (const segment of segments) {
    where += /^\d+$/.test(segment) ? `[${segment}]` : where === "" ? segment : `.${segment}`;
  }
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty: string }).missingProperty;
    return { path: where === "" ? missing : `${where}.${missing}`, message: `Missing required property "${missing}".` };
  }
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty: string }).additionalProperty;
    return { path: where, message: `Unexpected property "${extra}" — additional properties are not allowed here.` };
  }
  return { path: where, message: err.message ?? "Does not match the expected schema." };
}
