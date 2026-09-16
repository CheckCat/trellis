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

/** The sandbox kinds this core knows how to run. Mirrors the manifest's
 * `sandboxes[].type` enum (courses/manifest.schema.json) — widening one
 * means widening the other. */
export type SandboxType = "postgres";

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
 * The single entry point everything above the sandbox uses: routes, and
 * task 009's practice runner (`await fastify.sandbox.ensure(courseId,
 * sandboxId)` before running user SQL). Generic in its driver so a caller
 * that legitimately needs implementation-specific operations — 009 needs to
 * execute SQL, which only a Postgres sandbox can do — reaches them through
 * `driver` with full typing, while everything written against the plain
 * `SandboxProvisioner` stays implementation-agnostic.
 */
export interface SandboxProvisioner<TDriver extends SandboxDriver = SandboxDriver> {
  readonly driver: TDriver;
  /**
   * Makes this course's sandbox live, doing nothing if it already is. This
   * is the "подключение курса" path: the first practice run of a course
   * pays for the seed, later runs don't (and must not — a reset on every
   * query would wipe the user's own tables mid-lesson).
   */
  ensure(courseId: string, sandboxId?: string): Promise<SandboxState>;
  /** "Сбросить песочницу": rebuild unconditionally, even if this course's
   * sandbox is already live. */
  reset(courseId: string, sandboxId?: string): Promise<SandboxState>;
  /**
   * The live sandbox, or `undefined` if none is. With `courseId`, answers
   * "is THIS course's sandbox live" — a different course's live sandbox
   * reads as `undefined`, because from that course's point of view its own
   * sandbox has not been prepared.
   */
  status(courseId?: string): SandboxState | undefined;
  close(): Promise<void>;
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
