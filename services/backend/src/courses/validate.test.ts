import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import { practiceTypeCapability } from "../capabilities.js";
import type { CourseAnswerPractice, CourseSqlPractice, ValidationResult } from "./types.js";
import { resolveSafePath, validateManifest } from "./validate.js";
import { makeTempDir, validCourseFixtureFiles, validManifestYaml, writeFixtureFiles } from "./testSupport.js";

/** Runs `run` against a fresh temp package directory, always cleaning it up
 * afterwards — every test below needs a real directory because
 * validateManifest checks that `content`/`seed[]` paths actually exist. */
function withPackageDir(run: (dir: string) => void): void {
  const dir = makeTempDir();
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void test("validateManifest accepts a well-formed manifest (happy path)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(parseYaml(validManifestYaml()), dir);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.manifest.id, "fixture-course");
    assert.equal(result.manifest.modules.length, 1);
    assert.equal(result.manifest.sandboxes[0]?.id, "main");
    const lesson = result.manifest.modules[0]?.lessons[0];

    // Final review, backend fixes round (Important 1): contentPath/seed[]
    // must be absolute, already-validated (realpath'd) paths — not the raw
    // relative strings from the manifest — so a consumer (loader.ts, task
    // 009) can read/execute them directly. Comparing against
    // fs.realpathSync's own output (not a hand-built path.join) avoids a
    // false failure from platform path normalization (e.g. macOS's
    // /tmp -> /private/tmp symlink).
    assert.equal(lesson?.contentPath, fs.realpathSync(path.join(dir, "lessons/first-lesson.md")));
    assert.ok(lesson?.contentPath !== undefined && path.isAbsolute(lesson.contentPath));
    assert.equal(
      result.manifest.sandboxes[0]?.seed[0],
      fs.realpathSync(path.join(dir, "sandbox/01-schema.sql")),
    );

    assert.equal(lesson?.quiz?.options.length, 2);
    assert.equal(lesson?.quiz?.options[0]?.correct, true);
    assert.equal(lesson?.quiz?.options[1]?.correct, false);
    assert.equal(lesson?.practice?.type === "sql" ? lesson.practice.sandbox : undefined, "main");
  });
});

void test("resolveSafePath is exported so a caller (task 009) can re-validate a seed path immediately before executing it", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, [{ path: "sandbox/seed.sql", content: "select 1;" }]);
    const result = resolveSafePath(dir, "sandbox/seed.sql");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.absolutePath, fs.realpathSync(path.join(dir, "sandbox/seed.sql")));

    const escaping = resolveSafePath(dir, "../../etc/passwd");
    assert.equal(escaping.ok, false);
  });
});

void test("validateManifest rejects an unknown top-level property (structural, additionalProperties)", () => {
  withPackageDir((dir) => {
    const yamlText = validManifestYaml().replace("version: 1.0.0\n", "version: 1.0.0\nunexpectedField: oops\n");
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.message.includes("unexpectedField")));
  });
});

void test("validateManifest rejects a quiz with two correct: true options (error path)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const yamlText = validManifestYaml().replace(
      '              text: "5"\n              explanation: Simple arithmetic mistake.\n',
      '              text: "5"\n              correct: true\n',
    );
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].quiz.options" && /exactly one/i.test(err.message),
      ),
    );
  });
});

void test("validateManifest rejects an incorrect quiz option missing explanation (error path)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const yamlText = validManifestYaml().replace(
      '              text: "5"\n              explanation: Simple arithmetic mistake.\n',
      '              text: "5"\n',
    );
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].quiz.options[1].explanation" && /missing "explanation"/i.test(err.message),
      ),
    );
  });
});

void test("validateManifest rejects a duplicate lesson id across two different modules (edge case)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, [
      { path: "lessons/a.md", content: "A" },
      { path: "lessons/b.md", content: "B" },
    ]);
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: mod-a",
      "    title: Module A",
      "    lessons:",
      "      - id: shared-id",
      "        title: Lesson A",
      "        content: lessons/a.md",
      "  - id: mod-b",
      "    title: Module B",
      "    lessons:",
      "      - id: shared-id",
      "        title: Lesson B",
      "        content: lessons/b.md",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some((err) => err.path === "modules[1].lessons[0].id" && /duplicate lesson id/i.test(err.message)),
    );
  });
});

