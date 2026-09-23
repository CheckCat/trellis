# Практика кода (`practice.type: code`) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Третий тип практики `code`: ученик пишет функцию на TypeScript/JavaScript в браузере, backend исполняет её дочерним процессом `node` на объявленных курсом входах и засчитывает урок по `cases[].expected` или по `solution` автора.

**Architecture:** Плагин `services/backend/src/plugins/practice/code/` (плоская папка, как `sql/`): `compare.ts` (перенос значений в JSON с маркерами + структурное равенство) → `harness.ts` (текст ESM-модуля, который запускается в дочернем процессе) → `run-node.ts` (`CodeRunner`: temp-папка, `spawn`, таймаут, чтение `result.json`) → `run-code.ts` (оркестрация: solution → ученик → вердикты) → `route.ts` (HTTP). Тип регистрируется в `capabilities.ts`; валидатор, `lessonCompletionMode`, чужие поля выводятся из реестра. Фронт: третья ветка `PracticeView` с CodeMirror в JS/TS-режиме.

**Tech Stack:** Fastify 5, Node 22 (`--experimental-strip-types`, `child_process.spawn`), `node:test`, React 19 + `@uiw/react-codemirror` + `@codemirror/lang-javascript` (единственная новая зависимость), vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-23-code-practice-design.md`

## Global Constraints

- Node на машине разработки — 22.16, в образе `node:22-alpine` — 22.23; раннер обязан работать на обоих: флаг `--experimental-strip-types` передаётся всегда.
- Новых зависимостей backend — ноль. Единственная новая зависимость проекта — `@codemirror/lang-javascript` (frontend).
- Лимиты (точные значения из спеки): `CODE_TIMEOUT_SECONDS = 10`, `CODE_MEMORY_MB = 256`, `MAX_PRACTICE_CODE_LENGTH = 50_000`, `MAX_CODE_CASES = 50`, `MAX_CODE_OUTPUT_CHARS = 16_384` (console на один case), `MAX_CODE_PROCESS_OUTPUT_CHARS = 65_536` (stdout+stderr процесса).
- `expected`, `solution` и значение эталона не покидают backend ни в одном ответе.
- Node-нативный ESM: относительные импорты backend — с `.js`, импорт папки — через явный `/index.js`.
- Backend-тесты гоняются по `dist-test/`; перед финальной проверкой каждой стадии — `rm -rf dist dist-test` в `services/backend` (устаревшие артефакты задваивают тесты, см. память проекта).
- `rtk` фильтрует вывод инструментов — для сырого вывода `npm`/`tsc`/`grep` использовать `rtk proxy <cmd>`.
- Git: `git status` перед `git add`, стагировать файлы по имени, никогда `-A`/`.`.
- CI = local: финальная проверка — последовательность `.mvp/ci-mirror.sh` (`npm ci`, `lint`, `build`, `capabilities:check`, `test`).
- Все тексты, которые видит ученик, — по-русски; сообщения ошибок backend (`message` в 4xx/5xx) — по-английски, как во всём backend.

## Review Focus

Входы, о которых спека молчит, но которые встретятся первому же ученику; тест на каждый добавлен в задачу-владельца:

1. **Функция возвращает Promise, который никогда не разрешится** (`return new Promise(() => {})`) — ожидается вердикт `timeout`, а не зависший запрос. → Task 2, тест «never-settling promise».
2. **Код ученика вызывает `process.exit()`** посреди прогона — `result.json` неполный; ожидается `crashed` с честным сообщением, а не `ran` с пустыми case'ами. → Task 2, тест «process.exit».
3. **Код пишет мегабайт в `process.stdout` напрямую** (минуя перехват `console`) — pipe не должен переполниться и подвесить процесс; ожидается обычный `ran`. → Task 2, тест «raw stdout flood».
4. **`expected: null` в манифесте** — это значение `null`, а не «эталона нет»; функция, вернувшая `null`, проходит, вернувшая `undefined` — нет. → Task 4 (валидатор), Task 1 (сравнение).
5. **`solution` автора зависает по таймауту** — это сломанный курс (422 `solution_failed`), а не «сервис недоступен» (503) и не «неверный ответ». → Task 3.

---

### Task 1: `compare.ts` — перенос значений и структурное равенство

**Files:**
- Create: `services/backend/src/plugins/practice/code/compare.ts`
- Test: `services/backend/src/plugins/practice/code/compare.test.ts`

**Interfaces:**
- Produces:
  - `type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue }`
  - `encodeValue(value: unknown): EncodedValue` — бросает `TypeError` на циклической структуре.
  - `valuesEqual(a: EncodedValue, b: EncodedValue): boolean`.
- Правила кодирования (те же продублированы в harness, Task 2, и закреплены тестом там): `undefined → {"$undefined":true}`, `NaN → {"$nan":true}`, `±Infinity → {"$inf":1|-1}`, `bigint → {"$bigint":"<decimal>"}`, `Date → {"$date":"<iso>"|null}`, `Map → {"$map":[[k,v],…]}`, `Set → {"$set":[…]}`, функция → `{"$function":"<name>"}`, symbol → `{"$symbol":"<description>"}`; массивы — поэлементно; прочие объекты — по собственным перечислимым строковым ключам.

- [ ] **Step 1: Write the failing test**

```ts
// services/backend/src/plugins/practice/code/compare.test.ts
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
  assert.deepEqual(encodeValue(function sum() {}), { $function: "sum" });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/backend && rtk proxy npm test -- --test-name-pattern="encodeValue|valuesEqual" 2>&1 | tail -20`
Expected: `pretest` (`tsc -p tsconfig.test.json`) падает с `Cannot find module './compare.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/backend/src/plugins/practice/code/compare.ts
// How a learner's return value crosses the process boundary, and how two
// such values are compared.
//
// The harness (harness.ts) runs in a child process and can only hand back
// JSON. JSON has no undefined, no NaN, no Infinity, no bigint, no Date —
// and a `sum` that returns undefined must not grade the same as one that
// returns null. So every value is ENCODED into JSON with markers for what
// JSON cannot say, on both sides: the harness encodes what the function
// returned, this module encodes the manifest's `expected`, and the two
// encodings are compared structurally.
//
// The encoding rules live twice on purpose — here and in HARNESS_SOURCE —
// because the harness is a standalone script written into a temp dir and
// cannot import this module. run-node.test.ts pins the two together by
// running real code through the harness and comparing with encodeValue.

export type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };

export function encodeValue(value: unknown): EncodedValue {
  return encode(value, new Set());
}

