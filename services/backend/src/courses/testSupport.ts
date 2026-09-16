// Shared test-only helpers for building throwaway course package fixtures on
// disk (`manifest.yaml` + Markdown/SQL files). Several *.test.ts files under
// courses/ and routes/ all need "write a synthetic course package tree to a
// temp dir" — that's real logic worth sharing (SRP > DRY, but DRY still
// applies once it's actual logic, not just similar-looking lines — see
// backend-implementer role's "Common Agent Principles"), not per-file
// copy-paste.
//
// Kept out of the production build the same way *.test.ts is: see
// tsconfig.json's `exclude` (tsconfig.test.json resets `exclude` to `[]`, so
// this file IS compiled for `npm test`, same as any *.test.ts).
//
// Every fixture below is synthetic — no real course's ids/titles/content
// (task-006 brief: the core, and its tests, know nothing about any specific
// course).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FixtureFile {
  readonly path: string;
  readonly content: string;
}

/** Creates a fresh, empty temp directory. Callers must remove it themselves
 * (`fs.rmSync(dir, { recursive: true, force: true })`) in a `finally`. */
export function makeTempDir(prefix = "trellis-courses-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Writes each fixture file under `dir`, creating parent directories as
 * needed. */
export function writeFixtureFiles(dir: string, files: readonly FixtureFile[]): void {
  for (const file of files) {
    const fullPath = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf8");
  }
}

/** Writes one course package directory (`<coursesDir>/<dirName>/`)
 * containing `manifest.yaml` plus any extra files (lesson Markdown, sandbox
 * seed SQL, ...) referenced by that manifest. Returns the package
 * directory's absolute path. */
export function writeCoursePackage(
  coursesDir: string,
  dirName: string,
  manifestYaml: string,
  extraFiles: readonly FixtureFile[] = [],
): string {
  const packageDir = path.join(coursesDir, dirName);
  fs.mkdirSync(packageDir, { recursive: true });
  writeFixtureFiles(packageDir, [{ path: "manifest.yaml", content: manifestYaml }, ...extraFiles]);
  return packageDir;
}

/**
 * A minimal, fully valid manifest.yaml body — one module, one lesson with
 * `content` + a two-option quiz + a `practice` referencing a declared
 * sandbox. Every relative path it references (`lessons/<slug>.md`,
 * `sandbox/01-schema.sql`) must exist under wherever this is written — see
 * `validCourseFixtureFiles()`, which provides exactly those files.
 */
export function validManifestYaml(courseId = "fixture-course", lessonId = "first-lesson"): string {
  return (
    `id: ${courseId}\n` +
    `version: 1.0.0\n` +
    `title: Fixture course\n` +
    `description: A synthetic course used only by backend tests.\n` +
    `sandboxes:\n` +
    `  - id: main\n` +
    `    type: postgres\n` +
    `    seed:\n` +
    `      - sandbox/01-schema.sql\n` +
    `modules:\n` +
    `  - id: intro\n` +
    `    title: Intro module\n` +
    `    lessons:\n` +
    `      - id: ${lessonId}\n` +
    `        title: First lesson\n` +
    `        content: lessons/${lessonId}.md\n` +
    `        quiz:\n` +
    `          question: "2 + 2 = ?"\n` +
    `          options:\n` +
    `            - id: a\n` +
    `              text: "4"\n` +
    `              correct: true\n` +
    `            - id: b\n` +
    `              text: "5"\n` +
    `              explanation: Simple arithmetic mistake.\n` +
    `        practice:\n` +
    `          sandbox: main\n` +
    `          prompt: Do the thing.\n` +
    `          check: "select count(*) = 1 from t"\n`
  );
}

/** The files `validManifestYaml()` references — pass to
 * `writeFixtureFiles`/`writeCoursePackage` alongside it. */
export function validCourseFixtureFiles(lessonId = "first-lesson"): FixtureFile[] {
  return [
    { path: `lessons/${lessonId}.md`, content: "# First lesson\n\nHello." },
    { path: "sandbox/01-schema.sql", content: "create table t (id int);" },
  ];
}
