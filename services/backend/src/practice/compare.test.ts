import assert from "node:assert/strict";
import test from "node:test";

import {
  compareResults,
  isPracticeExpectedError,
  MAX_COMPARISON_ROWS,
  readPracticeExpected,
  type ComparableResult,
  type PracticeExpectedVerdict,
} from "./compare.js";
import { createScriptedSandboxDriver, databaseError, resultSet, type ScriptedAnswer } from "./testSupport.js";

// Postgres type OIDs, named so the tests read as types rather than numbers.
const TEXT = 25;
const INT4 = 23;
const INT8 = 20;
const NUMERIC = 1700;
const FLOAT8 = 701;
const BOOL = 16;

/** One side of a comparison, with the untruncated row count derived from
 * the rows unless a test is specifically about a capped result. */
function side(
  columnTypeIds: readonly number[],
  rows: readonly (readonly (string | null)[])[],
  totalRows = rows.length,
): ComparableResult {
  return { columnTypeIds, rows, totalRows };
}

function assertPassed(verdict: PracticeExpectedVerdict): void {
  assert.deepEqual(verdict, { passed: true }, `expected a pass, got: ${JSON.stringify(verdict)}`);
}

function assertFailed(verdict: PracticeExpectedVerdict, reason: string): void {
  assert.equal(verdict.passed, false);
  assert.equal(verdict.reason, reason);
}

// --- compareResults: the pure comparison ---------------------------------

void test("compareResults passes identical results, ordered or not", () => {
  const rows = [
    ["Война и мир", "Лев Толстой"],
    ["Отцы и дети", "Иван Тургенев"],
  ];
  assertPassed(compareResults(side([TEXT, TEXT], rows), side([TEXT, TEXT], rows), false));
  assertPassed(compareResults(side([TEXT, TEXT], rows), side([TEXT, TEXT], rows), true));
});

void test("compareResults compares row ORDER only when ordered is true", () => {
  const attempt = side([TEXT], [["b"], ["a"], ["c"]]);
  const reference = side([TEXT], [["a"], ["b"], ["c"]]);

  assertPassed(compareResults(attempt, reference, false));
  // Row 1 of the learner's own result is where the sequences first differ.
  assertFailed(compareResults(attempt, reference, true), "строки различаются (первое расхождение — строка 1)");
});

void test("compareResults treats rows as a MULTISET, not a set, when unordered", () => {
  // Same distinct values, different multiplicities — three rows each, so
  // the count check cannot catch this one.
  const attempt = side([TEXT], [["a"], ["a"], ["b"]]);
  const reference = side([TEXT], [["a"], ["b"], ["b"]]);
  assert.equal(compareResults(attempt, reference, false).passed, false);
});

void test("compareResults reports a column-count mismatch before anything else", () => {
  const attempt = side([TEXT, TEXT, INT4], [["a", "b", "1"]]);
  const reference = side([TEXT, TEXT], [["a", "b"]]);
  assertFailed(compareResults(attempt, reference, false), "ожидалось столбцов: 2, получено: 3");
});

void test("compareResults ignores column NAMES — only the count and the values matter", () => {
  // There are no names in `ComparableResult` at all: this test states that
  // the design choice is deliberate by passing results that a
  // name-sensitive comparison would reject (different types, same values).
  const attempt = side([TEXT], [["7"]]);
  const reference = side([TEXT], [["7"]]);
  assertPassed(compareResults(attempt, reference, false));
});

void test("compareResults reports a row-count mismatch using the UNTRUNCATED totals", () => {
  // The learner's result was capped at two retained rows but really has 22
  // — the message must name 22, not what happened to be kept.
  const attempt = side([TEXT], [["a"], ["b"]], 22);
  const reference = side([TEXT], Array.from({ length: 19 }, (_, index) => [`row-${index}`]));
  assertFailed(compareResults(attempt, reference, false), "ожидалось строк: 19, получено: 22");
});

void test("compareResults treats NULL as equal only to NULL", () => {
  assertPassed(compareResults(side([TEXT], [[null]]), side([TEXT], [[null]]), true));
  assert.equal(compareResults(side([TEXT], [[null]]), side([TEXT], [[""]]), true).passed, false);
  assert.equal(compareResults(side([TEXT], [["null"]]), side([TEXT], [[null]]), true).passed, false);
});

