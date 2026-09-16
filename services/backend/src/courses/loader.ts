import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { validateManifest } from "./validate.js";
import { describeError, isErrnoException } from "./fsErrors.js";
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
  // confirmed every `contentPath` existed and stayed inside packageDir *at
  // validation time*, but existence-then isn't readability-now: permissions
  // can change, and there's an inherent TOCTOU window between the check and
  // this read. So this read is wrapped too (fix round 1 — a lesson file that
  // turns unreadable between validation and this read must reject the
  // package with a clear reason, not throw an uncaught EACCES that takes
  // down the whole scan/registry/app startup).
  //
  // `lesson.contentPath` is already the absolute, realpath'd path
  // validate.ts resolved it to (final review, backend fixes round) — no
  // `path.resolve(packageDir, ...)` here anymore. That's not just less
  // code: re-deriving the path from the raw manifest string and packageDir
  // would re-open exactly the symlink-swap window resolveSafePath's
  // realpath check exists to close (validate a real target, then go read a
  // *different* lexical path that could have been repointed since).
  const contentReadErrors: ValidationError[] = [];
  const modules: CourseModule[] = manifest.modules.map((module, moduleIndex) => ({
    id: module.id,
    title: module.title,
    lessons: module.lessons.map((lesson, lessonIndex): CourseLesson => {
      let content: string | undefined;
      if (lesson.contentPath !== undefined) {
        try {
          content = fs.readFileSync(lesson.contentPath, "utf8");
        } catch (err) {
          contentReadErrors.push({
            path: `modules[${moduleIndex}].lessons[${lessonIndex}].content`,
            message: `Cannot read "${lesson.contentPath}": ${describeError(err)}`,
          });
        }
      }
      return { id: lesson.id, title: lesson.title, content, quiz: lesson.quiz, practice: lesson.practice };
    }),
  }));

  if (contentReadErrors.length > 0) {
    return { ok: false, errors: contentReadErrors };
  }

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
    .filter((entry) => isCourseCandidateDirectory(coursesDir, entry))
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

/**
 * `fs.Dirent#isDirectory()` reports the directory ENTRY's own type — for a
 * symlink it's always `false`, regardless of what the link points at (it
 * does not follow the link). Filtering on that alone silently drops a
 * symlinked course directory: not listed, not rejected, nothing logged —
 * just gone, with no trace anywhere a user (or this codebase's own tests)
 * would think to look (final review, backend fixes round). A symlink to a
 * course directory is a normal way to keep course content elsewhere on disk
 * (synced from a git checkout, another drive, ...) on a local, single-user
 * product where the person hitting this IS the one confused by content
 * silently vanishing — so it's supported here, not rejected: `fs.statSync`
 * (which does follow the link) decides whether it resolves to a directory.
 * A broken symlink or one pointing at a non-directory falls through to
 * `false` — same treatment as any other stray non-directory entry directly
 * under `coursesDir` (a stray README.md, say): not a course candidate, not
 * a special case worth its own rejection reason.
 */
function isCourseCandidateDirectory(coursesDir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(coursesDir, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}
