import assert from "node:assert/strict";
import test from "node:test";

import type { CourseAnswerField } from "../courses/types.js";
import { gradeAnswers, parseAnswerNumber } from "./answer.js";

function numberField(expected: number, tolerance = 0, id = "n"): CourseAnswerField {
  return { id, label: "Сколько?", kind: "number", expected, tolerance };
}

function textField(expected: string, id = "t"): CourseAnswerField {
  return { id, label: "Что именно?", kind: "text", expected };
}

// --- parseAnswerNumber ---------------------------------------------------

void test("parseAnswerNumber reads the plain forms", () => {
  assert.equal(parseAnswerNumber("112"), 112);
  assert.equal(parseAnswerNumber("18.5"), 18.5);
  assert.equal(parseAnswerNumber("  42  "), 42);
  assert.equal(parseAnswerNumber("-3.25"), -3.25);
  assert.equal(parseAnswerNumber("+7"), 7);
  assert.equal(parseAnswerNumber("0.5"), 0.5);
  assert.equal(parseAnswerNumber(".5"), 0.5);
});

void test("parseAnswerNumber accepts a comma as the decimal separator", () => {
  assert.equal(parseAnswerNumber("18,5"), 18.5);
  assert.equal(parseAnswerNumber("0,001"), 0.001);
  assert.equal(parseAnswerNumber("-2,5"), -2.5);
});

void test("parseAnswerNumber accepts spaces as thousands separators, including the ones Excel pastes", () => {
  assert.equal(parseAnswerNumber("1 234"), 1234);
  assert.equal(parseAnswerNumber("1 234 567,89"), 1234567.89);
  // U+00A0 (no-break) and U+202F (narrow no-break): what a copied
  // spreadsheet cell actually contains. Rejecting a correct answer over an
  // invisible character would be indefensible.
  assert.equal(parseAnswerNumber("1\u00a0234"), 1234);
  assert.equal(parseAnswerNumber("1\u202f234,5"), 1234.5);
});

void test("parseAnswerNumber reads both separators together, in either convention", () => {
  // Whichever of "," / "." comes last is the decimal point.
  assert.equal(parseAnswerNumber("1,234.56"), 1234.56);
  assert.equal(parseAnswerNumber("1.234,56"), 1234.56);
  assert.equal(parseAnswerNumber("1.234.567,8"), 1234567.8);
});

void test("parseAnswerNumber rejects what is not a plain number", () => {
  for (const raw of ["", "   ", "abc", "12abc", "1e3", "0x10", "Infinity", "NaN", "5.", "--1", "1,2,3.4.5", "50%", "$5"]) {
    assert.equal(parseAnswerNumber(raw), undefined, `expected ${JSON.stringify(raw)} to be unparseable`);
  }
});

// --- gradeAnswers --------------------------------------------------------

void test("gradeAnswers answers one boolean per DECLARED field and nothing else", () => {
  const fields = [numberField(112, 0, "headcount"), textField("По собственному желанию", "reason")];
  const verdict = gradeAnswers(fields, {
    headcount: "112",
    reason: "По собственному желанию",
    // A key that matches no field: the assignment's own field list is the
    // authority on what is graded, so this is ignored rather than fatal.
    "stray-key": "whatever",
  });

  assert.deepEqual(verdict, {
    ok: true,
    fields: { headcount: { correct: true }, reason: { correct: true } },
  });
});

void test("gradeAnswers marks a missing or blank answer wrong instead of skipping it", () => {
  const fields = [numberField(112, 0, "headcount"), textField("Да", "agreed")];

  // Nothing submitted at all: the client still needs a mark per field.
  const empty = gradeAnswers(fields, {});
  assert.deepEqual(empty, { ok: false, fields: { headcount: { correct: false }, agreed: { correct: false } } });

  const blank = gradeAnswers(fields, { headcount: "   ", agreed: "" });
  assert.equal(blank.ok, false);
  assert.equal(blank.fields.headcount?.correct, false);
});

void test("gradeAnswers is false overall as soon as one field is wrong", () => {
  const fields = [numberField(112, 0, "a"), numberField(5, 0, "b")];
  const verdict = gradeAnswers(fields, { a: "112", b: "6" });

  assert.equal(verdict.ok, false);
  // Partial credit is still reported honestly, field by field — the
  // learner has to know which one to fix.
  assert.equal(verdict.fields.a?.correct, true);
  assert.equal(verdict.fields.b?.correct, false);
});

void test("gradeAnswers applies the numeric tolerance, inclusively, and exact equality without one", () => {
  const loose = [numberField(18.5, 0.2)];
  assert.equal(gradeAnswers(loose, { n: "18,4" }).ok, true);
  assert.equal(gradeAnswers(loose, { n: "18.7" }).ok, true, "the tolerance is inclusive at its boundary");
  assert.equal(gradeAnswers(loose, { n: "18,2" }).ok, false);

  const exact = [numberField(112)];
  assert.equal(gradeAnswers(exact, { n: "112" }).ok, true);
  assert.equal(gradeAnswers(exact, { n: "112,0" }).ok, true, "the same value written differently is the same value");
  assert.equal(gradeAnswers(exact, { n: "113" }).ok, false);
});

void test("gradeAnswers compares text after trimming, ignoring case", () => {
  const fields = [textField("По собственному желанию")];
  for (const submitted of [
    "По собственному желанию",
    "  По собственному желанию  ",
    "по собственному желанию",
    "ПО СОБСТВЕННОМУ ЖЕЛАНИЮ",
  ]) {
    assert.equal(gradeAnswers(fields, { t: submitted }).ok, true, `expected ${JSON.stringify(submitted)} to pass`);
  }
  // Inner wording is NOT normalized away — the core does not guess at
  // synonyms or collapse spelling differences.
  for (const submitted of ["По  собственному желанию", "собственное желание", "По собственному"]) {
    assert.equal(gradeAnswers(fields, { t: submitted }).ok, false, `expected ${JSON.stringify(submitted)} to fail`);
  }
});

void test("gradeAnswers accepts decomposed Unicode — a spreadsheet paste is not a wrong answer", () => {
  // "Евгений" with a composed "й" (U+0439) against the decomposed form
  // ("и" + U+0306) macOS pastes. Indistinguishable on screen, different
  // strings, the same answer.
  const composed = "Евгений Онегин";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(decomposed, composed, "the fixture must actually differ byte-wise");

  assert.equal(gradeAnswers([textField(composed)], { t: decomposed }).ok, true);
  assert.equal(gradeAnswers([textField(decomposed)], { t: composed }).ok, true);
});

void test("gradeAnswers marks unparseable text in a numeric field wrong, never throwing", () => {
  const fields = [numberField(112)];
  for (const submitted of ["сто двенадцать", "112 человек", "~112"]) {
    assert.equal(gradeAnswers(fields, { n: submitted }).ok, false);
  }
});
