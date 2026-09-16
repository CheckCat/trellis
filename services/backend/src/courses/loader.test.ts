import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadCoursePackage, scanCoursesDir } from "./loader.js";
import {
  makeTempDir,
  validCourseFixtureFiles,
  validManifestYaml,
  writeCoursePackage,
  writeFixtureFiles,
} from "./testSupport.js";

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

void test(
  "loadCoursePackage rejects (does not throw) when a lesson's content file becomes unreadable after validation (fix round 1, Critical 1)",
  async (t) => {
    const packageDir = makeTempDir();
    try {
      writeFixtureFiles(packageDir, [
        { path: "manifest.yaml", content: validManifestYaml() },
        ...validCourseFixtureFiles(),
      ]);
      const contentPath = path.join(packageDir, "lessons", "first-lesson.md");

      // chmod 000 only actually blocks reads for a non-root process —
      // running as root (common in some container/CI setups) bypasses file
      // permissions entirely, which would make this test assert nothing.
      // Skip rather than false-green in that case, same spirit as this
      // codebase's TRELLIS_TEST_DATABASE_URL-gated skips
      // (db/testSupport.ts's connectToDisposableTestDbOrSkip).
      fs.chmodSync(contentPath, 0o000);
      let permissionsAreEnforced = true;
      try {
        fs.readFileSync(contentPath, "utf8");
        permissionsAreEnforced = false;
      } catch {
        // expected: EACCES
      }
      if (!permissionsAreEnforced) {
        fs.chmodSync(contentPath, 0o644);
        t.skip("file permissions are not enforced for this process (likely running as root) — skipping");
        return;
      }

      // The whole point of this test: this must NOT throw. Before fix round
      // 1, `fs.readFileSync` inside loadCoursePackage's module-building step
      // was unguarded, so an EACCES here propagated all the way up through
      // scanCoursesDir/createCourseRegistry/buildServer and crashed app
      // startup — exactly the invariant the brief calls out ("один битый
      // курс не имеет права ронять старт приложения").
      const result = loadCoursePackage(packageDir);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0]?.path, "modules[0].lessons[0].content");
      assert.ok(result.errors[0]?.message.includes("first-lesson.md"));
    } finally {
      fs.chmodSync(path.join(packageDir, "lessons", "first-lesson.md"), 0o644);
      fs.rmSync(packageDir, { recursive: true, force: true });
    }
  },
);

void test("scanCoursesDir treats a symlinked directory as a course candidate, not a silent no-op (final review, backend fixes round)", () => {
  const coursesDir = makeTempDir();
  // The actual package content lives outside coursesDir entirely (a
  // separate temp dir) — this is the realistic case the finding calls out:
  // a course kept elsewhere on disk (a git checkout, another drive, synced
  // content) and symlinked into COURSES_DIR, not a symlink between two
  // sibling entries of the same directory.
  const realCourseDir = makeTempDir();
  try {
    writeFixtureFiles(realCourseDir, [
      { path: "manifest.yaml", content: validManifestYaml("symlinked-course") },
      ...validCourseFixtureFiles(),
    ]);
    fs.symlinkSync(realCourseDir, path.join(coursesDir, "course-via-symlink"), "dir");

    const result = scanCoursesDir(coursesDir);

    // Before this fix: `fs.Dirent#isDirectory()` on the symlink entry is
    // `false` (it reports the link's own type, not the target's), so the
    // symlinked directory was filtered out before ever being attempted —
    // not listed as a course, not in `rejected`, nothing logged. This
    // assertion is the actual regression check: the course must be loaded.
    assert.equal(result.rejected.length, 0);
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0]?.id, "symlinked-course");
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
    fs.rmSync(realCourseDir, { recursive: true, force: true });
  }
});

void test("scanCoursesDir ignores a broken symlink under coursesDir without crashing (edge case)", () => {
  withTempDir((coursesDir) => {
    fs.symlinkSync(path.join(coursesDir, "does-not-exist"), path.join(coursesDir, "dangling-link"), "dir");
    const result = scanCoursesDir(coursesDir);
    assert.deepEqual(result, { courses: [], rejected: [] });
  });
});
