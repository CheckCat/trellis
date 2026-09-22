import type { Root } from "mdast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Убирает заголовок первого уровня, если урок с него начинается.
 *
 * Название урока — свойство урока, а не его текста: оно приходит из
 * manifest.yaml, есть даже у уроков без `content` и используется в
 * навигации, поэтому печатает его страница (`LessonView`). При этом
 * `.md`-файл курса остаётся самодостаточным документом с собственным
 * заголовком — так его и пишут, и читают в обычном редакторе. Совмещение
 * этих двух правд и даёт дубль на экране; плагин снимает его на уровне
 * дерева, до рендера.
 *
 * Отбрасывается ровно первый блок и только он: h1 в середине урока — это
 * уже часть содержания, а не второй титул.
 */
function remarkDropLeadingTitle() {
  return (tree: Root) => {
    const [first] = tree.children;
    if (first !== undefined && first.type === "heading" && first.depth === 1) {
      tree.children.shift();
    }
  };
}

/**
 * Renders a lesson's Markdown body. `react-markdown` builds React elements
 * from the parsed AST instead of injecting HTML (no `dangerouslySetInnerHTML`
 * anywhere in this app) — course content is a third-party-authored package
 * under `courses/` (project invariant: it's data, not code the core wrote),
 * so this is the one place user-facing untrusted-ish text actually renders.
 *
 * `remark-gfm` расширяет CommonMark до GitHub Flavored Markdown. Нужен он
 * прежде всего ради таблиц: в CommonMark их нет вообще, и без плагина
 * `| id | title |` превращается в абзац с палками — ровно то, чем курс
 * описывает данные. Заодно приезжают зачёркивание, автоссылки и списки
 * задач. Сырой HTML это не включает: плагин работает на remark-дереве, а
 * `rehype-raw` здесь по-прежнему не подключён.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="lesson-content">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkDropLeadingTitle]}>{source}</ReactMarkdown>
    </div>
  );
}
