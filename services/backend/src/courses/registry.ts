import path from "node:path";

import { scanCoursesDir, type RejectedCourse } from "./loader.js";
import { describeError, isErrnoException } from "./fsErrors.js";
import type { Course, ValidationError } from "./types.js";

export interface CourseSummary {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description?: string;
}

/** Same shape as loader.ts's `RejectedCourse`, plus the course id when it's
 * known (loader.ts doesn't know it — it only sees one directory at a time;
 * the registry adds it once available, in particular for duplicate-id
 * rejections). */
export interface RegistryRejectedCourse {
  readonly dir: string;
  readonly courseId?: string;
  readonly errors: readonly ValidationError[];
}

export interface RescanResult {
  /**
   * Fix round 2: when `scanFailed` is true, these two counts describe the
   * PREVIOUS (unchanged) state, not a fresh scan's result — the scan
   * itself never ran to completion (couldn't even read `coursesDir`), so
   * there is nothing new to count. Callers (routes/courses.ts) must check
   * `scanFailed` before presenting `accepted`/`rejected` as "what this
   * rescan found" — otherwise a failed scan that happens to match the
   * previous count (e.g. the common case: nothing changed since the last
   * successful scan) is indistinguishable from a real, successful rescan
   * that found the same numbers. That indistinguishability was the actual
   * bug this round fixes: `POST /courses/rescan` on an unreadable
   * `coursesDir` used to come back byte-for-byte identical to a genuine
   * success.
   */
  readonly accepted: number;
  readonly rejected: number;
  /** True when this scan could not read `coursesDir` at all (missing
   * permissions, `coursesDir` turned out to be a file, ...) — see
   * `scanError` for a human-readable reason. False on every ordinary scan,
   * including one that found 0 courses. */
  readonly scanFailed: boolean;
  /** Set only when `scanFailed` is true. Installer-style wording (see
   * describeScanFailure below) — safe to show directly to the person who
   * clicked "rescan" in a UI, not a raw errno/stack trace. */
  readonly scanError?: string;
}

/** Same "optional logger, no-op by default" convention as migrate.ts's
 * `MigrationLogger` (single string message — the caller/registry does its
 * own formatting, same as there) — a rejected course is the only thing
 * worth logging on a scan, so this only needs `warn`. */
export interface RegistryLogger {
  warn(message: string): void;
}

const noopLogger: RegistryLogger = { warn: () => {} };

export interface CourseRegistry {
  /** Valid courses only, summary shape (id/version/title/description) — see
   * GET /courses. */
  list(): CourseSummary[];
  /** The full validated+loaded course, or `undefined` if `courseId` isn't a
   * currently-accepted course (unknown id, or rejected — rejected courses
   * are never returned here, only via `listRejected()`). */
  get(courseId: string): Course | undefined;
  /** Every package that failed to load this scan, with its reason — "valid
   * until shown otherwise" for the operator, not silently dropped. */
  listRejected(): RegistryRejectedCourse[];
  /** Re-reads `coursesDir` from scratch and replaces the in-memory state
   * atomically (readers never see a partial scan) — the only way courses
   * are (re)loaded; there is no filesystem watcher (task-006 brief). If
   * `coursesDir` itself can't be read at all, the previous state is left in
   * place and the result comes back with `scanFailed: true` (fix round 2) —
   * check that flag before treating `accepted`/`rejected` as this scan's
   * result. */
  rescan(): RescanResult;
}

function toSummary(course: Course): CourseSummary {
  return { id: course.id, version: course.version, title: course.title, description: course.description };
}

/**
 * Builds an in-memory course registry and performs the initial scan of
 * `coursesDir` synchronously before returning — "первичное сканирование при
 * старте приложения, до готовности API отдавать курсы" (task-006 brief):
 * by the time `createCourseRegistry` returns, `list()`/`get()` already
 * reflect disk state, so there's no window where the API is up but the
 * registry is still empty because a scan hasn't run yet.
 *
 * `logger` gets one `warn` per rejected package on every scan (including
 * this initial one) — the brief requires a rejection's reason to be visible
 * via "API or logs"; routes/courses.ts covers the API side (`GET
 * /courses/:id` 404s don't leak it, but `POST /courses/rescan` echoes the
 * full list), this covers the logs side. Defaults to a no-op so tests that
 * don't care about logging don't need to pass one.
 */
