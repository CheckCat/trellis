// The two ways a code attempt fails that are NOT the learner's doing.

/** The author's solution could not produce a reference: it did not load,
 * threw, timed out or crashed. Broken course content — a 422, the same
 * class as a seed the database rejects. The solution's text is never part
 * of the message. */
export class CodeSolutionError extends Error {
  readonly kind = "solution_failed" as const;
  constructor(message: string) {
    super(message);
    this.name = "CodeSolutionError";
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
