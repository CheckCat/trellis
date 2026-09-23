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
