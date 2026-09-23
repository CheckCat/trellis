import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SqlEditor } from "./sql-editor";

afterEach(() => {
  cleanup();
});

describe("SqlEditor", () => {
  it("renders CodeMirror's editable surface and the current value", () => {
    const { container } = render(<SqlEditor value="select 1;" onChange={vi.fn()} busy={false} />);
    // CodeMirror's SQL tokenizer splits the line across several `<span>`s
    // (keyword/literal highlighting) — no single element carries the whole
    // text, so this reads the editable surface's combined text content
    // instead of matching one node.
    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable?.textContent).toBe("select 1;");
  });

  it("stops accepting input while a run is in flight (edge case)", () => {
    const { container } = render(<SqlEditor value="select 1;" onChange={vi.fn()} busy={true} />);
    // The run/reset buttons live in the practice toolbar now (see
    // PracticeView) — the only thing `busy` still does here is lock the
    // text, so that is what this asserts.
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[contenteditable="false"]')).not.toBeNull();
  });
});
