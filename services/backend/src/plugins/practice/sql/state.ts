// The course's reference SOLUTION — grading an exercise by the state the
// learner's statement left behind, compared against the state the author's
// own solution leaves behind.
//
// Why this exists next to check.ts and compare.ts, as a third mechanic:
//
//   - `check` grades a PREDICATE over the database ("is book 1 out of
//     stock?"). It answers only what the author thought to ask, so
//     `update books set in_stock = false` — no WHERE, four rows ruined —
//     passes a check written for book 1. Making a check strict means
//     spelling out "and nothing else changed" by hand, table by table,
//     against exact seed counts. On a course with five tables and a
//     thousand rows nobody writes that, and a proofreading rule nobody
//     follows is not a rule;
//   - `expected` grades a RESULT SET, so it grades `SELECT`s and nothing
//     else;
//   - this module grades the whole sandbox STATE against the state the
//     author's solution produces. The author writes the solution to the
//     exercise — the SQL they had to write anyway to invent it — and gets
//     strictness for free, including over tables and rows the assignment
//     never mentions.
//
// It is only possible because every attempt now starts from a freshly
// seeded sandbox (routes/practice/sql.ts). "State after" is comparable only
// when "state before" is identical, and before that rule the state before
// was whatever the learner had accumulated over the previous ten lessons.
//
// The boundaries are the ones both older mechanics obey:
//   - everything runs under the SANDBOX role, never the application role;
//   - the solution's TEXT never leaves the backend — it is the answer to
//     the exercise. What a failed verdict may carry is named in
//     `PracticeStateDifference` below: a table name and two row counts,
//     both of which the learner can see for themselves by querying the
//     sandbox. Never a cell, never a column, never a fragment of the
//     solution;
//   - a solution the database rejects is BROKEN COURSE CONTENT, not a
//     failed attempt: it throws, it does not return `{ passed: false }`.

import type { PoolClient } from "pg";

/**
 * Largest table the engine will digest, in rows.
 *
 * A snapshot reads every row of every table to hash it, so this bounds the
 * memory and time one attempt can cost. A course whose sandbox is bigger
 * than this cannot use the mechanic — that is an authoring decision to
 * report, not a limit to silently work around by hashing a prefix (a
 * digest over "the first 50 000 rows" would pass exercises that break row
 * 50 001).
 */
export const MAX_STATE_ROWS_PER_TABLE = 50_000;

export type PracticeSolutionErrorKind =
  /** The database rejected the solution itself. The author's SQL is
   * broken — same class as `check_failed`. */
  | "solution_failed"
  /** The solution ran twice from the same seed and left two DIFFERENT
   * states behind. Nothing the learner writes can be graded against a
   * moving target — see `assertDeterministic`. */
  | "solution_nondeterministic"
  /** Some table is larger than `MAX_STATE_ROWS_PER_TABLE`. */
  | "solution_too_large";

export interface PracticeSolutionErrorDetails {
  readonly databaseError?: string;
  readonly cause?: unknown;
}

export class PracticeSolutionError extends Error {
  readonly kind: PracticeSolutionErrorKind;
  readonly databaseError?: string;

  constructor(kind: PracticeSolutionErrorKind, message: string, details: PracticeSolutionErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PracticeSolutionError";
    this.kind = kind;
    this.databaseError = details.databaseError;
  }
}

export function isPracticeSolutionError(err: unknown): err is PracticeSolutionError {
  return err instanceof PracticeSolutionError;
}

/** One table's contents, reduced to something comparable. */
export interface TableDigest {
  readonly table: string;
  readonly rows: number;
  /** md5 over the table's rows, each rendered as JSON and sorted, so the
   * digest describes the SET of rows: two tables holding the same rows in
   * a different physical order are equal, which is the only sane reading
   * of "the database ended up the same" (Postgres makes no promise about
   * heap order anyway). */
  readonly digest: string;
}

/** Every table of the sandbox schema, in name order. */
export interface SandboxStateSnapshot {
  readonly tables: readonly TableDigest[];
}

/** What a learner is told when their state doesn't match. Deliberately
 * poor in content — see this file's header. */
export interface PracticeStateDifference {
  readonly table: string;
  /** Present when the row COUNTS differ; absent when the counts match and
   * only the contents do. */
  readonly expectedRows?: number;
  readonly actualRows?: number;
  /** `true` when the table exists on one side only. */
  readonly missing?: boolean;
}

export interface PracticeSolutionVerdict {
  readonly passed: boolean;
  /** Human-readable, in counts and table names only. Absent when passed. */
  readonly reason?: string;
}

/**
 * Reads the state of the sandbox schema the given connection is pointed at.
 *
 * `current_schema()` rather than a schema name passed in: the sandbox role's
 * search_path IS the sandbox schema (docker/postgres/init/02-schemas.sql),
 * so asking the connection what it can see is both correct and impossible
 * to point at the wrong schema by mistake.
 */
export async function snapshotSandboxState(client: PoolClient): Promise<SandboxStateSnapshot> {
  const tables = await listTables(client);
  const digests: TableDigest[] = [];
  for (const table of tables) {
    digests.push(await digestTable(client, table));
  }
  return { tables: digests };
}

/**
 * Compares the learner's resulting state with the solution's.
 *
 * Pure: both sides are already-read snapshots, so the comparison itself
 * touches no database and cannot fail.
 */
