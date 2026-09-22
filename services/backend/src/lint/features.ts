// The registry of what a course can GRANT a learner, and who can tell
// whether an exercise needs it.
//
// The problem this shape exists to avoid: the first version of this rule
// put a `grants_sql` field in skills.schema.json. One plugin, one field —
// and the second plugin would have added `grants_python`, the third
// `grants_dax`, until the plan format was a list of everything the
// engine had ever supported. A plan describes teaching, not dialects.
//
// So the plan says `grants: [sql:where]` and nothing more: one field
// forever, whose VALUES come from here. Adding a language means adding an
// analyzer below — no schema change, no new field, no edit to the rule in
// course.ts.
//
// An analyzer answers one question: given an exercise, which of my
// features does solving it require? The evidence is always the author's
// own reference answer, never the learner's input — a wrong answer here
// costs a lint finding, not a verdict.
//
// A practice type with no analyzer is simply not checked, and that is
// honest rather than silent: `course-without-grants` says so out loud.

import type { CoursePractice } from "../courses/types.js";
import { SQL_FEATURES, sqlFeaturesOf } from "./features.sql.js";

export interface FeatureAnalyzer {
  /** The prefix a plan writes before a feature id (`sql:where`). One per
   * language, not per practice type: two practice types could share a
   * language, and a learner who has met WHERE has met it everywhere. */
  readonly kind: string;
  /** Practice types this analyzer can read. */
  readonly practiceTypes: readonly string[];
  /** Every feature id it can report — closed, so a typo in a plan is a
   * finding instead of a silently ignored entry. */
  readonly features: readonly string[];
  /** The features solving this exercise requires. */
  extract(practice: CoursePractice): readonly string[];
}

const sqlAnalyzer: FeatureAnalyzer = {
  kind: "sql",
  practiceTypes: ["sql"],
  features: SQL_FEATURES,
  extract(practice) {
    if (practice.type === "answer") {
      return [];
    }
    // All three mechanics, because any of them can be the one that needs
    // the construct: `solution` is the author's answer, `expected` the
    // reference query, `check` the predicate over the result.
    const statements = [practice.solution, practice.expected, practice.check].filter(
      (sql): sql is string => typeof sql === "string",
    );
    const found = new Set(statements.flatMap((sql) => sqlFeaturesOf(sql)));
    return SQL_FEATURES.filter((feature) => found.has(feature));
  },
};

/** Every analyzer this build knows. A new language is appended here and
 * nowhere else. */
export const FEATURE_ANALYZERS: readonly FeatureAnalyzer[] = [sqlAnalyzer];

/** `sql:where` — how a plan names one feature. */
export function grantId(kind: string, feature: string): string {
  return `${kind}:${feature}`;
}

/** Splits a plan's entry, or `undefined` if it is not in `kind:feature`
 * form at all. */
export function parseGrant(grant: string): { kind: string; feature: string } | undefined {
  const separator = grant.indexOf(":");
  if (separator <= 0 || separator === grant.length - 1) {
    return undefined;
  }
  return { kind: grant.slice(0, separator), feature: grant.slice(separator + 1) };
}

/** True when some analyzer declares this exact `kind:feature`. */
export function isKnownGrant(grant: string): boolean {
  const parsed = parseGrant(grant);
  if (parsed === undefined) {
    return false;
  }
  return FEATURE_ANALYZERS.some(
    (analyzer) => analyzer.kind === parsed.kind && analyzer.features.includes(parsed.feature),
  );
}

/** The analyzer that can read this exercise, if any. */
export function analyzerFor(practice: CoursePractice): FeatureAnalyzer | undefined {
  return FEATURE_ANALYZERS.find((analyzer) => analyzer.practiceTypes.includes(practice.type));
}

/** Everything a plan may legally write in `grants`, for an error message
 * that says what to do instead of only what is wrong. */
export function knownGrants(): readonly string[] {
  return FEATURE_ANALYZERS.flatMap((analyzer) =>
    analyzer.features.map((feature) => grantId(analyzer.kind, feature)),
  );
}
