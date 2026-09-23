// Grading a practice assignment that was done OUTSIDE the platform.
//
// The two SQL mechanics (check.ts, compare.ts) both need a sandbox: they
// grade either the database's state or the rows a query returned. An
// exercise carried out in Excel or on a BI dashboard produces neither —
// there is nothing here to execute and nothing to inspect. So this mechanic
// grades the only thing that crosses back into the platform: the values the
// learner says they arrived at.
//
// The deal it makes explicit: the PROCESS is not graded, the RESULT is. A
// learner who guesses 112 passes; that is accepted, deliberately, as the
// price of being able to grade external work at all.
//
// Same boundaries the other mechanics obey:
//   - `expected` values are the answers to the exercise and never leave the
//     backend. The client learns one boolean per field — not the right
//     value, not how far off it was, not even which direction;
//   - the comparison is DECLARATIVE and owned by the core. A course
//     contributes labels, kinds, expected values and a tolerance; never
//     code (project invariant: "произвольный код-грейдер в составе курса
//     запрещён").
//
// Nothing in this module touches a database — it is pure, and the route
// calls it with the lesson's own fields.

import type { CourseAnswerField } from "../../../courses/types.js";

/** One field's verdict. Deliberately just a boolean: see the header. */
export interface AnswerFieldVerdict {
  readonly correct: boolean;
}

export interface AnswerVerdict {
  /** True only when EVERY declared field is correct — that is what
   * completes the lesson. */
  readonly ok: boolean;
  /** One entry per DECLARED field, in declaration order, whether or not
   * the submission carried an answer for it: the client renders the form
   * from this, and a field the learner left blank must be marked, not
   * silently missing. */
  readonly fields: Readonly<Record<string, AnswerFieldVerdict>>;
}

/**
 * Grades a submission against the assignment's fields.
 *
 * `answers` is the raw `{ fieldId: string }` map from the request body —
 * every value is a string, because that is what a form produces and
 * because parsing "18,5" is this module's job, not the client's. Keys that
 * match no declared field are ignored: the assignment's own field list is
 * the authority on what is being graded, and a stray key is not a reason
 * to reject an otherwise complete submission.
 */
export function gradeAnswers(
  fields: readonly CourseAnswerField[],
  answers: Readonly<Record<string, string>>,
): AnswerVerdict {
  const verdicts: Record<string, AnswerFieldVerdict> = {};
  let ok = true;

  for (const field of fields) {
    const correct = isFieldCorrect(field, answers[field.id]);
    verdicts[field.id] = { correct };
    ok = ok && correct;
  }

  return { ok, fields: verdicts };
}

function isFieldCorrect(field: CourseAnswerField, submitted: string | undefined): boolean {
  if (submitted === undefined) {
    // Left blank (or never sent). Not an error — an unfinished assignment.
    return false;
  }
  return field.kind === "number"
    ? isNumberCorrect(field, submitted)
    : isTextCorrect(String(field.expected), submitted);
}

function isNumberCorrect(field: CourseAnswerField, submitted: string): boolean {
  const value = parseAnswerNumber(submitted);
  if (value === undefined || typeof field.expected !== "number") {
    return false;
  }
  // `tolerance` is normalized to a present number for every numeric field
  // (courses/validate.ts); the `?? 0` is for a hand-built field in a test.
  return Math.abs(value - field.expected) <= (field.tolerance ?? 0);
}

/**
 * Compares a text answer: trimmed, case-insensitive.
 *
 * Also Unicode-normalized to NFC on both sides. That is not cosmetic: text
 * pasted out of a macOS spreadsheet routinely arrives decomposed ("й" as
 * "и" + combining breve), which is a different string from the composed
 * one a course author typed even though the two are indistinguishable on
 * screen. Marking that wrong would be the comparator's bug, not a wrong
 * answer.
 *
 * Nothing else is normalized — inner whitespace and punctuation are
 * compared as written. A course that wants to accept variants states them
 * in the prompt; the core does not guess at synonyms.
 */
function isTextCorrect(expected: string, submitted: string): boolean {
  return normalizeText(submitted) === normalizeText(expected);
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

/**
 * Reads a number the way a person types one, returning `undefined` when
 * the text is not a number at all (which grades as incorrect — a typo is a
 * wrong answer, not an API error).
 *
 * What is accepted, and why:
 *   - a comma as the decimal separator ("18,5"). This is the Russian
 *     convention and what a local spreadsheet produces;
 *   - spaces as thousands separators ("1 234"), INCLUDING the no-break and
 *     narrow no-break spaces — copying a formatted cell out of Excel gives
 *     U+00A0, not U+0020, and rejecting a pasted correct answer over an
 *     invisible character would be indefensible;
 *   - both separators at once, in either convention ("1,234.56" and
 *     "1.234,56"): whichever of "," / "." comes LAST is the decimal
 *     separator and the earlier ones are thousands separators. There is no
 *     way to read those two strings differently, so there is no reason to
 *     make the learner guess which one this app wants.
 *
 * What is not: exponent notation, currency symbols, percent signs. The
 * prompt states the unit; the answer is a number.
 */
export function parseAnswerNumber(raw: string): number | undefined {
  // \s covers U+00A0 and U+202F in JS regexes (both are Unicode spaces).
  const compact = raw.replace(/\s/gu, "");
  if (compact === "") {
    return undefined;
  }

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized: string;
  if (lastComma === -1) {
    normalized = compact;
  } else if (lastComma > lastDot) {
    // "1.234,56" / "18,5" — the comma is the decimal point, any dots
    // before it are thousands separators.
    normalized = compact.slice(0, lastComma).replaceAll(".", "") + "." + compact.slice(lastComma + 1);
  } else {
    // "1,234.56" — the dot is the decimal point, the commas are grouping.
    normalized = compact.replaceAll(",", "");
  }

  // Deliberately stricter than `Number()`, which happily reads "0x10",
  // "1e3", "Infinity" and "" as numbers.
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(normalized)) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