function encode(value: unknown, seen: Set<object>): EncodedValue {
  switch (typeof value) {
    case "undefined":
      return { $undefined: true };
    case "boolean":
    case "string":
      return value;
    case "number":
      if (Number.isNaN(value)) return { $nan: true };
      if (value === Number.POSITIVE_INFINITY) return { $inf: 1 };
      if (value === Number.NEGATIVE_INFINITY) return { $inf: -1 };
      return value;
    case "bigint":
      return { $bigint: value.toString() };
    case "function":
      return { $function: value.name };
    case "symbol":
      return { $symbol: value.description ?? "" };
    case "object":
      break;
    default:
      return { $unserializable: typeof value };
  }
  if (value === null) return null;
  if (seen.has(value)) {
    throw new TypeError("The value contains a circular reference and cannot be serialized.");
  }
  seen.add(value);
  try {
    if (value instanceof Date) {
      return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
    }
    if (value instanceof Map) {
      return { $map: [...value.entries()].map(([k, v]) => [encode(k, seen), encode(v, seen)]) };
    }
    if (value instanceof Set) {
      return { $set: [...value].map((item) => encode(item, seen)) };
    }
    if (Array.isArray(value)) {
      return value.map((item) => encode(item, seen));
    }
    const out: { [key: string]: EncodedValue } = {};
    for (const key of Object.keys(value)) {
      out[key] = encode((value as Record<string, unknown>)[key], seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** Structural equality over encoded values: object key ORDER is
 * irrelevant, array order is not, and nothing is coerced. */
export function valuesEqual(a: EncodedValue, b: EncodedValue): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => valuesEqual(item, b[index] as EncodedValue));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && valuesEqual(a[key] as EncodedValue, b[key] as EncodedValue));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/backend && rtk proxy npm test -- --test-name-pattern="encodeValue|valuesEqual" 2>&1 | tail -20`
Expected: 7 pass, 0 fail. Затем `rtk proxy npm run lint` — без ошибок (`Object.hasOwn` доступен: target ES2022+ в `tsconfig.base.json`; если tsc ругается — заменить на `Object.prototype.hasOwnProperty.call(b, key)`).

- [ ] **Step 5: Commit**

```bash
git add services/backend/src/plugins/practice/code/compare.ts services/backend/src/plugins/practice/code/compare.test.ts
git commit -m "feat(practice/code): перенос значений через JSON с маркерами и структурное равенство"
```

### Task 2: `limits.ts`, `harness.ts`, `run-node.ts` — дочерний процесс `node`

**Files:**
- Create: `services/backend/src/plugins/practice/code/limits.ts`
- Create: `services/backend/src/plugins/practice/code/harness.ts`
- Create: `services/backend/src/plugins/practice/code/run-node.ts`
- Modify: `services/backend/src/capabilities/capabilities.ts` (только `CODE_LANGUAGES`/`CodeLanguage` рядом с `ANSWER_FIELD_KINDS`; `PRACTICE_TYPES` НЕ трогать — это Task 4)
- Test: `services/backend/src/plugins/practice/code/run-node.test.ts`

**Interfaces:**
- Consumes: `EncodedValue` из Task 1.
- Produces:
  - `limits.ts`: `CODE_TIMEOUT_SECONDS = 10`, `CODE_MEMORY_MB = 256`, `MAX_CODE_OUTPUT_CHARS = 16_384`, `MAX_CODE_PROCESS_OUTPUT_CHARS = 65_536`, `MAX_CODE_CASES = 50`.
  - `capabilities.ts`: `CODE_LANGUAGES = ["typescript", "javascript"] as const`, `type CodeLanguage`.
  - `harness.ts`: `HARNESS_SOURCE: string`.
  - `run-node.ts`:
    ```ts
    interface CodeRunRequest { language: CodeLanguage; code: string; entry: string; cases: readonly (readonly unknown[])[] }
    interface CodeErrorInfo { message: string; stack?: string }
    interface CodeCaseOutcome { value?: EncodedValue; error?: CodeErrorInfo; output: string; truncated: boolean }
    type CodeRunResult = { durationMs: number } & (
      | { kind: "ran"; cases: readonly CodeCaseOutcome[] }
      | { kind: "load_failed"; error: CodeErrorInfo }
      | { kind: "entry_missing"; exported: readonly string[] }
      | { kind: "timeout"; cases: readonly CodeCaseOutcome[] }   // partial snapshot
      | { kind: "crashed"; exitCode: number | null; signal: string | null; stderr: string }
      | { kind: "unavailable"; message: string })
    interface CodeRunner { run(request: CodeRunRequest): Promise<CodeRunResult> }
    interface CreateNodeRunnerOptions { timeoutMs?: number; memoryMb?: number; execPath?: string; tmpRoot?: string }
    function createNodeRunner(options?: CreateNodeRunnerOptions): CodeRunner
    ```

- [ ] **Step 1: Add `CODE_LANGUAGES` to the registry**

В `services/backend/src/capabilities/capabilities.ts` сразу после блока `ANSWER_FIELD_KINDS`:

```ts
/** Languages a `code` practice may declare in `practice.language`. One
 * runtime (Node) runs both; the list exists so a course names what the
 * learner writes and the editor knows which mode to open. */
export const CODE_LANGUAGES = ["typescript", "javascript"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
```

- [ ] **Step 2: Write `limits.ts`**

```ts
// services/backend/src/plugins/practice/code/limits.ts
// The numbers the code runner is bounded by. A file of constants and
// nothing else, so capabilities.ts can import it (it reports them to
// course authors) without importing the runner.

/** Wall-clock budget for one whole run — the solution's or the
 * learner's — after which the child process is killed. */
export const CODE_TIMEOUT_SECONDS = 10;
/** `--max-old-space-size` of the child process, megabytes. */
export const CODE_MEMORY_MB = 256;
/** Characters of `console.*` output kept per case; the rest is dropped
 * and the case flagged `truncated`. */
export const MAX_CODE_OUTPUT_CHARS = 16_384;
/** Characters of the child's raw stdout+stderr kept for crash reports. */
export const MAX_CODE_PROCESS_OUTPUT_CHARS = 65_536;
/** Cases one assignment may declare (manifest.schema.json's maxItems). */
export const MAX_CODE_CASES = 50;
```

- [ ] **Step 3: Write `harness.ts`**

```ts
// services/backend/src/plugins/practice/code/harness.ts
// The script that runs INSIDE the child process. Kept as a string because
// it is written into a temp directory next to the learner's module and
// executed there — it cannot import anything of this package, which is
// also why its `encode` duplicates compare.ts (run-node.test.ts keeps the
// two in agreement).
//
// Protocol (argv): <modulePath> <entry> <casesPath> <resultPath> <maxOutput>.
// It never prints its result to stdout — the learner's own console.log
// lives there — but writes result.json, atomically, after EVERY case, so
// that a run killed by the timeout still leaves the cases that finished.

export const HARNESS_SOURCE = String.raw`
import fs from "node:fs";
import { format } from "node:util";
import { pathToFileURL } from "node:url";

const [modulePath, entry, casesPath, resultPath, maxOutputArg] = process.argv.slice(2);
const maxOutput = Number(maxOutputArg);
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

function writeResult(result) {
  const tmp = resultPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(result));
  fs.renameSync(tmp, resultPath);
}

function describeError(err) {
  if (err instanceof Error) {
    return typeof err.stack === "string" ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  return { message: String(err) };
}

function encode(value, seen = new Set()) {
  switch (typeof value) {
    case "undefined": return { $undefined: true };
    case "boolean":
    case "string": return value;
    case "number":
      if (Number.isNaN(value)) return { $nan: true };
      if (value === Number.POSITIVE_INFINITY) return { $inf: 1 };
      if (value === Number.NEGATIVE_INFINITY) return { $inf: -1 };
      return value;
    case "bigint": return { $bigint: value.toString() };
    case "function": return { $function: value.name };
    case "symbol": return { $symbol: value.description ?? "" };
    case "object": break;
    default: return { $unserializable: typeof value };
  }
  if (value === null) return null;
  if (seen.has(value)) throw new TypeError("The value contains a circular reference and cannot be serialized.");
  seen.add(value);
  try {
    if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
    if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [encode(k, seen), encode(v, seen)]) };
    if (value instanceof Set) return { $set: [...value].map((item) => encode(item, seen)) };
    if (Array.isArray(value)) return value.map((item) => encode(item, seen));
    const out = {};
    for (const key of Object.keys(value)) out[key] = encode(value[key], seen);
    return out;
  } finally {
    seen.delete(value);
  }
}

let mod;
try {
  mod = await import(pathToFileURL(modulePath).href);
} catch (err) {
  writeResult({ kind: "load_failed", error: describeError(err) });
  process.exit(0);
}
const fn = mod[entry];
if (typeof fn !== "function") {
  writeResult({ kind: "entry_missing", exported: Object.keys(mod) });
  process.exit(0);
}

const METHODS = ["log", "info", "warn", "error", "debug"];
const original = Object.fromEntries(METHODS.map((m) => [m, console[m]]));
const done = [];
writeResult({ kind: "ran", cases: done, complete: false });

for (const args of cases) {
  let output = "";
  let truncated = false;
  const capture = (...parts) => {
    if (truncated) return;
    const line = format(...parts) + "\n";
    if (output.length + line.length > maxOutput) {
      output += line.slice(0, Math.max(0, maxOutput - output.length));
      truncated = true;
      return;
    }
    output += line;
  };
  for (const m of METHODS) console[m] = capture;
  let outcome;
  try {
    const value = await fn(...args);
    try {
      outcome = { value: encode(value), output, truncated };
    } catch (err) {
      outcome = { error: { message: "The returned value cannot be serialized: " + err.message }, output, truncated };
    }
  } catch (err) {
    outcome = { error: describeError(err), output, truncated };
  } finally {
    for (const m of METHODS) console[m] = original[m];
  }
  done.push(outcome);
  writeResult({ kind: "ran", cases: done, complete: false });
}
writeResult({ kind: "ran", cases: done, complete: true });
`;
```

- [ ] **Step 4: Write the failing tests**

```ts
// services/backend/src/plugins/practice/code/run-node.test.ts
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
  const result = await runner.run({ language: "typescript", code: TS_SUM, entry: "sum", cases: [[2, 3], [-1, 1]] });
  const cases = ran(result);
  assert.deepEqual(cases.map((c) => c.value), [5, 0]);
  assert.deepEqual(cases.map((c) => c.output), ["", ""]);
  assert.equal(typeof result.durationMs, "number");
});

void test("runs a JavaScript module", async () => {
  const result = await createNodeRunner().run({ language: "javascript", code: JS_SUM, entry: "sum", cases: [[1, 1]] });
  assert.deepEqual(ran(result).map((c) => c.value), [2]);
});

void test("awaits an async function", async () => {
  const code = "export async function later(x: number) { await new Promise((r) => setTimeout(r, 10)); return x * 2; }";
  const result = await createNodeRunner().run({ language: "typescript", code, entry: "later", cases: [[21]] });
  assert.deepEqual(ran(result).map((c) => c.value), [42]);
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
  const result = await createNodeRunner().run({ language: "javascript", code, entry: "f", cases: which.map((w) => [w]) });
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
  assert.deepEqual(ran(result).map((c) => c.value), expected);
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
  const result = await createNodeRunner().run({ language: "javascript", code: "export function (", entry: "f", cases: [[]] });
  assert.equal(result.kind, "load_failed");
  assert.match(result.kind === "load_failed" ? result.error.message : "", /Unexpected token|SyntaxError/);
});

void test("non-erasable TypeScript (enum) is load_failed, not a crash", async () => {
  const code = "enum E { A }\nexport function f() { return E.A; }";
  const result = await createNodeRunner().run({ language: "typescript", code, entry: "f", cases: [[]] });
  assert.equal(result.kind, "load_failed");
});

void test("a missing export is entry_missing and lists what WAS exported", async () => {
  const result = await createNodeRunner().run({ language: "javascript", code: "export const Sum = 1; export function add() {}", entry: "sum", cases: [[]] });
  assert.deepEqual(result, { ...result, kind: "entry_missing", exported: ["Sum", "add"] });
});

void test("an endless loop is timeout, and the cases that finished are kept", async () => {
  const code = "export function f(n) { if (n) return n; while (true) {} }";
  const result = await createNodeRunner({ timeoutMs: 1500 }).run({ language: "javascript", code, entry: "f", cases: [[1], [0], [2]] });
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
  assert.deepEqual(ran(result).map((c) => c.value), [1]);
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
  assert.deepEqual(ran(result).map((c) => c.value), [{ $undefined: true }]);
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
  const result = await createNodeRunner({ execPath: "/nonexistent/node" }).run({ language: "javascript", code: JS_SUM, entry: "sum", cases: [[1, 2]] });
  assert.equal(result.kind, "unavailable");
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd services/backend && rtk proxy npm test -- --test-name-pattern="run-node|runs a|timeout|crashed|entry_missing|load_failed" 2>&1 | tail -5`
Expected: `pretest` падает — `Cannot find module './run-node.js'`.

- [ ] **Step 6: Write `run-node.ts`**

```ts
// services/backend/src/plugins/practice/code/run-node.ts
// Runs a learner's (or the author's) module in a child `node` process and
// reports what happened — nothing here knows about courses, lessons,
// grading or HTTP.
//
// Isolation is process-level, not a security boundary (project decision,
// docs/product/analysis-grey-zones.md): a fresh process per run, an
// empty environment, a temp working directory, a wall-clock timeout that
// ends in SIGKILL, a heap cap, and a cap on how much output is kept. The
// code can still see the container's filesystem and network — the same
// as `node file.ts` in the learner's own terminal, which is the threat
// model this product has.
//
// TypeScript is handled by node itself (`--experimental-strip-types`): on
// 22.16 the flag is required, on >= 22.18 it is the default and harmless.
// Only erasable syntax is supported — node rejects `enum`/`namespace` at
// import time, which surfaces as `load_failed` with node's own message.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CodeLanguage } from "../../../capabilities/index.js";
import type { EncodedValue } from "./compare.js";
import { HARNESS_SOURCE } from "./harness.js";
import { CODE_MEMORY_MB, CODE_TIMEOUT_SECONDS, MAX_CODE_OUTPUT_CHARS, MAX_CODE_PROCESS_OUTPUT_CHARS } from "./limits.js";

export interface CodeRunRequest {
  readonly language: CodeLanguage;
  readonly code: string;
  readonly entry: string;
  /** One array of arguments per case, in order. */
  readonly cases: readonly (readonly unknown[])[];
}

export interface CodeErrorInfo {
  readonly message: string;
  readonly stack?: string;
}

/** What one case produced. Exactly one of `value`/`error` is present. */
export interface CodeCaseOutcome {
  readonly value?: EncodedValue;
  readonly error?: CodeErrorInfo;
  /** Captured `console.*` output of this case. */
  readonly output: string;
  readonly truncated: boolean;
}

export type CodeRunResult = { readonly durationMs: number } & (
  | { readonly kind: "ran"; readonly cases: readonly CodeCaseOutcome[] }
  | { readonly kind: "load_failed"; readonly error: CodeErrorInfo }
  | { readonly kind: "entry_missing"; readonly exported: readonly string[] }
  /** Killed by the timeout; `cases` holds the ones that finished first. */
  | { readonly kind: "timeout"; readonly cases: readonly CodeCaseOutcome[] }
  /** The process ended without a complete result (OOM abort, process.exit). */
  | { readonly kind: "crashed"; readonly exitCode: number | null; readonly signal: string | null; readonly stderr: string }
  /** `node` itself could not be started. */
  | { readonly kind: "unavailable"; readonly message: string }
);

export interface CodeRunner {
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}

export interface CreateNodeRunnerOptions {
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly execPath?: string;
  readonly tmpRoot?: string;
}

/** What the harness writes to result.json — see harness.ts. */
type HarnessResult =
  | { kind: "load_failed"; error: CodeErrorInfo }
  | { kind: "entry_missing"; exported: string[] }
  | { kind: "ran"; cases: CodeCaseOutcome[]; complete: boolean };

interface ProcessOutcome {
  readonly status: "exited" | "timeout" | "spawn_failed";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly message: string;
}

export function createNodeRunner(options: CreateNodeRunnerOptions = {}): CodeRunner {
  const timeoutMs = options.timeoutMs ?? CODE_TIMEOUT_SECONDS * 1000;
  const memoryMb = options.memoryMb ?? CODE_MEMORY_MB;
  const execPath = options.execPath ?? process.execPath;
  const tmpRoot = options.tmpRoot ?? os.tmpdir();

  return {
    async run(request) {
      const started = Date.now();
      const dir = await fs.promises.mkdtemp(path.join(tmpRoot, "trellis-code-"));
      try {
        // `.mts`/`.mjs`, not `.ts`/`.js`: the extension alone fixes the
        // module format, so node never has to guess ESM from the text.
        const modulePath = path.join(dir, request.language === "typescript" ? "attempt.mts" : "attempt.mjs");
        const harnessPath = path.join(dir, "harness.mjs");
        const casesPath = path.join(dir, "cases.json");
        const resultPath = path.join(dir, "result.json");
        await Promise.all([
          fs.promises.writeFile(modulePath, request.code, "utf8"),
          fs.promises.writeFile(harnessPath, HARNESS_SOURCE, "utf8"),
          fs.promises.writeFile(casesPath, JSON.stringify(request.cases), "utf8"),
        ]);

        const outcome = await runProcess(
          execPath,
          [
            "--experimental-strip-types",
            "--no-warnings=ExperimentalWarning",
            `--max-old-space-size=${memoryMb}`,
            "--disallow-code-generation-from-strings",
            harnessPath,
            modulePath,
            request.entry,
            casesPath,
            resultPath,
            String(MAX_CODE_OUTPUT_CHARS),
          ],
          dir,
          timeoutMs,
        );
        const durationMs = Date.now() - started;

        if (outcome.status === "spawn_failed") {
          return { kind: "unavailable", message: outcome.message, durationMs };
        }
        const snapshot = readSnapshot(resultPath);
        if (outcome.status === "timeout") {
          return { kind: "timeout", cases: snapshot?.kind === "ran" ? snapshot.cases : [], durationMs };
        }
        if (snapshot === undefined || (snapshot.kind === "ran" && !snapshot.complete)) {
          return { kind: "crashed", exitCode: outcome.exitCode, signal: outcome.signal, stderr: outcome.stderr, durationMs };
        }
        switch (snapshot.kind) {
          case "load_failed":
            return { kind: "load_failed", error: snapshot.error, durationMs };
          case "entry_missing":
            return { kind: "entry_missing", exported: snapshot.exported, durationMs };
          case "ran":
            return { kind: "ran", cases: snapshot.cases, durationMs };
        }
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function readSnapshot(resultPath: string): HarnessResult | undefined {
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8")) as HarnessResult;
  } catch {
    return undefined;
  }
}

function runProcess(execPath: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stderr = "";
    let stdoutSeen = 0;
    const settle = (outcome: ProcessOutcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };

    const child = spawn(execPath, args, { cwd, env: {}, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    // stdout is drained and dropped: the learner's console output reaches
    // us through result.json, and an undrained pipe would stall the child
    // once it filled (Review Focus 3).
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSeen += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CODE_PROCESS_OUTPUT_CHARS) {
        stderr += chunk.toString("utf8").slice(0, MAX_CODE_PROCESS_OUTPUT_CHARS - stderr.length);
      }
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      settle({ status: "spawn_failed", exitCode: null, signal: null, stderr, message: err.message });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      void stdoutSeen;
      settle({ status: timedOut ? "timeout" : "exited", exitCode, signal, stderr, message: "" });
    });
  });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd services/backend && rm -rf dist dist-test && rtk proxy npm test 2>&1 | tail -15`
Expected: все run-node тесты pass (два таймаут-теста занимают ~1.5 с каждый); общий счётчик тестов вырос ровно на 16 + 7 (Task 1). `rtk proxy npm run lint` — чисто; если eslint ругается на `void stdoutSeen` — удалить переменную и просто вешать пустой обработчик `child.stdout.on("data", () => {})` с комментарием.

- [ ] **Step 8: Commit**

```bash
git add services/backend/src/capabilities/capabilities.ts services/backend/src/plugins/practice/code/limits.ts services/backend/src/plugins/practice/code/harness.ts services/backend/src/plugins/practice/code/run-node.ts services/backend/src/plugins/practice/code/run-node.test.ts
git commit -m "feat(practice/code): раннер — дочерний процесс node с harness, таймаутом и лимитами"
```

### Task 3: `errors.ts`, `run-code.ts` — оркестрация попытки (solution → ученик → вердикты)

**Files:**
- Create: `services/backend/src/plugins/practice/code/errors.ts`
- Create: `services/backend/src/plugins/practice/code/run-code.ts`
- Modify: `services/backend/src/courses/types.ts` (добавить интерфейсы `CourseCodeCase`, `CourseCodePractice`; союз `CoursePractice` НЕ расширять — это Task 4, иначе сборка сломается раньше, чем появится маршрут)
- Modify: `services/backend/src/plugins/practice/test-support.ts` (скриптованный раннер)
- Test: `services/backend/src/plugins/practice/code/run-code.test.ts`

**Interfaces:**
- Consumes: `CodeRunner`, `CodeRunRequest`, `CodeRunResult`, `CodeCaseOutcome`, `CodeErrorInfo` (Task 2); `encodeValue`, `valuesEqual`, `EncodedValue` (Task 1); `CODE_TIMEOUT_SECONDS` (Task 2).
- Produces:
  - `courses/types.ts`:
    ```ts
    interface CourseCodeCase { args: readonly unknown[]; reference: { kind: "expected"; value: unknown } | { kind: "solution" } }
    interface CourseCodePractice { type: "code"; language: CodeLanguage; prompt: string; entry: string; starter?: string; cases: readonly CourseCodeCase[]; solution?: string }
    ```
  - `errors.ts`: `class CodeSolutionError extends Error { kind: "solution_failed" }`, `isCodeSolutionError(err): err is CodeSolutionError`, `class CodeRunnerUnavailableError extends Error { kind: "unavailable" }`, `isCodeRunnerUnavailableError`.
  - `run-code.ts`:
    ```ts
    type CodeRunOutcome = Exclude<CodeRunResult, { kind: "unavailable" }>
    interface CodeCaseVerdict { args: readonly unknown[]; passed: boolean; value?: EncodedValue; error?: CodeErrorInfo; output: string; truncated: boolean }
    interface CodePracticeAttemptResult { run: CodeRunOutcome; cases: readonly CodeCaseVerdict[]; allPassed: boolean }
    runCodePracticeAttempt(runner: CodeRunner, practice: CourseCodePractice, code: string): Promise<CodePracticeAttemptResult>
    ```
  - `test-support.ts`: `createScriptedCodeRunner(respond: (request: CodeRunRequest, index: number) => CodeRunResult): { runner: CodeRunner; requests: CodeRunRequest[] }`, `ranWith(values: readonly EncodedValue[]): CodeRunResult`.

- [ ] **Step 1: Add the domain interfaces**

В `services/backend/src/courses/types.ts` после `CourseAnswerPractice` (союз `CoursePractice` пока не трогать):

```ts
/** One call of a `code` assignment's function: what it is called with,
 * and where the value it must return comes from. */
export interface CourseCodeCase {
  readonly args: readonly unknown[];
  /**
   * Normalized by validate.ts from "does the manifest have an `expected`
   * KEY" (an `in` check — YAML cannot express undefined, and `expected:
   * null` is a legitimate value). An explicit discriminator rather than an
   * optional field so nothing downstream has to guess whether a missing
   * `expected` means "graded by the solution".
   */
  readonly reference: { readonly kind: "expected"; readonly value: unknown } | { readonly kind: "solution" };
}

/**
 * A practice assignment done as CODE: the learner writes a module that
 * exports `entry`, the engine calls it with each case's `args` in a child
 * process and compares what comes back with the reference — the case's
 * own `expected`, or what the author's `solution` returns for the same
 * arguments. `solution`, like the sql kind's, never leaves the backend.
 */
export interface CourseCodePractice {
  readonly type: "code";
  readonly language: CodeLanguage;
  readonly prompt: string;
  readonly entry: string;
  /** Initial editor contents — public, it is shown to the learner. */
  readonly starter?: string;
  /** At least one (validate.ts). Order is display order. */
  readonly cases: readonly CourseCodeCase[];
  readonly solution?: string;
}
```

И расширить импорт типов в том же файле: `import type { AnswerFieldKind, CodeLanguage, SandboxType } from "../capabilities/index.js";` плюс добавить `CodeLanguage` в строку `export type { … } from "../capabilities/index.js";`.

- [ ] **Step 2: Write `errors.ts`**

```ts
// services/backend/src/plugins/practice/code/errors.ts
// The two ways a code attempt fails that are NOT the learner's doing.

/** The author's solution could not produce a reference: it did not load,
 * threw, timed out or crashed. Broken course content — a 422, the same
 * class as a seed the database rejects. The solution's text is never part
 * of the message. */
export class CodeSolutionError extends Error {
  readonly kind = "solution_failed" as const;
  constructor(message: string) {
    super(message);
    this.name = "CodeSolutionError";
  }
}

export function isCodeSolutionError(err: unknown): err is CodeSolutionError {
  return err instanceof CodeSolutionError;
}

/** `node` itself could not be started — this build cannot run code
 * practice at all. A 503, like an unreachable sandbox. */
export class CodeRunnerUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "CodeRunnerUnavailableError";
  }
}

export function isCodeRunnerUnavailableError(err: unknown): err is CodeRunnerUnavailableError {
  return err instanceof CodeRunnerUnavailableError;
}
```

- [ ] **Step 3: Add the scripted runner to test-support**

В конец `services/backend/src/plugins/practice/test-support.ts`:

```ts
// --- The `code` practice type (plugins/practice/code/) ---------------------

import type { EncodedValue } from "./code/compare.js";
import type { CodeRunner, CodeRunRequest, CodeRunResult } from "./code/run-node.js";

/** A runner that answers by script instead of spawning node: the route and
 * the orchestration are defined by what they SEND to a runner and what they
 * make of the answer, and a real child process would make every outcome
 * (timeout, crash, unavailable) slow or impossible to produce on demand. */
export function createScriptedCodeRunner(
  respond: (request: CodeRunRequest, index: number) => CodeRunResult,
): { runner: CodeRunner; requests: CodeRunRequest[] } {
  const requests: CodeRunRequest[] = [];
  return {
    requests,
    runner: {
      async run(request) {
        requests.push(request);
        return respond(request, requests.length - 1);
      },
    },
  };
}

/** A clean `ran` result returning `values` case by case. */
export function ranWith(values: readonly EncodedValue[]): CodeRunResult {
  return { kind: "ran", durationMs: 1, cases: values.map((value) => ({ value, output: "", truncated: false })) };
}
```

(Импорты — перенести в блок импортов в начале файла, чтобы eslint `import/first` не ругался.)

- [ ] **Step 4: Write the failing tests**

```ts
// services/backend/src/plugins/practice/code/run-code.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import type { CourseCodePractice } from "../../../courses/types.js";
import { createScriptedCodeRunner, ranWith } from "../test-support.js";
import { isCodeRunnerUnavailableError, isCodeSolutionError } from "./errors.js";
import { runCodePracticeAttempt } from "./run-code.js";

const SOLUTION = "export function sum(a, b) { return a + b; }";

function practice(overrides: Partial<CourseCodePractice> = {}): CourseCodePractice {
  return {
    type: "code",
    language: "javascript",
    prompt: "Add.",
    entry: "sum",
    cases: [
      { args: [2, 3], reference: { kind: "expected", value: 5 } },
      { args: [-1, 1], reference: { kind: "expected", value: 0 } },
    ],
    ...overrides,
  };
}

void test("grades every case against its own expected and runs the learner's code once", async () => {
  const { runner, requests } = createScriptedCodeRunner(() => ranWith([5, 1]));
  const attempt = await runCodePracticeAttempt(runner, practice(), "learner code");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.code, "learner code");
  assert.equal(requests[0]?.entry, "sum");
  assert.deepEqual(requests[0]?.cases, [[2, 3], [-1, 1]]);
  assert.equal(attempt.run.kind, "ran");
  assert.deepEqual(attempt.cases.map((c) => c.passed), [true, false]);
  assert.deepEqual(attempt.cases.map((c) => c.value), [5, 1]);
  assert.deepEqual(attempt.cases.map((c) => c.args), [[2, 3], [-1, 1]]);
  assert.equal(attempt.allPassed, false);
});

void test("an expected of null is a value, not an absence (Review Focus 4)", async () => {
  const p = practice({ cases: [{ args: [], reference: { kind: "expected", value: null } }] });
  const nullRun = await runCodePracticeAttempt(createScriptedCodeRunner(() => ranWith([null])).runner, p, "x");
  const undefRun = await runCodePracticeAttempt(createScriptedCodeRunner(() => ranWith([{ $undefined: true }])).runner, p, "x");
  assert.equal(nullRun.allPassed, true);
  assert.equal(undefRun.allPassed, false);
});

void test("runs the solution first and takes the reference of a solution-graded case from it", async () => {
  const { runner, requests } = createScriptedCodeRunner((request) => (request.code === SOLUTION ? ranWith([5, 99]) : ranWith([5, 15])));
  const p = practice({
    solution: SOLUTION,
    cases: [
      { args: [2, 3], reference: { kind: "solution" } },
      // Both present: the explicit `expected` wins over what the solution returned.
      { args: [10, 5], reference: { kind: "expected", value: 15 } },
    ],
  });
  const attempt = await runCodePracticeAttempt(runner, p, "learner code");

  assert.deepEqual(requests.map((r) => r.code), [SOLUTION, "learner code"]);
  assert.deepEqual(requests[0]?.cases, [[2, 3], [10, 5]]);
  assert.deepEqual(attempt.cases.map((c) => c.passed), [true, true]);
  assert.equal(attempt.allPassed, true);
});

for (const [label, result] of [
  ["does not load", { kind: "load_failed", durationMs: 1, error: { message: "SyntaxError: boom" } }],
  ["exports no such function", { kind: "entry_missing", durationMs: 1, exported: ["Sum"] }],
  ["times out (Review Focus 5)", { kind: "timeout", durationMs: 1, cases: [] }],
  ["crashes", { kind: "crashed", durationMs: 1, exitCode: 134, signal: null, stderr: "heap out of memory" }],
  ["throws on a case", { kind: "ran", durationMs: 1, cases: [{ error: { message: "nope" }, output: "", truncated: false }] }],
] as const) {
  void test(`a solution that ${label} is CodeSolutionError, and the learner's code never runs`, async () => {
    const { runner, requests } = createScriptedCodeRunner(() => result);
    const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
    await assert.rejects(runCodePracticeAttempt(runner, p, "learner"), (err) => isCodeSolutionError(err));
    assert.equal(requests.length, 1);
  });
}

void test("a solution error message never contains the solution's text", async () => {
  const { runner } = createScriptedCodeRunner(() => ({ kind: "load_failed", durationMs: 1, error: { message: "bad" } }));
  const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(runner, p, "learner"), (err: Error) => !err.message.includes(SOLUTION));
});

