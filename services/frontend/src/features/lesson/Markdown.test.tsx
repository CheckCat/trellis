import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(() => {
  cleanup();
});

describe("Markdown", () => {
  it("renders headings and paragraphs from the source text (happy path)", () => {
    // Заголовок второго уровня, а не первого: первый в начале файла
    // намеренно не рендерится — см. отдельный тест ниже.
    render(<Markdown source={"## Title\n\nBody text."} />);

    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeTruthy();
    expect(screen.getByText("Body text.")).toBeTruthy();
  });

  it("renders a fenced code block as <pre><code> (edge case — SQL lesson examples)", () => {
    render(<Markdown source={"```sql\nSELECT 1;\n```"} />);

    const code = screen.getByText("SELECT 1;", { exact: false });
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders a GFM pipe table as a real table (edge case — курс описывает данные таблицами)", () => {
    // Таблицы — расширение GitHub Flavored Markdown, а не CommonMark:
    // без remark-gfm react-markdown отрисует это одним абзацем с палками.
    render(
      <Markdown
        source={["| id | title |", "|----|-------|", "| 1 | Война и мир |"].join("\n")}
      />,
    );

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "title" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Война и мир" })).toBeTruthy();
  });

  it("skips a leading level-1 heading — заголовок урока принадлежит странице", () => {
    // Название урока берётся из манифеста (оно есть и у уроков без
    // content), а страница печатает его сама. Тело урока при этом остаётся
    // самодостаточным .md-файлом, который нормально читается в редакторе, —
    // поэтому заголовок из него не убирают, его просто не рендерят вторым.
    render(<Markdown source={"# Что такое SQL\n\nТело урока."} />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("Тело урока.")).toBeTruthy();
  });

  it("keeps a level-1 heading that is not the first block (edge case)", () => {
    // Пропускается ровно дубль заголовка страницы, а не любой h1: если
    // автор курса разделил урок на части, второй h1 — часть содержания.
    render(<Markdown source={"Вступление.\n\n# Часть вторая"} />);

    expect(screen.getByRole("heading", { level: 1, name: "Часть вторая" })).toBeTruthy();
  });

  it("never executes embedded HTML/script content (security path)", () => {
    render(<Markdown source={"<script>window.__markdownPwned = true;</script>"} />);

    // react-markdown parses CommonMark into React elements, never raw HTML
    // (no rehype-raw plugin, no dangerouslySetInnerHTML) — a script tag in
    // course content must never run.
    expect((window as unknown as { __markdownPwned?: boolean }).__markdownPwned).toBeUndefined();
  });
});
