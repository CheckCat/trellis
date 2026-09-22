// The practice sandbox as an INTERFACE, with Postgres as one implementation
// (project invariant: "песочница практики — интерфейс с реализациями;
// Postgres — лишь одна из них"). Nothing in this file mentions SQL, pools,
// schemas or `pg`: a second sandbox type (a filesystem workspace, a
// container, ...) implements `SandboxDriver` and everything above it —
// provisioner.ts, routes/sandbox.ts, task 009's practice runner — keeps
// working unchanged.
//
// The split of responsibilities the interface encodes:
//   - the PROVISIONER (provisioner.ts) owns everything course-shaped:
//     finding the declared sandbox, re-validating its seed paths against the
//     package directory, reading them, remembering which course's sandbox is
//     currently live;
//   - the DRIVER (postgres-sandbox.ts) owns everything backend-shaped:
//     wiping whatever the previous course left behind and applying the seed
//     material it is handed. A driver never touches the filesystem and never
//     looks at a `Course` — it receives a fully resolved `SandboxSpec`.

/** The sandbox kinds this core knows how to run — re-exported from the
 * capability registry, which is where a kind comes into existence
 * (project invariant). The manifest's `sandboxes[].type` enum is checked
 * against the same list by capabilities.test.ts. */
import type { SandboxType } from "../capabilities.js";

export type { SandboxType };

/** One seed unit, already read off disk by the provisioner. `content` is
 * raw text handed to the driver as-is (for the Postgres driver: SQL). */
export interface SandboxSeedFile {
  /** Path relative to the course package directory, exactly as a course
   * author would recognize it (`sandbox/01-schema.sql`). This is what goes
   * into API responses and error messages — never the absolute host path,
   * which is an implementation detail of where courses happen to be
   * mounted. */
  readonly relativePath: string;
  /** Absolute, re-validated path the content was actually read from. Kept
   * for logs/diagnostics, not for display. */
  readonly absolutePath: string;
  readonly content: string;
}

/** Everything a driver needs to (re)build one course's sandbox, with no
 * course/filesystem knowledge left in it. */
export interface SandboxSpec {
  readonly courseId: string;
  readonly sandboxId: string;
  readonly type: SandboxType;
  /** In manifest order — seeds are applied in the order the course declares
   * them (`01-schema.sql` before `02-data.sql`), never sorted or
   * parallelized. */
  readonly seedFiles: readonly SandboxSeedFile[];
}

/** Which course's sandbox is live right now, and since when. */
export interface SandboxState {
  readonly courseId: string;
  readonly sandboxId: string;
  readonly type: SandboxType;
  /** Package-relative paths of the seeds that were applied, in order. */
  readonly seedFiles: readonly string[];
  /** ISO-8601, the same string shape progress timestamps use. */
  readonly readyAt: string;
}

export interface SandboxDriver {
  readonly type: SandboxType;
  /**
   * Discards everything currently in the sandbox and rebuilds it from
   * `spec.seedFiles`. Implementations must be all-or-nothing: on failure
   * the sandbox is left in a state the next `provision` can recover from,
   * and the error explains which seed failed and what the backend said —
   * a broken seed is course-content breakage, reported verbatim, never
   * swallowed into a generic "sandbox error".
   *
   * Always a full rebuild: there is no incremental/"only if changed" path
   * on purpose. "Сбросить песочницу" and "prepare this course's sandbox"
   * are the same operation, so a reset can never drift from a first-time
   * provision.
   */
  provision(spec: SandboxSpec): Promise<void>;
  /** Releases the driver's own resources (connections, handles). Closing a
   * driver built over an injected resource must not close that resource —
   * ownership rules follow db/pool.ts's `AppPool#end`. */
  close(): Promise<void>;
}

/**
 * The drivers this process can run, looked up by the `sandboxes[].type` a
 * course declares.
 *
 * A registry rather than a single driver because that is what makes a
 * second sandbox kind a pure addition (project invariant: a kind exists
 * only if it is registered in capabilities.ts). The provisioner picks the
 * driver for `spec.type` and knows nothing else about it — adding a kind
 * touches its own driver module and the registry, never provisioner.ts.
 */
export interface SandboxDriverRegistry {
  /** The registered types, in registration order. */
  readonly types: readonly SandboxType[];
  /** The driver for `type`, or `undefined` when nothing is registered for
   * it — which is a 503 (`unavailable`), not a course-content error: the
   * manifest was valid, this build just cannot run it. */
  get(type: SandboxType): SandboxDriver | undefined;
}

