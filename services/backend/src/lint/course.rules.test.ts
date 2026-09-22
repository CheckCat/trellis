import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { repoPath } from "../repoRoot.js";
import { LINT_RULES } from "./course.js";

/**
 * The seams around `LINT_RULES`.
 *
 * `LintFinding.rule` is typed against the list, so the code cannot report a
 * rule the list does not know — that direction is a compile error and needs
 * no test. These cover the two directions a type cannot:
 *
 *  - a rule on the list that nothing reports (dead documentation, and the
 *    shape a rule that CANNOT fire takes: `quiz-wrong-option-without-
 *    explanation` sat here for months while courses/validate.ts rejected
 *    the same thing harder, so the warning could never reach anyone);
 *  - a rule the tool reports that courses/README.md never explains, which
 *    is how an author meets a rule id with nowhere to look it up.
 *
 * Both read the sources as text on purpose. Anything cleverer would have to
 * import the rules to find them, and importing them is what the compiler
 * already does.
 */

/** Files allowed to report a finding — `lintCourse`'s rules and the CLI's
 * own preflight, which reports why a package could not be linted at all. */
const REPORTING_SOURCES = ["lint/course.ts", "course-lint-cli.ts"] as const;

function reportedRules(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const relative of REPORTING_SOURCES) {
    const source = fs.readFileSync(repoPath("services", "backend", "src", relative), "utf8");
    // Only `rule:` properties of a finding being built — not the list
    // itself, which is an array of bare strings.
    for (const match of source.matchAll(/\brule:\s*"([a-z0-9-]+)"/g)) {
      found.add(match[1] as string);
    }
  }
  return found;
}

/** Rule ids as courses/README.md writes them: in backticks, inside the
 * "Ошибки (E)" / "Предупреждения (W)" lists. Names are matched against
 * `LINT_RULES` rather than by shape, so ordinary backticked prose (a field
 * name, a file name) cannot be mistaken for a documented rule. */
function documentedRules(): ReadonlySet<string> {
  const readme = fs.readFileSync(repoPath("courses", "README.md"), "utf8");
  const known = new Set<string>(LINT_RULES);
  const documented = new Set<string>();
  for (const match of readme.matchAll(/`([a-z0-9-]+)`/g)) {
    const name = match[1] as string;
    if (known.has(name)) {
      documented.add(name);
    }
  }
  return documented;
}

void test("every rule on LINT_RULES is one the lint actually reports", () => {
  const reported = reportedRules();
  // Guards the scan itself: a regex that matched nothing would make the
  // assertion below vacuous while still reporting success.
  assert.ok(reported.size > 20, `the rule scan found only ${reported.size} rules — the source shape changed`);
  assert.deepEqual(
    LINT_RULES.filter((rule) => !reported.has(rule)),
    [],
    "listed but never reported — either the rule was removed and the list was not, or it moved out of the scanned files",
  );
});

void test("every rule the lint reports is explained in courses/README.md", () => {
  const documented = documentedRules();
  assert.deepEqual(
    LINT_RULES.filter((rule) => !documented.has(rule)),
    [],
    "reported but undocumented — an author meets this rule id with nowhere to look it up",
  );
});
