import assert from "node:assert/strict";
import test from "node:test";

import { encodeValue, valuesEqual } from "./compare.js";

void test("encodeValue leaves JSON-native values alone", () => {
  assert.deepEqual(encodeValue({ a: [1, "two", true, null] }), { a: [1, "two", true, null] });
});

void test("encodeValue tells undefined from null (Review Focus 4)", () => {
  assert.deepEqual(encodeValue(undefined), { $undefined: true });
  assert.equal(encodeValue(null), null);
  assert.equal(valuesEqual(encodeValue(undefined), encodeValue(null)), false);
  assert.equal(valuesEqual(encodeValue(null), null), true);
});

void test("encodeValue carries the numbers JSON cannot", () => {
  assert.deepEqual(encodeValue(Number.NaN), { $nan: true });
  assert.deepEqual(encodeValue(Number.POSITIVE_INFINITY), { $inf: 1 });
  assert.deepEqual(encodeValue(Number.NEGATIVE_INFINITY), { $inf: -1 });
  assert.deepEqual(encodeValue(10n), { $bigint: "10" });
  // NaN is equal to NaN once encoded — the learner returned "the" NaN.
  assert.equal(valuesEqual(encodeValue(Number.NaN), encodeValue(Number.NaN)), true);
});

void test("encodeValue carries Date, Map and Set", () => {
  assert.deepEqual(encodeValue(new Date("2026-01-02T03:04:05.000Z")), { $date: "2026-01-02T03:04:05.000Z" });
  assert.deepEqual(encodeValue(new Date(Number.NaN)), { $date: null });
  assert.deepEqual(encodeValue(new Map([["k", 1]])), { $map: [["k", 1]] });
  assert.deepEqual(encodeValue(new Set([1, 2])), { $set: [1, 2] });
});

void test("encodeValue names functions and symbols instead of dropping them", () => {
  assert.deepEqual(
    encodeValue(function sum() {
      return 0;
    }),
    { $function: "sum" },
  );
  assert.deepEqual(encodeValue(Symbol("tag")), { $symbol: "tag" });
});

void test("encodeValue refuses a circular structure", () => {
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  assert.throws(() => encodeValue(loop), TypeError);
});

void test("valuesEqual ignores object key order but not array order", () => {
  assert.equal(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(valuesEqual([1, 2], [2, 1]), false);
  assert.equal(valuesEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(valuesEqual([1, [2, { c: 3 }]], [1, [2, { c: 3 }]]), true);
  assert.equal(valuesEqual("1", 1), false);
});
