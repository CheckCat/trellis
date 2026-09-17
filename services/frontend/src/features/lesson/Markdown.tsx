import ReactMarkdown from "react-markdown";

/**
 * Renders a lesson's Markdown body. `react-markdown` builds React elements
 * from the parsed AST instead of injecting HTML (no `dangerouslySetInnerHTML`
 * anywhere in this app) — course content is a third-party-authored package
 * under `courses/` (project invariant: it's data, not code the core wrote),
 * so this is the one place user-facing untrusted-ish text actually renders.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="lesson-content">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}
