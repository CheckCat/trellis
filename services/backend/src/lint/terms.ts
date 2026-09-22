// Finding out whether a course uses a word before it explains it.
//
// The problem this solves is not specific to technical courses. A module
// on HR metrics that says "скорректируйте на сезонность" four lessons
// before the lesson that defines seasonality has the same defect as a SQL
// module that asks for WHERE before teaching it: the learner meets a term
// as if they already knew it, decides the fault is theirs, and stops.
//
// What a machine can and cannot do here is worth stating plainly, because
// the gap is where the author's own review lives:
//
//   CAN: find an OCCURRENCE of a declared term earlier than the lesson
//        declared to introduce it. That is a text search, and it is exact.
//   CANNOT: notice that a lesson leans on a CONCEPT without naming it
//        ("посчитайте с поправкой на время года"). Nothing in the text
//        marks that, so nothing here will catch it.
//
// So this is a floor, not a ceiling: it makes the cheap half of the
// problem impossible to ship, and leaves the expensive half to a reader.
//
// Matching is deliberately crude. Russian inflects, so "текучесть",
// "текучести" and "текучестью" are the same word to a reader and three
// different strings to `includes()`. A full morphological analyser would
// be a dependency, a download and a black box; instead each token is cut
// down to a stem by removing the longest ending from a fixed list. It is
// a "light stemmer" — it under-matches on stem changes (человек/люди),
// which is why a term can also carry `forms` spelled out by hand.

/** Endings stripped to compare two forms of the same word. Longest first:
 * "сотрудниками" must lose "ами", not "и". */
const ENDINGS: readonly string[] = [
  "иями", "ями", "ами", "иях", "ях", "ах", "ов", "ев", "ий", "ый", "ое", "ее", "ые", "ие",
  "ого", "его", "ому", "ему", "ыми", "ими", "ой", "ей", "ою", "ею", "ом", "ем", "ая", "яя",
  "ую", "юю", "ью", "ия", "ии", "es",
  "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й", "s",
];

// Verb endings (-ть, -ся) are deliberately absent. Cutting them would
// turn "текучесть" into "текучес" while "текучести" becomes "текучест",
// and the two forms of the same noun would stop matching — the exact
// failure this file exists to avoid. Terms are overwhelmingly nouns; a
// course that needs a verb spells its forms out.

/** A stem shorter than this is left alone: cutting "код" to "к" would
 * make it match half the dictionary. */
const MIN_STEM = 4;

/**
 * One word reduced to its stem. Lowercased, `ё` folded to `е` (authors
 * spell it both ways and mean the same word), longest known ending
 * removed once.
 */
export function stem(word: string): string {
  const normalized = word.toLowerCase().replaceAll("ё", "е");
  for (const ending of ENDINGS) {
    if (normalized.length - ending.length >= MIN_STEM && normalized.endsWith(ending)) {
      return normalized.slice(0, normalized.length - ending.length);
    }
  }
  return normalized;
}

/** Splits into word tokens, dropping punctuation and digits. Letters of
 * any alphabet count — a Russian course still says "eNPS" and "SQL". */
function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0 && /\p{L}/u.test(token));
}

/**
 * The prose of a Markdown lesson: fenced code blocks and inline code are
 * removed first.
 *
 * A term inside a code sample is not the course explaining it — a query
 * that happens to contain `where` teaches nothing to a reader who has not
 * met WHERE, and flagging it would train authors to silence this rule.
 * Link URLs go too, for the same reason.
 */
export function proseOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`([^`\n]*)`/g, (_match, code: string) => (isTermLike(code) ? ` ${code} ` : " "))
    .replace(/\]\([^)\s]+\)/g, "] ")
    .replace(/^\s{4,}\S.*$/gm, " ");
}

/** Inline code short enough to be a NAME rather than a snippet.
 *
 * Authors write "команда `SELECT`" and "`ORDER BY` задаёт порядок" — that
 * is the course naming a term, and dropping it would make every SQL
 * keyword look unexplained. A whole statement in backticks is a sample,
 * and a sample teaches nothing to someone who has not met the keyword. */
function isTermLike(code: string): boolean {
  const parts = code.trim().split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 && parts.length <= 2;
}

/** A lesson's prose as stems, in reading order. */
export function stemsOf(markdown: string): string[] {
  return words(proseOf(markdown)).map(stem);
}

/** A term as the matcher sees it: the canonical spelling plus any
 * hand-written forms, each reduced to a sequence of stems (a term may be
 * several words: "среднесписочная численность"). */
export function phrasesOf(term: { readonly term: string; readonly forms?: readonly string[] }): string[][] {
  return [term.term, ...(term.forms ?? [])]
    .map((spelling) => words(spelling).map(stem))
    .filter((phrase) => phrase.length > 0);
}

/** Does this stem sequence contain the phrase? Plain sliding window: the
 * texts are lesson-sized and the term lists are short. */
export function containsPhrase(haystack: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || haystack.length < phrase.length) {
    return false;
  }
  for (let start = 0; start <= haystack.length - phrase.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (haystack[start + offset] !== phrase[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

/** True when any spelling of the term occurs in the text. */
export function mentions(stems: readonly string[], phrases: readonly (readonly string[])[]): boolean {
  return phrases.some((phrase) => containsPhrase(stems, phrase));
}