export function createCourseRegistry(coursesDir: string, logger: RegistryLogger = noopLogger): CourseRegistry {
  let courses = new Map<string, Course>();
  let rejected: RegistryRejectedCourse[] = [];

  function rescan(): RescanResult {
    // scanCoursesDir only special-cases a *missing* coursesDir (ENOENT) as
    // "no courses"; anything else it can't read (coursesDir is a file —
    // ENOTDIR, or unreadable — EACCES) still throws. Fix round 1: a
    // misconfigured mount must produce a readable log line, not an uncaught
    // exception that takes down app startup with a bare Node stack trace —
    // this is a local, installer-style app (see .mvp/invariants.md), not a
    // service with an ops team reading stack traces. On such a failure the
    // previous scan's state is kept as-is (nothing to replace it with) —
    // deliberately not wiped to empty, so a transient/one-off read error on
    // a *re*scan doesn't make previously-good courses disappear.
    let scanned: ReturnType<typeof scanCoursesDir>;
    try {
      scanned = scanCoursesDir(coursesDir);
    } catch (err) {
      // Fix round 2: the caller (routes/courses.ts, ultimately whoever
      // clicked "rescan") needs a machine-readable way to tell "this scan
      // failed, these are stale counts" apart from "this scan genuinely
      // found the same numbers as before" — before this, both cases
      // returned the exact same `{ accepted, rejected }` shape, so a failed
      // rescan of a `chmod 000`'d coursesDir looked byte-for-byte identical
      // to a real, successful no-op rescan. `scanFailed`/`scanError` make
      // the failure visible to the HTTP client, not just the server log
      // (this is a local single-user app — nobody is tailing server logs).
      const scanError = describeScanFailure(coursesDir, err);
      logger.warn(`${scanError} Keeping the previous course list unchanged.`);
      return { accepted: courses.size, rejected: rejected.length, scanFailed: true, scanError };
    }
    const { courses: loaded, rejected: loadRejected } = scanned;

    const nextCourses = new Map<string, Course>();
    const nextRejected: RegistryRejectedCourse[] = loadRejected.map(fromLoaderRejection);

    // Deterministic "first directory wins" — scanCoursesDir already returns
    // `loaded` sorted by directory name, so this loop order is stable
    // across restarts and rescans, not "whichever finished loading last".
    for (const course of loaded) {
      const existing = nextCourses.get(course.id);
      if (existing === undefined) {
        nextCourses.set(course.id, course);
      } else {
        nextRejected.push({
          dir: path.basename(course.dir),
          courseId: course.id,
          errors: [
            {
              path: "id",
              message:
                `Duplicate course id "${course.id}" — already used by package directory ` +
                `"${path.basename(existing.dir)}" (directories are scanned in alphabetical order; ` +
                `the first one to claim an id keeps it, later ones are rejected — not "last scanned wins").`,
            },
          ],
        });
      }
    }

    for (const entry of nextRejected) {
      logger.warn(
        `Course package rejected: "${entry.dir}"${entry.courseId === undefined ? "" : ` (id "${entry.courseId}")`} — ` +
          entry.errors.map((error) => (error.path === "" ? error.message : `${error.path}: ${error.message}`)).join("; "),
      );
    }

    courses = nextCourses;
    rejected = nextRejected;
    return { accepted: courses.size, rejected: rejected.length, scanFailed: false };
  }

  rescan();

  return {
    list: () => Array.from(courses.values()).map(toSummary),
    get: (courseId) => courses.get(courseId),
    listRejected: () => rejected,
    rescan,
  };
}

function fromLoaderRejection(rejection: RejectedCourse): RegistryRejectedCourse {
  return { dir: rejection.dir, errors: rejection.errors };
}

/**
 * Turns a `scanCoursesDir` failure into an installer-style sentence: no
 * errno, no stack trace, just what's wrong with the folder and what to do
 * about it. This is what ends up in `RescanResult.scanError` and gets
 * echoed back over HTTP — the person who clicked "rescan" in a UI needs to
 * understand it without ever opening a server log (fix round 2).
 */
function describeScanFailure(coursesDir: string, err: unknown): string {
  if (isErrnoException(err)) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      return `The courses folder ("${coursesDir}") could not be read — check that this app has permission to read it.`;
    }
    if (err.code === "ENOTDIR") {
      return `"${coursesDir}" is not a folder — check that the courses location points at a directory, not a file.`;
    }
  }
  return `The courses folder ("${coursesDir}") could not be scanned: ${describeError(err)}.`;
}

// Makes `fastify.courses` (decorated in server.ts) known to the type system
// everywhere `FastifyInstance` is used — same pattern as `fastify.db` in
// db/pool.ts.
declare module "fastify" {
  interface FastifyInstance {
    courses: CourseRegistry;
  }
}
