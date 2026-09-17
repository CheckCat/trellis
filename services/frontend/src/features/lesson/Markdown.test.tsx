import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(() => {
  cleanup();
});

describe("Markdown", () => {
  it("renders headings and paragraphs from the source text (happy path)", () => {
    render(<Markdown source={"# Title\n\nBody text."} />);

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByText("Body text.")).toBeTruthy();
  });

  it("renders a fenced code block as <pre><code> (edge case — SQL lesson examples)", () => {
    render(<Markdown source={"```sql\nSELECT 1;\n```"} />);

    const code = screen.getByText("SELECT 1;", { exact: false });
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("never executes embedded HTML/script content (security path)", () => {
    render(<Markdown source={"<script>window.__markdownPwned = true;</script>"} />);

    // react-markdown parses CommonMark into React elements, never raw HTML
    // (no rehype-raw plugin, no dangerouslySetInnerHTML) — a script tag in
    // course content must never run.
    expect((window as unknown as { __markdownPwned?: boolean }).__markdownPwned).toBeUndefined();
  });
});
