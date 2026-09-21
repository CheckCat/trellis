// Running the user's own SQL in the practice sandbox.
//
// The product rule this file exists to honour, literally: "запрос выполняет
// backend в песочнице, результат или ошибка Postgres показываются как есть"
// (docs/product/business-logic.md). So:
//   - the statement text is handed to Postgres unchanged — never parsed,
//     rewritten, wrapped in a transaction, prefixed with a `set`, or
//     inspected for "dangerous" keywords. The sandbox role's own grants are
//     what make that safe (project invariant), not a blocklist here;
//   - a failing statement is NOT an error of this endpoint. It is a normal,
//     expected outcome of practising SQL, and the database's own words for it
//     (message, SQLSTATE `code`, `position`, `detail`, `hint`) are carried
//     out to the client verbatim.
//
// This module never opens a connection: it is handed a client that the
// sandbox driver checked out under the sandbox role (postgres-sandbox.ts's
// `withClient`). That is the only way the application-role pool cannot leak
// into practice execution by accident.

import { DatabaseError, type PoolClient } from "pg";

/** How many rows of a result set are sent to the client. A practice query
 * with a runaway cartesian join is the expected failure mode of a SQL
 * editor, not an edge case: the sandbox role's `statement_timeout` (30s,
 * docker/postgres/init/02-schemas.sql) bounds how long it runs, and this
 * bounds how much comes back. `rowCount` still reports the real total, and
 * `truncated` says out loud that there was more. */
export const MAX_RESULT_ROWS = 200;

export interface PracticeColumn {
  readonly name: string;
  /** Postgres type OID, passed through untouched — the client can use it to
   * right-align numerics and so on. Not translated to a type NAME here: that
   * would need a catalog lookup per query for something purely cosmetic. */
  readonly dataTypeId: number;
}

export interface PracticeResultSet {
  /** `SELECT`, `INSERT`, `CREATE TABLE`, ... as Postgres reports it. */
  readonly command?: string;
  /** Rows returned (SELECT) or affected (INSERT/UPDATE/DELETE) — the real
   * number, independent of `MAX_RESULT_ROWS` truncation below. `null` when
   * the statement has no row count (pg reports it that way for DDL). */
  readonly rowCount: number | null;
  readonly columns: readonly PracticeColumn[];
  /**
   * Rows as ARRAYS of cells, positionally matching `columns`, never objects
   * keyed by column name: `select 1 as a, 2 as a` is valid SQL, and an
   * object would silently drop one of the two columns (pg's default row
   * shape does exactly that). A result grid must show what was actually
   * returned.
   *
   * Every cell is a string, or `null` for SQL NULL — see `formatCell` for
   * why the parsed JS value isn't sent instead.
   */
  readonly rows: readonly (readonly (string | null)[])[];
  /** `true` when the result had more rows than were sent. */
  readonly truncated: boolean;
  /** How many statements the submitted SQL turned out to be. Postgres runs
   * `a; b; c` as one simple query and answers with one result per statement;
   * only the LAST one is reported above (a grid shows one result), and this
   * tells the client the other ones ran too. */
  readonly statementCount: number;
}

/** A Postgres error, as Postgres described it. Field names and values are
 * the driver's own (`pg`'s `DatabaseError`), not a re-interpretation. */
export interface PracticeSqlError {
  readonly message: string;
  readonly severity?: string;
  /** SQLSTATE, e.g. `42P01` for "relation does not exist". */
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
  /** 1-based character offset into the submitted SQL, as a string (that is
   * how the wire protocol and `pg` report it) — an editor uses it to put the
   * caret on the offending token. */
  readonly position?: string;
  readonly where?: string;
}

/**
 * The attempt's result as the GRADER sees it, which is not the same thing
 * as what the client sees: `MAX_RESULT_ROWS` is a display cap ("how much
 * fits in a grid"), and grading a `SELECT` against a reference query
 * (practice/compare.ts) must not be decided on a truncated result.
 *
 * So this carries its own, much larger cap (`gradingRows`, set by the
 * caller) plus `totalRows` — the untruncated count — so a comparison can
 * reject a mismatch on size alone without ever materializing a runaway
 * result set beyond that cap.
 */
export interface PracticeGradingRows {
  readonly rows: readonly (readonly (string | null)[])[];
  /** How many rows the statement really returned, whatever `rows` holds. */
  readonly totalRows: number;
}

