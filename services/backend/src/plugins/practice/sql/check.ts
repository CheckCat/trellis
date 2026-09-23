// The course's check query — the ONLY grading logic the core has for
// practice.
//
// Project invariant, quoted: "Контракт check-запроса зачёта: возвращает одну
// строку с одним boolean-значением. Никакой другой логики зачёта
// («грейдера») в ядре." So this module does exactly three things: run the
// query the course wrote, verify that its answer is one row × one column ×
// one boolean, and report that boolean. There is no comparison of expected
// result sets, no diffing, no partial credit, no "close enough" — a course
// that wants a different notion of "passed" writes it into its own SQL.
//
// Anything else the query returns is BROKEN COURSE CONTENT, not a failed
// attempt: reporting "не зачтено" for a check that returns two rows would
// tell the learner they got it wrong when in fact the course author did.
// Those two outcomes are kept strictly apart — a wrong verdict is
// `{ passed: false }`, a broken check throws.
//
// The check runs under the sandbox role on the same connection the user's
// own SQL just ran on (project invariant: seed, check and user SQL all run
// as `trellis_sandbox`, never as the application role).

import type { PoolClient } from "pg";

export type PracticeCheckErrorKind =
  /** The database rejected the check query itself (syntax error, missing
   * table, permission). The author's SQL is broken. */
  | "check_failed"
  /** The query ran, but its answer isn't "one row, one boolean". */
  | "check_contract_violation";

export interface PracticeCheckErrorDetails {
  /** Postgres' own message, verbatim — the same rule seed failures follow
   * (sandbox/types.ts): a course author fixing a broken check needs the
   * database's words, not a paraphrase. */
  readonly databaseError?: string;
  readonly cause?: unknown;
}

export class PracticeCheckError extends Error {
  readonly kind: PracticeCheckErrorKind;
  readonly databaseError?: string;

  constructor(kind: PracticeCheckErrorKind, message: string, details: PracticeCheckErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PracticeCheckError";
    this.kind = kind;
    this.databaseError = details.databaseError;
  }
}

export function isPracticeCheckError(err: unknown): err is PracticeCheckError {
  return err instanceof PracticeCheckError;
}

export interface PracticeCheckVerdict {
  /** The single boolean the check query returned. Nothing else about the
   * check — not its text, not its result shape — ever leaves this module. */
  readonly passed: boolean;
}

export interface RunPracticeCheckOptions {
  /** The course's `practice.check` SQL. Never echoed into any message or
   * response: it is the answer to the exercise (routes/courses.ts strips it
   * from the public lesson shape for the same reason). */
  readonly sql: string;
  readonly courseId: string;
  readonly lessonId: string;
}

/**
 * Runs the check and returns its verdict. Throws `PracticeCheckError` when
 * the check is broken rather than unsatisfied — see this file's header.
 */
export async function runPracticeCheck(
  client: PoolClient,
  options: RunPracticeCheckOptions,
): Promise<PracticeCheckVerdict> {
  const subject = `The check query of lesson "${options.lessonId}" in course "${options.courseId}"`;
  const contract = "a check query must return exactly one row with exactly one boolean column";

  let raw: unknown;
  try {
    // Same `rowMode: "array"` as practice execution: the column COUNT is
    // part of the contract, and pg's default object rows collapse two
    // identically named columns into one key — which would let a check
    // returning `select true as ok, false as ok` pass the "exactly one
    // column" test it should fail.
    raw = await client.query({ text: options.sql, rowMode: "array" });
  } catch (err) {
    const databaseError = err instanceof Error ? err.message : String(err);
    throw new PracticeCheckError("check_failed", `${subject} could not be executed: ${databaseError}`, {
      databaseError,
      cause: err,
    });
  }

  if (Array.isArray(raw)) {
    // Several statements in one check — `pg` answers with one result each.
    // Which of them is the verdict is undefined, so there is no honest way
    // to grade it.
    throw violation(`${subject} is ${raw.length} statements, but ${contract}, as a single statement.`);
  }
  const record = isRecord(raw) ? raw : {};
  const fields = Array.isArray(record.fields) ? (record.fields as unknown[]) : [];
  const rows = Array.isArray(record.rows) ? (record.rows as unknown[]) : [];

  if (fields.length !== 1) {
    throw violation(`${subject} returned ${fields.length} columns, but ${contract}.`);
  }
  if (rows.length !== 1) {
    throw violation(`${subject} returned ${rows.length} rows, but ${contract}.`);
  }
  const row = rows[0];
  const value = Array.isArray(row) ? (row as unknown[])[0] : undefined;
  if (typeof value !== "boolean") {
    // The TYPE is named, never the value: a check like `select answer = 42`
    // returning something odd shouldn't hand the learner a fragment of the
    // expected answer through an error message.
    throw violation(`${subject} returned ${describeType(value)} instead of a boolean, but ${contract}.`);
  }
  return { passed: value };
}

function violation(message: string): PracticeCheckError {
  return new PracticeCheckError("check_contract_violation", message);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "no value";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (value instanceof Date) {
    return "a timestamp";
  }
  return `a value of type "${typeof value}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