void test("compareResults compares numeric columns by value, within 1e-9", () => {
  // `count(*)` (bigint) against `sum(1)` (numeric): same value, different
  // type, different text.
  assertPassed(compareResults(side([INT8], [["3"]]), side([NUMERIC], [["3.00"]]), true));
  // Inside the tolerance.
  assertPassed(compareResults(side([FLOAT8], [["0.1"]]), side([NUMERIC], [["0.1000000000"]]), true));
  assertPassed(compareResults(side([FLOAT8], [["1"]]), side([FLOAT8], [["1.0000000009"]]), true));
  // Outside it — a real difference, not a representation artefact.
  assert.equal(compareResults(side([FLOAT8], [["1"]]), side([FLOAT8], [["1.000001"]]), true).passed, false);
});

void test("compareResults does not apply the numeric tolerance to text that merely looks numeric", () => {
  // A text column holding "1" and one holding "1.0000000001" are different
  // answers: `'1' = '1.0000000001'` is false in SQL too.
  assert.equal(compareResults(side([TEXT], [["1"]]), side([TEXT], [["1.0000000001"]]), true).passed, false);
  // Mixed types fall back to text as well — `'1'` is not `1`.
  assert.equal(compareResults(side([TEXT], [["1"]]), side([INT4], [["1.0"]]), true).passed, false);
});

void test("compareResults matches near-equal numbers across a reordered unordered result", () => {
  const attempt = side([FLOAT8], [["2"], ["1.0000000001"]]);
  const reference = side([FLOAT8], [["1"], ["2.0000000001"]]);
  assertPassed(compareResults(attempt, reference, false));
});

void test("compareResults compares non-numeric types on Postgres' own rendering", () => {
  assertPassed(compareResults(side([BOOL], [["true"]]), side([BOOL], [["true"]]), true));
  assert.equal(compareResults(side([BOOL], [["true"]]), side([BOOL], [["false"]]), true).passed, false);
  // Timestamps arrive as `Date`s and are rendered as the same ISO instant
  // by `formatCell` on both sides — "по значению" and "по тексту" coincide.
  const instant = "2024-03-01T10:00:00.000Z";
  assertPassed(compareResults(side([1184], [[instant]]), side([1184], [[instant]]), true));
});

void test("compareResults names the learner's OWN row number in an unordered mismatch", () => {
  // Rows 1 and 2 match something on the other side; row 3 does not.
  const attempt = side([TEXT], [["b"], ["a"], ["zzz"]]);
  const reference = side([TEXT], [["a"], ["b"], ["c"]]);
  assertFailed(
    compareResults(attempt, reference, false),
    "строки различаются (порядок строк не важен; первая строка без пары — строка 3)",
  );
});

// --- readPracticeExpected: the reference query against a sandbox client ---

const EXPECTED_SQL = "select title from books where in_stock = true";

interface ExpectedRun {
  readonly verdict?: PracticeExpectedVerdict;
  readonly error?: unknown;
  readonly texts: string[];
  readonly rowModes: (string | undefined)[];
}

async function runExpected(
  attempt: ComparableResult,
  respond: (text: string) => ScriptedAnswer,
  ordered = false,
): Promise<ExpectedRun> {
  const scripted = createScriptedSandboxDriver({ respond });
  const collect = (): Pick<ExpectedRun, "texts" | "rowModes"> => ({
    texts: scripted.texts(),
    rowModes: scripted.queries.map((query) => query.rowMode),
  });
  try {
    const verdict = await scripted.driver.withClient(async (client) => {
      // Reading the reference and judging the attempt against it are two
      // steps now, because the route runs them at two different moments:
      // the reference comes off the freshly seeded sandbox BEFORE the
      // learner's statement (routes/practice/sql.ts). These tests still
      // exercise the pair together — that is what the mechanic is.
      const reference = await readPracticeExpected(client, {
        sql: EXPECTED_SQL,
        courseId: "some-course",
        lessonId: "some-lesson",
      });
      return compareResults(attempt, reference, ordered);
    });
    return { verdict, ...collect() };
  } catch (err) {
    return { error: err, ...collect() };
  }
}