export type PracticeExecution =
  | {
      readonly ok: true;
      readonly result: PracticeResultSet;
      /** Present only when `options.gradingRows` asked for it. Never part
       * of any API response — the client gets `result` (see above). */
      readonly grading?: PracticeGradingRows;
      readonly durationMs: number;
    }
  | { readonly ok: false; readonly error: PracticeSqlError; readonly durationMs: number };

export interface ExecutePracticeSqlOptions {
  readonly maxRows?: number;
  /** Injectable monotonic-ish clock, so a test can assert on `durationMs`
   * without sleeping. */
  readonly now?: () => number;
  /** When set, the execution also carries up to this many rows for
   * server-side grading — see `PracticeGradingRows`. Omitted (the default)
   * means nothing grades this attempt's rows, and none are retained. */
  readonly gradingRows?: number;
}

/**
 * Runs `sql` on an already-checked-out sandbox client and returns either the
 * result set or the database's error — this function does not throw for SQL
 * problems. It only propagates failures that are not the statement's fault
 * (the connection dying mid-query, say), which the route turns into a
 * sandbox-level answer.
 *
 * No `statement_timeout` is set here: the sandbox ROLE carries it
 * server-side (02-schemas.sql), so it applies to every connection that role
 * ever opens, including ones this code path knows nothing about. Setting it
 * again per query would be a second source of truth for the same limit.
 */
export async function executePracticeSql(
  client: PoolClient,
  sql: string,
  options: ExecutePracticeSqlOptions = {},
): Promise<PracticeExecution> {
  const maxRows = options.maxRows ?? MAX_RESULT_ROWS;
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();
  try {
    // `rowMode: "array"` — see `PracticeResultSet.rows`. No `values` are
    // passed on purpose: with none, `pg` uses the simple query protocol,
    // which is what lets a user submit several statements at once the way
    // any SQL client would.
    const raw: unknown = await client.query({ text: sql, rowMode: "array" });
    const grading = options.gradingRows === undefined ? undefined : toGradingRows(raw, options.gradingRows);
    return {
      ok: true,
      result: toResultSet(raw, maxRows),
      ...(grading === undefined ? {} : { grading }),
      durationMs: clock() - startedAt,
    };
  } catch (err) {
    // `DatabaseError` is `pg`'s own class for "the server answered with an
    // ErrorResponse" — a real verdict on the submitted statement (syntax
    // error, missing table, permission). Anything else reaching here (the
    // connection dying mid-query, a timeout, a socket error) is not the
    // statement's fault and must not be dressed up as one: it is rethrown so
    // the caller — which knows it is holding a SANDBOX connection, this
    // function does not — can answer with a sandbox-level failure instead of
    // telling the learner their SQL was wrong.
    if (!(err instanceof DatabaseError)) {
      throw err;
    }
    return { ok: false, error: toPracticeSqlError(err), durationMs: clock() - startedAt };
  }
}

/**
 * Ends any transaction the attempt left behind, so the connection can go
 * back to the pool clean and the next statement on it (the course's check
 * query) starts from a known state.
 *
 * Two cases make this mandatory, not hygiene:
 *   - the user submitted `begin;` without committing — the next user of that
 *     pooled connection would inherit an open transaction;
 *   - the statement failed inside an (implicit or explicit) transaction —
 *     Postgres then rejects EVERY further command with "current transaction
 *     is aborted", including the check query.
 *
 * A bare `rollback` outside a transaction is a no-op that emits a notice,
 * not an error, so this needs no "are we in a transaction?" probe. Failures
 * are swallowed deliberately: this runs on the way out, and its error must
 * never replace the result or the SQL error the user is waiting for.
 */
export async function rollbackOpenTransaction(client: PoolClient): Promise<void> {
  await quietly(client, "rollback");
}

/**
 * Returns a connection to the pool in the state it was handed over in, after
 * the attempt AND the check are done with it.
 *
 * The user's SQL is arbitrary, which includes session-level `SET`s: a
 * submission ending in `set statement_timeout = 0` would otherwise keep that
 * setting on the pooled connection for whoever gets it next — quietly
 * removing the sandbox role's own guard against a runaway query holding a
 * connection forever (docker/postgres/init/02-schemas.sql). `DISCARD ALL`
 * resets exactly that class of leftovers (session settings, prepared
 * statements, temp tables, advisory locks) and is the reason this is not
 * simply another `rollback`.
 *
 * It runs LAST, never between the attempt and the check: the check grades
 * the session the attempt left behind, temp tables included. And it must run
 * outside a transaction block (Postgres rejects `DISCARD ALL` inside one),
 * which is why the rollback comes first.
 */
