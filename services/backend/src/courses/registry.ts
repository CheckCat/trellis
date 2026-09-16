import path from "node:path";

import { scanCoursesDir, type RejectedCourse } from "./loader.js";
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
  readonly accepted: number;
  readonly rejected: number;
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
   * are (re)loaded; there is no filesystem watcher (task-006 brief). */
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
      logger.warn(
        `Could not read courses directory "${coursesDir}": ${describeError(err)} — keeping the previous course list ` +
          "unchanged (0 courses if this is the initial scan at startup). Check that COURSES_DIR points at a readable directory.",
      );
      return { accepted: courses.size, rejected: rejected.length };
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
    return { accepted: courses.size, rejected: rejected.length };
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

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Makes `fastify.courses` (decorated in server.ts) known to the type system
// everywhere `FastifyInstance` is used — same pattern as `fastify.db` in
// db/pool.ts.
declare module "fastify" {
  interface FastifyInstance {
    courses: CourseRegistry;
  }
}
