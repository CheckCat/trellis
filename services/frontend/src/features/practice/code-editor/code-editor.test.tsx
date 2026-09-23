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

  it("mounts in both language modes with the text intact", () => {
    // jsdom does not render highlighting stably enough to assert on token
    // classes; what this pins is that each mode mounts and shows the text.
    const ts = render(<CodeEditor value="let a: number = 1;" language="typescript" onChange={vi.fn()} busy={false} />);
    expect(ts.container.querySelectorAll(".cm-line").length).toBeGreaterThan(0);
    expect(ts.container.textContent).toContain("number");
    ts.unmount();
    const js = render(<CodeEditor value="let a = 1;" language="javascript" onChange={vi.fn()} busy={false} />);
    expect(js.container.textContent).toContain("let a = 1;");
  });
});
