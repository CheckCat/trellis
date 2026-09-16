// Tiny shared helpers for turning a caught filesystem error into something
// usable in a `ValidationError`/`RejectedCourse` message. Extracted because
// `loader.ts` and `registry.ts` both had verbatim copies of both functions
// (final review, backend fixes round) — this is duplicated LOGIC (how to
// tell an `Error` with an errno `code` apart from anything else thrown), not
// just similar-looking lines, so it belongs in one place per this project's
// SRP > DRY convention (see backend-implementer role).

/** Narrows `err` to Node's `ErrnoException` shape (an `Error` that also
 * carries a `.code`, e.g. `"ENOENT"`/`"EACCES"`) so callers can switch on
 * `.code` without an unchecked cast. */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/** Best-effort human-readable description of any thrown value — `Error`s
 * use their `.message`, anything else is stringified. Not installer-style
 * prose on its own (callers wrap this with context, e.g. "Cannot read
 * \"x\": <this>") — just the raw "what went wrong" fragment. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
