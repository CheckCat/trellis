import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { lintPackage, runLint } from "./course-lint-cli.js";
import { makeTempDir, validCourseFixtureFiles, validManifestYaml, writeCoursePackage } from "./courses/testSupport.js";
import { repoPath } from "./repoRoot.js";

/** Writes a package with the shared valid manifest plus an optional
 * skills.yaml, and hands back its directory. */
function withPackage(skillsYaml: string | undefined, run: (dir: string) => void): void {
  const coursesDir = makeTempDir("trellis-lint-cli-");
  try {
    writeCoursePackage(coursesDir, "course", validManifestYaml("course"), validCourseFixtureFiles());
    const dir = path.join(coursesDir, "course");
    if (skillsYaml !== undefined) {
      fs.writeFileSync(path.join(dir, "skills.yaml"), skillsYaml, "utf8");
    }
    run(dir);
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
}

void test("the shipped pilot course passes the lint with no findings", () => {
  // The brief's own acceptance criterion, kept honest: `npm run
  // course:lint -- courses/pilot-sql` is green, and stays green when
  // somebody edits the course without editing its plan.
  const result = lintPackage(repoPath("courses", "pilot-sql"));

  assert.equal(result.linted, true);
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings, null, 2));
});

void test("a package with no skills.yaml is still linted, just with fewer rules", () => {
  withPackage(undefined, (dir) => {
    const result = lintPackage(dir);
    // The file is optional (the engine never reads it), so its absence is
    // not itself a finding — the plan rules simply do not run.
    assert.equal(result.linted, true);
    assert.deepEqual(
      result.findings.filter((finding) => finding.rule.startsWith("lesson-")),
      [],
    );
  });
});

void test("an unusable skills.yaml stops the lint with a located error, not a crash", () => {
  withPackage("version: 1\nlessons:\n  - id: first-lesson\n    verify: telepathy\n", (dir) => {
    const result = lintPackage(dir);

    assert.equal(result.linted, false);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]?.rule, "skills-invalid");
    // Prefixed `skills.` so the path says which of the two files it is in.
    assert.equal(result.findings[0]?.path, "skills.lessons[0].verify");
  });
});

void test("a broken manifest is reported as such, and the package is not linted further", () => {
  const coursesDir = makeTempDir("trellis-lint-cli-");
  try {
    writeCoursePackage(coursesDir, "broken", "id: broken\nversion: nope\ntitle: Broken\nmodules: []\n");
    const result = lintPackage(path.join(coursesDir, "broken"));

    assert.equal(result.linted, false);
    assert.ok(result.findings.length > 0);
    assert.ok(result.findings.every((finding) => finding.rule === "manifest-invalid"));
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
});

void test("a directory that is not a course package fails the run rather than passing it silently", () => {
  const dir = makeTempDir("trellis-lint-cli-");
  try {
    const result = runLint([dir]);
    assert.ok(result.errors > 0, "a missing manifest must be an error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("runLint reports per package and totals errors and warnings across them", () => {
  withPackage(
    // `first-lesson` carries a quiz AND a checked practice (the shared
    // fixture), so planning it as `quiz` is correct and planning the
    // course's only module as over budget is a warning.
    "version: 1\nlessons:\n  - id: first-lesson\n    verify: quiz\n    hours: 9\nmodules:\n  - id: intro\n    budget_hours: 1\n",
    (dir) => {
      const result = runLint([dir, dir]);

      // Two warnings per package: the budget it blows, and the missing
      // glossary (this plan declares no `terms`, so nothing guards the
      // order in which the course introduces words).
      assert.equal(result.errors, 0);
      assert.equal(result.warnings, 4, "both packages contribute their own warnings");
      // One header line per package plus one line per finding.
      assert.equal(result.lines.length, 6);
      assert.match(result.lines[0] ?? "", /0 error\(s\), 2 warning\(s\)$/);
      assert.match(result.lines[1] ?? "", /^ {2}WARN {2}modules\[0\] \[module-over-budget\]/);
    },
  );
});
