// The course's reference query — grading a practice assignment by the ROWS
// the learner's own statement returned, instead of by the state it left
// behind.
//
// Why this exists next to check.ts: `check` grades the database, so it can
// only grade an exercise that CHANGES the database. Most SQL exercises are
// `SELECT`s, which change nothing — before this, they were ungradable
// ("задание без check — самоотметка"). The engine already runs the
// learner's statement and holds its rows (execute.ts); comparing them with
// a reference query's rows is the missing half.
//
// Same boundaries `check` obeys, for the same reasons:
//   - the reference query runs under the SANDBOX role, on the same
//     connection the learner's statement just used (project invariant:
//     seed, check, reference and user SQL all run as `trellis_sandbox`);
//   - its TEXT never leaves the backend — it is the answer to the exercise.
//     The verdict the learner gets is one boolean plus a `reason` that
//     names shapes and counts ("ожидалось столбцов: 2, получено: 3"), never
//     a value, a column name, or a fragment of the query;
//   - a reference query the database rejects is BROKEN COURSE CONTENT, not
//     a failed attempt: it throws, it does not return `{ passed: false }`.
//
// What is new here, and deliberately so: the comparison is DECLARATIVE. The
// core owns the whole notion of "equal result sets" (column count, cell
// equality per type, ordered vs multiset) — a course contributes two
// strings and a boolean, never code. That is what keeps the invariant
// "произвольный код-грейдер в составе курса запрещён" true while adding a
// second grading mechanic.

import type { PoolClient } from "pg";

import { formatCell } from "./execute.js";

/**
 * Hard cap on how many rows either side of a comparison may have.
 *
 * Unrelated to `MAX_RESULT_ROWS` (execute.ts), which is a DISPLAY cap and
 * has no say here: grading must not be decided on a truncated grid. This
 * one bounds memory and comparison time for an exercise whose reference
 * result is unreasonably large — which is an authoring mistake (an
 * exercise nobody can eyeball is not an exercise), reported as such.
 */
export const MAX_COMPARISON_ROWS = 10_000;

/**
 * Absolute tolerance for numeric cells. Two numbers coming out of Postgres
 * through different expressions (`avg(x)` as `numeric` vs `sum(x)/count(x)`
 * as `double precision`) are routinely equal in value and different in
 * their last binary digit; grading a learner wrong for that would be a bug
 * in this comparator, not a wrong answer.
 */
export const NUMERIC_TOLERANCE = 1e-9;

/**
 * Postgres type OIDs treated as numbers rather than text: `int2`, `int8`,
 * `int4`, `float4`, `float8`, `numeric` — the brief's "int/bigint/numeric/
 * float". Everything else (including `money`, whose text form carries a
 * currency symbol) is compared as text.
 */
const NUMERIC_TYPE_OIDS: ReadonlySet<number> = new Set([21, 20, 23, 700, 701, 1700]);

export type PracticeExpectedErrorKind =
  /** The database rejected the reference query itself. The author's SQL is
   * broken — same class as `check_failed`. */
  | "expected_failed"
  /** The reference query ran, but cannot be used as one (several
   * statements in one string, so which result is the reference is
   * undefined). */
  | "expected_contract_violation"
  /** One side of the comparison is bigger than `MAX_COMPARISON_ROWS`. */
  | "expected_too_large";

export interface PracticeExpectedErrorDetails {
  /** Postgres' own message, verbatim — the rule seed and check failures
   * already follow: a course author fixing this needs the database's
   * words, not a paraphrase. */
  readonly databaseError?: string;
  readonly cause?: unknown;
}

export class PracticeExpectedError extends Error {
  readonly kind: PracticeExpectedErrorKind;
  readonly databaseError?: string;

  constructor(kind: PracticeExpectedErrorKind, message: string, details: PracticeExpectedErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PracticeExpectedError";
    this.kind = kind;
    this.databaseError = details.databaseError;
  }
}

export function isPracticeExpectedError(err: unknown): err is PracticeExpectedError {
  return err instanceof PracticeExpectedError;
}

/** One side of a comparison: cells already rendered the way execute.ts
 * renders them (`formatCell`), plus the column types needed to decide
 * whether a cell is a number, plus the untruncated row count. */
export interface ComparableResult {
  readonly columnTypeIds: readonly number[];
  readonly rows: readonly (readonly (string | null)[])[];
  /** The real number of rows, which may exceed `rows.length` when the
   * caller capped what it retained. */
  readonly totalRows: number;
}

export interface PracticeExpectedVerdict {
  readonly passed: boolean;
  /**
   * Why not, in the learner's language — present exactly when `passed` is
   * `false`. Says what differs in shape ("ожидалось строк: 19, получено:
   * 22"), never what the right answer is.
   */
  readonly reason?: string;
}

