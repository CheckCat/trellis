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