void test("a runner that is unavailable is CodeRunnerUnavailableError for the solution AND for the learner", async () => {
  const unavailable = createScriptedCodeRunner(() => ({ kind: "unavailable", durationMs: 1, message: "spawn ENOENT" })).runner;
  await assert.rejects(runCodePracticeAttempt(unavailable, practice(), "x"), (err) => isCodeRunnerUnavailableError(err));
  const p = practice({ solution: SOLUTION, cases: [{ args: [1], reference: { kind: "solution" } }] });
  await assert.rejects(runCodePracticeAttempt(unavailable, p, "x"), (err) => isCodeRunnerUnavailableError(err));
});

void test("a timeout keeps the finished cases' verdicts and fails the rest", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "timeout",
    durationMs: 1,
    cases: [{ value: 5, output: "", truncated: false }],
  }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.equal(attempt.run.kind, "timeout");
  assert.deepEqual(attempt.cases.map((c) => c.passed), [true, false]);
  assert.equal(attempt.cases[1]?.value, undefined);
  assert.equal(attempt.allPassed, false);
});

void test("a learner's module that does not load fails every case without a value", async () => {
  const { runner } = createScriptedCodeRunner(() => ({ kind: "load_failed", durationMs: 1, error: { message: "SyntaxError" } }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.equal(attempt.run.kind, "load_failed");
  assert.deepEqual(attempt.cases.map((c) => c.passed), [false, false]);
  assert.equal(attempt.allPassed, false);
});

void test("a case that threw is failed and carries the learner's error", async () => {
  const { runner } = createScriptedCodeRunner(() => ({
    kind: "ran",
    durationMs: 1,
    cases: [{ value: 5, output: "hi\n", truncated: false }, { error: { message: "negative" }, output: "", truncated: false }],
  }));
  const attempt = await runCodePracticeAttempt(runner, practice(), "x");
  assert.deepEqual(attempt.cases.map((c) => c.passed), [true, false]);
  assert.equal(attempt.cases[0]?.output, "hi\n");
  assert.equal(attempt.cases[1]?.error?.message, "negative");
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd services/backend && rtk proxy npm test 2>&1 | tail -5`
Expected: `pretest` падает — `Cannot find module './run-code.js'` (и `./errors.js`, если Step 2 ещё не сделан).

- [ ] **Step 6: Write `run-code.ts`**

```ts
// services/backend/src/plugins/practice/code/run-code.ts
// One attempt at a `code` assignment, independent of HTTP: get the
// reference for every case, run the learner's code, grade case by case.
//
// The reference comes first — the author's solution runs before the
// learner's module. Technically unnecessary here (separate processes),
// but it is the one rule the engine has for every mechanic ("эталон
// снимается до ученика"), and a rule with exceptions is two rules.

import type { CourseCodePractice } from "../../../courses/types.js";
import { encodeValue, valuesEqual, type EncodedValue } from "./compare.js";
import { CodeRunnerUnavailableError, CodeSolutionError } from "./errors.js";
import { CODE_TIMEOUT_SECONDS } from "./limits.js";
import type { CodeCaseOutcome, CodeErrorInfo, CodeRunner, CodeRunResult } from "./run-node.js";

/** A run whose "node could not start" outcome has already been turned
 * into `CodeRunnerUnavailableError` — the route never sees that kind. */
export type CodeRunOutcome = Exclude<CodeRunResult, { kind: "unavailable" }>;

export interface CodeCaseVerdict {
  readonly args: readonly unknown[];
  readonly passed: boolean;
  /** The LEARNER's own return value — never the reference. */
  readonly value?: EncodedValue;
  readonly error?: CodeErrorInfo;
  readonly output: string;
  readonly truncated: boolean;
}

export interface CodePracticeAttemptResult {
  readonly run: CodeRunOutcome;
  /** One verdict per declared case, in manifest order. */
  readonly cases: readonly CodeCaseVerdict[];
  readonly allPassed: boolean;
}

export async function runCodePracticeAttempt(
  runner: CodeRunner,
  practice: CourseCodePractice,
  code: string,
): Promise<CodePracticeAttemptResult> {
  const cases = practice.cases.map((c) => c.args);
  const references = await resolveReferences(runner, practice, cases);

  const run = await runner.run({ language: practice.language, code, entry: practice.entry, cases });
  if (run.kind === "unavailable") {
    throw new CodeRunnerUnavailableError(`Code practice cannot run: ${run.message}.`);
  }

  const outcomes: readonly CodeCaseOutcome[] = run.kind === "ran" || run.kind === "timeout" ? run.cases : [];
  const verdicts = practice.cases.map((declared, index): CodeCaseVerdict => {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      // Never reached (timeout, crash, or the run never started).
      return { args: declared.args, passed: false, output: "", truncated: false };
    }
    if (outcome.error !== undefined) {
      return { args: declared.args, passed: false, error: outcome.error, output: outcome.output, truncated: outcome.truncated };
    }
    return {
      args: declared.args,
      passed: valuesEqual(outcome.value ?? null, references[index] ?? null) && outcome.value !== undefined,
      value: outcome.value,
      output: outcome.output,
      truncated: outcome.truncated,
    };
  });

  return { run, cases: verdicts, allPassed: run.kind === "ran" && verdicts.every((v) => v.passed) };
}

/**
 * The encoded reference of every case: the case's own `expected` when it
 * has one, otherwise what the solution returned for the same arguments.
 * The solution runs whenever it is declared — a broken solution is broken
 * course content even on a case that happens to carry its own `expected`.
 */
async function resolveReferences(
  runner: CodeRunner,
  practice: CourseCodePractice,
  cases: readonly (readonly unknown[])[],
): Promise<readonly EncodedValue[]> {
  let solutionOutcomes: readonly CodeCaseOutcome[] | undefined;
  if (practice.solution !== undefined) {
    const run = await runner.run({ language: practice.language, code: practice.solution, entry: practice.entry, cases });
    if (run.kind === "unavailable") {
      throw new CodeRunnerUnavailableError(`Code practice cannot run: ${run.message}.`);
    }
    if (run.kind !== "ran") {
      throw new CodeSolutionError(`The solution of this assignment could not be run: ${describeFailure(run)}.`);
    }
    run.cases.forEach((outcome, index) => {
      if (outcome.error !== undefined) {
        throw new CodeSolutionError(`The solution of this assignment threw on case ${index + 1}: ${outcome.error.message}.`);
      }
    });
    solutionOutcomes = run.cases;
  }

  return practice.cases.map((declared, index) => {
    if (declared.reference.kind === "expected") {
      return encodeValue(declared.reference.value);
    }
    const value = solutionOutcomes?.[index]?.value;
    if (value === undefined) {
      // validate.ts guarantees a `solution` exists for such a case; a
      // solution that returned fewer outcomes than cases would be a
      // harness bug, reported as broken content rather than swallowed.
      throw new CodeSolutionError(`The solution of this assignment produced no value for case ${index + 1}.`);
    }
    return value;
  });
}

/** Why a run did not reach `ran`, in one clause — node's own words where
 * it has any. Shared by the solution error above and the route's
 * `failure.message` for the learner. */
export function describeFailure(run: Exclude<CodeRunOutcome, { kind: "ran" }>): string {
  switch (run.kind) {
    case "load_failed":
      return run.error.stack ?? run.error.message;
    case "entry_missing":
      return `no function is exported under the expected name (exported: ${run.exported.join(", ") || "nothing"})`;
    case "timeout":
      return `the run exceeded ${CODE_TIMEOUT_SECONDS} seconds and was stopped`;
    case "crashed":
      return `the process exited unexpectedly (${run.signal ?? `code ${run.exitCode}`})${run.stderr.trim() === "" ? "" : `: ${run.stderr.trim()}`}`;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd services/backend && rm -rf dist dist-test && rtk proxy npm test 2>&1 | tail -15 && rtk proxy npm run lint`
Expected: 13 новых тестов pass, lint чист. Проверь, что `tsc -p tsconfig.json` (`rtk proxy npm run build`) тоже зелёный: `run-code.ts` импортирует `CourseCodePractice` из `courses/types.ts`, ещё не входящий в союз, — это допустимо.

- [ ] **Step 8: Commit**

```bash
git add services/backend/src/courses/types.ts services/backend/src/plugins/practice/test-support.ts services/backend/src/plugins/practice/code/errors.ts services/backend/src/plugins/practice/code/run-code.ts services/backend/src/plugins/practice/code/run-code.test.ts
git commit -m "feat(practice/code): оркестрация попытки — эталон из expected или solution, вердикт по case'ам"
```

### Task 4: Регистрация типа `code` — реестр, схема, валидатор, публичная форма, линт, маршрут

Один коммит по необходимости: `PRACTICE_STRATEGIES` — тотальная карта по `PRACTICE_TYPES`, а `toPublicPractice`/линт — исчерпывающие `switch`/ветвления по союзу `CoursePractice`. Добавить `"code"` в реестр без маршрута, или маршрут без союза, сборка не позволит. Порядок внутри задачи: сначала тесты валидатора (падают структурно — схема не знает `code`), затем правки в порядке ниже, пока `tsc` не станет зелёным, затем тесты.

**Files:**
- Modify: `services/backend/src/capabilities/capabilities.ts`
- Modify: `services/backend/src/capabilities/capabilities.test.ts`
- Modify: `services/backend/src/courses/manifest.schema.json`
- Modify: `services/backend/src/courses/types.ts` (союз)
- Modify: `services/backend/src/courses/validate/validate.ts`
- Modify: `services/backend/src/routes/courses/courses.ts` (`toPublicPractice`, `publicPracticeSchema`)
- Modify: `services/backend/src/lint/skills/skills.ts`, `services/backend/src/lint/skills/skills.schema.json`, `services/backend/src/lint/course/course.ts`, `services/backend/src/lint/features/features.ts`
- Create: `services/backend/src/plugins/practice/code/route.ts`, `services/backend/src/plugins/practice/code/index.ts`
- Modify: `services/backend/src/plugins/practice/registry.ts`
- Modify (generated): `docs/contracts/capabilities.json`
- Test: `services/backend/src/courses/validate/validate.test.ts`

**Interfaces:**
- Consumes: Task 1–3 целиком.
- Produces:
  - `capabilities.ts`: `PRACTICE_TYPES = ["sql", "answer", "code"]`, `MAX_PRACTICE_CODE_LENGTH = 50_000`, `ManifestFieldCapability.valueType` расширен значениями `"any" | "any[]"`, `CODE_PRACTICE` в `practiceTypes`, лимиты `maxPracticeCodeLength`, `codeTimeoutSeconds`, `codeMemoryMb`, `maxCodeCases`, `maxCodeOutputChars`.
  - `route.ts`: `createCodePracticeStrategy(options: { runner: CodeRunner }): PracticeStrategy`, `codePracticeStrategy: PracticeStrategy` (с `createNodeRunner()`), маршрут `POST /courses/:courseId/lessons/:lessonId/practice/code`, тело `{ code: string }`, ответ 200 по спеке (`ok`, `failure?`, `durationMs`, `cases[]`, `passed`, `lesson`, `course`), 422 `{ error: "solution_failed", message }`, 503 `{ error: "unavailable", message }`.
  - `index.ts`: `export { codePracticeStrategy } from "./route.js";` — единственный экспорт.
  - Публичная форма урока: `{ type: "code", prompt, language, entry, starter? }`.
  - `VERIFY_KINDS` + `"code"`; `VERIFY_MECHANICS.code = { practiceType: "code", mechanic: "cases" }`.

- [ ] **Step 1: Write the failing validator tests**

Добавить в конец `services/backend/src/courses/validate/validate.test.ts` (в файле уже есть `withPackageDir`, `validCourseFixtureFiles`, `writeFixtureFiles`, `parseYaml`; `CourseCodePractice` добавить в импорт типов из `../types.js`):

```ts
// --- practice.type: code -------------------------------------------------

/** A manifest whose only lesson carries a code assignment built from
 * `practiceLines` (already indented under `practice:`). */
function codeManifest(practiceLines: readonly string[]): unknown {
  return parseYaml(
    [
      "id: fixture-course",
      "version: 1.0.0",
      "title: Fixture",
      "modules:",
      "  - id: m",
      "    title: M",
      "    lessons:",
      "      - id: first-lesson",
      "        title: L",
      "        content: lessons/first-lesson.md",
      "        practice:",
      ...practiceLines.map((line) => `          ${line}`),
      "",
    ].join("\n"),
  );
}

const CODE_PRACTICE_LINES = [
  "type: code",
  "language: typescript",
  "prompt: Add two numbers.",
  "entry: sum",
  "cases:",
  "  - args: [2, 3]",
  "    expected: 5",
  "  - args: [-1, 1]",
  "    expected: 0",
];

function codePracticeOf(result: ValidationResult): CourseCodePractice {
  assert.equal(result.ok, true, JSON.stringify(result));
  const practice = result.ok ? result.manifest.modules[0]?.lessons[0]?.practice : undefined;
  assert.equal(practice?.type, "code");
  return practice as CourseCodePractice;
}

void test("validateManifest accepts a code practice with explicit expectations and normalizes each case's reference", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const practice = codePracticeOf(validateManifest(codeManifest(CODE_PRACTICE_LINES), dir));
    assert.equal(practice.language, "typescript");
    assert.equal(practice.entry, "sum");
    assert.equal(practice.starter, undefined);
    assert.equal(practice.solution, undefined);
    assert.deepEqual(practice.cases, [
      { args: [2, 3], reference: { kind: "expected", value: 5 } },
      { args: [-1, 1], reference: { kind: "expected", value: 0 } },
    ]);
  });
});

void test("a case without expected is graded by the solution when one is declared", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const practice = codePracticeOf(
      validateManifest(
        codeManifest([
          "type: code",
          "language: javascript",
          "prompt: Add.",
          "entry: sum",
          "starter: 'export function sum(a, b) {}'",
          "cases:",
          "  - args: [2, 3]",
          "solution: 'export function sum(a, b) { return a + b; }'",
        ]),
        dir,
      ),
    );
    assert.deepEqual(practice.cases, [{ args: [2, 3], reference: { kind: "solution" } }]);
    assert.equal(practice.starter, "export function sum(a, b) {}");
    assert.equal(practice.solution, "export function sum(a, b) { return a + b; }");
  });
});