/** Answers the reference query with `answer`; transaction control gets an
 * empty result. */
function script(answer: ScriptedAnswer): (text: string) => ScriptedAnswer {
  return (text: string) => (text === EXPECTED_SQL ? answer : resultSet({ command: text.toUpperCase(), rowCount: null }));
}

void test("readPracticeExpected runs the reference inside a read-only transaction and ends it", async () => {
  const run = await runExpected(
    side([TEXT], [["Отцы и дети"]]),
    script(resultSet({ columns: ["title"], rows: [["Отцы и дети"]], dataTypeIds: [TEXT] })),
  );

  assertPassed(run.verdict!);
  // Read-only by construction, not by inspecting the author's SQL: a
  // reference query must never be able to change the sandbox the learner
  // is working in (or the state a `check` on the same lesson grades).
  assert.deepEqual(run.texts, ["begin transaction read only", EXPECTED_SQL, "rollback"]);
  // Positional rows, for the same reason the learner's statement uses
  // them: two identically named columns must not collapse into one.
  assert.equal(run.rowModes[1], "array");
});

void test("readPracticeExpected ends the transaction even when the reference query fails", async () => {
  const run = await runExpected(
    side([TEXT], [["a"]]),
    script(databaseError('relation "bookz" does not exist', { code: "42P01" })),
  );

  assert.ok(isPracticeExpectedError(run.error), `expected a PracticeExpectedError, got ${String(run.error)}`);
  assert.equal(run.error.kind, "expected_failed");
  // Postgres' own words reach the course author verbatim...
  assert.equal(run.error.databaseError, 'relation "bookz" does not exist');
  // ...but the reference query's text never does.
  assert.doesNotMatch(run.error.message, /in_stock|select title/);
  assert.deepEqual(run.texts, ["begin transaction read only", EXPECTED_SQL, "rollback"]);
});

void test("readPracticeExpected rejects a multi-statement reference query", async () => {
  const run = await runExpected(side([TEXT], [["a"]]), script([resultSet({}), resultSet({})]));

  assert.ok(isPracticeExpectedError(run.error));
  assert.equal(run.error.kind, "expected_contract_violation");
  assert.match(run.error.message, /is 2 statements/);
  assert.doesNotMatch(run.error.message, /in_stock|select title/);
});

void test("readPracticeExpected rejects a reference result past the comparison limit as the AUTHOR's problem", async () => {
  const oversized = MAX_COMPARISON_ROWS + 1;
  const run = await runExpected(
    side([INT4], [], oversized),
    script(
      resultSet({
        columns: ["n"],
        rows: Array.from({ length: oversized }, (_, index) => [index]),
        dataTypeIds: [INT4],
      }),
    ),
  );

  assert.ok(isPracticeExpectedError(run.error));
  assert.equal(run.error.kind, "expected_too_large");
  // The message must blame the assignment, not the learner — and say what
  // the limit is, so the author can act on it.
  assert.match(run.error.message, new RegExp(`${oversized} rows`));
  assert.match(run.error.message, new RegExp(`${MAX_COMPARISON_ROWS}-row comparison limit`));
  assert.match(run.error.message, /assignment-configuration problem, not a wrong answer/);
});

void test("readPracticeExpected compares ordered results in sequence when the assignment says so", async () => {
  const reference = script(
    resultSet({
      columns: ["title", "published_year"],
      rows: [
        ["Евгений Онегин", 1833],
        ["Мёртвые души", 1842],
      ],
      dataTypeIds: [TEXT, INT4],
    }),
  );
  const shuffled = side(
    [TEXT, INT4],
    [
      ["Мёртвые души", "1842"],
      ["Евгений Онегин", "1833"],
    ],
  );

  assertFailed((await runExpected(shuffled, reference, true)).verdict!, "строки различаются (первое расхождение — строка 1)");
  assertPassed((await runExpected(shuffled, reference, false)).verdict!);
});
