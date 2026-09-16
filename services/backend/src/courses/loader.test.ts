import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadCoursePackage, scanCoursesDir } from "./loader.js";
import { makeTempDir, validCourseFixtureFiles, validManifestYaml, writeCoursePackage } from "./testSupport.js";

function withTempDir(run: (dir: string) => void): void {
  const dir = makeTempDir();
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void test("scanCoursesDir returns an empty list when COURSES_DIR does not exist (not an error)", () => {
  withTempDir((tempDir) => {
    const missingDir = path.join(tempDir, "does-not-exist");
    const result = scanCoursesDir(missingDir);
    assert.deepEqual(result, { courses: [], rejected: [] });
  });
});

void test("scanCoursesDir returns an empty list for an existing but empty COURSES_DIR (edge case)", () => {
  withTempDir((coursesDir) => {
    const result = scanCoursesDir(coursesDir);
    assert.deepEqual(result, { courses: [], rejected: [] });
  });
});

void test("scanCoursesDir loads a valid course and rejects a broken one in the same directory, with a reason (happy + error path)", () => {
  withTempDir((coursesDir) => {
    writeCoursePackage(coursesDir, "good-course", validManifestYaml("good-course"), validCourseFixtureFiles());
    // Broken: references a sandbox that was never declared.
    const brokenYaml = [
      "id: broken-course",
      "version: 1.0.0",
      "title: Broken course",
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
    writeCoursePackage(coursesDir, "broken-course", brokenYaml);

    const result = scanCoursesDir(coursesDir);

    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0]?.id, "good-course");
    assert.equal(result.courses[0]?.modules[0]?.lessons[0]?.content, "# First lesson\n\nHello.");

    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0]?.dir, "broken-course");
    assert.ok(result.rejected[0]?.errors.some((err) => err.message.includes("nonexistent")));
  });
});

void test("loadCoursePackage fails with a clear reason when manifest.yaml is missing (error path)", () => {
  withTempDir((packageDir) => {
    const result = loadCoursePackage(packageDir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]?.message.includes("manifest.yaml"));
  });
});

void test("loadCoursePackage fails with a clear reason when manifest.yaml is not valid YAML (error path)", () => {
  withTempDir((packageDir) => {
    fs.writeFileSync(path.join(packageDir, "manifest.yaml"), "id: [this is not: valid: yaml", "utf8");
    const result = loadCoursePackage(packageDir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors[0]?.message.toLowerCase().includes("yaml"));
  });
});
