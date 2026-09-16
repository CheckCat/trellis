// Everything course-shaped about the sandbox: which sandbox a course
// declares, whether its seed files are still where the scan said they were,
// and which course's sandbox is live right now. The driver below it
// (postgres-sandbox.ts) sees none of this — it gets a resolved `SandboxSpec`
// and nothing else.
//
// One live sandbox at a time, deliberately. The physical sandbox is a single
// schema in a single Postgres instance (docs/product/technical-solutions.md:
// "не отдельный сервис/контейнер: отдельная схема/роль внутри того же
// Postgres-инстанса"), so "course B's sandbox" and "course A's sandbox" are
// the same schema with different contents. Making that a visible, single
// slot of state — rather than pretending each course has its own — is what
// keeps `ensure()` honest: switching courses rebuilds, staying on one
// course doesn't.
//
// The state lives in memory only. After a restart nothing is known to be
// live, so the next `ensure()` rebuilds from seed — which is the correct
// answer for a sandbox by definition (its contents are disposable; the
// user's progress lives in `core`, under the application role, and is never
// touched here).

import fs from "node:fs";
import path from "node:path";

import type { CourseRegistry } from "../courses/registry.js";
import type { Course, CourseSandbox } from "../courses/types.js";
import { describeError } from "../courses/fsErrors.js";
import { resolveSafePath } from "../courses/validate.js";
import {
  SandboxError,
  type SandboxDriver,
  type SandboxProvisioner,
  type SandboxSeedFile,
  type SandboxSpec,
  type SandboxState,
} from "./types.js";

export interface CreateSandboxProvisionerOptions<TDriver extends SandboxDriver> {
  /** The same registry `fastify.courses` serves from — the sandbox must
   * never build a second view of what's installed. */
  readonly courses: CourseRegistry;
  readonly driver: TDriver;
  /** Injectable clock, so tests can assert on `readyAt` without sleeping. */
  readonly now?: () => Date;
}

export function createSandboxProvisioner<TDriver extends SandboxDriver>(
  options: CreateSandboxProvisionerOptions<TDriver>,
): SandboxProvisioner<TDriver> {
  const { courses, driver } = options;
  const now = options.now ?? (() => new Date());

  let state: SandboxState | undefined;

  // Provisioning is not re-entrant: two concurrent rebuilds would race over
  // the same schema (the second `drop schema ... cascade` blocking on the
  // first's locks until the sandbox role's 30s statement_timeout kills it),
  // and — worse — a `reset` interleaved with an `ensure` could leave `state`
  // describing a course whose seeds were then dropped by the other call.
  // Every state-changing operation goes through this queue, so they happen
  // one after another in call order. In-process serialization is sufficient
  // by construction: the product is a single local backend process.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    // `.then(op, op)` — a failed operation must not poison the queue for the
    // next caller (a broken seed is a normal outcome here, not a fatal one).
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  async function provisionNow(courseId: string, sandboxId: string | undefined): Promise<SandboxState> {
    const spec = resolveSpec(courses, courseId, sandboxId);
    // Cleared BEFORE the rebuild, not after: from here until the driver
    // reports success, what is actually in the sandbox is unknown (the
    // driver is mid-wipe). If the rebuild fails, "nothing is live" is the
    // truthful answer and the next `ensure()` will try again from scratch —
    // whereas leaving the old state would claim a course's seed data is
    // there when it may have just been dropped.
    state = undefined;
    await driver.provision(spec);
    state = {
      courseId: spec.courseId,
      sandboxId: spec.sandboxId,
      type: spec.type,
      seedFiles: spec.seedFiles.map((seed) => seed.relativePath),
      readyAt: now().toISOString(),
    };
    return state;
  }

  return {
    driver,

    ensure(courseId: string, sandboxId?: string): Promise<SandboxState> {
      return serialize(async () => {
        // Resolved even on the fast path: a caller naming a course that
        // isn't installed, or a sandbox the course doesn't declare, must get
        // the same error whether or not something else is live.
        const target = resolveSandbox(courses, courseId, sandboxId);
        if (state !== undefined && state.courseId === courseId && state.sandboxId === target.sandbox.id) {
          return state;
        }
        return await provisionNow(courseId, target.sandbox.id);
      });
    },

    reset(courseId: string, sandboxId?: string): Promise<SandboxState> {
      return serialize(() => provisionNow(courseId, sandboxId));
    },

    status(courseId?: string): SandboxState | undefined {
      if (state === undefined) {
        return undefined;
      }
      if (courseId !== undefined && state.courseId !== courseId) {
        return undefined;
      }
      return state;
    },

    close(): Promise<void> {
      return driver.close();
    },
  };
}