export async function resetSandboxSession(client: PoolClient): Promise<void> {
  await quietly(client, "rollback");
  await quietly(client, "discard all");
}

/** Runs a cleanup statement whose failure must never replace the result (or
 * the SQL error) the user is waiting for. */
async function quietly(client: PoolClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch {
    // Nothing useful to do: the connection is being released either way.
  }
}

/** `pg`'s error fields, copied out untouched. Anything absent stays absent
 * rather than becoming an empty string, so a client can tell "Postgres said
 * nothing about this" from "Postgres said ''". */
export function toPracticeSqlError(err: unknown): PracticeSqlError {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const fields = err as unknown as Record<string, unknown>;
  const error: { -readonly [K in keyof PracticeSqlError]: PracticeSqlError[K] } = { message: err.message };
  for (const key of ["severity", "code", "detail", "hint", "position", "where"] as const) {
    const value = optionalText(fields[key]);
    if (value !== undefined) {
      error[key] = value;
    }
  }
  return error;
}

/**
 * One cell, rendered for display. Every value becomes a string (or `null`
 * for SQL NULL) instead of being passed through as whatever JS value `pg`
 * parsed it into.
 *
 * Why not the parsed value: JSON has no way to carry most of what Postgres
 * returns without lying about it — a `bigint` beyond 2^53 loses digits as a
 * JSON number, `numeric` already arrives as a string, a `timestamptz`
 * arrives as a `Date` whose JSON form depends on the server's timezone
 * handling, and `bytea` arrives as a Buffer that JSON.stringify turns into
 * `{"type":"Buffer","data":[...]}`. A SQL result grid shows text; making
 * that explicit keeps the wire format honest (and lets the response schema
 * declare it, instead of an untyped "any").
 */
export function formatCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    // Postgres' own `bytea` output format, so it reads the way `psql` would
    // show it.
    return `\\x${value.toString("hex")}`;
  }
  try {
    // json/jsonb columns and Postgres arrays arrive as parsed JS values.
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular/unstringifiable — never let a cell take the whole response
    // down.
    return String(value);
  }
}

/** `pg` answers a multi-statement simple query with an ARRAY of results (one
 * per statement) and a single-statement one with a bare result. Both are
 * normalized here; everything is read defensively, because this is the one
 * place where a driver-shape surprise would otherwise crash a route. */
function toResultSet(raw: unknown, maxRows: number): PracticeResultSet {
  const { record, statementCount } = lastStatement(raw);

  const fields = Array.isArray(record.fields) ? (record.fields as unknown[]) : [];
  const columns: PracticeColumn[] = fields.map((field, index) => {
    const fieldRecord = isRecord(field) ? field : {};
    return {
      name: typeof fieldRecord.name === "string" ? fieldRecord.name : `column${index + 1}`,
      dataTypeId: typeof fieldRecord.dataTypeID === "number" ? fieldRecord.dataTypeID : 0,
    };
  });

  const rawRows = rowsOf(record);

  return {
    ...(typeof record.command === "string" ? { command: record.command } : {}),
    rowCount: typeof record.rowCount === "number" ? record.rowCount : null,
    columns,
    rows: formatRows(rawRows, maxRows),
    truncated: rawRows.length > maxRows,
    statementCount,
  };
}

/** The same last-statement result, read for grading instead of display —
 * a bigger cap and the true row count (see `PracticeGradingRows`). */
function toGradingRows(raw: unknown, cap: number): PracticeGradingRows {
  const rawRows = rowsOf(lastStatement(raw).record);
  return { rows: formatRows(rawRows, cap), totalRows: rawRows.length };
}

function lastStatement(raw: unknown): { record: Record<string, unknown>; statementCount: number } {
  const results = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  const last = results.length === 0 ? undefined : results[results.length - 1];
  return { record: isRecord(last) ? last : {}, statementCount: Math.max(results.length, 1) };
}

function rowsOf(record: Record<string, unknown>): unknown[] {
  return Array.isArray(record.rows) ? (record.rows as unknown[]) : [];
}

function formatRows(rawRows: readonly unknown[], cap: number): (string | null)[][] {
  return rawRows.slice(0, cap).map((row) => (Array.isArray(row) ? (row as unknown[]) : [row]).map(formatCell));
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.length === 0 ? undefined : value;
  }
  if (typeof value === "number") {
    // `position` comes back as a string from the wire protocol, but a driver
    // (or a test double) handing over a number must not silently drop it.
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
