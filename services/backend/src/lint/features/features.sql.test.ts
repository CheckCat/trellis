import assert from "node:assert/strict";
import test from "node:test";

import { sqlFeaturesOf, SQL_FEATURES } from "./features.sql.js";

void test("a plain SELECT uses only SELECT", () => {
  assert.deepEqual(sqlFeaturesOf("select title, author from books"), ["select"]);
});

void test("the constructs an exercise needs are reported together", () => {
  assert.deepEqual(sqlFeaturesOf("select title from books where in_stock = true order by title"), [
    "select",
    "where",
    "order-by",
  ]);
});

void test("a string literal is data, not syntax", () => {
  // The whole reason literals are stripped first: a book called
  // 'Order by Chaos' must not make an exercise look like it needs sorting.
  assert.deepEqual(sqlFeaturesOf("insert into books (title) values ('Order by Chaos')"), ["insert"]);
});

void test("a comment cannot grant a construct either (edge case)", () => {
  assert.deepEqual(sqlFeaturesOf("select id from t -- where the magic happens"), ["select"]);
});

void test("the old comma join counts as a join", () => {
  // A learner who has not met joins cannot write this form either.
  assert.ok(sqlFeaturesOf("select a.id from authors a, books b where a.id = b.author_id").includes("join"));
});

void test("a parenthesised SELECT is a subquery wherever it stands", () => {
  assert.ok(sqlFeaturesOf("select id from t where id in (select id from u)").includes("subquery"));
});

void test("aggregates are detected by call, not by the word", () => {
  assert.ok(sqlFeaturesOf("select count(*) from books").includes("aggregate"));
  // A column that merely happens to be called `count` is not an aggregate.
  assert.equal(sqlFeaturesOf("select count from stats").includes("aggregate"), false);
});

/**
 * One statement per published feature, chosen so the statement genuinely
 * NEEDS that construct. Serves both directions at once: a feature with no
 * sample is one nobody proved detectable, and a sample that does not
 * produce its feature is a pattern that never fires.
 *
 * A feature id that cannot be detected is the worst kind of silence here —
 * a plan grants it, an exercise uses it, and the rule that should have
 * said "this needs what the course has not taught" says nothing.
 */
const SAMPLES: Readonly<Record<string, string>> = {
  select: "select 1",
  where: "select a from t where b = 1",
  "order-by": "select a from t order by a",
  limit: "select a from t limit 5",
  distinct: "select distinct a from t",
  "group-by": "select a from t group by a",
  having: "select a from t group by a having count(*) > 1",
  aggregate: "select count(*) from t",
  join: "select a from t join u on t.id = u.id",
  subquery: "select a from t where id in (select id from u)",
  union: "select a from t union select b from u",
  case: "select case when a then 1 else 2 end from t",
  like: "select a from t where b like 'x%'",
  in: "select a from t where b in (1, 2)",
  between: "select a from t where b between 1 and 2",
  "null-check": "select a from t where b is null",
  insert: "insert into t values (1)",
  update: "update t set a = 1",
  delete: "delete from t",
  transaction: "begin; select 1; commit;",
  ddl: "create table t (id int)",
  window: "select sum(x) over (partition by dept) from t",
  cte: "with recent as (select a from t) select a from recent",
  "date-function": "select date_trunc('month', hired_at) from t",
};

void test("every published feature has a statement that produces it, and vice versa", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...SQL_FEATURES].sort());
  for (const [feature, sql] of Object.entries(SAMPLES)) {
    assert.ok(sqlFeaturesOf(sql).includes(feature), `"${feature}" is never detected — ${sql}`);
  }
});

void test("every id the detector returns is one the published list knows", () => {
  for (const sql of Object.values(SAMPLES)) {
    for (const feature of sqlFeaturesOf(sql)) {
      assert.ok(SQL_FEATURES.includes(feature), `${feature} is missing from SQL_FEATURES`);
    }
  }
});

void test("a window function is not just an aggregate", () => {
  // The blind spot this feature was added for: before it, the statement
  // below reported only "aggregate", so a course that taught COUNT could
  // set a window-function exercise and the lint stayed silent.
  const features = sqlFeaturesOf("select dept, sum(salary) over (partition by dept) from employees");
  assert.ok(features.includes("window"));
  assert.ok(features.includes("aggregate"));
});

void test("a column named like a date function is data, not date arithmetic (edge case)", () => {
  // `age` and `extract` are plausible column names; only a call is
  // evidence. `interval` has no call form, so it is matched as a word —
  // the deliberate exception, noted where the pattern is written.
  assert.equal(sqlFeaturesOf("select age, extract from people").includes("date-function"), false);
  assert.ok(sqlFeaturesOf("select age(hired_at) from people").includes("date-function"));
});

void test("WITH that is not a CTE does not count (edge case)", () => {
  // `with` appears in plenty of clauses that introduce no named query.
  assert.equal(sqlFeaturesOf("create table t (id int) with (fillfactor = 70)").includes("cte"), false);
  assert.ok(sqlFeaturesOf("with recent as (select 1) select * from recent").includes("cte"));
});