export interface ReadPracticeExpectedOptions {
  /** The course's `practice.expected` SQL. Never echoed anywhere. */
  readonly sql: string;
  readonly courseId: string;
  readonly lessonId: string;
}

/**
 * Runs the reference query on an already-checked-out sandbox client and
 * returns its rows, for `compareResults` to judge the learner's against.
 * Throws `PracticeExpectedError` when the ASSIGNMENT is broken rather than
 * unsatisfied — see this file's header.
 *
 * Reading and comparing are two functions rather than one because of WHEN
 * the reading has to happen: the reference runs BEFORE the learner's
 * statement, on the freshly seeded sandbox (routes/practice/sql.ts). Run
 * afterwards — as it was until the sandbox began re-seeding per attempt —
 * `delete from books; select * from books;` compared an empty result with
 * an equally empty reference and passed. A reference read before the
 * learner touches anything cannot be bent by what they write.
 *
 * The query runs inside `begin transaction read only`: the reference is a
 * description of the right answer, not a second chance to modify the
 * sandbox, and a course whose reference query has side effects would
 * silently change the state the learner is working against (and the state
 * a `check` on the same lesson then grades). Postgres enforces that itself
 * — no statement inspection here, exactly as execute.ts refuses to parse
 * the learner's SQL.
 *
 * No `statement_timeout` is set: the sandbox ROLE carries it server-side
 * (docker/postgres/init/02-schemas.sql), so the reference query is bounded
 * by the same 30s the learner's own statement was, on the same connection,
 * without a second source of truth for that limit.
 */
export async function readPracticeExpected(
  client: PoolClient,
  options: ReadPracticeExpectedOptions,
): Promise<ComparableResult> {
  const subject = `The expected query of lesson "${options.lessonId}" in course "${options.courseId}"`;

  let raw: unknown;
  // `begin` failing is not the reference query's fault (a dead connection,
  // an already-open transaction) — it propagates untouched, and the route
  // answers with a sandbox-level failure, exactly like execute.ts's
  // non-`DatabaseError` path.
  await client.query("begin transaction read only");
  try {
    // Same `rowMode: "array"` as the learner's statement: cells must line
    // up positionally with `columnTypeIds`, and pg's default object rows
    // collapse two identically named columns into one key — which would
    // make `select 1 as a, 2 as a` look like a one-column result on one
    // side and a two-column one on the other.
    raw = await client.query({ text: options.sql, rowMode: "array" });
  } catch (err) {
    const databaseError = err instanceof Error ? err.message : String(err);
    throw new PracticeExpectedError("expected_failed", `${subject} could not be executed: ${databaseError}`, {
      databaseError,
      cause: err,
    });
  } finally {
    // Ends the read-only transaction whatever happened. `quietly`, because
    // its failure must never replace the verdict (or the error) above —
    // and the route's `resetSandboxSession` runs a `rollback` of its own on
    // the way out regardless.
    try {
      await client.query("rollback");
    } catch {
      // Nothing useful to do: the connection is being reset either way.
    }
  }

  if (Array.isArray(raw)) {
    // Several statements in one reference — `pg` answers with one result
    // each, and which of them describes the right answer is undefined.
    throw new PracticeExpectedError(
      "expected_contract_violation",
      `${subject} is ${raw.length} statements, but an expected query must be a single statement returning the rows the learner's own query should return.`,
    );
  }

  const reference = toComparableResult(raw);
  if (reference.totalRows > MAX_COMPARISON_ROWS) {
    throw new PracticeExpectedError(
      "expected_too_large",
      `${subject} returned ${reference.totalRows} rows, more than the ${MAX_COMPARISON_ROWS}-row comparison limit. This is an assignment-configuration problem, not a wrong answer: narrow the exercise (or its seed data) so the expected result fits.`,
    );
  }

  return reference;
}

/**
 * The comparison itself — pure, and the whole of what "правильный ответ"
 * means in this engine.
 *
 * Rules, in the order they are checked (each answers with the cheapest
 * honest reason, and none of them reveals the reference's content):
 *  1. column COUNT must match. Column NAMES are not compared: a learner
 *     writing `select title, author` and an author writing `select b.title,
 *     b.author` produce the same answer, and aliasing is not the skill
 *     being assessed;
 *  2. row COUNT must match — checked against the untruncated totals, so a
 *     runaway result is rejected on size without comparing a single cell;
 *  3. every cell must be equal (`cellsEqual`), row by row in order when
 *     `ordered`, as multisets otherwise.
 */