interface ResolvedSandbox {
  readonly course: Course;
  readonly sandbox: CourseSandbox;
}

/** Finds the course and the sandbox within it, or explains precisely which
 * of the two was the problem. No filesystem access — `ensure()`'s fast path
 * calls this on every request. */
function resolveSandbox(courses: CourseRegistry, courseId: string, sandboxId: string | undefined): ResolvedSandbox {
  const course = courses.get(courseId);
  if (course === undefined) {
    throw new SandboxError("course_not_found", `Course "${courseId}" was not found.`);
  }
  if (course.sandboxes.length === 0) {
    throw new SandboxError(
      "sandbox_not_found",
      `Course "${courseId}" does not declare a practice sandbox, so there is nothing to prepare or reset.`,
    );
  }
  if (sandboxId === undefined) {
    const [only] = course.sandboxes;
    if (course.sandboxes.length > 1 || only === undefined) {
      throw new SandboxError(
        "ambiguous_sandbox",
        `Course "${courseId}" declares several sandboxes (${course.sandboxes.map((s) => `"${s.id}"`).join(", ")}) ` +
          "— say which one to use.",
      );
    }
    return { course, sandbox: only };
  }
  const sandbox = course.sandboxes.find((candidate) => candidate.id === sandboxId);
  if (sandbox === undefined) {
    throw new SandboxError(
      "sandbox_not_found",
      `Course "${courseId}" does not declare a sandbox with id "${sandboxId}".`,
    );
  }
  return { course, sandbox };
}

/**
 * Turns "course X's sandbox Y" into the fully resolved, already-read
 * `SandboxSpec` the driver runs.
 *
 * Seed paths are re-validated here even though courses/validate.ts already
 * checked them at scan time: a scan can be arbitrarily old (there is no
 * filesystem watcher — rescanning is explicit), so between then and now a
 * seed file may have been deleted, replaced by a directory, or swapped for a
 * symlink pointing outside the package. task-006's report asks the executing
 * task to re-run `resolveSafePath` immediately before use for exactly this
 * reason; this is that call.
 */
function resolveSpec(courses: CourseRegistry, courseId: string, sandboxId: string | undefined): SandboxSpec {
  const { course, sandbox } = resolveSandbox(courses, courseId, sandboxId);
  const packageDir = course.dir;
  // `CourseSandbox.seed` holds absolute, realpath'd paths while `course.dir`
  // is the path as written under coursesDir — on macOS those differ for any
  // course under a symlinked directory (`/var/...` vs `/private/var/...`),
  // so the package-relative form is computed against the realpath of the
  // package directory, not against `course.dir` itself. Without this, every
  // relative path would come out as a `../../..` escape and every seed would
  // be rejected as "resolves outside the package directory".
  let realPackageDir: string;
  try {
    realPackageDir = fs.realpathSync(packageDir);
  } catch (err) {
    throw new SandboxError(
      "seed_unreadable",
      `The package directory of course "${courseId}" ("${packageDir}") could not be read: ${describeError(err)}.`,
      { cause: err },
    );
  }

  const seedFiles: SandboxSeedFile[] = sandbox.seed.map((absoluteSeedPath) => {
    const relativePath = path.relative(realPackageDir, absoluteSeedPath);
    const resolved = resolveSafePath(packageDir, relativePath);
    if (!resolved.ok) {
      throw new SandboxError(
        "seed_unreadable",
        `Seed file "${relativePath}" of course "${courseId}" is no longer usable: ${resolved.reason} ` +
          "Re-scan the courses folder (POST /courses/rescan) after fixing the package.",
        { seedFile: relativePath },
      );
    }
    let content: string;
    try {
      content = fs.readFileSync(resolved.absolutePath, "utf8");
    } catch (err) {
      throw new SandboxError(
        "seed_unreadable",
        `Seed file "${relativePath}" of course "${courseId}" could not be read: ${describeError(err)}.`,
        { seedFile: relativePath, cause: err },
      );
    }
    return { relativePath, absolutePath: resolved.absolutePath, content };
  });

  return { courseId: course.id, sandboxId: sandbox.id, type: sandbox.type, seedFiles };
}

// Makes `fastify.sandbox` (decorated in server.ts) visible to every route
// file, the same way db/pool.ts declares `fastify.db`. It is typed with the
// concrete Postgres driver because that is what the server actually wires
// today and because task 009 reaches through `.driver` to run SQL; when a
// second driver appears, this becomes a union (or the routes that need a
// specific driver narrow on `driver.type`) — the provisioner itself, and
// everything that only calls ensure/reset/status, needs no change either
// way.
declare module "fastify" {
  interface FastifyInstance {
    sandbox: SandboxProvisioner<import("./postgres-sandbox.js").PostgresSandboxDriver>;
  }
}