void test("expected: null is a reference value, not a missing reference (Review Focus 4)", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const practice = codePracticeOf(
      validateManifest(codeManifest(["type: code", "language: javascript", "prompt: P.", "entry: f", "cases:", "  - args: []", "    expected: null"]), dir),
    );
    assert.deepEqual(practice.cases[0]?.reference, { kind: "expected", value: null });
  });
});

void test("a case without expected in a practice without solution is rejected, naming the case", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(
      codeManifest(["type: code", "language: javascript", "prompt: P.", "entry: f", "cases:", "  - args: [1]", "    expected: 1", "  - args: [2]"]),
      dir,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.errors.map((e) => e.path),
      ["modules[0].lessons[0].practice.cases[1].expected"],
    );
  });
});

void test("language, entry and cases are required for type: code, each error named separately", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(codeManifest(["type: code", "prompt: P."]), dir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.errors.map((e) => e.path).sort(),
      ["modules[0].lessons[0].practice.cases", "modules[0].lessons[0].practice.entry", "modules[0].lessons[0].practice.language"],
    );
  });
});

void test("entry must be an identifier and may not be `default`", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    for (const entry of ["1abc", "my-fn", "default"]) {
      const result = validateManifest(
        codeManifest(["type: code", "language: javascript", "prompt: P.", `entry: "${entry}"`, "cases:", "  - args: []", "    expected: 1"]),
        dir,
      );
      assert.equal(result.ok, false, entry);
      if (result.ok) return;
      assert.ok(result.errors.some((e) => e.path.endsWith(".practice.entry")), `${entry}: ${JSON.stringify(result.errors)}`);
    }
  });
});

void test("sql fields on a code practice are foreign and rejected by name", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const result = validateManifest(codeManifest([...CODE_PRACTICE_LINES, "sandbox: main", "check: select true"]), dir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const paths = result.errors.map((e) => e.path);
    assert.ok(paths.includes("modules[0].lessons[0].practice.sandbox"), JSON.stringify(result.errors));
    assert.ok(paths.includes("modules[0].lessons[0].practice.check"));
    // `solution` is shared by sql and code — declaring it on a code
    // practice must NOT be flagged as foreign.
    assert.ok(!paths.some((p) => p.endsWith(".solution")));
  });
});