export function compareResults(
  attempt: ComparableResult,
  reference: ComparableResult,
  ordered: boolean,
): PracticeExpectedVerdict {
  if (attempt.columnTypeIds.length !== reference.columnTypeIds.length) {
    return {
      passed: false,
      reason: `ожидалось столбцов: ${reference.columnTypeIds.length}, получено: ${attempt.columnTypeIds.length}`,
    };
  }
  if (attempt.totalRows !== reference.totalRows) {
    return { passed: false, reason: `ожидалось строк: ${reference.totalRows}, получено: ${attempt.totalRows}` };
  }
  if (attempt.rows.length < attempt.totalRows || reference.rows.length < reference.totalRows) {
    // Defensive: both sides are known to be within MAX_COMPARISON_ROWS by
    // now (the reference was checked by the caller, and the attempt matches
    // its count), so a short `rows` array means the caller retained fewer
    // rows than it promised — a bug here, not a wrong answer.
    throw new PracticeExpectedError(
      "expected_too_large",
      `A practice comparison was handed fewer rows than the results actually have (attempt ${attempt.rows.length}/${attempt.totalRows}, expected ${reference.rows.length}/${reference.totalRows}).`,
    );
  }

  // Decided once per column, not per cell: a column is compared as a
  // number only when BOTH sides declared a numeric type for it. `count(*)`
  // (bigint) against `sum(1)` (numeric) is still numeric on both sides;
  // a number against a text column is not, and falls back to exact text
  // comparison — which is the honest answer, since `'1'` and `1` are
  // different results.
  const numericColumns = attempt.columnTypeIds.map(
    (typeId, index) => isNumericType(typeId) && isNumericType(reference.columnTypeIds[index] ?? -1),
  );

  const mismatch = ordered
    ? firstOrderedMismatch(attempt.rows, reference.rows, numericColumns)
    : firstUnmatchedRow(attempt.rows, reference.rows, numericColumns);

  if (mismatch === undefined) {
    return { passed: true };
  }
  return {
    passed: false,
    reason: ordered
      ? `строки различаются (первое расхождение — строка ${mismatch})`
      : `строки различаются (порядок строк не важен; первая строка без пары — строка ${mismatch})`,
  };
}

/** 1-based index of the first differing row, or `undefined` when every row
 * matches. */
function firstOrderedMismatch(
  attempt: readonly (readonly (string | null)[])[],
  reference: readonly (readonly (string | null)[])[],
  numericColumns: readonly boolean[],
): number | undefined {
  for (let index = 0; index < attempt.length; index += 1) {
    if (!rowsEqual(attempt[index] ?? [], reference[index] ?? [], numericColumns)) {
      return index + 1;
    }
  }
  return undefined;
}

/**
 * Multiset equality. Answers with the 1-based position — in the LEARNER'S
 * OWN result, the only row numbering they can see on screen — of the first
 * row that has no counterpart among the expected ones, or `undefined` when
 * every row pairs up.
 *
 * "First" is by that position, not by the internal ordering this walk uses:
 * a learner told "строка 3 без пары" must be able to look at row 3.
 *
 * Both sides are sorted by a total order over cells (`compareCells`) and
 * merged. Sorting, not hashing: cell equality here is tolerance-based for
 * numbers, and a hash key would have to round, which splits two values that
 * are equal-within-tolerance but land on different sides of a rounding
 * boundary. The sort orders numbers numerically, so values within
 * `NUMERIC_TOLERANCE` end up adjacent and the merge pairs them.
 *
 * (The one case this does not resolve is rows whose leading columns are
 * equal-within-tolerance but not identical, whose later columns then
 * disagree about the order — e.g. `(1.0, 'x'), (1.0 + 5e-10, 'y')` against
 * the same two rows with `x`/`y` swapped. Resolving it exactly means a
 * matching over an equality that isn't transitive, which is quadratic in
 * the row count; at a 1e-9 tolerance over a course exercise it is not a
 * case that occurs, and reporting a mismatch is the conservative outcome.)
 */
