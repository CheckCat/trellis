import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { validateManifest } from "./validate.js";
import type { Course, CourseLesson, CourseModule, LoadResult, ValidationError } from "./types.js";

const MANIFEST_FILENAME = "manifest.yaml";

/**
 * Loads and validates a single course package directory. Never throws —
 * every failure (unreadable manifest, invalid YAML, failed structural or
 * semantic validation) comes back as `{ ok: false, errors }` with the same
 * `ValidationError` shape validate.ts uses, so callers (scanCoursesDir,
 * registry.ts) don't need to special-case "IO error" vs "validation error".
 */
export function loadCoursePackage(packageDir: string): LoadResult {
  const manifestPath = path.join(packageDir, MANIFEST_FILENAME);

  let manifestText: string;
  try {
    manifestText = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: "", message: `Cannot read "${MANIFEST_FILENAME}": ${describeError(err)}` }],
    };
  }

  let manifestSource: unknown;
  try {
    manifestSource = parseYaml(manifestText);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: "", message: `"${MANIFEST_FILENAME}" is not valid YAML: ${describeError(err)}` }],
    };
  }

  const result = validateManifest(manifestSource, packageDir);
  if (!result.ok) {
    return result;
  }

  const { manifest } = result;
  // Reading lesson Markdown is deliberately this module's job, not
  // validate.ts's (task-006 brief, requirement 2 vs 3) — validate.ts already
  // confirmed every `contentPath` exists and stays inside packageDir, so
  // this read can't escape the package.
  const modules: CourseModule[] = manifest.modules.map((module) => ({
    id: module.id,
    title: module.title,
    lessons: module.lessons.map((lesson): CourseLesson => {
      const content =
        lesson.contentPath === undefined
          ? undefined
          : fs.readFileSync(path.resolve(packageDir, lesson.contentPath), "utf8");
      return { id: lesson.id, title: lesson.title, content, quiz: lesson.quiz, practice: lesson.practice };
    }),
  }));

  const course: Course = {
    id: manifest.id,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description,
    dir: path.resolve(packageDir),
    sandboxes: manifest.sandboxes,
    modules,
  };

  return { ok: true, course };
}

export interface RejectedCourse {
  /** The package's directory name (relative to coursesDir), not a full
   * path — this is what an operator sees in `courses/<dir>` and needs to
   * find the broken package. */
  readonly dir: string;
  readonly errors: readonly ValidationError[];
}

export interface ScannedCourses {
  readonly courses: readonly Course[];
  readonly rejected: readonly RejectedCourse[];
}

/**
 * Scans every immediate subdirectory of `coursesDir` and loads each as a
 * course package. A missing `coursesDir` is "no courses yet", not an
 * error — the caller (registry.ts) gets an empty, valid registry rather
 * than a thrown exception; this mirrors validateManifest's "one broken
 * course can't take the app down" contract one level up (a missing/broken
 * *directory* can't either).
 *
 * Does not detect duplicate course ids across directories — that requires
 * seeing every directory's result at once and picking a deterministic
 * "first wins" order, which is registry.ts's job (this function has no
 * opinion on registry-wide state, only on what's on disk).
 */
export function scanCoursesDir(coursesDir: string): ScannedCourses {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(coursesDir, { withFileTypes: true });
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return { courses: [], rejected: [] };
    }
    throw err;
  }

  // Sorted for a deterministic scan order — registry.ts's "first directory
  // wins on a duplicate id" rule needs a stable ordering to be meaningful
  // and reproducible across restarts/rescans.
  const dirNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const courses: Course[] = [];
  const rejected: RejectedCourse[] = [];
  for (const dirName of dirNames) {
    const result = loadCoursePackage(path.join(coursesDir, dirName));
    if (result.ok) {
      courses.push(result.course);
    } else {
      rejected.push({ dir: dirName, errors: result.errors });
    }
  }

  return { courses, rejected };
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
