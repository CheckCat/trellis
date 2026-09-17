import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SqlEditor } from "./SqlEditor";

afterEach(() => {
  cleanup();
});

describe("SqlEditor", () => {
  it("renders CodeMirror's editable surface and the current value", () => {
    const { container } = render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={vi.fn()} busy={false} />);
    // CodeMirror's SQL tokenizer splits the line across several `<span>`s
    // (keyword/literal highlighting) — no single element carries the whole
    // text, so this reads the editable surface's combined text content
    // instead of matching one node.
    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable?.textContent).toBe("select 1;");
  });

  it("calls onRun when the run button is clicked and enabled (happy path)", () => {
    const onRun = vi.fn();
    render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={onRun} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Выполнить" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("disables the run button when the value is empty/whitespace-only (edge case)", () => {
    render(<SqlEditor value="   " onChange={vi.fn()} onRun={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(true);
  });

  it("disables the run button and shows a busy label while a run is in flight (edge case)", () => {
    render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={vi.fn()} busy={true} />);
    const button = screen.getByRole("button", { name: "Выполняем…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