function firstUnmatchedRow(
  attempt: readonly (readonly (string | null)[])[],
  reference: readonly (readonly (string | null)[])[],
  numericColumns: readonly boolean[],
): number | undefined {
  const attemptOrder = sortedIndices(attempt, numericColumns);
  const referenceOrder = sortedIndices(reference, numericColumns);

  let unmatched: number | undefined;
  const leaveUnmatched = (index: number): void => {
    unmatched = unmatched === undefined ? index : Math.min(unmatched, index);
  };

  let left = 0;
  let right = 0;
  while (left < attemptOrder.length && right < referenceOrder.length) {
    const attemptIndex = attemptOrder[left] ?? 0;
    const referenceIndex = referenceOrder[right] ?? 0;
    const attemptRow = attempt[attemptIndex] ?? [];
    const referenceRow = reference[referenceIndex] ?? [];

    if (rowsEqual(attemptRow, referenceRow, numericColumns)) {
      left += 1;
      right += 1;
    } else if (compareRows(attemptRow, referenceRow, numericColumns) <= 0) {
      // Nothing left on the expected side can still pair with this row —
      // everything after it sorts no earlier.
      leaveUnmatched(attemptIndex);
      left += 1;
    } else {
      // This EXPECTED row is the one without a counterpart; the learner's
      // row may still pair with a later one.
      right += 1;
    }
  }
  while (left < attemptOrder.length) {
    leaveUnmatched(attemptOrder[left] ?? 0);
    left += 1;
  }

  return unmatched === undefined ? undefined : unmatched + 1;
}

function sortedIndices(
  rows: readonly (readonly (string | null)[])[],
  numericColumns: readonly boolean[],
): number[] {
  return rows
    .map((_, index) => index)
    .sort((left, right) => compareRows(rows[left] ?? [], rows[right] ?? [], numericColumns) || left - right);
}

function rowsEqual(
  attempt: readonly (string | null)[],
  reference: readonly (string | null)[],
  numericColumns: readonly boolean[],
): boolean {
  if (attempt.length !== reference.length) {
    return false;
  }
  return attempt.every((cell, index) => cellsEqual(cell, reference[index] ?? null, numericColumns[index] === true));
}

/**
 * Cell equality, per the brief:
 *   - `NULL` equals `NULL` and nothing else (SQL's own three-valued logic
 *     does not apply here: this is "is the learner's answer the same table",
 *     not "is this predicate true");
 *   - identical text is equal, whatever the type. This is checked first, so
 *     `NaN`/`Infinity` in a numeric column compare equal to themselves
 *     instead of falling into an arithmetic comparison that says otherwise;
 *   - numeric columns additionally accept a difference up to
 *     `NUMERIC_TOLERANCE`;
 *   - everything else — text, booleans, dates/timestamps, json, arrays,
 *     bytea — is compared on Postgres' own rendering of the value, which is
 *     what `formatCell` produced for both sides (a `timestamptz` arrives as
 *     a `Date` on both sides and is rendered as the same ISO instant, so
 *     "по значению" and "по тексту" coincide for temporal types).
 */
function cellsEqual(attempt: string | null, reference: string | null, numeric: boolean): boolean {
  if (attempt === null || reference === null) {
    return attempt === reference;
  }
  if (attempt === reference) {
    return true;
  }
  if (!numeric) {
    return false;
  }
  const left = Number(attempt);
  const right = Number(reference);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= NUMERIC_TOLERANCE;
}

function compareRows(
  left: readonly (string | null)[],
  right: readonly (string | null)[],
  numericColumns: readonly boolean[],
): number {
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const order = compareCells(left[index] ?? null, right[index] ?? null, numericColumns[index] === true);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** A total order over cells, consistent with `cellsEqual` up to the numeric
 * tolerance — NULLs first, numbers by value, everything else by text. */
function compareCells(left: string | null, right: string | null, numeric: boolean): number {
  if (left === null) {
    return right === null ? 0 : -1;
  }
  if (right === null) {
    return 1;
  }
  if (numeric) {
    const leftValue = Number(left);
    const rightValue = Number(right);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
      return leftValue < rightValue ? -1 : 1;
    }
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isNumericType(typeId: number): boolean {
  return NUMERIC_TYPE_OIDS.has(typeId);
}

/** A `pg` result (single statement, `rowMode: "array"`) read into the shape
 * the comparison works on. Read defensively for the same reason
 * execute.ts's `toResultSet` is: a driver-shape surprise must not crash a
 * route. */
function toComparableResult(raw: unknown): ComparableResult {
  const record = isRecord(raw) ? raw : {};
  const fields = Array.isArray(record.fields) ? (record.fields as unknown[]) : [];
  const rawRows = Array.isArray(record.rows) ? (record.rows as unknown[]) : [];

  return {
    columnTypeIds: fields.map((field) => {
      const fieldRecord = isRecord(field) ? field : {};
      return typeof fieldRecord.dataTypeID === "number" ? fieldRecord.dataTypeID : 0;
    }),
    // Rendered only up to the limit — `totalRows` below is what decides
    // whether the limit was exceeded, so a runaway reference result is
    // rejected without rendering a cell of it beyond that point.
    rows: rawRows
      .slice(0, MAX_COMPARISON_ROWS)
      .map((row) => (Array.isArray(row) ? (row as unknown[]) : [row]).map(formatCell)),
    totalRows: rawRows.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