void test("args that is not an array, and an unknown language, are structural errors", () => {
  withPackageDir((dir) => {
    writeFixtureFiles(dir, validCourseFixtureFiles());
    const badArgs = validateManifest(codeManifest(["type: code", "language: javascript", "prompt: P.", "entry: f", "cases:", "  - args: 5", "    expected: 1"]), dir);
    assert.equal(badArgs.ok, false);
    const badLanguage = validateManifest(codeManifest(["type: code", "language: python", "prompt: P.", "entry: f", "cases:", "  - args: []", "    expected: 1"]), dir);
    assert.equal(badLanguage.ok, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/backend && rtk proxy npm test -- --test-name-pattern="code practice|type: code|Review Focus 4|entry must|foreign and rejected|structural errors|graded by the solution" 2>&1 | tail -20`
Expected: сборка тестов проходит (типы уже есть), тесты падают: схема отклоняет `type: code` (`enum`) и неизвестные свойства.

- [ ] **Step 3: Register the type in `capabilities.ts`**

Правки в `services/backend/src/capabilities/capabilities.ts`:

1. Импорты лимитов (в блок импортов вверху):
```ts
import { CODE_MEMORY_MB, CODE_TIMEOUT_SECONDS, MAX_CODE_CASES, MAX_CODE_OUTPUT_CHARS } from "../plugins/practice/code/limits.js";
```
2. `PRACTICE_TYPES`:
```ts
export const PRACTICE_TYPES = ["sql", "answer", "code"] as const;
```
3. После `MAX_ANSWER_VALUE_LENGTH`:
```ts
/** Largest `code` submission the practice endpoint accepts, in characters
 * (plugins/practice/code/route.ts's body schema). */
export const MAX_PRACTICE_CODE_LENGTH = 50_000;
```
4. `ManifestFieldCapability.valueType`:
```ts
  readonly valueType: "string" | "number" | "boolean" | "object[]" | "any" | "any[]";
```
5. Перед `const POSTGRES_SANDBOX`:
```ts
const CODE_PRACTICE: PracticeTypeCapability = {
  type: "code",
  summary:
    "Задание выполняется как код: ученик пишет модуль на TypeScript или JavaScript, экспортирующий функцию, " +
    "движок вызывает её в отдельном процессе Node на объявленных входах и сравнивает возвращённые значения " +
    "с эталоном. Вывод в консоль показывается, но не проверяется.",
  requiresSandbox: false,
  submitPath: "practice/code",
  endpoint: submitEndpoint("practice/code"),
  manifestFields: [
    {
      name: "type",
      valueType: "string",
      required: true,
      values: [...PRACTICE_TYPES],
      summary: 'Должен быть "code" — для этого типа поле обязательно (умолчание — "sql").',
    },
    {
      name: "language",
      valueType: "string",
      required: true,
      values: [...CODE_LANGUAGES],
      summary:
        "Язык модуля ученика. Оба исполняются Node: TypeScript — со стиранием типов (только «стираемый» синтаксис: " +
        "без enum, namespace и parameter properties; типы не проверяются, только убираются).",
    },
    { name: "prompt", valueType: "string", required: true, summary: "Формулировка задания для ученика." },
    {
      name: "entry",
      valueType: "string",
      required: true,
      summary: "Имя именованного ESM-экспорта, который движок вызывает (`export function sum`). Идентификатор, не `default`.",
    },
    {
      name: "starter",
      valueType: "string",
      required: false,
      summary: "Начальное содержимое редактора — сигнатура с пустым телом. Уходит клиенту как есть.",
    },
    {
      name: "cases",
      valueType: "object[]",
      required: true,
      summary: `Вызовы функции, по которым ставится зачёт. От 1 до ${MAX_CODE_CASES}; проверяются все.`,
      fields: [
        { name: "args", valueType: "any[]", required: true, summary: "Аргументы вызова по порядку (любые JSON-значения)." },
        {
          name: "expected",
          valueType: "any",
          required: false,
          summary:
            "Ожидаемое возвращаемое значение (любое JSON-значение, null — тоже значение). Если поля нет, эталон " +
            "берётся из solution; без solution поле обязательно. Клиенту не отдаётся никогда.",
        },
      ],
    },
    {
      name: "solution",
      valueType: "string",
      required: false,
      summary:
        "Эталонное решение автора на том же language с тем же entry. Движок вызывает его на тех же args и берёт " +
        "результат как эталон для каждого case без своего expected. Обязано быть детерминированным. Клиенту не " +
        "отдаётся никогда.",
    },
  ],
  mechanics: [
    {
      name: "cases",
      manifestFields: ["cases", "solution"],
      summary:
        "Для каждого case движок вызывает функцию ученика с args, ждёт результат (Promise допустим) и сравнивает " +
        "его с эталоном структурно: порядок ключей объектов не важен, порядок элементов массива важен, числа — " +
        "точно, undefined и null различаются, NaN равен NaN. Исключение или таймаут — case не пройден.",
      feedback:
        "На каждый case: аргументы, СОБСТВЕННЫЙ результат ученика (или его исключение), вывод console и boolean. " +
        "Эталон и текст solution наружу не уходят; причина провала — только «не совпало».",
    },
  ],
  completion: "Урок засчитывается, когда пройдены ВСЕ case. Задание без cases невалидно, поэтому самоотметки у этого типа нет.",
};
```
6. `practiceTypes: [SQL_PRACTICE, ANSWER_PRACTICE, CODE_PRACTICE],` и в `limits` после `maxAnswerValueLength`:
```ts
    /** Максимальная длина кода попытки, символов. */
    maxPracticeCodeLength: MAX_PRACTICE_CODE_LENGTH,
    /** Таймаут одного прогона кода (solution или ученика), секунды. */
    codeTimeoutSeconds: CODE_TIMEOUT_SECONDS,
    /** Лимит кучи процесса с кодом, мегабайты. */
    codeMemoryMb: CODE_MEMORY_MB,
    /** Максимум case в одном задании. */
    maxCodeCases: MAX_CODE_CASES,
    /** Символов вывода console на один case. */
    maxCodeOutputChars: MAX_CODE_OUTPUT_CHARS,
```
7. Обновить комментарий-шапку файла: строка «`SANDBOX_TYPES` / `PRACTICE_TYPES` / `ANSWER_FIELD_KINDS`» → добавить `CODE_LANGUAGES`.

В `capabilities.test.ts` рядом с тестом про `fields[].kind` добавить:
```ts
void test("manifest.schema.json's practice.language enum is exactly the registered code languages", () => {
  assert.deepEqual(schemaEnum("$defs", "practice", "properties", "language", "enum"), [...CODE_LANGUAGES]);
});
```
(и `CODE_LANGUAGES` в импорт из `./capabilities.js`).

- [ ] **Step 4: Extend `manifest.schema.json`**

В `$defs.practice`:
- `properties.type.enum` → `["sql", "answer", "code"]`, description дополнить: «`code` runs the learner's exported function in a child node process and compares each `cases[].args` call's return value with `cases[].expected` or with what `solution` returns.»
- В `properties` добавить:
```json
        "language": {
          "type": "string",
          "enum": ["typescript", "javascript"],
          "description": "type: code only. What the learner writes. Both run on node; TypeScript is type-STRIPPED (erasable syntax only, no type checking)."
        },
        "entry": {
          "type": "string",
          "pattern": "^[A-Za-z_$][A-Za-z0-9_$]*$",
          "description": "type: code only. Name of the named ESM export the engine calls. `default` is rejected in validate.ts."
        },
        "starter": {
          "type": "string",
          "description": "type: code only. Initial editor contents shown to the learner."
        },
        "cases": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "description": "type: code only. The calls the function is graded on — every one must pass.",
          "items": { "$ref": "#/$defs/codeCase" }
        },
```
- `properties.solution.description` начать с «type: sql or code.» и добавить в конец: «For `code`: the author's module on the same `language` with the same `entry`; its return value for a case's `args` is the reference of every case without its own `expected`.»
- Новый `$defs.codeCase`:
```json
    "codeCase": {
      "type": "object",
      "additionalProperties": false,
      "required": ["args"],
      "properties": {
        "args": {
          "type": "array",
          "description": "Arguments the function is called with, in order. Any JSON values."
        },
        "expected": {
          "description": "The value the function must return for these args — any JSON value, `null` included (`expected: null` means \"must return null\"). Absent means \"graded by `solution`\"; validate.ts rejects an absent `expected` when the assignment has no `solution`. Never sent to the client."
        }
      }
    },
```
`maxItems: 50` — то же число, что `MAX_CODE_CASES`; добавить в `capabilities.test.ts` проверку по образцу существующих (рядом с enum-тестами):
```ts
void test("manifest.schema.json's cases maxItems is the registered case limit", () => {
  const cases = (manifestSchema as { $defs: { practice: { properties: { cases: { maxItems?: number } } } } }).$defs.practice.properties.cases;
  assert.equal(cases.maxItems, MAX_CODE_CASES);
});
```
(`MAX_CODE_CASES` импортировать из `../plugins/practice/code/limits.js`.)

- [ ] **Step 5: Extend the domain union and the validator**

`services/backend/src/courses/types.ts`:
```ts
export type CoursePractice = CourseSqlPractice | CourseAnswerPractice | CourseCodePractice;
```
(и дополнить комментарий над союзом: «`cases` is meaningless for the other two»).

`services/backend/src/courses/validate/validate.ts`:

1. Импорт `CODE_LANGUAGES` (для текста ошибки) и типов `CodeLanguage`, `CourseCodeCase`, `CourseCodePractice`.
2. `RawPractice` дополнить:
```ts
  readonly language?: CodeLanguage;
  readonly entry?: string;
  readonly starter?: string;
  readonly cases?: readonly RawCodeCase[];
```
и рядом:
```ts
interface RawCodeCase {
  readonly args: readonly unknown[];
  /** Read with an `in` check, never `!== undefined`: `expected: null` is a value. */
  readonly expected?: unknown;
}
```
3. В `validatePractice` сразу после `rejectForeignFields(...)`:
```ts
  if (type === "code") {
    return validateCodePractice(practice, practicePath, errors);
  }
```
4. Новая функция (после `validateAnswerFields`):
```ts
/**
 * `type: code`. The schema already pinned the shapes (language enum,
 * entry pattern, cases min/max, args is an array); what is left is what a
 * schema cannot say: which fields this type REQUIRES (the schema's
 * `required` is shared by all types, so it lists only `prompt`), that
 * `default` is not an entry name, and that every case has SOME reference
 * — its own `expected`, or the assignment's `solution`.
 *
 * Always returns a practice, even after pushing errors (same contract as
 * validateAnswerFields: the model is about to be discarded, but the other
 * lessons still get checked).
 */
function validateCodePractice(practice: RawPractice, practicePath: string, errors: ValidationError[]): CourseCodePractice {
  if (practice.language === undefined) {
    errors.push({
      path: `${practicePath}.language`,
      message: `A practice of type "code" must declare "language" — one of: ${CODE_LANGUAGES.join(", ")}.`,
    });
  }
  if (practice.entry === undefined) {
    errors.push({
      path: `${practicePath}.entry`,
      message: `A practice of type "code" must declare "entry" — the name of the function the learner's module exports.`,
    });
  } else if (practice.entry === "default") {
    errors.push({
      path: `${practicePath}.entry`,
      message: `"entry" must be a NAMED export; "default" is not one. Name the function ("export function sum") and write that name.`,
    });
  }
  if (practice.cases === undefined) {
    errors.push({
      path: `${practicePath}.cases`,
      message: `A practice of type "code" must declare "cases" — at least one set of arguments the function is called with.`,
    });
  }

  const cases: CourseCodeCase[] = (practice.cases ?? []).map((rawCase, index) => {
    // YAML has no undefined, so "the key is there" is the whole test —
    // `expected: null` is a reference value, not a missing one.
    const hasExpected = Object.hasOwn(rawCase, "expected");
    if (!hasExpected && practice.solution === undefined) {
      errors.push({
        path: `${practicePath}.cases[${index}].expected`,
        message:
          `Case ${index + 1} has no "expected" and the assignment declares no "solution" — the engine would have ` +
          `nothing to compare the learner's result with. Write the value, or add a "solution".`,
      });
    }
    return {
      args: rawCase.args,
      reference: hasExpected ? { kind: "expected", value: rawCase.expected } : { kind: "solution" },
    };
  });

  return {
    type: "code",
    // Placeholders for the missing-field cases above: an error was already
    // recorded and this model is on its way to being discarded.
    language: practice.language ?? "typescript",
    prompt: practice.prompt,
    entry: practice.entry ?? "",
    ...(practice.starter === undefined ? {} : { starter: practice.starter }),
    cases,
    ...(practice.solution === undefined ? {} : { solution: practice.solution }),
  };
}
```

- [ ] **Step 6: Public shape, lint, and the strategy — until `tsc` is green**

Run `cd services/backend && rtk proxy npm run build 2>&1 | head -40` и закрыть каждую ошибку:

`services/backend/src/routes/courses/courses.ts` — `toPublicPractice`, новая ветка перед `default`:
```ts
    case "code":
      return {
        type: practice.type,
        prompt: practice.prompt,
        language: practice.language,
        entry: practice.entry,
        // `cases` and `solution` stay behind on purpose: the reference
        // values are the answer, and even the inputs are not needed to
        // show the assignment — the run response carries them per case.
        ...(practice.starter === undefined ? {} : { starter: practice.starter }),
      };
```
`publicPracticeSchema.properties` дополнить (импорт `CODE_LANGUAGES` из `../../capabilities/index.js`):
```ts
    language: { type: "string", enum: [...CODE_LANGUAGES] },
    entry: { type: "string" },
    starter: { type: "string" },
```

`services/backend/src/lint/skills/skills.ts`:
```ts
export const VERIFY_KINDS = ["quiz", "sql-state", "sql-result", "answer", "code", "self"] as const;
```
`services/backend/src/lint/skills/skills.schema.json` — `verify.enum` → `["quiz", "sql-state", "sql-result", "answer", "code", "self"]`, в description добавить «code -> practice.type: code;».

`services/backend/src/lint/course/course.ts`:
- `VERIFY_MECHANICS`: добавить `code: { practiceType: "code", mechanic: "cases" },` перед `self`.
- `describeActualVerification`: заменить `if (practice.type === "answer") { kinds.push("answer"); } else {` на
```ts
    if (practice.type === "answer") {
      kinds.push("answer");
    } else if (practice.type === "code") {
      kinds.push("code");
    } else {
```

`services/backend/src/lint/features/features.ts` — в `sqlAnalyzer.extract` заменить `if (practice.type === "answer")` на `if (practice.type !== "sql")` (комментарий: analyzer is per language; a practice of any other kind has no SQL to read).

Проверить `rtk proxy grep -n '"answer"' services/backend/src -r --include=*.ts | grep -v test | grep -v plugins/practice/answer` — каждое место, где код ветвится по `=== "answer"` с else-веткой, предполагающей `sql`, должно уже быть в списке выше; если tsc молчит, а место есть — исправить на явную проверку `=== "sql"`.

`services/backend/src/plugins/practice/code/route.ts`:
```ts
// The `code` practice mechanic: run the learner's exported function in a
// child node process on every case the course declares, compare what it
// returns with the reference, and complete the lesson when every case
// passes.
//
// One request does the whole loop (run solution if any, run the learner,
// grade, record) — same reasoning as the sql strategy: a client must not
// be able to grade without running, or show a result a later verdict
// contradicts.
//
// The three failure classes, in the same statuses the sql strategy uses:
//   - the learner's own doing — module does not load, wrong export, throws,
//     times out, returns the wrong thing: 200 with `ok`/`passed` false and
//     node's own words;
//   - broken course content — the SOLUTION does any of the above: 422
//     `solution_failed`, never a wrong-answer verdict;
//   - this build cannot run code — node did not start: 503 `unavailable`.

import type { FastifyInstance } from "fastify";

import { MAX_PRACTICE_CODE_LENGTH } from "../../../capabilities/index.js";
import type { CourseCodePractice } from "../../../courses/types.js";
import { lessonCompletionMode } from "../../../progress/model/index.js";
import {
  buildTree,
  courseProgressSummarySchema,
  errorResponseSchema,
  lessonParamsSchema,
  lessonProgressSchema,
  toLessonCompletionPayload,
} from "../../../routes/progress/index.js";
import { resolvePractice, type PracticeStrategy } from "../api.js";
import { isCodeRunnerUnavailableError, isCodeSolutionError } from "./errors.js";
import { describeFailure, runCodePracticeAttempt, type CodePracticeAttemptResult } from "./run-code.js";
import { createNodeRunner, type CodeRunner } from "./run-node.js";

export interface CreateCodePracticeStrategyOptions {
  readonly runner: CodeRunner;
}

/** The strategy over an injectable runner — tests script the runner
 * instead of spawning node. The shipped one is `codePracticeStrategy`. */
export function createCodePracticeStrategy(options: CreateCodePracticeStrategyOptions): PracticeStrategy {
  const { runner } = options;
  return {
    type: "code",
    register(fastify: FastifyInstance) {
      fastify.post<{ Params: { courseId: string; lessonId: string }; Body: { code: string } }>(
        "/courses/:courseId/lessons/:lessonId/practice/code",
        {
          schema: {
            params: lessonParamsSchema,
            body: practiceCodeBodySchema,
            response: {
              200: practiceCodeResponseSchema,
              400: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
              422: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const resolved = resolvePractice(request, reply, "code");
          if (resolved === undefined) {
            return reply;
          }
          const { course, location } = resolved;
          const practice = resolved.practice as CourseCodePractice;

          let attempt: CodePracticeAttemptResult;
          try {
            attempt = await runCodePracticeAttempt(runner, practice, request.body.code);
          } catch (err) {
            if (isCodeSolutionError(err)) {
              request.log.warn({ err }, "code practice solution is broken");
              return reply.code(422).send({ error: err.kind, message: err.message });
            }
            if (isCodeRunnerUnavailableError(err)) {
              request.log.error({ err }, "code runner unavailable");
              return reply.code(503).send({ error: err.kind, message: err.message });
            }
            throw err;
          }

          // A lesson carrying both a quiz and a graded practice is gated by
          // its quiz (progress/model.ts): the verdict is still reported,
          // completing stays the quiz's job.
          if (attempt.allPassed && lessonCompletionMode(location.lesson) === "practice") {
            await fastify.progress.markLessonCompleted({
              courseId: course.id,
              lessonId: location.lesson.id,
              courseVersion: course.version,
            });
          }

          const payload = toLessonCompletionPayload(await buildTree(fastify, course), location.lesson.id);
          const { run } = attempt;
          return {
            ok: run.kind === "ran",
            ...(run.kind === "ran" ? {} : { failure: { kind: run.kind, message: describeFailure(run) } }),
            durationMs: run.durationMs,
            cases: attempt.cases.map((verdict) => ({
              args: verdict.args,
              passed: verdict.passed,
              ...(verdict.value === undefined ? {} : { value: verdict.value }),
              ...(verdict.error === undefined ? {} : { error: { message: verdict.error.message } }),
              output: verdict.output,
              truncated: verdict.truncated,
            })),
            passed: attempt.allPassed,
            ...payload,
          };
        },
      );
    },
  };
}

export const codePracticeStrategy: PracticeStrategy = createCodePracticeStrategy({ runner: createNodeRunner() });

// --- JSON Schemas --------------------------------------------------------

const practiceCodeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    // Same rules as the sql body: no whitespace-only submissions, finite.
    code: { type: "string", pattern: "\\S", minLength: 1, maxLength: MAX_PRACTICE_CODE_LENGTH },
  },
} as const;

const practiceCodeCaseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["args", "passed", "output", "truncated"],
  properties: {
    // Inputs are public; `value` is the learner's OWN return value in the
    // encoded form compare.ts describes. An untyped schema (`{}`) makes
    // fast-json-stringify pass the value through JSON.stringify as-is.
    args: { type: "array" },
    passed: { type: "boolean" },
    value: {},
    error: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string" } } },
    output: { type: "string" },
    truncated: { type: "boolean" },
  },
} as const;

const practiceCodeFailureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "message"],
  properties: {
    kind: { type: "string", enum: ["load_failed", "entry_missing", "timeout", "crashed"] },
    message: { type: "string" },
  },
} as const;

const practiceCodeResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "durationMs", "cases", "passed", "lesson", "course"],
  properties: {
    /** The module loaded and every case was called. */
    ok: { type: "boolean" },
    /** Present iff `ok` is false. */
    failure: practiceCodeFailureSchema,
    durationMs: { type: "integer" },
    cases: { type: "array", items: practiceCodeCaseSchema },
    passed: { type: "boolean" },
    lesson: lessonProgressSchema,
    course: courseProgressSummarySchema,
  },
} as const;
```

`services/backend/src/plugins/practice/code/index.ts`:
```ts
export { codePracticeStrategy } from "./route.js";
```

`services/backend/src/plugins/practice/registry.ts`:
```ts
import { codePracticeStrategy } from "./code/index.js";
…
export const PRACTICE_STRATEGIES: Readonly<Record<CoursePracticeType, PracticeStrategy>> = {
  sql: sqlPracticeStrategy,
  answer: answerPracticeStrategy,
  code: codePracticeStrategy,
};
```

Повторять `rtk proxy npm run build` до зелёного.

- [ ] **Step 7: Regenerate the contract and run everything**

```bash
cd services/backend && rm -rf dist dist-test
rtk proxy npm run capabilities:write
rtk proxy npm run capabilities:check
rtk proxy npm run lint && rtk proxy npm run build && rtk proxy npm test 2>&1 | tail -15
```
Expected: `docs/contracts/capabilities.json` изменился (третий `practiceTypes[]`, новые `limits`, `manifestContractVersion` остался 1 — изменение аддитивное); все тесты pass, включая `capabilities.test.ts` (сверка enum'ов и полей схемы), `skills.verify.test.ts`, `course.rules.test.ts`, `extensibility.test.ts` и восемь новых validate-тестов. `courses/pilot-sql` линтуется без изменений: `cd ../.. && rtk proxy npm run course:lint -- courses/pilot-sql`.

- [ ] **Step 8: Commit**

```bash
git status
git add services/backend/src/capabilities/capabilities.ts services/backend/src/capabilities/capabilities.test.ts services/backend/src/courses/manifest.schema.json services/backend/src/courses/types.ts services/backend/src/courses/validate/validate.ts services/backend/src/courses/validate/validate.test.ts services/backend/src/routes/courses/courses.ts services/backend/src/lint/skills/skills.ts services/backend/src/lint/skills/skills.schema.json services/backend/src/lint/course/course.ts services/backend/src/lint/features/features.ts services/backend/src/plugins/practice/code/route.ts services/backend/src/plugins/practice/code/index.ts services/backend/src/plugins/practice/registry.ts docs/contracts/capabilities.json
git commit -m "feat(practice/code): тип code зарегистрирован — реестр, схема, валидатор, публичная форма, линт, маршрут"
```

### Task 5: HTTP-тесты маршрута `practice/code`

**Files:**
- Modify: `services/backend/src/plugins/practice/test-support.ts` (опция `practiceStrategies` у `withPracticeApp`, фикстурный манифест `code`)
- Test: `services/backend/src/plugins/practice/code/code.test.ts`

**Interfaces:**
- Consumes: `createCodePracticeStrategy` (Task 4), `createScriptedCodeRunner`, `ranWith` (Task 3), `withPracticeApp` и `WithPracticeAppOptions` (существующие).
- Produces в `test-support.ts`: `WithPracticeAppOptions.practiceStrategies?: readonly PracticeStrategy[]` (пробрасывается в `buildServer`); `CODE_LESSON_ID = "code-lesson"`, `CODE_SOLUTION_LESSON_ID = "code-solution-lesson"`, `FIXTURE_CODE_SOLUTION = "export function sum(a, b) { return a + b; }"`, `FIXTURE_CODE_STARTER = "export function sum(a: number, b: number): number {\n  return 0;\n}"`, `codeManifestYaml(courseId = "progress-fixture"): string`.

- [ ] **Step 1: Extend test-support**

В `WithPracticeAppOptions` добавить:
```ts
  /** Overrides the strategy registry — how a test hands the `code`
   * strategy a scripted runner instead of a real node process. */
  readonly practiceStrategies?: readonly PracticeStrategy[];
```
В `withPracticeApp` в вызов `buildServer({...})` добавить `...(options.practiceStrategies === undefined ? {} : { practiceStrategies: options.practiceStrategies }),` (импорт типа `PracticeStrategy` из `./api.js`).

В конец файла (рядом со скриптованным раннером из Task 3):
```ts
export const CODE_LESSON_ID = "code-lesson";
export const CODE_SOLUTION_LESSON_ID = "code-solution-lesson";
/** The solution the fixture declares — text that must never appear in any response. */
export const FIXTURE_CODE_SOLUTION = "export function sum(a, b) { return a + b; }";
/** Public: the starter IS meant to reach the learner. */
export const FIXTURE_CODE_STARTER = "export function sum(a: number, b: number): number {\n  return 0;\n}";

/** Two code lessons: one graded by explicit expectations, one by the
 * author's solution (with one case carrying both). No sandboxes at all —
 * a code course needs none. */
export function codeManifestYaml(courseId = "progress-fixture"): string {
  return [
    `id: ${courseId}`,
    "version: 1.0.0",
    "title: Progress fixture course",
    "modules:",
    "  - id: only-module",
    "    title: Only module",
    "    lessons:",
    `      - id: ${CODE_LESSON_ID}`,
    "        title: Code lesson with explicit expectations",
    "        practice:",
    "          type: code",
    "          language: typescript",
    "          prompt: Add two numbers.",
    "          entry: sum",
    `          starter: ${JSON.stringify(FIXTURE_CODE_STARTER)}`,
    "          cases:",
    "            - args: [2, 3]",
    "              expected: 5",
    "            - args: [-1, 1]",
    "              expected: 0",
    `      - id: ${CODE_SOLUTION_LESSON_ID}`,
    "        title: Code lesson graded by the author's solution",
    "        practice:",
    "          type: code",
    "          language: javascript",
    "          prompt: Add two numbers.",
    "          entry: sum",
    "          cases:",
    "            - args: [2, 3]",
    "            - args: [10, 5]",
    "              expected: 15",
    `          solution: ${JSON.stringify(FIXTURE_CODE_SOLUTION)}`,
    "",
  ].join("\n");
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// services/backend/src/plugins/practice/code/code.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import type { CodeRunRequest, CodeRunResult } from "./run-node.js";
import { createCodePracticeStrategy } from "./route.js";
import {
  codeManifestYaml,
  CODE_LESSON_ID,
  CODE_SOLUTION_LESSON_ID,
  createScriptedCodeRunner,
  FIXTURE_CODE_SOLUTION,
  FIXTURE_CODE_STARTER,
  ranWith,
  withPracticeApp,
  type PracticeAppContext,
} from "../test-support.js";
import { answerPracticeStrategy } from "../answer/index.js";
import { sqlPracticeStrategy } from "../sql/index.js";
import { FIXTURE_COURSE_ID, FIXTURE_PRACTICE_LESSON_ID } from "../../../progress/test-support.js";

const CODE_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_LESSON_ID}/practice/code`;
const SOLUTION_URL = `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_SOLUTION_LESSON_ID}/practice/code`;
const LEARNER_CODE = "export function sum(a: number, b: number) { return a + b; }";

interface CodeAppContext extends Pick<PracticeAppContext, "app" | "progress"> {
  readonly requests: CodeRunRequest[];
}

/** The full app over the code fixture, with the code strategy driven by
 * `respond`; the other two strategies are the real ones. */
function withCodeApp(
  respond: (request: CodeRunRequest, index: number) => CodeRunResult,
  run: (context: CodeAppContext) => Promise<void>,
  manifestYaml = codeManifestYaml(),
): Promise<void> {
  const scripted = createScriptedCodeRunner(respond);
  return withPracticeApp(
    ({ app, progress }) => run({ app, progress, requests: scripted.requests }),
    {
      manifestYaml,
      practiceStrategies: [sqlPracticeStrategy, answerPracticeStrategy, createCodePracticeStrategy({ runner: scripted.runner })],
    },
  );
}

void test("POST practice/code runs the learner's module on every case and completes the lesson when all pass", async () => {
  await withCodeApp(
    () => ranWith([5, 0]),
    async ({ app, progress, requests }) => {
      const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });

      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.ok, true);
      assert.equal(body.passed, true);
      assert.equal(body.failure, undefined);
      assert.deepEqual(body.cases, [
        { args: [2, 3], passed: true, value: 5, output: "", truncated: false },
        { args: [-1, 1], passed: true, value: 0, output: "", truncated: false },
      ]);
      assert.equal(body.lesson.id, CODE_LESSON_ID);
      assert.equal(body.lesson.status, "completed");
      assert.equal(body.lesson.completionMode, "practice");
      assert.equal(body.course.completedLessons, 1);
      assert.equal(progress.records()[0]?.lessonId, CODE_LESSON_ID);

      // No solution declared — exactly one run, with the learner's text
      // untouched and the manifest's cases in order.
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], { language: "typescript", code: LEARNER_CODE, entry: "sum", cases: [[2, 3], [-1, 1]] });
    },
  );
});

void test("POST practice/code reports a failed case with the learner's own value and records nothing", async () => {
  await withCodeApp(
    () => ranWith([5, 1]),
    async ({ app, progress }) => {
      const body = (await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } })).json();
      assert.equal(body.ok, true);
      assert.equal(body.passed, false);
      assert.deepEqual(body.cases.map((c: { passed: boolean; value: unknown }) => [c.passed, c.value]), [[true, 5], [false, 1]]);
      assert.equal(body.lesson.status, "not_started");
      assert.equal(progress.records().length, 0);
      // Neither the expected value nor any hint of it rides along.
      for (const c of body.cases) {
        assert.equal("expected" in c, false);
      }
    },
  );
});

void test("POST practice/code runs the solution first and grades by it; an explicit expected still wins", async () => {
  await withCodeApp(
    (request) => (request.code === FIXTURE_CODE_SOLUTION ? ranWith([5, 99]) : ranWith([5, 15])),
    async ({ app, requests }) => {
      const response = await app.inject({ method: "POST", url: SOLUTION_URL, payload: { code: "export function sum(a, b) { return a + b; }" } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().passed, true);
      assert.deepEqual(requests.map((r) => r.code)[0], FIXTURE_CODE_SOLUTION);
      assert.equal(requests.length, 2);
      assert.equal(response.body.includes(FIXTURE_CODE_SOLUTION), false);
    },
  );
});

for (const [kind, result, pattern] of [
  ["load_failed", { kind: "load_failed", durationMs: 3, error: { message: "SyntaxError: Unexpected token" } }, /Unexpected token/],
  ["entry_missing", { kind: "entry_missing", durationMs: 3, exported: ["Sum"] }, /exported: Sum/],
  ["timeout", { kind: "timeout", durationMs: 10_000, cases: [] }, /10 seconds/],
  ["crashed", { kind: "crashed", durationMs: 3, exitCode: 134, signal: null, stderr: "heap out of memory" }, /heap out of memory/],
] as const) {
  void test(`POST practice/code answers 200 ok:false with failure "${kind}" — the learner's doing, not an API error`, async () => {
    await withCodeApp(
      () => result,
      async ({ app, progress }) => {
        const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json();
        assert.equal(body.ok, false);
        assert.equal(body.passed, false);
        assert.equal(body.failure.kind, kind);
        assert.match(body.failure.message, pattern);
        assert.deepEqual(body.cases.map((c: { passed: boolean }) => c.passed), [false, false]);
        assert.equal(progress.records().length, 0);
      },
    );
  });
}

