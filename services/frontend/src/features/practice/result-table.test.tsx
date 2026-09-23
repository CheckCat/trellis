import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PracticeResultSet } from "../../api/types";
import { ResultTable } from "./result-table";

afterEach(() => {
  cleanup();
});

describe("ResultTable", () => {
  it("renders columns and rows, showing NULL cells distinctly (happy path)", () => {
    const result: PracticeResultSet = {
      command: "SELECT",
      rowCount: 2,
      columns: [
        { name: "id", dataTypeId: 23 },
        { name: "label", dataTypeId: 25 },
      ],
      rows: [
        ["1", "a"],
        ["2", null],
      ],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByRole("columnheader", { name: "id" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "label" })).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("NULL")).toBeTruthy();
  });

  it("shows a one-line summary instead of an empty table for a command with no columns (edge case)", () => {
    const result: PracticeResultSet = {
      command: "INSERT",
      rowCount: 3,
      columns: [],
      rows: [],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByText("INSERT выполнена, затронуто строк: 3.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one header per column even when names collide (edge case, `select 1 as a, 2 as a`)", () => {
    const result: PracticeResultSet = {
      command: "SELECT",
      rowCount: 1,
      columns: [
        { name: "a", dataTypeId: 23 },
        { name: "a", dataTypeId: 23 },
      ],
      rows: [["1", "2"]],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getAllByRole("columnheader", { name: "a" })).toHaveLength(2);
  });

  it("shows a truncation note when the result was capped (edge case)", () => {
    const result: PracticeResultSet = {
      rowCount: 500,
      columns: [{ name: "n", dataTypeId: 23 }],
      rows: Array.from({ length: 200 }, (_, i) => [String(i)]),
      truncated: true,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByText("Показаны первые 200 строк из 500.")).toBeTruthy();
  });
});
