import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createCourseRegistry } from "./registry.js";
import { makeTempDir, validCourseFixtureFiles, validManifestYaml, writeCoursePackage } from "./testSupport.js";

function withTempDir(run: (dir: string) => void): void {
  const dir = makeTempDir();
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void test("createCourseRegistry scans synchronously at construction (list()/get() work immediately)", () => {
  withTempDir((coursesDir) => {
    writeCoursePackage(coursesDir, "course-a", validManifestYaml("course-a"), validCourseFixtureFiles());

    const registry = createCourseRegistry(coursesDir);

    assert.deepEqual(registry.list(), [
      { id: "course-a", version: "1.0.0", title: "Fixture course", description: "A synthetic course used only by backend tests." },
    ]);
    assert.equal(registry.get("course-a")?.id, "course-a");
    assert.equal(registry.get("unknown-course"), undefined);
    assert.deepEqual(registry.listRejected(), []);
  });
});

void test("createCourseRegistry over a missing coursesDir yields an empty, valid registry (not an error)", () => {
  withTempDir((tempDir) => {
    const registry = createCourseRegistry(`${tempDir}/does-not-exist`);
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.rescan().accepted, 0);
    assert.equal(registry.rescan().rejected, 0);
  });
});

void test("rescan() picks up a course package added after the initial scan, but not before it's called (explicit rescan only)", () => {
  withTempDir((coursesDir) => {
    const registry = createCourseRegistry(coursesDir);
    assert.deepEqual(registry.list(), []);

    writeCoursePackage(coursesDir, "course-a", validManifestYaml("course-a"), validCourseFixtureFiles());
    // Not visible yet — no filesystem watcher, only explicit rescan() (brief).
    assert.deepEqual(registry.list(), []);

    const result = registry.rescan();
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 0);
    assert.equal(registry.get("course-a")?.id, "course-a");
  });
});

void test("createCourseRegistry rejects the second of two directories that declare the same course id, deterministically (edge case)", () => {
  withTempDir((coursesDir) => {
    // "aaa-dir" sorts before "zzz-dir" — scanCoursesDir scans in that order,
    // so "aaa-dir" must be the one that wins regardless of write order here.
    writeCoursePackage(coursesDir, "zzz-dir", validManifestYaml("dup-id", "lesson-one"), validCourseFixtureFiles("lesson-one"));
    writeCoursePackage(coursesDir, "aaa-dir", validManifestYaml("dup-id", "lesson-two"), validCourseFixtureFiles("lesson-two"));

    const registry = createCourseRegistry(coursesDir);

    assert.equal(registry.list().length, 1);
    assert.equal(registry.get("dup-id")?.dir, `${coursesDir}/aaa-dir`);
    assert.equal(registry.listRejected().length, 1);
    assert.equal(registry.listRejected()[0]?.dir, "zzz-dir");
    assert.ok(registry.listRejected()[0]?.errors.some((err) => /duplicate course id/i.test(err.message)));
  });
});

void test("createCourseRegistry over a coursesDir that is actually a file starts up with a readable warning, not a crash (fix round 1, Important 3)", () => {
  withTempDir((tempDir) => {
    const notADirectory = path.join(tempDir, "courses-is-a-file");
    fs.writeFileSync(notADirectory, "oops, this is a file, not a directory", "utf8");

    const warnings: string[] = [];
    // The whole point: this constructor call must not throw (readdirSync on
    // a file throws ENOTDIR) — before fix round 1 this propagated straight
    // out of createCourseRegistry with a bare Node stack trace, which is
    // exactly what an installer-style local app (.mvp/invariants.md) must
    // never show the user at startup.
    const registry = createCourseRegistry(notADirectory, { warn: (message) => warnings.push(message) });

    assert.deepEqual(registry.list(), []);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]?.includes(notADirectory));
    assert.ok(!/\bat\s+\S+\s*\(/.test(warnings[0] ?? ""), "warning message must not look like a raw stack trace");
  });
});

void test("createCourseRegistry logs a warning for every rejected package on scan", () => {
  withTempDir((coursesDir) => {
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
      "",
    ].join("\n");
    writeCoursePackage(coursesDir, "broken-course", brokenYaml);

    const warnings: string[] = [];
    createCourseRegistry(coursesDir, { warn: (message) => warnings.push(message) });

    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]?.includes("broken-course"));
  });
});
