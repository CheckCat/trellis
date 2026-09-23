// Real child processes, real temp directories: the runner's contract is
// "what node does with this file", and only node can answer that.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { encodeValue } from "./compare.js";
import { createNodeRunner, type CodeRunResult } from "./run-node.js";

const TS_SUM = "export function sum(a: number, b: number): number { return a + b; }";
const JS_SUM = "export function sum(a, b) { return a + b; }";

function ran(result: CodeRunResult) {
  assert.equal(result.kind, "ran", JSON.stringify(result));
  return result.kind === "ran" ? result.cases : [];
}

void test("runs a TypeScript module and returns every case's value", async () => {
  const runner = createNodeRunner();
  const result = await runner.run({
    language: "typescript",
    code: TS_SUM,
    entry: "sum",
    cases: [
      [2, 3],
      [-1, 1],
    ],
  });
  const cases = ran(result);
  assert.deepEqual(
    cases.map((c) => c.value),
    [5, 0],
  );
  assert.deepEqual(
    cases.map((c) => c.output),
    ["", ""],
  );
  assert.equal(typeof result.durationMs, "number");
});

void test("runs a JavaScript module", async () => {
  const result = await createNodeRunner().run({ language: "javascript", code: JS_SUM, entry: "sum", cases: [[1, 1]] });
  assert.deepEqual(
    ran(result).map((c) => c.value),
    [2],
  );
});

void test("awaits an async function", async () => {
  const code =
    "export async function later(x: number) { await new Promise((r) => setTimeout(r, 10)); return x * 2; }";
  const result = await createNodeRunner().run({ language: "typescript", code, entry: "later", cases: [[21]] });
  assert.deepEqual(
    ran(result).map((c) => c.value),
    [42],
  );
});

void test("the harness encodes values exactly like compare.ts (the duplicated rules agree)", async () => {
  const code = [
    "export function f(which) {",
    "  switch (which) {",
    "    case 'undef': return undefined;",
    "    case 'nan': return NaN;",
    "    case 'inf': return -Infinity;",
    "    case 'big': return 10n;",
    "    case 'date': return new Date('2026-01-02T03:04:05.000Z');",
    "    case 'map': return new Map([['k', [1, null]]]);",
    "    case 'set': return new Set([1, 2]);",
    "    case 'obj': return { b: 2, a: 1 };",
    "  }",
    "}",
  ].join("\n");
  const which = ["undef", "nan", "inf", "big", "date", "map", "set", "obj"];
  const result = await createNodeRunner().run({
    language: "javascript",
    code,
    entry: "f",
    cases: which.map((w) => [w]),
  });
  const expected = [
    undefined,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    10n,
    new Date("2026-01-02T03:04:05.000Z"),
    new Map([["k", [1, null]]]),
    new Set([1, 2]),
    { b: 2, a: 1 },
  ].map(encodeValue);
  assert.deepEqual(
    ran(result).map((c) => c.value),
    expected,
  );
});

void test("an exception inside one case is that case's error, not the run's", async () => {
  const code = "export function f(x) { if (x < 0) throw new RangeError('negative'); return x; }";
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: [[1], [-1]] });
  const cases = ran(result);
  assert.equal(cases[0]?.value, 1);
  assert.equal(cases[1]?.value, undefined);
  assert.equal(cases[1]?.error?.message, "negative");
});

void test("a syntax error is load_failed with node's own words", async () => {
  const result = await createNodeRunner().run({
    language: "javascript",
    code: "export function (",
    entry: "f",
    cases: [[]],
  });
  assert.equal(result.kind, "load_failed");
  // Node's wording changes between versions ("Function statements require
  // a function name" today); what must hold is that it IS a SyntaxError
  // and that the message is not empty.
  const error = result.kind === "load_failed" ? result.error : { message: "", stack: "" };
  assert.ok(error.message.length > 0);
  assert.match(error.stack ?? "", /^SyntaxError/);
});

void test("non-erasable TypeScript (enum) is load_failed, not a crash", async () => {
  const code = "enum E { A }\nexport function f() { return E.A; }";
  const result = await createNodeRunner().run({ language: "typescript", code, entry: "f", cases: [[]] });
  assert.equal(result.kind, "load_failed");
});

void test("a missing export is entry_missing and lists what WAS exported", async () => {
  const result = await createNodeRunner().run({
    language: "javascript",
    code: "export const Sum = 1; export function add() {}",
    entry: "sum",
    cases: [[]],
  });
  assert.equal(result.kind, "entry_missing");
  assert.deepEqual(result.kind === "entry_missing" ? result.exported : [], ["Sum", "add"]);
});

void test("an endless loop is timeout, and the cases that finished are kept", async () => {
  const code = "export function f(n) { if (n) return n; while (true) {} }";
  const result = await createNodeRunner({ timeoutMs: 1500 }).run({
    language: "javascript",
    code,
    entry: "f",
    cases: [[1], [0], [2]],
  });
  assert.equal(result.kind, "timeout");
  assert.deepEqual(result.kind === "timeout" ? result.cases.map((c) => c.value) : [], [1]);
});

void test("a promise that never settles is timeout (Review Focus 1)", async () => {
  const code = "export function f() { return new Promise(() => {}); }";
  const result = await createNodeRunner({ timeoutMs: 1500 }).run({ language: "javascript", code, entry: "f", cases: [[]] });
  assert.equal(result.kind, "timeout");
});

void test("process.exit() mid-run is crashed, never a clean ran (Review Focus 2)", async () => {
  const code = "export function f(n) { if (n) process.exit(0); return n; }";
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: [[0], [1]] });
  assert.equal(result.kind, "crashed");
});

void test("a raw stdout flood does not block the process (Review Focus 3)", async () => {
  const code = "export function f() { process.stdout.write('x'.repeat(1_000_000)); return 1; }";
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: [[]] });
  assert.deepEqual(
    ran(result).map((c) => c.value),
    [1],
  );
});

void test("console output is captured per case and truncated at the limit", async () => {
  const code = "export function f(n) { console.log('case', n); console.warn('x'.repeat(20_000)); return n; }";
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: [[1], [2]] });
  const cases = ran(result);
  assert.ok(cases[0]?.output.startsWith("case 1\n"));
  assert.ok(cases[1]?.output.startsWith("case 2\n"));
  assert.equal(cases[0]?.truncated, true);
  assert.ok((cases[0]?.output.length ?? 0) <= 16_384);
});

void test("the child sees an empty environment", async () => {
  const code = "export function f() { return process.env.HOME; }";
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: [[]] });
  assert.deepEqual(
    ran(result).map((c) => c.value),
    [{ $undefined: true }],
  );
});

void test("the temp directory is removed after every outcome", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-run-node-test-"));
  try {
    const runner = createNodeRunner({ tmpRoot, timeoutMs: 1500 });
    await runner.run({ language: "javascript", code: JS_SUM, entry: "sum", cases: [[1, 2]] });
    await runner.run({ language: "javascript", code: "export function f() { while (true) {} }", entry: "f", cases: [[]] });
    await runner.run({ language: "javascript", code: "export function (", entry: "f", cases: [[]] });
    assert.deepEqual(fs.readdirSync(tmpRoot), []);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

void test("a node binary that cannot be started is unavailable", async () => {
  const result = await createNodeRunner({ execPath: "/nonexistent/node" }).run({
    language: "javascript",
    code: JS_SUM,
    entry: "sum",
    cases: [[1, 2]],
  });
  assert.equal(result.kind, "unavailable");
});
