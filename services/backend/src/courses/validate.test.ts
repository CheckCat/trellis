import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import { validateManifest } from "./validate.js";
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
    assert.equal(lesson?.contentPath, "lessons/first-lesson.md");
    assert.equal(lesson?.quiz?.options.length, 2);
    assert.equal(lesson?.quiz?.options[0]?.correct, true);
    assert.equal(lesson?.quiz?.options[1]?.correct, false);
    assert.equal(lesson?.practice?.sandbox, "main");
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
