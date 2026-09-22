// Which SQL constructs a statement actually uses.
//
// Same purpose as lint/terms.ts, one layer down: a course must not set an
// exercise that can only be solved with something it has not taught yet.
// For prose the evidence is a word in the text; for an exercise it is a
// construct in the author's own reference statement — if the author needs
// WHERE to solve it, so does the learner.
//
// This is not a SQL parser and must not grow into one. It answers a single
// yes/no per construct on text the COURSE AUTHOR wrote (never on a
// learner's input), and a wrong answer costs a lint finding, not a wrong
// verdict. String literals and comments are removed first so that a book
// titled 'Order by Chaos' does not count as ORDER BY.

/** Feature ids a plan may list in `skills[].grants_sql`. Closed on
 * purpose: a typo in a plan must be a finding, not a silently ignored
 * entry that makes the rule pass by accident. */
export const SQL_FEATURES: readonly string[] = [
  "select",
  "where",
  "order-by",
  "limit",
  "distinct",
  "group-by",
  "having",
  "aggregate",
  "join",
  "subquery",
  "union",
  "case",
  "like",
  "in",
  "between",
  "null-check",
  "insert",
  "update",
  "delete",
  "transaction",
  "ddl",
];

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["select", /\bselect\b/],
  ["where", /\bwhere\b/],
  ["order-by", /\border\s+by\b/],
  ["limit", /\b(?:limit|offset|fetch\s+first)\b/],
  ["distinct", /\bdistinct\b/],
  ["group-by", /\bgroup\s+by\b/],
  ["having", /\bhaving\b/],
  ["aggregate", /\b(?:count|sum|avg|min|max)\s*\(/],
  ["join", /\b(?:join|using)\b/],
  ["union", /\b(?:union|intersect|except)\b/],
  ["case", /\bcase\b/],
  ["like", /\b(?:like|ilike|similar\s+to)\b/],
  ["in", /\bin\s*\(/],
  ["between", /\bbetween\b/],
  ["null-check", /\bis\s+(?:not\s+)?null\b/],
  ["insert", /\binsert\s+into\b/],
  ["update", /\bupdate\b/],
  ["delete", /\bdelete\s+from\b/],
  ["transaction", /\b(?:begin|commit|rollback|savepoint)\b/],
  ["ddl", /\b(?:create|alter|drop|truncate)\b/],
];

/** Strips string literals, dollar-quoted blocks and comments — everything
 * whose contents are data rather than syntax. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:''|[^'])*'/g, " ")
    .replace(/"(?:""|[^"])*"/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * The features one statement uses, in the order of SQL_FEATURES.
 *
 * A comma-joined `from a, b` counts as a join: it is the same idea
 * written the older way, and a learner who has not met joins cannot
 * produce it either.
 */
export function sqlFeaturesOf(sql: string): string[] {
  const text = stripLiterals(sql).toLowerCase();
  const found = new Set<string>();

  for (const [feature, pattern] of PATTERNS) {
    if (pattern.test(text)) {
      found.add(feature);
    }
  }
  if (/\bfrom\s+[a-z_][\w.]*(?:\s+(?:as\s+)?[a-z_]\w*)?\s*,/.test(text)) {
    found.add("join");
  }
  // A parenthesised SELECT is a subquery wherever it stands — in FROM, in
  // WHERE, or as a column.
  if (/\(\s*select\b/.test(text)) {
    found.add("subquery");
  }

  return SQL_FEATURES.filter((feature) => found.has(feature));
}