export function comparePracticeState(
  expected: SandboxStateSnapshot,
  actual: SandboxStateSnapshot,
): PracticeSolutionVerdict {
  const differences = diffSnapshots(expected, actual);
  if (differences.length === 0) {
    return { passed: true };
  }
  return { passed: false, reason: describeDifferences(differences) };
}

/**
 * Throws when the two snapshots of the SAME solution disagree.
 *
 * Called only when a learner's attempt failed the comparison, which is the
 * moment the answer matters and the only moment it is worth a third
 * re-seed: an attempt that MATCHED the solution cannot have been graded
 * against a moving target, and re-verifying it would cost every learner of
 * every course for a defect that shows up on the first failure anyway.
 *
 * What this catches is not only `random()` and `now()` written into the
 * solution — a skill that generates courses can be told not to write those.
 * It catches the case that rule cannot reach: a DEFAULT in the course's own
 * seed (`created_at timestamptz default now()`), which makes every INSERT
 * exercise in the course unsolvable, by anyone, forever, while telling the
 * learner only "не зачтено".
 */
export function assertDeterministic(
  first: SandboxStateSnapshot,
  second: SandboxStateSnapshot,
  context: { readonly courseId: string; readonly lessonId: string },
): void {
  const differences = diffSnapshots(first, second);
  if (differences.length === 0) {
    return;
  }
  throw new PracticeSolutionError(
    "solution_nondeterministic",
    `The solution of lesson "${context.lessonId}" in course "${context.courseId}" left two different states ` +
      `behind when run twice from the same seed (${describeDifferences(differences)}). No answer can be graded ` +
      `against it. The usual causes are now()/random() in the solution itself, or a column DEFAULT in the ` +
      `course's seed that varies per run.`,
  );
}

/** Runs the author's solution, translating a database refusal into the
 * "broken course content" class. Deliberately NOT returning a verdict:
 * there is no such thing as a solution that legitimately fails. */
export async function runPracticeSolution(
  client: PoolClient,
  options: { readonly sql: string; readonly courseId: string; readonly lessonId: string },
): Promise<void> {
  try {
    await client.query(options.sql);
  } catch (err) {
    const databaseError = err instanceof Error ? err.message : String(err);
    throw new PracticeSolutionError(
      "solution_failed",
      `The solution of lesson "${options.lessonId}" in course "${options.courseId}" could not be executed: ` +
        `${databaseError}`,
      { databaseError, cause: err },
    );
  }
}

// --- internals ------------------------------------------------------------

async function listTables(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ relname: string }>(
    `select c.relname
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema()
        and c.relkind = 'r'
      order by c.relname`,
  );
  return result.rows.map((row) => row.relname);
}

async function digestTable(client: PoolClient, table: string): Promise<TableDigest> {
  const identifier = `"${table.replaceAll('"', '""')}"`;
  const result = await client.query<{ rows: string; digest: string | null }>(
    // `to_jsonb(t)` renders a whole row with its column NAMES, so a table
    // that gained or lost a column digests differently even when the
    // surviving cells match — dropping a column is a state change like any
    // other. Sorted inside the aggregate, not by an ORDER BY on the outer
    // query: `string_agg` is order-sensitive and would otherwise digest
    // whatever order the heap happened to return.
    `select count(*)::text as rows,
            md5(coalesce(string_agg(row_text, E'\\n' order by row_text), '')) as digest
       from (select to_jsonb(t)::text as row_text from ${identifier} t) rendered`,
  );
  const record = result.rows[0];
  const rows = Number(record?.rows ?? "0");
  if (rows > MAX_STATE_ROWS_PER_TABLE) {
    throw new PracticeSolutionError(
      "solution_too_large",
      `Table "${table}" of the practice sandbox holds ${rows} rows, more than the ${MAX_STATE_ROWS_PER_TABLE} ` +
        `this engine will compare state over. An exercise graded by its solution needs a sandbox small enough ` +
        `to read whole; use "check" for a course this size.`,
    );
  }
  return { table, rows, digest: record?.digest ?? "" };
}

function diffSnapshots(
  expected: SandboxStateSnapshot,
  actual: SandboxStateSnapshot,
): PracticeStateDifference[] {
  const actualByTable = new Map(actual.tables.map((table) => [table.table, table]));
  const differences: PracticeStateDifference[] = [];

  for (const table of expected.tables) {
    const mirror = actualByTable.get(table.table);
    if (mirror === undefined) {
      differences.push({ table: table.table, missing: true });
      continue;
    }
    if (mirror.digest === table.digest) {
      continue;
    }
    differences.push(
      mirror.rows === table.rows
        ? { table: table.table }
        : { table: table.table, expectedRows: table.rows, actualRows: mirror.rows },
    );
  }

  for (const table of actual.tables) {
    if (!expected.tables.some((candidate) => candidate.table === table.table)) {
      // A table the solution does not produce. Named, because the learner
      // created it and knows it exists — hiding it would only make the
      // verdict unexplainable.
      differences.push({ table: table.table, missing: true });
    }
  }

  return differences;
}

function describeDifferences(differences: readonly PracticeStateDifference[]): string {
  return differences
    .map((difference) => {
      if (difference.missing === true) {
        return `таблица "${difference.table}" есть только с одной стороны`;
      }
      if (difference.expectedRows === undefined || difference.actualRows === undefined) {
        return `таблица "${difference.table}": строк столько же, но содержимое отличается`;
      }
      return `таблица "${difference.table}": ожидалось строк ${difference.expectedRows}, получено ${difference.actualRows}`;
    })
    .join("; ");
}
