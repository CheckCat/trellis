import assert from "node:assert/strict";
import test from "node:test";

import { containsPhrase, mentions, phrasesOf, proseOf, stem, stemsOf } from "./terms.js";

void test("inflected forms of a Russian word share a stem", () => {
  const forms = ["текучесть", "текучести", "текучестью", "Текучесть"];
  const stems = new Set(forms.map(stem));
  assert.equal(stems.size, 1, `expected one stem, got ${[...stems].join(", ")}`);
});

void test("ё and е are the same letter to a reader, so they are here too", () => {
  assert.equal(stem("учёт"), stem("учет"));
});

void test("a short word is left alone rather than cut to nothing (edge case)", () => {
  // "код" minus an ending would be "к", which would match half the
  // dictionary. Under-matching is the safe direction: it costs a missed
  // finding, over-matching costs a false one.
  assert.equal(stem("код"), "код");
});

void test("different words do not collide", () => {
  assert.notEqual(stem("ключ"), stem("ключевой"));
  assert.notEqual(stem("наём"), stem("найм"));
});

void test("a fenced code block is not the course explaining a word", () => {
  const prose = proseOf("Читаем таблицу.\n\n```sql\nselect * from books where id = 1;\n```\n");
  assert.match(prose, /Читаем/);
  // A query containing WHERE teaches nothing to someone who has not met
  // WHERE — flagging it would train authors to silence the rule.
  assert.doesNotMatch(prose, /where/i);
});

void test("inline code of one or two words IS the course naming a term", () => {
  // "команда `SELECT`" names the keyword; a whole statement in backticks
  // is a sample. The line between them is length, which is crude and
  // deliberate.
  assert.match(proseOf("используется команда `SELECT`"), /SELECT/);
  assert.match(proseOf("`ORDER BY` задаёт порядок"), /ORDER BY/);
  assert.doesNotMatch(proseOf("пишем `select title from books`"), /select/);
});

void test("a multi-word term matches as a sequence, not as loose words", () => {
  const phrases = phrasesOf({ term: "среднесписочная численность" });
  assert.equal(phrases.length, 1);
  assert.ok(mentions(stemsOf("Считаем среднесписочную численность за год."), phrases));
  // The two words apart are not the term.
  assert.equal(mentions(stemsOf("Численность отдела и среднесписочная база"), phrases), false);
});

void test("hand-written forms cover what the stemmer cannot reach", () => {
  const phrases = phrasesOf({ term: "eNPS", forms: ["индекс лояльности"] });
  assert.ok(mentions(stemsOf("Считаем индекс лояльности сотрудников."), phrases));
  assert.ok(mentions(stemsOf("Метрика eNPS показывает..."), phrases));
});

void test("an empty phrase never matches (edge case)", () => {
  assert.equal(containsPhrase(["а", "б"], []), false);
  assert.equal(phrasesOf({ term: "   " }).length, 0);
});