void test("validateManifest rejects practice.sandbox referencing an undeclared sandbox (error path)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        practice:",
      "          sandbox: nonexistent",
      "          prompt: Do the thing.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].practice.sandbox" && err.message.includes("nonexistent"),
      ),
    );
  });
});

void test('validateManifest rejects content: "../../etc/passwd" (path safety)', () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        content: ../../etc/passwd",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some((err) => err.path === "modules[0].lessons[0].content" && err.message.includes('".."')),
    );
  });
});

void test("validateManifest rejects an absolute content path (path safety)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        content: /etc/passwd",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some((err) => err.path === "modules[0].lessons[0].content" && /absolute/i.test(err.message)),
    );
  });
});

void test("validateManifest rejects a content path that does not exist on disk (error path)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        content: lessons/missing.md",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some((err) => err.path === "modules[0].lessons[0].content" && /does not (exist|point)/i.test(err.message)),
    );
  });
});

void test("validateManifest rejects a lesson with none of content/quiz/practice (edge case)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: empty-lesson",
      "        title: Empty lesson",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.path === "modules[0].lessons[0]" && /none of content\/quiz\/practice/i.test(err.message)));
  });
});

void test("validateManifest rejects a lesson id containing a slash (fix round 1, Important 2 — lesson id is a URL path segment)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      '      - id: "les/son"',
      "        title: Sloppy lesson id",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: b",
      "              text: 'No'",
      "              explanation: Nope.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
  });
});

void test("validateManifest rejects a module id that is only whitespace (fix round 1, Important 2)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      '  - id: " "',
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: b",
      "              text: 'No'",
      "              explanation: Nope.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
  });
});

void test('validateManifest rejects a lesson id of "." or ".." (fix round 1, Important 2)', () => {
  withPackageDir((dir) => {
    for (const badId of [".", ".."]) {
      const yamlText = [
        "id: fixture-course",
        "version: 1.0.0",
        "title: Fixture course",
        "modules:",
        "  - id: intro",
        "    title: Intro",
        "    lessons:",
        `      - id: "${badId}"`,
        "        title: Only lesson",
        "        quiz:",
        "          question: Q?",
        "          options:",
        "            - id: a",
        "              text: 'Yes'",
        "              correct: true",
        "            - id: b",
        "              text: 'No'",
        "              explanation: Nope.",
        "",
      ].join("\n");
      const result = validateManifest(parseYaml(yamlText), dir);
      assert.equal(result.ok, false, `expected lesson id "${badId}" to be rejected`);
    }
  });
});

void test("validateManifest still accepts single-character quiz option ids (a/b, per the brief's own example — Important 2 must not regress this)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(parseYaml(validManifestYaml()), dir);
    assert.equal(result.ok, true);
  });
});

void test("validateManifest rejects a title that is only whitespace (fix round 1, Important 6)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      'title: "   "',
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        content: lessons/missing.md",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);
    assert.equal(result.ok, false);
  });
});

void test("validateManifest rejects a duplicate sandbox id (edge case, task 012)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "sandboxes:",
      "  - id: main",
      "    type: postgres",
      "  - id: main",
      "    type: postgres",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: b",
      "              text: 'No'",
      "              explanation: Nope.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.path === "sandboxes[1].id" && /duplicate sandbox id/i.test(err.message)));
  });
});

void test("validateManifest rejects a duplicate module id (edge case, task 012)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro A",
      "    lessons:",
      "      - id: lesson-a",
      "        title: Lesson A",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: b",
      "              text: 'No'",
      "              explanation: Nope.",
      "  - id: intro",
      "    title: Intro B",
      "    lessons:",
      "      - id: lesson-b",
      "        title: Lesson B",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: b",
      "              text: 'No'",
      "              explanation: Nope.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.path === "modules[1].id" && /duplicate module id/i.test(err.message)));
  });
});

