import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { lintPackage, runLint } from "./course-lint-cli.js";
import { makeTempDir, validCourseFixtureFiles, validManifestYaml, writeCoursePackage } from "../courses/test-support.js";
import { repoPath } from "../repo-root.js";

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

// --- Lesson text, end to end --------------------------------------------
// These exist because of a bug the unit tests could not have caught. The
// rules that read lesson text were tested by handing them a map of texts
// directly, while the CLI built that map by treating `lesson.content` — the
// Markdown itself — as a path to a file. Every read threw, every throw was
// swallowed, and five rules were silent for months behind a green suite.
//
// So these go through `lintPackage`: a real package on disk, read by the
// real loader. The text now travels the one way it travels in production.

/** A two-lesson package where the SECOND lesson introduces a term the
 * FIRST one may or may not use — the smallest course a vocabulary rule can
 * have an opinion about. */
function withTextPackage(
  files: { earlier: string; later: string; prompt?: string; version?: string },
  skillsYaml: string | undefined,
  run: (dir: string) => void,
): void {
  const practice =
    files.prompt === undefined
      ? ""
      : "        practice:\n" +
        "          type: answer\n" +
        `          prompt: ${JSON.stringify(files.prompt)}\n` +
        "          fields:\n" +
        "            - id: n\n" +
        "              label: Сколько человек ушло?\n" +
        "              kind: number\n" +
        "              expected: 12\n";
  const manifest =
    "id: texts\n" +
    `version: ${files.version ?? "1.0.0"}\n` +
    "title: Texts\n" +
    "modules:\n" +
    "  - id: only\n" +
    "    title: Only module\n" +
    "    lessons:\n" +
    "      - id: earlier\n" +
    "        title: Earlier lesson\n" +
    "        content: lessons/earlier.md\n" +
    practice +
    "      - id: later\n" +
    "        title: Later lesson\n" +
    "        content: lessons/later.md\n";

  const coursesDir = makeTempDir("trellis-lint-texts-");
  try {
    writeCoursePackage(coursesDir, "texts", manifest, [
      { path: "lessons/earlier.md", content: files.earlier },
      { path: "lessons/later.md", content: files.later },
    ]);
    const dir = path.join(coursesDir, "texts");
    if (skillsYaml !== undefined) {
      fs.writeFileSync(path.join(dir, "skills.yaml"), skillsYaml, "utf8");
    }
    run(dir);
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
}

/** The plan both vocabulary tests below share: `текучесть` belongs to the
 * second lesson. `verify` matches whichever shape the manifest takes. */
function glossaryPlan(earlierVerify: "self" | "answer"): string {
  return (
    "version: 1\n" +
    "terms:\n" +
    "  - term: текучесть\n" +
    "    introduced_in: later\n" +
    "lessons:\n" +
    "  - id: earlier\n" +
    `    verify: ${earlierVerify}\n` +
    "  - id: later\n" +
    "    verify: self\n"
  );
}

void test("a term used before its lesson is found through the CLI, in the lesson's Markdown", () => {
  withTextPackage(
    {
      earlier: "# Раньше\n\nВысокая текучесть — наша главная проблема, и все это знают.",
      later: "# Позже\n\nТекучесть — это доля сотрудников, ушедших за период.",
    },
    glossaryPlan("self"),
    (dir) => {
      const found = lintPackage(dir).findings.filter((f) => f.rule === "term-used-before-introduced");
      assert.equal(found.length, 1, JSON.stringify(lintPackage(dir).findings, null, 2));
      assert.equal(found[0]?.path, "modules[0].lessons[0]");
    },
  );
});

void test("a term used only in an exercise prompt is found too — the manifest is text the learner reads", () => {
  // The case Markdown alone cannot see: an exercise lesson whose body says
  // nothing while the assignment itself puts the word in front of the
  // learner. For a practice lesson this is where the text usually lives.
  withTextPackage(
    {
      earlier: "# Раньше\n\nОткройте выгрузку и посчитайте по инструкции ниже.",
      prompt: "Посчитайте текучесть за 2024 год и впишите результат.",
      later: "# Позже\n\nТекучесть — это доля сотрудников, ушедших за период.",
    },
    glossaryPlan("answer"),
    (dir) => {
      const found = lintPackage(dir).findings.filter((f) => f.rule === "term-used-before-introduced");
      assert.equal(found.length, 1, JSON.stringify(lintPackage(dir).findings, null, 2));
      assert.equal(found[0]?.path, "modules[0].lessons[0]");
    },
  );
});

void test("a placeholder lesson in a released course is an error through the CLI", () => {
  withTextPackage(
    {
      earlier: "# Раньше\n\n> ЗАГЛУШКА — текст урока не написан.\n",
      later: "# Позже\n\nЗдесь уже написан настоящий текст урока.",
    },
    undefined,
    (dir) => {
      const found = lintPackage(dir).findings.filter((f) => f.rule === "lesson-is-placeholder");
      assert.equal(found.length, 1);
      assert.equal(found[0]?.severity, "error");
    },
  );
});

void test("the same placeholder is allowed while the course still calls itself a skeleton", () => {
  withTextPackage(
    {
      earlier: "# Раньше\n\n> ЗАГЛУШКА — текст урока не написан.\n",
      later: "# Позже\n\n> ЗАГЛУШКА — текст урока не написан.\n",
      version: "0.1.0-skeleton",
    },
    undefined,
    (dir) => {
      assert.deepEqual(
        lintPackage(dir).findings.filter((f) => f.rule === "lesson-is-placeholder"),
        [],
      );
    },
  );
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
