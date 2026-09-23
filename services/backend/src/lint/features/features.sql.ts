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

/** Feature ids a plan may grant, as `sql:<id>` in a term's `grants`
 * (lint/features.ts is the registry those values come from). Closed on
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
  // Added later than the rest, after the analyzer was found silent on the
  // three constructs an analytics course is most likely to build a lesson
  // around. The criterion for adding one is not "SQL has it" — that way
  // lies a parser — but "a course teaches this as its own technique, and a
  // learner who has not met it cannot produce it". `sum(x) over (...)`
  // used to read as plain `aggregate`, so a course could grant `aggregate`
  // in module 1 and set a window-function exercise in module 2 with
  // nothing said.
  "window",
  "cte",
  "date-function",
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
  // `over (` is the only way a window function can be written, so the
  // ranking functions below are redundant with it in valid SQL — they are
  // listed anyway because a reference answer with a typo should still be
  // read as "this exercise is about window functions".
  ["window", /\bover\s*\(|\bwindow\s+[a-z_]\w*\s+as\b|\b(?:row_number|rank|dense_rank|percent_rank|ntile|lag|lead|first_value|last_value|nth_value)\s*\(/],
  ["cte", /\bwith\s+(?:recursive\s+)?[a-z_]\w*\s*(?:\([^)]*\))?\s+as\s*(?:materialized\s+|not\s+materialized\s+)?\(/],
  // Function-like names need their parenthesis: a column called `age` or
  // `extract` is data, not date arithmetic. The bare keywords in the
  // second half have no call syntax to key on and are accepted as words.
  [
    "date-function",
    /\b(?:date_trunc|date_part|extract|age|make_date|make_time|make_timestamp|make_interval|to_date|to_timestamp|justify_days|justify_hours)\s*\(|\b(?:interval|current_date|current_timestamp|localtimestamp|localtime)\b/,
  ],
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