void test("POST practice/code answers 422 solution_failed when the solution is broken, without its text", async () => {
  await withCodeApp(
    () => ({ kind: "load_failed", durationMs: 3, error: { message: "SyntaxError: bad" } }),
    async ({ app, requests }) => {
      const response = await app.inject({ method: "POST", url: SOLUTION_URL, payload: { code: "export function sum() {}" } });
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().error, "solution_failed");
      assert.match(response.json().message, /SyntaxError: bad/);
      assert.equal(response.body.includes(FIXTURE_CODE_SOLUTION), false);
      // The learner's code was never run.
      assert.equal(requests.length, 1);
    },
  );
});

void test("POST practice/code answers 503 unavailable when node cannot be started", async () => {
  await withCodeApp(
    () => ({ kind: "unavailable", durationMs: 1, message: "spawn ENOENT" }),
    async ({ app }) => {
      const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code: LEARNER_CODE } });
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().error, "unavailable");
    },
  );
});

void test("POST practice/code answers 409 for a lesson whose practice is sql, pointing at practice/run", async () => {
  await withPracticeApp(async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: `/courses/${FIXTURE_COURSE_ID}/lessons/${FIXTURE_PRACTICE_LESSON_ID}/practice/code`,
      payload: { code: LEARNER_CODE },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "practice_type_mismatch");
    assert.match(response.json().message, /practice\/run/);
  });
});

void test("POST practice/code rejects blank and oversized code with 400 before running anything", async () => {
  await withCodeApp(
    () => ranWith([5, 0]),
    async ({ app, requests }) => {
      for (const code of ["", "   \n", "x".repeat(50_001)]) {
        const response = await app.inject({ method: "POST", url: CODE_URL, payload: { code } });
        assert.equal(response.statusCode, 400, `code of length ${code.length}`);
      }
      assert.equal(requests.length, 0);
    },
  );
});

void test("GET lesson exposes the code assignment's public shape only — no cases, no solution", async () => {
  await withCodeApp(
    () => ranWith([]),
    async ({ app }) => {
      const response = await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_LESSON_ID}` });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().practice, {
        type: "code",
        prompt: "Add two numbers.",
        language: "typescript",
        entry: "sum",
        starter: FIXTURE_CODE_STARTER,
      });
      const solutionLesson = await app.inject({ method: "GET", url: `/courses/${FIXTURE_COURSE_ID}/lessons/${CODE_SOLUTION_LESSON_ID}` });
      assert.equal(solutionLesson.body.includes(FIXTURE_CODE_SOLUTION), false);
      assert.equal("cases" in solutionLesson.json().practice, false);
    },
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd services/backend && rtk proxy npm test -- --test-name-pattern="practice/code|code assignment" 2>&1 | tail -20`
Expected: `pretest` падает на отсутствующих экспортах `test-support.ts` (`codeManifestYaml`, `practiceStrategies`) — пока Step 1 не сделан; после Step 1 тесты падают там, где маршрут расходится с ожиданиями.

- [ ] **Step 4: Fix the route until green**

Run: `cd services/backend && rm -rf dist dist-test && rtk proxy npm test 2>&1 | tail -20`
Expected: 12 новых тестов pass. Типичные расхождения, которые надо закрыть в `route.ts`, а не в тестах: `value: 0` пропадает из-за `=== undefined`-проверки (не должно — `0 !== undefined`); 409-сообщение содержит `practice/run` (берётся из реестра через `resolvePractice`, править не нужно); `failure.message` для `timeout` должен содержать «10 seconds» (`CODE_TIMEOUT_SECONDS`).

- [ ] **Step 5: Lint, commit**

```bash
cd services/backend && rtk proxy npm run lint
cd ../.. && git add services/backend/src/plugins/practice/test-support.ts services/backend/src/plugins/practice/code/code.test.ts
git commit -m "test(practice/code): HTTP-контракт маршрута practice/code — зачёт, провалы, 422/503/409, публичная форма"
```

### Task 6: Frontend — типы API и клиент

**Files:**
- Modify: `services/frontend/src/shared/api/types.ts`
- Modify: `services/frontend/src/shared/api/client.ts`

**Interfaces:**
- Produces:
  ```ts
  type CodeLanguage = "typescript" | "javascript";
  interface PublicCodePractice { type: "code"; prompt: string; language: CodeLanguage; entry: string; starter?: string }
  type PublicPractice = PublicSqlPractice | PublicAnswerPractice | PublicCodePractice;
  type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };
  interface PracticeCodeCaseResult { args: EncodedValue[]; passed: boolean; value?: EncodedValue; error?: { message: string }; output: string; truncated: boolean }
  type PracticeCodeFailureKind = "load_failed" | "entry_missing" | "timeout" | "crashed";
  interface PracticeCodeResponse { ok: boolean; failure?: { kind: PracticeCodeFailureKind; message: string }; durationMs: number; cases: PracticeCodeCaseResult[]; passed: boolean; lesson: LessonProgress; course: LessonCompletionResponse["course"] }
  api.runPracticeCode(courseId: string, lessonId: string, code: string): Promise<PracticeCodeResponse>
  ```

- [ ] **Step 1: Add the types**

В `services/frontend/src/shared/api/types.ts` после `PublicAnswerPractice`:

```ts
/** `practice.language` — capabilities.ts's `CODE_LANGUAGES`. */
export type CodeLanguage = "typescript" | "javascript";

/** A practice assignment done as code: the learner's module must export
 * `entry`; the backend calls it per case in a child node process. The
 * cases and the solution stay on the server (routes/courses.ts's
 * `toPublicPractice`) — only the starter text travels, because it is
 * meant to be shown. */
export interface PublicCodePractice {
  type: "code";
  prompt: string;
  language: CodeLanguage;
  entry: string;
  starter?: string;
}
```
Союз: `export type PublicPractice = PublicSqlPractice | PublicAnswerPractice | PublicCodePractice;` (комментарий над ним дополнить третьим эндпоинтом `practice/code`).

После `PracticeAnswerResponse`:

```ts
/**
 * A value as the backend's harness encoded it (plugins/practice/code/
 * compare.ts): JSON, plus one-key marker objects for what JSON cannot
 * carry — `{$undefined:true}`, `{$nan:true}`, `{$inf:1|-1}`,
 * `{$bigint:"…"}`, `{$date:"…"|null}`, `{$map:[[k,v]]}`, `{$set:[…]}`,
 * `{$function:"name"}`, `{$symbol:"…"}`. `features/practice/code-value`
 * turns one back into text for display.
 */
export type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };

/** One case of a code run (`practiceCodeCaseSchema`). `value` is the
 * learner's OWN return value — the reference never reaches the client;
 * `error` is the learner's own exception. Exactly one of the two is
 * present when the run reached this case at all. */
export interface PracticeCodeCaseResult {
  args: EncodedValue[];
  passed: boolean;
  value?: EncodedValue;
  error?: { message: string };
  /** Captured `console.*` output of this case. */
  output: string;
  truncated: boolean;
}

export type PracticeCodeFailureKind = "load_failed" | "entry_missing" | "timeout" | "crashed";

/** POST /courses/:courseId/lessons/:lessonId/practice/code —
 * plugins/practice/code/route.ts's `practiceCodeResponseSchema`. Always
 * 200 for the learner's own failures (`ok: false` + `failure`); a 422 is
 * a broken solution, a 503 a runner that cannot start — both `ApiError`. */
export interface PracticeCodeResponse {
  ok: boolean;
  /** Present iff `ok` is false. `message` is node's own text. */
  failure?: { kind: PracticeCodeFailureKind; message: string };
  durationMs: number;
  cases: PracticeCodeCaseResult[];
  /** Every case passed — the lesson's practice gate. */
  passed: boolean;
  lesson: LessonProgress;
  course: LessonCompletionResponse["course"];
}
```

- [ ] **Step 2: Add the client method**

В `services/frontend/src/shared/api/client.ts` после `submitPracticeAnswers` (импорт `PracticeCodeResponse` в блок типов):

```ts
  runPracticeCode: (courseId: string, lessonId: string, code: string): Promise<PracticeCodeResponse> =>
    apiFetch<PracticeCodeResponse>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/practice/code`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
    ),
```

- [ ] **Step 3: Type-check and commit**

Run: `cd services/frontend && rtk proxy npm run build 2>&1 | tail -20`
Expected: ошибка в `features/practice/practice-view/practice-view.tsx` — `switch` по `practice.type` теперь не покрывает `"code"` (`UnsupportedPractice` ждёт `never`). Настоящая ветка появится в Task 9; чтобы этот коммит был зелёным, добавить в `PracticeView` временную ветку:
```tsx
    case "code":
      return <UnsupportedPractice practice={practice as never} />;
```
с комментарием `// Task 9 replaces this with CodePracticeView.` — сборка зелёная, поведение прежнее (страница честно говорит «обновите приложение»). Затем `rtk proxy npm run lint && rtk proxy npm test 2>&1 | tail -5` — зелёные.

```bash
git add services/frontend/src/shared/api/types.ts services/frontend/src/shared/api/client.ts services/frontend/src/features/practice/practice-view/practice-view.tsx
git commit -m "feat(frontend/api): типы и клиент для practice/code"
```

### Task 7: Frontend — `code-value`: показ закодированных значений

**Files:**
- Create: `services/frontend/src/features/practice/code-value/index.ts`
- Create: `services/frontend/src/features/practice/code-value/code-value.ts`
- Test: `services/frontend/src/features/practice/code-value/code-value.test.ts`

**Interfaces:**
- Consumes: `EncodedValue` (Task 6).
- Produces: `formatCodeValue(value: EncodedValue): string` — JS-подобный текст: `undefined`, `null`, `NaN`, `-Infinity`, `10n`, `"str"`, `[1, 2]`, `{ a: 1, "b c": 2 }`, `Date(2026-01-02T03:04:05.000Z)`, `Map([["k", 1]])`, `Set([1, 2])`, `[function sum]`, `Symbol(tag)`; `formatCodeArgs(args: EncodedValue[]): string` — `args` через `, `.

- [ ] **Step 1: Write the failing test**

```ts
// services/frontend/src/features/practice/code-value/code-value.test.ts
import { describe, expect, it } from "vitest";
import { formatCodeArgs, formatCodeValue } from "./code-value";

describe("formatCodeValue", () => {
  it("prints JSON-native values the way a JS console would", () => {
    expect(formatCodeValue(null)).toBe("null");
    expect(formatCodeValue(true)).toBe("true");
    expect(formatCodeValue(3.5)).toBe("3.5");
    expect(formatCodeValue("hi")).toBe('"hi"');
    expect(formatCodeValue([1, "a", null])).toBe('[1, "a", null]');
    expect(formatCodeValue({ a: 1, "b c": [2] })).toBe('{ a: 1, "b c": [2] }');
    expect(formatCodeValue({})).toBe("{}");
    expect(formatCodeValue([])).toBe("[]");
  });

  it("decodes the harness markers", () => {
    expect(formatCodeValue({ $undefined: true })).toBe("undefined");
    expect(formatCodeValue({ $nan: true })).toBe("NaN");
    expect(formatCodeValue({ $inf: 1 })).toBe("Infinity");
    expect(formatCodeValue({ $inf: -1 })).toBe("-Infinity");
    expect(formatCodeValue({ $bigint: "10" })).toBe("10n");
    expect(formatCodeValue({ $date: "2026-01-02T03:04:05.000Z" })).toBe("Date(2026-01-02T03:04:05.000Z)");
    expect(formatCodeValue({ $date: null })).toBe("Date(Invalid Date)");
    expect(formatCodeValue({ $map: [["k", 1]] })).toBe('Map([["k", 1]])');
    expect(formatCodeValue({ $set: [1, 2] })).toBe("Set([1, 2])");
    expect(formatCodeValue({ $function: "sum" })).toBe("[function sum]");
    expect(formatCodeValue({ $symbol: "tag" })).toBe("Symbol(tag)");
  });

  it("does not mistake a two-key object for a marker", () => {
    expect(formatCodeValue({ $nan: true, x: 1 })).toBe("{ $nan: true, x: 1 }");
  });

  it("joins arguments with a comma", () => {
    expect(formatCodeArgs([2, "x", { $undefined: true }])).toBe('2, "x", undefined');
    expect(formatCodeArgs([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/frontend && rtk proxy npx vitest run src/features/practice/code-value 2>&1 | tail -10`
Expected: FAIL — `Failed to resolve import "./code-value"`.

- [ ] **Step 3: Write the implementation**

```ts
// services/frontend/src/features/practice/code-value/code-value.ts
import type { EncodedValue } from "../../../shared/api/types";

/**
 * A harness-encoded value as text a learner recognizes from their own
 * console: `undefined` and `null` look different, `NaN` is `NaN`, an
 * object is `{ a: 1 }` and not `{"a":1}`. Display only — nothing here is
 * compared, the backend already did that.
 */
export function formatCodeValue(value: EncodedValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatCodeValue).join(", ")}]`;

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const marker = decodeMarker(keys[0] as string, value[keys[0] as string] as EncodedValue);
    if (marker !== undefined) return marker;
  }
  if (keys.length === 0) return "{}";
  return `{ ${keys.map((key) => `${formatKey(key)}: ${formatCodeValue(value[key] as EncodedValue)}`).join(", ")} }`;
}

export function formatCodeArgs(args: EncodedValue[]): string {
  return args.map(formatCodeValue).join(", ");
}

/** A one-key object is a marker only when the key is one the harness
 * writes AND the payload has the shape it writes — `{ $nan: true, x: 1 }`
 * is an ordinary object (the caller checked the key count). */
function decodeMarker(key: string, payload: EncodedValue): string | undefined {
  switch (key) {
    case "$undefined":
      return payload === true ? "undefined" : undefined;
    case "$nan":
      return payload === true ? "NaN" : undefined;
    case "$inf":
      return payload === 1 ? "Infinity" : payload === -1 ? "-Infinity" : undefined;
    case "$bigint":
      return typeof payload === "string" ? `${payload}n` : undefined;
    case "$date":
      return payload === null ? "Date(Invalid Date)" : typeof payload === "string" ? `Date(${payload})` : undefined;
    case "$map":
      return Array.isArray(payload) ? `Map(${formatCodeValue(payload)})` : undefined;
    case "$set":
      return Array.isArray(payload) ? `Set(${formatCodeValue(payload)})` : undefined;
    case "$function":
      return typeof payload === "string" ? `[function ${payload}]` : undefined;
    case "$symbol":
      return typeof payload === "string" ? `Symbol(${payload})` : undefined;
    default:
      return undefined;
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function formatKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}
```

`index.ts`: `export * from "./code-value";`

- [ ] **Step 4: Run tests, lint, commit**

Run: `cd services/frontend && rtk proxy npx vitest run src/features/practice/code-value 2>&1 | tail -5 && rtk proxy npm run lint`
Expected: 4 pass.

```bash
git add services/frontend/src/features/practice/code-value
git commit -m "feat(frontend/practice): показ закодированных значений кода как в консоли"
```

### Task 8: Frontend — `CodeEditor` и зависимость `@codemirror/lang-javascript`

**Files:**
- Modify: `services/frontend/package.json`, `package-lock.json` (через `npm install`)
- Create: `services/frontend/src/features/practice/code-editor/index.tsx`
- Create: `services/frontend/src/features/practice/code-editor/code-editor.tsx`
- Modify: `services/frontend/src/index.css`
- Test: `services/frontend/src/features/practice/code-editor/code-editor.test.tsx`

**Interfaces:**
- Consumes: `CodeLanguage` (Task 6).
- Produces: `CodeEditor({ value, language, onChange, busy }: { value: string; language: CodeLanguage; onChange: (value: string) => void; busy: boolean })`.

- [ ] **Step 1: Install the dependency**

Run: `cd /Users/vadim/Documents/Pet/trellis && rtk proxy npm install -w @trellis/frontend @codemirror/lang-javascript@^6.2.0 2>&1 | tail -5`
Expected: в `services/frontend/package.json` появилась строка `"@codemirror/lang-javascript": "^6.2.x"` рядом с `@codemirror/lang-sql`; `package-lock.json` обновлён. Проверить `git diff --stat` — ровно два файла.

- [ ] **Step 2: Write the failing test**

```tsx
// services/frontend/src/features/practice/code-editor/code-editor.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CodeEditor } from "./code-editor";

afterEach(() => {
  cleanup();
});

describe("CodeEditor", () => {
  it("renders CodeMirror's editable surface with the current value", () => {
    const { container } = render(
      <CodeEditor value="export function sum() {}" language="typescript" onChange={vi.fn()} busy={false} />,
    );
    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable?.textContent).toBe("export function sum() {}");
  });

  it("locks the text while a run is in flight", () => {
    const { container } = render(<CodeEditor value="x" language="javascript" onChange={vi.fn()} busy={true} />);
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[contenteditable="false"]')).not.toBeNull();
  });

  it("highlights TypeScript syntax only in typescript mode", () => {
    // `: number` is a type annotation — the TS tokenizer marks it, the JS
    // one reads it as an error/plain text. Assert via the presence of a
    // typed token class rather than colors.
    const ts = render(<CodeEditor value="let a: number = 1;" language="typescript" onChange={vi.fn()} busy={false} />);
    expect(ts.container.querySelectorAll(".cm-line").length).toBeGreaterThan(0);
    expect(ts.container.textContent).toContain("number");
    ts.unmount();
    const js = render(<CodeEditor value="let a = 1;" language="javascript" onChange={vi.fn()} busy={false} />);
    expect(js.container.textContent).toContain("let a = 1;");
  });
});
```

(Третий тест — smoke на оба режима: jsdom не рендерит подсветку стабильно, поэтому он проверяет только, что оба режима монтируются с текстом.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/frontend && rtk proxy npx vitest run src/features/practice/code-editor 2>&1 | tail -5`
Expected: FAIL — модуль не найден.

