// The two ways a code attempt fails that are NOT the learner's doing.

/**
 * The author's solution could not produce a reference: it did not load,
 * threw, timed out or crashed. Broken course content — a 422, the same
 * class as a seed the database rejects.
 *
 * `message` is a fixed sentence per failure kind and is what the client
 * receives. Node's own text goes to `detail`, for the server log only:
 * a syntax error's message quotes the offending SOURCE LINES, and an
 * uncaught exception's stderr prints the throwing line with a caret —
 * for a short solution, two such lines are the whole answer.
 */
export class CodeSolutionError extends Error {
  readonly kind = "solution_failed" as const;
  /** Node's words, or the solution's own exception — log only. */
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "CodeSolutionError";
    this.detail = detail;
  }
}

export function isCodeSolutionError(err: unknown): err is CodeSolutionError {
  return err instanceof CodeSolutionError;
}

/** `node` itself could not be started — this build cannot run code
 * practice at all. A 503, like an unreachable sandbox. */
export class CodeRunnerUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "CodeRunnerUnavailableError";
  }
}

export function isCodeRunnerUnavailableError(err: unknown): err is CodeRunnerUnavailableError {
  return err instanceof CodeRunnerUnavailableError;
}