void test("validateManifest rejects a duplicate quiz option id within the same quiz (edge case, task 012)", () => {
  withPackageDir((dir) => {
    const yamlText = [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        quiz:",
      "          question: Q?",
      "          options:",
      "            - id: a",
      "              text: 'Yes'",
      "              correct: true",
      "            - id: a",
      "              text: 'No'",
      "              explanation: Nope.",
      "",
    ].join("\n");
    const result = validateManifest(parseYaml(yamlText), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].quiz.options[1].id" && /duplicate quiz option id/i.test(err.message),
      ),
    );
  });
});

void test("validateManifest rejects a content path that escapes the package directory via a symlink (path safety, task 012)", () => {
  withPackageDir((dir) => {
    const outsideDir = makeTempDir("trellis-courses-outside-");
    try {
      writeFixtureFiles(outsideDir, [{ path: "secret.md", content: "not part of this package" }]);
      fs.mkdirSync(path.join(dir, "lessons"), { recursive: true });
      // A symlink whose *target* exists (unlike the plain "../.. " lexical
      // check above) but resolves, via realpath, outside packageDir — the
      // one escape resolveSafePath's doc comment says a lexical ".." check
      // alone cannot catch.
      fs.symlinkSync(path.join(outsideDir, "secret.md"), path.join(dir, "lessons/escape.md"));

      const yamlText = [
        "id: fixture-course",
        "version: 1.0.0",
        "title: Fixture course",
        "modules:",
        "  - id: intro",
        "    title: Intro",
        "    lessons:",
        "      - id: only-lesson",
        "        title: Only lesson",
        "        content: lessons/escape.md",
        "",
      ].join("\n");
      const result = validateManifest(parseYaml(yamlText), dir);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(
        result.errors.some(
          (err) => err.path === "modules[0].lessons[0].content" && /outside the package directory/i.test(err.message),
        ),
      );
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

/** Narrows a validated lesson's practice to the `sql` kind, failing the
 * test (rather than type-erroring) if the validator produced the other
 * one — `CoursePractice` is a union discriminated on `type`. */
function sqlPracticeOf(result: ValidationResult): CourseSqlPractice {
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const practice = result.manifest.modules[0]?.lessons[0]?.practice;
  assert.ok(practice !== undefined, "lesson carries no practice");
  assert.equal(practice.type, "sql");
  assert.ok(practice.type === "sql");
  return practice;
}

/** The same for the `answer` kind. */
function answerPracticeOf(result: ValidationResult): CourseAnswerPractice {
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const practice = result.manifest.modules[0]?.lessons[0]?.practice;
  assert.ok(practice !== undefined, "lesson carries no practice");
  assert.equal(practice.type, "answer");
  assert.ok(practice.type === "answer");
  return practice;
}

/** A one-lesson manifest whose only lesson carries the given `practice`
 * block lines (already indented to `practice:`'s children). */
function practiceManifestYaml(practiceLines: readonly string[]): string {
  return [
    "id: fixture-course",
    "version: 1.0.0",
    "title: Fixture course",
    "sandboxes:",
    "  - id: main",
    "    type: postgres",
    "modules:",
    "  - id: intro",
    "    title: Intro",
    "    lessons:",
    "      - id: only-lesson",
    "        title: Only lesson",
    "        practice:",
    "          sandbox: main",
    "          prompt: Do the thing.",
    ...practiceLines.map((line) => `          ${line}`),
    "",
  ].join("\n");
}

void test("validateManifest accepts practice.expected and normalizes the ordered default to false", () => {
  withPackageDir((dir) => {
    const result = validateManifest(parseYaml(practiceManifestYaml(['expected: "select a from t"'])), dir);

    const practice = sqlPracticeOf(result);
    assert.equal(practice.expected, "select a from t");
    // "по умолчанию false" is resolved once, here — not left implicit for
    // every reader of the domain model to re-derive.
    assert.equal(practice.ordered, false);
  });
});

void test("validateManifest carries practice.ordered: true through, and keeps check/expected independent", () => {
  withPackageDir((dir) => {
    const result = validateManifest(
      parseYaml(
        practiceManifestYaml([
          'check: "select count(*) = 1 from t"',
          'expected: "select a from t order by a"',
          "ordered: true",
        ]),
      ),
      dir,
    );

    const practice = sqlPracticeOf(result);
    assert.equal(practice.check, "select count(*) = 1 from t");
    assert.equal(practice.expected, "select a from t order by a");
    assert.equal(practice.ordered, true);
  });
});

void test("validateManifest leaves ordered absent on a practice without expected", () => {
  withPackageDir((dir) => {
    const result = validateManifest(parseYaml(practiceManifestYaml(['check: "select true"'])), dir);

    const practice = sqlPracticeOf(result);
    assert.equal(practice.expected, undefined);
    // `ordered` only means something next to an `expected`; a `false` here
    // would claim the assignment declared something it didn't.
    assert.equal(practice.ordered, undefined);
  });
});

void test("validateManifest rejects an empty or blank practice.expected", () => {
  for (const value of ['expected: ""', 'expected: "   "']) {
    withPackageDir((dir) => {
      const result = validateManifest(parseYaml(practiceManifestYaml([value])), dir);
      assert.equal(result.ok, false, `expected ${value} to be rejected`);
      if (result.ok) return;
      assert.ok(result.errors.some((err) => err.path === "modules[0].lessons[0].practice.expected"));
    });
  }
});

void test("validateManifest rejects practice.ordered without a practice.expected", () => {
  withPackageDir((dir) => {
    const result = validateManifest(parseYaml(practiceManifestYaml(["ordered: true"])), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    // `ordered` alone is an authoring mistake with no meaning to fall back
    // on: there is nothing to order against.
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].practice" && /expected/.test(err.message),
      ),
      `unexpected errors: ${JSON.stringify(result.errors)}`,
    );
  });
});

void test("validateManifest rejects a non-boolean practice.ordered", () => {
  withPackageDir((dir) => {
    const result = validateManifest(
      parseYaml(practiceManifestYaml(['expected: "select a from t"', 'ordered: "yes"'])),
      dir,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.path === "modules[0].lessons[0].practice.ordered"));
  });
});

// --- practice.type: the discriminator ------------------------------------

/** A one-lesson manifest whose only lesson carries an `answer` practice
 * built from the given lines (already indented to `practice:`'s children).
 * No `sandboxes:` at all — an answer assignment must not need one. */
function answerManifestYaml(practiceLines: readonly string[]): string {
  return [
    "id: fixture-course",
    "version: 1.0.0",
    "title: Fixture course",
    "modules:",
    "  - id: intro",
    "    title: Intro",
    "    lessons:",
    "      - id: only-lesson",
    "        title: Only lesson",
    "        practice:",
    "          type: answer",
    "          prompt: Report what you got.",
    ...practiceLines.map((line) => `          ${line}`),
    "",
  ].join("\n");
}

const VALID_ANSWER_FIELDS = [
  "fields:",
  "  - id: headcount",
  '    label: "Сколько сотрудников?"',
  "    kind: number",
  "    expected: 112",
  "  - id: turnover",
  '    label: "Текучесть, %"',
  "    kind: number",
  "    expected: 18.5",
  "    tolerance: 0.2",
  "  - id: top-reason",
  '    label: "Самая частая причина"',
  "    kind: text",
  '    expected: "По собственному желанию"',
];

void test("validateManifest treats a practice with no type as sql — an older course stays valid unchanged", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const practice = sqlPracticeOf(validateManifest(parseYaml(validManifestYaml()), dir));

    // The manifest never wrote `type:`; the domain model always carries it.
    assert.equal(practice.type, "sql");
    assert.equal(practice.sandbox, "main");
  });
});