- [ ] **Step 4: Write the component and styles**

```tsx
// services/frontend/src/features/practice/code-editor/code-editor.tsx
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import type { CodeLanguage } from "../../../shared/api/types";

/**
 * The learner's code for a `code` practice. Controlled, like `SqlEditor`:
 * the practice view owns the text and the run button; this only renders
 * CodeMirror in the assignment's language. `typescript: true` switches
 * the same JavaScript mode to accept type annotations — one editor, two
 * dialects, exactly as node runs them.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  busy,
}: {
  value: string;
  language: CodeLanguage;
  onChange: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="code-editor">
      <div className="code-editor-frame">
        <CodeMirror
          value={value}
          height="260px"
          extensions={[javascript({ typescript: language === "typescript" })]}
          editable={!busy}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
```

`index.tsx`: `export * from "./code-editor";`

`services/frontend/src/index.css`: у каждого правила с селектором `.sql-editor…` (строки ~1039–1078: `.sql-editor-frame`, `.sql-editor .cm-editor`, `.sql-editor .cm-editor.cm-focused`, `.sql-editor-frame:focus-within`, `.sql-editor .cm-activeLine, .sql-editor .cm-activeLineGutter`, `.sql-editor .cm-gutters`, `.sql-editor .cm-cursor`) добавить через запятую двойника с `.code-editor`, например:
```css
.sql-editor-frame,
.code-editor-frame {
```
Комментарий над первым правилом: «`.code-editor` — тот же редактор для практики кода; стили общие, чтобы два редактора не разъезжались».

- [ ] **Step 5: Run tests, lint, commit**

Run: `cd services/frontend && rtk proxy npx vitest run src/features/practice/code-editor 2>&1 | tail -5 && rtk proxy npm run lint && rtk proxy npm run build 2>&1 | tail -3`
Expected: 3 pass, lint и build зелёные.

```bash
git add package-lock.json services/frontend/package.json services/frontend/src/features/practice/code-editor services/frontend/src/index.css
git commit -m "feat(frontend/practice): редактор кода на CodeMirror в JS/TS-режиме"
```

### Task 9: Frontend — `useCodePractice`, `CodePracticeView`, ветка в `PracticeView`