/**
 * The single entry point everything above the sandbox uses: routes, and
 * the practice strategies (`await fastify.sandbox.ensure(courseId,
 * sandboxId)` before running user SQL).
 *
 * A caller that legitimately needs implementation-specific operations —
 * the `sql` practice strategy needs to execute SQL, which only a Postgres
 * sandbox can do — reaches its driver through `drivers.get(type)` and
 * narrows (see postgres-sandbox.ts's `isPostgresSandboxDriver`).
 * Everything written against ensure/reset/status stays
 * implementation-agnostic and needs no narrowing at all.
 */
export interface SandboxProvisioner {
  readonly drivers: SandboxDriverRegistry;
  /** Rebuild from the course's seed, unconditionally. */
  reset(courseId: string, sandboxId?: string): Promise<SandboxState>;
  /**
   * Rebuilds the sandbox and runs `work` against it, with the guarantee
   * that nothing else re-seeds or switches the sandbox until `work`
   * settles. This is how practice runs: every attempt starts from the
   * course's seed and nothing else.
   *
   * There used to be an `ensure()` here instead — "the first practice run
   * of a course pays for the seed, later ones don't". It was the right
   * shape for a sandbox that ACCUMULATED: cheaper, and it let a learner
   * build something across several runs. What it also did was let lesson 3
   * decide whether lesson 11 passes, and let a `delete` inside one attempt
   * make that attempt's own grading compare two empty sets. State that
   * carries over cannot be graded, so it no longer carries over.
   *
   * `work` receives `reseed` because grading by the course's SOLUTION
   * needs the seeded state more than once per attempt (run the solution,
   * read the state, put the sandbox back, run the learner's SQL). Calling
   * the provisioner's own `reset` from inside `work` would deadlock on
   * this same queue — hence the handle rather than a re-entrant call.
   */
  withFreshSandbox<T>(
    courseId: string,
    sandboxId: string | undefined,
    work: (context: FreshSandboxContext) => Promise<T>,
  ): Promise<T>;
  /**
   * The live sandbox, or `undefined` if none is. With `courseId`, answers
   * "is THIS course's sandbox live" — a different course's live sandbox
   * reads as `undefined`, because from that course's point of view its own
   * sandbox has not been prepared.
   */
  status(courseId?: string): SandboxState | undefined;
  close(): Promise<void>;
}

/** What `withFreshSandbox` hands its caller: the sandbox as just seeded,
 * and the ability to return it to exactly that state again without leaving
 * the exclusive window. */
export interface FreshSandboxContext {
  readonly state: SandboxState;
  reseed(): Promise<SandboxState>;
}

/**
 * Why a sandbox operation could not be carried out. Deliberately split fine
 * enough for routes/sandbox.ts to answer with an honest HTTP status without
 * re-deriving anything from message text:
 *   - `course_not_found`   — no such course is installed (404)
 *   - `sandbox_not_found`  — the course declares no such sandbox (404)
 *   - `ambiguous_sandbox`  — the course declares several and the caller
 *                            didn't say which (400)
 *   - `seed_unreadable`    — a declared seed file is gone, unreadable, or
 *                            no longer resolves inside the package (422)
 *   - `seed_failed`        — the backend rejected a seed (422)
 *   - `unavailable`        — the sandbox backend itself is unreachable or
 *                            not configured (503)
 */
export type SandboxErrorKind =
  | "course_not_found"
  | "sandbox_not_found"
  | "ambiguous_sandbox"
  | "seed_unreadable"
  | "seed_failed"
  | "unavailable";

export interface SandboxErrorDetails {
  /** Package-relative path of the seed involved, for `seed_*` kinds. */
  readonly seedFile?: string;
  /** The backend's own error text, passed through verbatim (a Postgres
   * message with its `LINE n:` context, say). The product rule for practice
   * — "результат или ошибка Postgres показываются как есть" — applies to a
   * course's seed SQL too: a course author fixing a broken seed needs the
   * database's own words, not a paraphrase. */
  readonly databaseError?: string;
  readonly cause?: unknown;
}

/** The one error type the sandbox layer throws. Anything else escaping a
 * driver is a bug in that driver. */
export class SandboxError extends Error {
  readonly kind: SandboxErrorKind;
  readonly seedFile?: string;
  readonly databaseError?: string;

  constructor(kind: SandboxErrorKind, message: string, details: SandboxErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "SandboxError";
    this.kind = kind;
    this.seedFile = details.seedFile;
    this.databaseError = details.databaseError;
  }
}

export function isSandboxError(err: unknown): err is SandboxError {
  return err instanceof SandboxError;
}
