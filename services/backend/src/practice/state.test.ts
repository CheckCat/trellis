import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeterministic,
  comparePracticeState,
  isPracticeSolutionError,
  MAX_STATE_ROWS_PER_TABLE,
  runPracticeSolution,
  snapshotSandboxState,
  type SandboxStateSnapshot,
} from "./state.js";
import { createScriptedSandboxDriver, databaseError, resultSet, type ScriptedAnswer } from "./test-support.js";

const CONTEXT = { courseId: "some-course", lessonId: "some-lesson" } as const;
const SOLUTION_SQL = "update books set in_stock = false where id = 1";

/** The two shapes a snapshot reads: the table list, then one digest query
 * per table. Anything else is the code under test doing something it
 * shouldn't.
 *
 * Rows are OBJECTS here, unlike everywhere else in these fixtures: both of
 * these queries are the engine's own and are read by column name, so they
 * run in `pg`'s default row mode. The positional `rowMode: "array"` is for
 * SQL whose shape the engine does not control — the learner's statement,
 * the course's check, the course's reference query. */
function scriptSnapshot(tables: Record<string, { rows: number; digest: string }>): (text: string) => ScriptedAnswer {
  return (text: string) => {
    if (text.includes("pg_catalog.pg_class")) {
      return { rows: Object.keys(tables).map((name) => ({ relname: name })) };
    }
    if (text.includes("md5(")) {
      const table = Object.keys(tables).find((name) => text.includes(`"${name}"`));
      const entry = table === undefined ? undefined : tables[table];
      return { rows: [{ rows: String(entry?.rows ?? 0), digest: entry?.digest ?? "" }] };
    }
    return resultSet({});
  };
}

async function snapshot(tables: Record<string, { rows: number; digest: string }>): Promise<SandboxStateSnapshot> {
  const scripted = createScriptedSandboxDriver({ respond: scriptSnapshot(tables) });
  return await scripted.driver.withClient((client) => snapshotSandboxState(client));
}

void test("a snapshot reads every table of the sandbox schema, in name order", async () => {
  const scripted = createScriptedSandboxDriver({
    respond: scriptSnapshot({ authors: { rows: 2, digest: "aaa" }, books: { rows: 5, digest: "bbb" } }),
  });

  const state = await scripted.driver.withClient((client) => snapshotSandboxState(client));

  assert.deepEqual(state.tables, [
    { table: "authors", rows: 2, digest: "aaa" },
    { table: "books", rows: 5, digest: "bbb" },
  ]);
  // Scoped by `current_schema()`, never by a schema name passed in: the
  // sandbox role's search_path IS the sandbox schema, so the connection
  // itself is the authority on what may be read.
  assert.match(scripted.texts()[0] ?? "", /current_schema\(\)/);
  assert.equal(scripted.clientsOpen(), 0);
});

void test("identical states pass; a changed row fails without naming what changed", async () => {
  const reference = await snapshot({ books: { rows: 5, digest: "same" } });
  const identical = await snapshot({ books: { rows: 5, digest: "same" } });
  const edited = await snapshot({ books: { rows: 5, digest: "different" } });

  assert.deepEqual(comparePracticeState(reference, identical), { passed: true });

  const verdict = comparePracticeState(reference, edited);
  assert.equal(verdict.passed, false);
  // Same row count, so the only honest thing to say is that the contents
  // differ. Naming the row — let alone the value — would hand over the
  // answer one failed attempt at a time.
  assert.equal(verdict.reason, 'таблица "books": строк столько же, но содержимое отличается');
});

void test("a row-count difference is reported in counts, which the learner can see anyway", async () => {
  const reference = await snapshot({ books: { rows: 5, digest: "a" } });
  const deleted = await snapshot({ books: { rows: 4, digest: "b" } });

  assert.deepEqual(comparePracticeState(reference, deleted), {
    passed: false,
    reason: 'таблица "books": ожидалось строк 5, получено 4',
  });
});

void test("a table on one side only is reported as such (edge case)", async () => {
  const reference = await snapshot({ books: { rows: 1, digest: "a" } });
  const extra = await snapshot({ books: { rows: 1, digest: "a" }, scratch: { rows: 0, digest: "" } });

  // A table the learner created themselves. Named, because they know it
  // exists — hiding it would make the verdict unexplainable.
  assert.deepEqual(comparePracticeState(reference, extra), {
    passed: false,
    reason: 'таблица "scratch" есть только с одной стороны',
  });
  assert.equal(comparePracticeState(extra, reference).passed, false);
});

void test("the damage an UPDATE without WHERE does is caught by the state, not by a predicate", async () => {
  // The whole reason this mechanic exists. The assignment is "mark book 1
  // as out of stock"; a check written for book 1 passes both of these, and
  // only one of them is right.
  const solved = await snapshot({ books: { rows: 5, digest: "one-row-updated" } });
  const sledgehammer = await snapshot({ books: { rows: 5, digest: "every-row-updated" } });

  assert.equal(comparePracticeState(solved, solved).passed, true);
  assert.equal(comparePracticeState(solved, sledgehammer).passed, false);
});

void test("a solution the database rejects is the AUTHOR's problem, never a verdict (error path)", async () => {
  const scripted = createScriptedSandboxDriver({
    respond: () => databaseError('relation "bookz" does not exist', { code: "42P01" }),
  });

  const err = await scripted.driver
    .withClient((client) => runPracticeSolution(client, { sql: SOLUTION_SQL, ...CONTEXT }))
    .catch((thrown: unknown) => thrown);

  assert.ok(isPracticeSolutionError(err), `expected a PracticeSolutionError, got ${String(err)}`);
  assert.equal(err.kind, "solution_failed");
  // Postgres' own words reach the course author verbatim...
  assert.equal(err.databaseError, 'relation "bookz" does not exist');
  // ...but the solution's text never does — it is the answer to the
  // exercise, and an error message is not a place to print it.
  assert.doesNotMatch(err.message, /in_stock|update books/);
});

void test("a table bigger than the comparison limit is refused as an authoring decision (edge case)", async () => {
  const oversized = MAX_STATE_ROWS_PER_TABLE + 1;
  const scripted = createScriptedSandboxDriver({
    respond: scriptSnapshot({ events: { rows: oversized, digest: "x" } }),
  });

  const err = await scripted.driver
    .withClient((client) => snapshotSandboxState(client))
    .catch((thrown: unknown) => thrown);

  assert.ok(isPracticeSolutionError(err));
  assert.equal(err.kind, "solution_too_large");
  assert.match(err.message, new RegExp(`${oversized} rows`));
  // And it says what to do instead, rather than only what it refuses.
  assert.match(err.message, /use "check"/);
});

void test("a solution that leaves two different states behind is reported as broken content", async () => {
  const first = await snapshot({ books: { rows: 5, digest: "run-one" } });
  const second = await snapshot({ books: { rows: 5, digest: "run-two" } });

  assert.doesNotThrow(() => assertDeterministic(first, first, CONTEXT));

  const err = (() => {
    try {
      assertDeterministic(first, second, CONTEXT);
      return undefined;
    } catch (thrown: unknown) {
      return thrown;
    }
  })();

  assert.ok(isPracticeSolutionError(err));
  assert.equal(err.kind, "solution_nondeterministic");
  // The message has to point at both causes, because the one a course
  // author will not think of is the second: a DEFAULT in the seed makes
  // every INSERT exercise in the course unsolvable while telling the
  // learner only "не зачтено".
  assert.match(err.message, /now\(\)\/random\(\)/);
  assert.match(err.message, /DEFAULT/);
  assert.doesNotMatch(err.message, /update books/);
});
