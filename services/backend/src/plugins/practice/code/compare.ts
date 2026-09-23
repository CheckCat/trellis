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