**Files:**
- Create: `services/frontend/src/features/practice/use-code-practice.ts`
- Create: `services/frontend/src/features/practice/code-practice-view/index.tsx`
- Create: `services/frontend/src/features/practice/code-practice-view/code-practice-view.tsx`
- Modify: `services/frontend/src/features/practice/practice-view/practice-view.tsx`
- Modify: `services/frontend/src/features/practice/practice-view/practice-view.test.tsx` (тест «неизвестный тип» сейчас использует `type: "code"` — переключить на `"file"`)
- Modify: `services/frontend/src/index.css` (таблица case'ов, блок ошибки)
- Test: `services/frontend/src/features/practice/code-practice-view/code-practice-view.test.tsx`

**Interfaces:**
- Consumes: `api.runPracticeCode`, `PublicCodePractice`, `PracticeCodeResponse`, `PracticeCodeFailureKind` (Task 6); `formatCodeArgs`, `formatCodeValue` (Task 7); `CodeEditor` (Task 8); `draftKey`, `useDraft` (`../draft`); `PlayIcon`; `formatApiError`.
- Produces: `useCodePractice(courseId, lessonId): { execution: PracticeCodeResponse | undefined; isRunning: boolean; runError: Error | null; run: (code: string) => void }`; `CodePracticeView({ courseId, lessonId, practice: PublicCodePractice })`.

- [ ] **Step 1: Write the hook**

```ts
// services/frontend/src/features/practice/use-code-practice.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

/**
 * Drives one lesson's `code` practice: sending the learner's module to the
 * backend, which runs it case by case and grades it.
 *
 * Nothing to provision and nothing to reset — every run is a fresh child
 * process on the server (plugins/practice/code/run-node.ts).
 */
export function useCodePractice(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: (code: string) => api.runPracticeCode(courseId, lessonId, code),
    onSuccess: (data) => {
      // Only a run where every case passed can have completed the lesson —
      // re-fetch the progress tree the way the other completing actions
      // do, rather than hand-patching the cache from this response.
      if (data.passed) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  return {
    /** The most recently completed run, or `undefined` before any. */
    execution: runMutation.data,
    isRunning: runMutation.isPending,
    runError: runMutation.error,
    run: (code: string) => runMutation.mutate(code),
  };
}
```

- [ ] **Step 2: Write the failing view tests**

```tsx
// services/frontend/src/features/practice/code-practice-view/code-practice-view.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicCodePractice } from "../../../shared/api/types";
import { CodePracticeView } from "./code-practice-view";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const PRACTICE: PublicCodePractice = {
  type: "code",
  language: "typescript",
  prompt: "Напишите функцию sum(a, b).",
  entry: "sum",
  starter: "export function sum(a: number, b: number): number {\n  return 0;\n}",
};
const RUN_URL = "/api/courses/c1/lessons/l1/practice/code";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function lessonCourse(completed: boolean) {
  return {
    lesson: {
      id: "l1",
      title: "Lesson",
      status: completed ? "completed" : "not_started",
      completionMode: "practice",
      hasContent: true,
      hasQuiz: false,
      hasPractice: true,
      ...(completed ? { completedAt: "2026-01-01T00:00:00.000Z" } : {}),
    },
    course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: completed ? 1 : 0, completed },
  };
}

function renderView(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, practice = PRACTICE) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <CodePracticeView courseId="c1" lessonId="l1" practice={practice} />
    </QueryClientProvider>,
  );
  return { queryClient, container };
}

describe("CodePracticeView", () => {
  it("opens with the starter when there is no draft, and sends it as the code", async () => {
    let sent: unknown;
    const { container } = renderView(async (url, init) => {
      expect(url).toBe(RUN_URL);
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ ok: true, durationMs: 5, passed: false, cases: [{ args: [2, 3], passed: false, value: 0, output: "", truncated: false }], ...lessonCourse(false) });
    });
    expect(container.querySelector('[contenteditable="true"]')?.textContent).toContain("export function sum(a: number, b: number): number");

    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(sent).toEqual({ code: PRACTICE.starter }));
  });

  it("shows every case with its input, the learner's value and a verdict, and the tally (failed path)", async () => {
    renderView(async () =>
      jsonResponse({
        ok: true,
        durationMs: 5,
        passed: false,
        cases: [
          { args: [2, 3], passed: true, value: 5, output: "adding\n", truncated: false },
          { args: [-1, 1], passed: false, value: { $undefined: true }, output: "", truncated: false },
          { args: [0, 0], passed: false, error: { message: "boom" }, output: "", truncated: false },
        ],
        ...lessonCourse(false),
      }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Пройдено 1 из 3.")).toBeTruthy());
    expect(screen.getByText("2, 3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("undefined")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByText("adding")).toBeTruthy();
    expect(screen.getAllByText("пройден")).toHaveLength(1);
    expect(screen.getAllByText("не пройден")).toHaveLength(2);
  });

  it("re-fetches progress when every case passed (happy path)", async () => {
    const { queryClient } = renderView(async () =>
      jsonResponse({ ok: true, durationMs: 5, passed: true, cases: [{ args: [2, 3], passed: true, value: 5, output: "", truncated: false }], ...lessonCourse(true) }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Все случаи пройдены.")).toBeTruthy());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("shows node's own words for a module that did not load, and no case table", async () => {
    renderView(async () =>
      jsonResponse({
        ok: false,
        failure: { kind: "load_failed", message: "SyntaxError: Unexpected token '('" },
        durationMs: 2,
        passed: false,
        cases: [{ args: [2, 3], passed: false, output: "", truncated: false }],
        ...lessonCourse(false),
      }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText("Модуль не загрузился")).toBeTruthy());
    expect(screen.getByText(/Unexpected token/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains a 422 from a broken solution as the course's fault, not the learner's", async () => {
    renderView(async () => jsonResponse({ error: "solution_failed", message: "The solution of this assignment could not be run" }, 422));
    await userEvent.setup().click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(screen.getByText(/The solution of this assignment could not be run/)).toBeTruthy());
  });

  it("keeps the run button disabled while the editor is empty", () => {
    renderView(async () => jsonResponse({}), { ...PRACTICE, starter: undefined });
    expect((screen.getByRole("button", { name: "Выполнить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Введите код, чтобы выполнить.")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd services/frontend && rtk proxy npx vitest run src/features/practice/code-practice-view 2>&1 | tail -5`
Expected: FAIL — модуль не найден.

- [ ] **Step 4: Write the view**

```tsx
// services/frontend/src/features/practice/code-practice-view/code-practice-view.tsx
import type { PracticeCodeCaseResult, PracticeCodeFailureKind, PublicCodePractice } from "../../../shared/api/types";
import { formatApiError } from "../../../shared/lib/format-api-error";
import { PlayIcon } from "../../../shared/ui/icons";
import { CodeEditor } from "../code-editor";
import { formatCodeArgs, formatCodeValue } from "../code-value";
import { draftKey, useDraft } from "../draft";
import { useCodePractice } from "../use-code-practice";

/**
 * The `code` kind: an editor in the assignment's language, one run
 * button, and — after a run — either the reason the module could not be
 * run at all, or a table of every case with the learner's own result.
 *
 * The editor opens with the course's `starter` until the learner has a
 * draft of their own (draft.ts). Clearing the editor completely brings the
 * starter back: an empty draft is not a draft, and "forget what I wrote"
 * returning the learner to the signature is the least surprising reading.
 */
export function CodePracticeView({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicCodePractice;
}) {
  const [draft, setDraft] = useDraft(draftKey(courseId, lessonId));
  const code = draft.length === 0 ? (practice.starter ?? "") : draft;
  const isEmpty = code.trim().length === 0;
  const { execution, isRunning, runError, run } = useCodePractice(courseId, lessonId);

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <CodeEditor value={code} language={practice.language} onChange={setDraft} busy={isRunning} />

      <div className="practice-toolbar">
        <button
          type="button"
          className="icon-button icon-button--primary"
          onClick={() => run(code)}
          // Mirrors the body schema's `pattern: "\\S"` (route.ts): a
          // submission that would come back 400 never leaves the browser.
          disabled={isRunning || isEmpty}
          aria-label={isRunning ? "Выполняем…" : "Выполнить"}
          title={isRunning ? "Выполняем…" : isEmpty ? "Введите код, чтобы выполнить" : "Выполнить код"}
        >
          <PlayIcon />
        </button>
        {isEmpty && !isRunning && <span className="practice-toolbar-note">Введите код, чтобы выполнить.</span>}
      </div>

      {runError !== null && (
        <p className="muted-note">{formatApiError(runError, "Не удалось выполнить код. Попробуйте ещё раз.")}</p>
      )}

      {execution !== undefined && (
        <div className="practice-result">
          {execution.failure !== undefined && <CodeFailureView kind={execution.failure.kind} message={execution.failure.message} />}
          {execution.ok && <CaseTable cases={execution.cases} />}
          {execution.ok && (
            <p className={execution.passed ? "practice-verdict practice-verdict--passed" : "practice-verdict practice-verdict--failed"}>
              {execution.passed
                ? "Все случаи пройдены."
                : `Пройдено ${execution.cases.filter((c) => c.passed).length} из ${execution.cases.length}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const FAILURE_TITLES: Record<PracticeCodeFailureKind, string> = {
  load_failed: "Модуль не загрузился",
  entry_missing: "Экспорт не найден",
  timeout: "Превышено время выполнения",
  crashed: "Процесс завершился аварийно",
};

/** Why the module could not be run at all — a heading in the app's words
 * and node's own text underneath, verbatim (same rule as Postgres errors
 * in the sql kind: a learner debugging needs the real message). */
function CodeFailureView({ kind, message }: { kind: PracticeCodeFailureKind; message: string }) {
  return (
    <div className="practice-code-failure">
      <p className="practice-verdict practice-verdict--failed">{FAILURE_TITLES[kind]}</p>
      <pre className="practice-code-error">{message}</pre>
    </div>
  );
}

/** One row per case: what the function was called with, what the
 * learner's version returned (or threw), what it printed, and whether
 * that matched. The reference is never here — it never left the server. */
function CaseTable({ cases }: { cases: PracticeCodeCaseResult[] }) {
  return (
    <table className="code-cases">
      <thead>
        <tr>
          <th scope="col">Вход</th>
          <th scope="col">Результат</th>
          <th scope="col">Вывод</th>
          <th scope="col">Вердикт</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c, index) => (
          <tr key={index} className={c.passed ? "code-case--passed" : "code-case--failed"}>
            <td>
              <code>{formatCodeArgs(c.args)}</code>
            </td>
            <td>
              {c.error !== undefined ? (
                <code className="code-case-error">{c.error.message}</code>
              ) : c.value !== undefined ? (
                <code>{formatCodeValue(c.value)}</code>
              ) : (
                <span className="muted-note">—</span>
              )}
            </td>
            <td>
              {c.output.length > 0 && (
                <pre className="code-case-output">
                  {c.output}
                  {c.truncated && "…"}
                </pre>
              )}
            </td>
            <td>{c.passed ? "пройден" : "не пройден"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`index.tsx`: `export * from "./code-practice-view";`

`PracticeView` (`practice-view.tsx`): импорт `import { CodePracticeView } from "../code-practice-view";`, временную ветку из Task 6 заменить на
```tsx
    case "code":
      return <CodePracticeView courseId={courseId} lessonId={lessonId} practice={practice} />;
```
и дополнить комментарий компонента: «три kinds».

`practice-view.test.tsx`: в тесте «meeting a kind it does not know» заменить `type: "code"` на `type: "file"` и `sumEven` оставить; комментарий: «`code` is a kind this build knows now; `file` still is not».

`index.css` — существующее правило `.practice-sql-error {` заменить на список селекторов `.practice-sql-error,\n.practice-code-error {` (комментарий: «ошибка загрузки модуля в практике кода — тот же вид, что у ошибки Postgres»), и добавить после него:
```css
/* Таблица случаев практики кода. Моноширинные значения, строка целиком
 * окрашена по вердикту — глазу не нужно искать колонку «Вердикт». */
.code-cases {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: 0.9rem;
}
.code-cases th,
.code-cases td {
  text-align: left;
  vertical-align: top;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border, #e5e5e5);
}
.code-case--passed td:last-child {
  color: var(--ok, #2e7d32);
}
.code-case--failed td:last-child {
  color: var(--danger, #c62828);
}
.code-case-error {
  color: var(--danger, #c62828);
}
.code-case-output {
  margin: 0;
  max-height: 8rem;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.85rem;
}
```
Имена CSS-переменных подставить те, что реально объявлены в `index.css`/`ui/theme.css` (`rtk proxy grep -n "^\s*--" services/frontend/src/ui/theme.css | head`) — `.practice-verdict--passed`/`--failed` уже используют нужные цвета, взять их.

- [ ] **Step 5: Run tests, lint, build, commit**

Run: `cd services/frontend && rtk proxy npm run lint && rtk proxy npm run build 2>&1 | tail -3 && rtk proxy npm test 2>&1 | tail -8`
Expected: все зелёные, 6 новых тестов в `code-practice-view.test.tsx`; `practice-view.test.tsx` по-прежнему проходит с `"file"`.

```bash
git add services/frontend/src/features/practice/use-code-practice.ts services/frontend/src/features/practice/code-practice-view services/frontend/src/features/practice/practice-view/practice-view.tsx services/frontend/src/features/practice/practice-view/practice-view.test.tsx services/frontend/src/index.css
git commit -m "feat(frontend/practice): практика кода — редактор, запуск, таблица случаев, вердикт"
```

### Task 10: Документация — инварианты, grey-zones, CLAUDE.md, README курсов, скилл автора

**Files:**
- Modify: `.mvp/invariants.md`
- Modify: `docs/product/analysis-grey-zones.md`
- Modify: `CLAUDE.md`
- Modify: `courses/README.md`
- Modify: `.claude/skills/course-author/SKILL.md` (список `verify`)
- Create: `.claude/skills/practice-code/SKILL.md`

- [ ] **Step 1: `.mvp/invariants.md`**

В строке «Зачёт практики — только декларативные механики…» дополнить перечень после `fields`: «`cases` — вызов экспортированной функции ученика на объявленных аргументах и сравнение возвращённого значения с `cases[].expected` или с результатом `solution` автора, для заданий на код». После строки «Каждая попытка SQL-практики…» добавить:

```
- Код практики (`practice.type: code`) исполняется дочерним процессом `node` внутри backend-контейнера: свежий процесс на каждый прогон, пустой `env`, временный `cwd`, таймаут с `SIGKILL`, лимит кучи, лимит вывода. Изоляция процессная, не security-граница (код видит ФС и сеть контейнера) — модель угроз та же, что у `node file.ts` в терминале ученика на его же машине. Эталон (`solution`) исполняется до кода ученика, отдельным процессом. Нового типа песочницы нет: у кода нет накапливаемого состояния, которое `SandboxDriver` описывает.
```

- [ ] **Step 2: `docs/product/analysis-grey-zones.md`**

Новый раздел в конце файла:

```
## Практика кода (2026-09-23)

- **Механика — функция + `cases` + `solution`, а не программа со stdin/stdout** — возвращаемые значения сравниваются структурно (JSON с маркерами для undefined/NaN/Infinity/bigint/Date/Map/Set), вывод в консоль показывается, но не проверяется. Текстовое сравнение stdout хрупко (пробелы, переводы строк), а инвариант запрещает авторский код-грейдер — значит эталон должен быть данными или решением.
- **Исполнение — дочерний процесс `node` в backend-контейнере, а не отдельный контейнер и не `worker_threads`** — симметрично Postgres-песочнице (отдельная роль в том же инстансе). Отдельный контейнер дал бы настоящую границу ценой четвёртого сервиса, паритета лаунчеров и более долгого холодного старта; `worker_threads` делил бы процесс с backend (OOM/нативное падение роняет сервер, `process.env` с паролями БД доступен коду). Процессная изоляция достаточна для локального продукта одного пользователя; при появлении многопользовательского сценария первым делом выносить раннер в контейнер — интерфейс `CodeRunner` (`plugins/practice/code/run-node.ts`) это позволяет без правок маршрута.
- **Без нового типа песочницы** — `SandboxDriver` (`provision(seed)`, одна живая песочница, `withFreshSandbox`) описывает накапливающее состояние; у кода его нет. Раннер живёт внутри плагина, `language` — свойство задания, не курса.
- **TypeScript через `--experimental-strip-types`, без транспилятора** — ноль зависимостей backend; флаг обязателен на 22.16 (машина разработки) и безвреден на 22.23 (образ). Цена: только «стираемый» TS (`enum`, `namespace`, parameter properties отклоняются Node при импорте → `load_failed`), типы не проверяются. Записано в capabilities и в README курсов.
- **Правила кодирования значений продублированы** в `compare.ts` и в тексте harness (`harness.ts`): harness — самостоятельный скрипт во временной папке и импортировать пакет не может. Совпадение двух копий закреплено тестом `run-node.test.ts` («the harness encodes values exactly like compare.ts»).
```

- [ ] **Step 3: `CLAUDE.md`**

Строка «У практики есть тип: …» — дополнить: «`practice.type: code` — задание на код (TypeScript/JavaScript): ученик экспортирует функцию, движок вызывает её в дочернем процессе `node` на `cases[].args` и сравнивает результат с `cases[].expected` или с результатом `solution`.»

Строка «Зачёт практики — только декларативные механики ядра…» — после фрагмента про `answer` добавить: «Для `code`: одна механика `cases` — все объявленные вызовы должны вернуть эталон; эталон case'а — его `expected`, а без него — то, что вернул `solution` автора на тех же аргументах. Исполнение — дочерний процесс `node` с таймаутом и лимитами (процессная изоляция, не security-граница; `docs/product/analysis-grey-zones.md`). TS исполняется со стиранием типов: только стираемый синтаксис, без проверки типов.»

Строка «Эталоны ответов (`check`, `expected`, `fields[].expected`, верный вариант квиза)…» — добавить в скобки «`cases[].expected`, `solution`».

- [ ] **Step 4: `courses/README.md`**

После раздела «### Тип `answer`» (перед «### Пример: `SELECT`-задание») новый раздел:

````markdown
### Тип `code`

Задание на код: ученик пишет модуль на TypeScript или JavaScript,
который экспортирует функцию с именем `entry`. Движок вызывает её в
отдельном процессе Node на каждом наборе аргументов из `cases` и
сравнивает возвращённое значение с эталоном. Песочница курсу не нужна.

```yaml
practice:
  type: code
  language: typescript        # typescript | javascript
  prompt: "Напишите функцию sum(a, b), возвращающую сумму."
  entry: sum                  # имя именованного экспорта
  starter: |                  # необязательно: с чего начинает ученик
    export function sum(a: number, b: number): number {
      // ...
    }
  cases:
    - args: [2, 3]
      expected: 5             # эталон явно…
    - args: [-1, 1]           # …или из solution
  solution: |
    export function sum(a: number, b: number) { return a + b; }
```

- `type: code`, `language`, `entry`, `cases` — обязательны. `entry` —
  идентификатор, не `default`.
- `cases[].args` — массив аргументов вызова, любые JSON-значения.
  От 1 до 50 случаев; зачёт — когда пройдены **все**.
- `cases[].expected` — ожидаемое возвращаемое значение, любое
  JSON-значение; `null` — тоже значение. Если поля нет, эталон берётся
  из `solution`; без `solution` поле обязательно у каждого случая.
- `solution` — решение автора на том же языке с тем же `entry`. Как и у
  `sql`, обязано быть детерминированным и никогда не уходит ученику.
- `sandbox`, `check`, `expected` (верхнего уровня), `ordered`, `fields`
  при `type: code` **запрещены**.

**Как сравниваются значения.** Структурно, после переноса в JSON: порядок
ключей объекта не важен, порядок элементов массива важен, числа — точное
равенство (`0.1 + 0.2` ≠ `0.3` — учитывайте в задании), `undefined` и
`null` различаются, `NaN` равен `NaN`. Функция может быть `async` —
движок дождётся результата. Вывод `console.*` показывается ученику, но
не проверяется.

**Ограничения исполнения.** Один прогон — не дольше 10 с и не больше
256 МБ кучи; исключение или таймаут — случай не пройден. TypeScript
исполняется Node со стиранием типов: поддерживается только «стираемый»
синтаксис — без `enum`, `namespace`, parameter properties, — а ошибки
типов не проверяются (только синтаксис). Импорт npm-пакетов в решении
не поддерживается — задание должно решаться стандартной библиотекой.

Ученик видит на каждый случай: аргументы, **свой** результат (или своё
исключение), вывод консоли и вердикт. Эталон не показывается никогда —
формулируйте условие так, чтобы по нему можно было понять, что ждут.
````

В разделе «## `skills.yaml` — план курса и его линт» в перечне значений `verify` добавить `code` (→ `practice.type: code`).

- [ ] **Step 5: Скиллы автора**

`.claude/skills/course-author/SKILL.md`, строка ~106: `verify: self | quiz | sql-result | sql-state | answer | code`. Там же, где перечисляются подключаемые скиллы практики (`practice-sql`, `practice-answer`), добавить `practice-code`.

Создать `.claude/skills/practice-code/SKILL.md`:

````markdown
---
name: practice-code
description: Use when a Trellis lesson's exercise is a function the learner writes in TypeScript or JavaScript and the engine grades by calling it — choosing the entry signature, the cases, and whether to grade by explicit expected values or by an author's solution. Подключается скиллом course-author.
---

# Задание на код

Подключается, когда урок в `skills.yaml` помечен `verify: code`. Поля и
лимиты — в `docs/contracts/capabilities.json`, формат — раздел «Тип
`code`» в `courses/README.md`.

Движок вызывает экспортированную функцию ученика на каждом `cases[].args`
в отдельном процессе Node и сравнивает возвращённое значение с эталоном.
Он не читает код, не проверяет стиль и не проверяет типы — только то,
что функция возвращает. Проверяется результат, не процесс.

## Сигнатура — часть условия

`entry` и порядок аргументов ученик узнаёт только из `prompt` и
`starter`. Всегда давай `starter` с полной сигнатурой и пустым телом:
без него ученик угадывает имя экспорта, а «экспорт не найден» — самая
обидная из ошибок, потому что решение может быть верным.

Функция обязана быть чистой по отношению к аргументам: один вход — один
выход, без чтения файлов, сети и `process.env` (в процессе он пуст).

## Случаи: явный `expected` или `solution`

- `expected` — когда правильный ответ очевиден и его полезно видеть в
  манифесте при ревью (`sum(2, 3) → 5`). Пиши значение ровно в той
  форме, которую должна вернуть функция: `[1, 2]` — массив, `"5"` —
  строка, `5` — число; `null` — это значение, а не «нет эталона».
- `solution` — когда ответов много или они громоздки (сортировка
  массива из двадцати элементов). Решение обязано быть
  детерминированным и на том же языке с тем же `entry`. Сломанное
  решение движок отвечает «сломанный курс», а не «не зачтено», — но
  ученик всё равно остаётся без урока; прогони `solution` руками до
  публикации.
- Оба сразу — допустимо; у случая с `expected` он главнее.

Минимум три случая: типичный, граничный (пустой массив, ноль,
отрицательное), и один, ловящий самое частое неверное решение. Больше
десяти — редко нужно, лимит 50.

## Что ученик увидит

Свои аргументы, свой результат (или своё исключение), свой вывод
`console.log` и «пройден / не пройден» по каждому случаю. Эталон —
никогда. Поэтому условие обязано отвечать на вопрос «что именно
вернуть» без догадок: тип, форма, порядок элементов.

## Чего избегать

- Сравнение чисел точное: задания с плавающей точкой формулируй через
  целые или округление в условии.
- Только «стираемый» TypeScript: без `enum`, `namespace`, parameter
  properties. Если задание про них — это не задание для этого движка.
- Никаких npm-пакетов и никакого файлового ввода-вывода в решении.
- Порядок ключей объекта не важен, порядок элементов массива важен —
  если порядок в ответе не задан условием, требуй отсортированный.
````

- [ ] **Step 6: Lint the pilot course and commit**

Run: `cd /Users/vadim/Documents/Pet/trellis && rtk proxy npm run course:lint -- courses/pilot-sql 2>&1 | tail -3 && rtk proxy npm test 2>&1 | tail -5`
Expected: пилотный курс без ошибок; root-тесты (`scripts/*.test.mjs`) зелёные.

```bash
git status
git add .mvp/invariants.md docs/product/analysis-grey-zones.md CLAUDE.md courses/README.md .claude/skills/course-author/SKILL.md .claude/skills/practice-code/SKILL.md
git commit -m "docs: практика кода — инварианты, принятые решения, формат манифеста, скилл автора"
```

### Task 11: Сквозная проверка — CI-mirror, собранный стек, браузер

**Files:**
- Временно (не коммитить): `courses/_smoke-code/manifest.yaml`, `courses/_smoke-code/lessons/sum.md`

- [ ] **Step 1: CI mirror с чистого листа**

```bash
cd /Users/vadim/Documents/Pet/trellis
rm -rf services/backend/dist services/backend/dist-test services/frontend/dist
rtk proxy npm ci 2>&1 | tail -2
rtk proxy npm run lint --if-present 2>&1 | tail -3
rtk proxy npm run build --if-present 2>&1 | tail -3
rtk proxy npm run capabilities:check --if-present 2>&1 | tail -3
rtk proxy npm run test --if-present 2>&1 | tail -12
```
Expected: всё зелёное, ни одного `fail`; backend: число `skipped` осталось 15 (DB-тесты без `DATABASE_URL`), общее число тестов выросло ровно на сумму добавленных (7 compare + 16 run-node + 13 run-code + 12 code.test + 8 validate + 2 capabilities = 58) — иной прирост означает устаревшие артефакты в `dist-test`. Проверить отсутствие утечки test-support в прод-сборку: `find services/backend/dist -iname "*test-support*"` пуст.

- [ ] **Step 2: Временный курс для стека**

`courses/_smoke-code/manifest.yaml`:
```yaml
id: smoke-code
version: 1.0.0
title: Smoke — практика кода
modules:
  - id: m1
    title: Функции
    lessons:
      - id: sum
        title: Сумма двух чисел
        content: lessons/sum.md
        practice:
          type: code
          language: typescript
          prompt: "Напишите функцию sum(a, b), возвращающую сумму двух чисел."
          entry: sum
          starter: |
            export function sum(a: number, b: number): number {
              return 0;
            }
          cases:
            - args: [2, 3]
              expected: 5
            - args: [-1, 1]
          solution: |
            export function sum(a: number, b: number): number { return a + b; }
```
`courses/_smoke-code/lessons/sum.md`: одна строка `# Сумма`.

`rtk proxy npm run course:lint -- courses/_smoke-code` — 0 ошибок (skills.yaml нет — это допустимо).

- [ ] **Step 3: Собранный стек**

```bash
npm run stack:rebuild 2>&1 | tail -5     # пересборка образов без кеша: backend изменился
```
Дождаться адреса. Затем:
```bash
curl -s http://127.0.0.1:3001/capabilities | rtk proxy grep -o '"type":"code"'
curl -s -X POST http://127.0.0.1:3001/courses/smoke-code/lessons/sum/practice/code -H 'content-type: application/json' -d '{"code":"export function sum(a: number, b: number) { return a + b; }"}'
```
Expected: `"type":"code"` есть; ответ `{"ok":true,…"passed":true,…"status":"completed"…}` — это доказывает, что `/tmp` пишется от пользователя `node` и strip-types работает в образе. Второй запрос с `while (true) {}` → `ok:false`, `failure.kind:"timeout"` примерно через 10 с. `docker compose logs backend | tail` — без ошибок.

- [ ] **Step 4: Браузер**

Через Chrome MCP (`tabs_context_mcp` → новая вкладка `http://localhost:3000`): курс «Smoke — практика кода» → урок «Сумма двух чисел» → в редакторе виден starter с TS-подсветкой → заменить тело на `return a + b;` → «Выполнить» → таблица из двух строк «пройден», строка «Все случаи пройдены.», урок отмечен пройденным на странице курса. Вернуться в урок — черновик сохранился. `read_console_messages` — без ошибок. Сделать `export function sum() { throw new Error("x") }` → две строки с «x» и «не пройден», «Пройдено 0 из 2.».

- [ ] **Step 5: Cleanup**

```bash
rm -rf courses/_smoke-code
npm run stack:down
git status        # должно быть чисто (кроме courses/hr-analytics/, который был untracked до начала работ)
```
Ничего не коммитится в этой задаче.

---

## Самопроверка плана (выполнена автором плана)

- **Покрытие спеки:** манифест/валидатор — Task 4; реестр и лимиты — Task 2+4; harness-протокол, инкрементальный `result.json`, маркеры — Task 1+2; оркестрация, `CodeSolutionError`, порядок «эталон до ученика» — Task 3; маршрут и схемы ответа — Task 4+5; публичная форма — Task 4+5; линт (`verify: code`, features без анализатора) — Task 4; frontend типы/клиент/редактор/представление/`PracticeView` — Task 6–9; документация и скилл — Task 10; проверка стека и `/tmp` — Task 11. Раздел «Вне объёма» спеки не реализуется.
- **Согласованность имён между задачами:** `createNodeRunner`/`CodeRunner`/`CodeRunRequest`/`CodeRunResult`/`CodeCaseOutcome` (Task 2) используются в Task 3, 4, 5 под теми же именами; `runCodePracticeAttempt`/`describeFailure`/`CodePracticeAttemptResult` (Task 3) — в Task 4; `createCodePracticeStrategy` (Task 4) — в Task 5; `createScriptedCodeRunner`/`ranWith` (Task 3) — в Task 3 и 5; `formatCodeValue`/`formatCodeArgs` (Task 7) — в Task 9; `CodeEditor` (Task 8) — в Task 9; `PracticeCodeResponse`/`PublicCodePractice` (Task 6) — в Task 9.
- **Review Focus:** пункты 1–3 закрыты тестами Task 2, пункт 4 — Task 1 (`valuesEqual`), Task 3 и Task 4 (валидатор), пункт 5 — Task 3 (таймаут solution → `CodeSolutionError`) и Task 5 (422).