void test("validateManifest accepts a type: answer practice, with no sandbox anywhere in the course", () => {
  withPackageDir((dir) => {
    const practice = answerPracticeOf(validateManifest(parseYaml(answerManifestYaml(VALID_ANSWER_FIELDS)), dir));

    assert.equal(practice.prompt, "Report what you got.");
    assert.deepEqual(
      practice.fields.map((field) => field.id),
      ["headcount", "turnover", "top-reason"],
    );
    assert.deepEqual(practice.fields[0], {
      id: "headcount",
      label: "Сколько сотрудников?",
      kind: "number",
      expected: 112,
      // The manifest omitted it; "по умолчанию 0" is resolved here, once.
      tolerance: 0,
    });
    assert.equal(practice.fields[1]?.tolerance, 0.2);
    // A text field carries no tolerance at all — `0` would claim the
    // assignment declared something it can't have.
    assert.equal(practice.fields[2]?.tolerance, undefined);
    assert.equal(practice.fields[2]?.expected, "По собственному желанию");
  });
});

/**
 * Every property the `sql` capability declares and the `answer` one does
 * not, as a YAML line. Derived, not listed: the hand-written list this
 * replaces was missing `solution` — added to `sql` long after the list was
 * written, and nothing said so. All of them are scalars, which is why one
 * stub value per type is enough.
 */
