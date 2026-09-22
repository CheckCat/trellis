import assert from "node:assert/strict";
import test from "node:test";

import { sqlFeaturesOf, SQL_FEATURES } from "./sqlFeatures.js";

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

void test("every id the detector can return is in the published list", () => {
  const samples = [
    "select 1",
    "update t set a = 1 where b = 2",
    "delete from t",
    "insert into t values (1)",
    "create table t (id int)",
    "begin; select 1; commit;",
    "select distinct a from t group by a having count(*) > 1 limit 5",
    "select case when a is null then 1 else 2 end from t where a like 'x%' and b between 1 and 2",
    "select a from t union select b from u",
  ];
  for (const sql of samples) {
    for (const feature of sqlFeaturesOf(sql)) {
      assert.ok(SQL_FEATURES.includes(feature), `${feature} is missing from SQL_FEATURES`);
    }
  }
});
