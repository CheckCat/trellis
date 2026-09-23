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

// A promise that never settles must be a TIMEOUT, not an exit: with an
// empty event loop node abandons an unsettled top-level await and exits
// with code 13, which would read as a crash. A referenced timer keeps the
// loop alive until the runner's own deadline kills the process.
const keepAlive = setInterval(() => {}, 60_000);

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
clearInterval(keepAlive);
`;