function sqlOnlyPracticeLines(): readonly string[] {
  const answerFields = new Set((practiceTypeCapability("answer")?.manifestFields ?? []).map((field) => field.name));
  return (practiceTypeCapability("sql")?.manifestFields ?? [])
    .filter((field) => !answerFields.has(field.name))
    .map((field) => `${field.name}: ${field.valueType === "boolean" ? "true" : '"x"'}`);
}

void test("validateManifest rejects sql-only properties on a type: answer practice", () => {
  const lines = sqlOnlyPracticeLines();
  // Guards the derivation itself: an empty list would make every
  // assertion below vacuous while the test still reported success.
  assert.ok(lines.length >= 5, `expected the sql type to declare properties answer does not: ${lines.join(", ")}`);
  for (const line of lines) {
    withPackageDir((dir) => {
      const result = validateManifest(parseYaml(answerManifestYaml([...VALID_ANSWER_FIELDS, line])), dir);

      assert.equal(result.ok, false, `expected ${line} to be rejected`);
      if (result.ok) return;
      const property = line.split(":")[0];
      assert.ok(
        result.errors.some(
          (err) =>
            err.path === `modules[0].lessons[0].practice.${property}` ||
            // `ordered` alone never reaches the semantic pass: the
            // schema's `dependentRequired` rejects it first (for wanting
            // an `expected` that is itself forbidden here), and that error
            // is reported against the practice object. Either rejection
            // is the right answer — what matters is that it is rejected.
            err.path === "modules[0].lessons[0].practice",
        ),
        `no error naming practice.${property}: ${JSON.stringify(result.errors)}`,
      );
    });
  }
});

void test("validateManifest rejects a type: answer practice with no fields", () => {
  withPackageDir((dir) => {
    const result = validateManifest(parseYaml(answerManifestYaml([])), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) => err.path === "modules[0].lessons[0].practice.fields" && /must declare "fields"/.test(err.message),
      ),
      JSON.stringify(result.errors),
    );
  });
});

void test("validateManifest rejects an empty fields list (structural, minItems)", () => {
  withPackageDir((dir) => {
    const result = validateManifest(parseYaml(answerManifestYaml(["fields: []"])), dir);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((err) => err.path === "modules[0].lessons[0].practice.fields"));
  });
});

void test("validateManifest rejects duplicate answer field ids", () => {
  withPackageDir((dir) => {
    const result = validateManifest(
      parseYaml(
        answerManifestYaml([
          "fields:",
          "  - id: same",
          '    label: "One"',
          "    kind: number",
          "    expected: 1",
          "  - id: same",
          '    label: "Two"',
          "    kind: number",
          "    expected: 2",
        ]),
      ),
      dir,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) =>
          err.path === "modules[0].lessons[0].practice.fields[1].id" && /Duplicate answer field id/.test(err.message),
      ),
      JSON.stringify(result.errors),
    );
  });
});

