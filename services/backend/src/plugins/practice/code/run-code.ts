// One attempt at a `code` assignment, independent of HTTP: get the
// reference for every case, run the learner's code, grade case by case.
//
// The reference comes first — the author's solution runs before the
// learner's module. Technically unnecessary here (separate processes),
// but it is the one rule the engine has for every mechanic ("эталон
// снимается до ученика"), and a rule with exceptions is two rules.

import type { CourseCodePractice } from "../../../courses/types.js";
import { encodeValue, valuesEqual, type EncodedValue } from "./compare.js";
import { CodeRunnerUnavailableError, CodeSolutionError } from "./errors.js";
import { CODE_TIMEOUT_SECONDS } from "./limits.js";
import type { CodeCaseOutcome, CodeErrorInfo, CodeRunner, CodeRunResult } from "./run-node.js";

/** A run whose "node could not start" outcome has already been turned
 * into `CodeRunnerUnavailableError` — the route never sees that kind. */
export type CodeRunOutcome = Exclude<CodeRunResult, { kind: "unavailable" }>;

export interface CodeCaseVerdict {
  readonly args: readonly unknown[];
  readonly passed: boolean;
  /** The LEARNER's own return value — never the reference. */
  readonly value?: EncodedValue;
  readonly error?: CodeErrorInfo;
  readonly output: string;
  readonly truncated: boolean;
}

export interface CodePracticeAttemptResult {
  readonly run: CodeRunOutcome;
  /** One verdict per declared case, in manifest order. */
  readonly cases: readonly CodeCaseVerdict[];
  readonly allPassed: boolean;
}

export async function runCodePracticeAttempt(
  runner: CodeRunner,
  practice: CourseCodePractice,
  code: string,
): Promise<CodePracticeAttemptResult> {
  const cases = practice.cases.map((c) => c.args);
  const references = await resolveReferences(runner, practice, cases);

  const run = await runner.run({ language: practice.language, code, entry: practice.entry, cases });
  if (run.kind === "unavailable") {
    throw new CodeRunnerUnavailableError(`Code practice cannot run: ${run.message}.`);
  }

  const outcomes: readonly CodeCaseOutcome[] = run.kind === "ran" || run.kind === "timeout" ? run.cases : [];
  const verdicts = practice.cases.map((declared, index): CodeCaseVerdict => {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      // Never reached (timeout, crash, or the run never started).
      return { args: declared.args, passed: false, output: "", truncated: false };
    }
    if (outcome.error !== undefined) {
      return {
        args: declared.args,
        passed: false,
        error: outcome.error,
        output: outcome.output,
        truncated: outcome.truncated,
      };
    }
    return {
      args: declared.args,
      passed: outcome.value !== undefined && valuesEqual(outcome.value, references[index] ?? null),
      value: outcome.value,
      output: outcome.output,
      truncated: outcome.truncated,
    };
  });

  return { run, cases: verdicts, allPassed: run.kind === "ran" && verdicts.every((v) => v.passed) };
}

/**
 * The encoded reference of every case: the case's own `expected` when it
 * has one, otherwise what the solution returned for the same arguments.
 * The solution runs whenever it is declared — a broken solution is broken
 * course content even on a case that happens to carry its own `expected`.
 */
async function resolveReferences(
  runner: CodeRunner,
  practice: CourseCodePractice,
  cases: readonly (readonly unknown[])[],
): Promise<readonly EncodedValue[]> {
  let solutionOutcomes: readonly CodeCaseOutcome[] | undefined;
  if (practice.solution !== undefined) {
    const run = await runner.run({ language: practice.language, code: practice.solution, entry: practice.entry, cases });
    if (run.kind === "unavailable") {
      throw new CodeRunnerUnavailableError(`Code practice cannot run: ${run.message}.`);
    }
    if (run.kind !== "ran") {
      throw new CodeSolutionError(`The solution of this assignment could not be run: ${describeFailure(run)}.`);
    }
    run.cases.forEach((outcome, index) => {
      if (outcome.error !== undefined) {
        throw new CodeSolutionError(
          `The solution of this assignment threw on case ${index + 1}: ${outcome.error.message}.`,
        );
      }
    });
    solutionOutcomes = run.cases;
  }

  return practice.cases.map((declared, index) => {
    if (declared.reference.kind === "expected") {
      return encodeValue(declared.reference.value);
    }
    const value = solutionOutcomes?.[index]?.value;
    if (value === undefined) {
      // validate.ts guarantees a `solution` exists for such a case; a
      // solution that returned fewer outcomes than cases would be a
      // harness bug, reported as broken content rather than swallowed.
      throw new CodeSolutionError(`The solution of this assignment produced no value for case ${index + 1}.`);
    }
    return value;
  });
}

/** Why a run did not reach `ran`, in one clause — node's own words where
 * it has any. Shared by the solution error above and the route's
 * `failure.message` for the learner. */
export function describeFailure(run: Exclude<CodeRunOutcome, { kind: "ran" }>): string {
  switch (run.kind) {
    case "load_failed":
      return run.error.stack ?? run.error.message;
    case "entry_missing":
      return `no function is exported under the expected name (exported: ${run.exported.join(", ") || "nothing"})`;
    case "timeout":
      return `the run exceeded ${CODE_TIMEOUT_SECONDS} seconds and was stopped`;
    case "crashed":
      return `the process exited unexpectedly (${run.signal ?? `code ${run.exitCode}`})${
        run.stderr.trim() === "" ? "" : `: ${run.stderr.trim()}`
      }`;
  }
}