void test("validateManifest rejects an expected value whose type does not match its kind", () => {
  const cases = [
    { kind: "number", expected: '"сто двенадцать"', wanted: /must be a number/ },
    { kind: "text", expected: "112", wanted: /must be a string/ },
  ] as const;

  for (const scenario of cases) {
    withPackageDir((dir) => {
      const result = validateManifest(
        parseYaml(
          answerManifestYaml([
            "fields:",
            "  - id: only",
            '    label: "Only"',
            `    kind: ${scenario.kind}`,
            `    expected: ${scenario.expected}`,
          ]),
        ),
        dir,
      );

      assert.equal(result.ok, false, `expected kind ${scenario.kind} / ${scenario.expected} to be rejected`);
      if (result.ok) return;
      const error = result.errors.find((err) => err.path === "modules[0].lessons[0].practice.fields[0].expected");
      assert.ok(error !== undefined, JSON.stringify(result.errors));
      assert.match(error.message, scenario.wanted);
      // The right answer is never quoted back, not even into a validation
      // error — a manifest error ends up in logs and API responses.
      assert.doesNotMatch(error.message, /сто двенадцать|112/);
    });
  }
});

void test("validateManifest rejects a blank text expected — nothing would be left to get right", () => {
  withPackageDir((dir) => {
    const result = validateManifest(
      parseYaml(
        answerManifestYaml(["fields:", "  - id: only", '    label: "Only"', "    kind: text", '    expected: "   "']),
      ),
      dir,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.errors.some(
        (err) =>
          err.path === "modules[0].lessons[0].practice.fields[0].expected" && /blank "expected"/.test(err.message),
      ),
      JSON.stringify(result.errors),
    );
  });
});

void test("validateManifest rejects tolerance on a text field, and a negative one anywhere", () => {
  withPackageDir((dir) => {
    const onText = validateManifest(
      parseYaml(
        answerManifestYaml([
          "fields:",
          "  - id: only",
          '    label: "Only"',
          "    kind: text",
          '    expected: "да"',
          "    tolerance: 0.5",
        ]),
      ),
      dir,
    );
    assert.equal(onText.ok, false);
    if (!onText.ok) {
      assert.ok(
        onText.errors.some((err) => err.path === "modules[0].lessons[0].practice.fields[0].tolerance"),
        JSON.stringify(onText.errors),
      );
    }

    const negative = validateManifest(
      parseYaml(
        answerManifestYaml([
          "fields:",
          "  - id: only",
          '    label: "Only"',
          "    kind: number",
          "    expected: 1",
          "    tolerance: -0.5",
        ]),
      ),
      dir,
    );
    assert.equal(negative.ok, false);
    if (!negative.ok) {
      assert.ok(negative.errors.some((err) => err.path === "modules[0].lessons[0].practice.fields[0].tolerance"));
    }
  });
});

void test("validateManifest rejects fields on a sql practice, and a sql practice with no sandbox", () => {
  withPackageDir((dir) => {
    const withFields = validateManifest(
      parseYaml(
        practiceManifestYaml(["fields:", "  - id: x", '    label: "X"', "    kind: number", "    expected: 1"]),
      ),
      dir,
    );
    assert.equal(withFields.ok, false);
    if (!withFields.ok) {
      assert.ok(
        withFields.errors.some(
          (err) => err.path === "modules[0].lessons[0].practice.fields" && /type "answer"/.test(err.message),
        ),
        JSON.stringify(withFields.errors),
      );
    }

    // `sandbox` is no longer schema-required (an answer practice has
    // none), so "a sql practice without one" has to be caught here.
    const noSandbox = validateManifest(
      parseYaml(
        [
          "id: fixture-course",
          "version: 1.0.0",
          "title: Fixture course",
          "modules:",
          "  - id: intro",
          "    title: Intro",
          "    lessons:",
          "      - id: only-lesson",
          "        title: Only lesson",
          "        practice:",
          "          prompt: Do the thing.",
          "",
        ].join("\n"),
      ),
      dir,
    );
    assert.equal(noSandbox.ok, false);
    if (!noSandbox.ok) {
      assert.ok(
        noSandbox.errors.some(
          (err) => err.path === "modules[0].lessons[0].practice.sandbox" && /must declare "sandbox"/.test(err.message),
        ),
        JSON.stringify(noSandbox.errors),
      );
    }
  });
});
