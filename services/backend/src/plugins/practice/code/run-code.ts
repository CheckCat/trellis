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
    const reference = references[index];
    if (reference === undefined) {
      // One reference per declared case is built below; anything else is
      // a bug here, and a bug must not grade as "returned null".
      throw new Error(`No reference for case ${index + 1} of "${practice.entry}".`);
    }
    return {
      args: declared.args,
      passed: outcome.value !== undefined && valuesEqual(outcome.value, reference),
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
      // A fixed sentence per kind for the client; node's words — which
      // quote source lines — only for the log (see CodeSolutionError).
      throw new CodeSolutionError(
        `The solution of this assignment could not be run (${SOLUTION_FAILURE_SENTENCE[run.kind]}). ` +
          "This is a problem with the course, not with your code.",
        describeFailure(run, practice.entry),
      );
    }
    run.cases.forEach((outcome, index) => {
      if (outcome.error !== undefined) {
        throw new CodeSolutionError(
          `The solution of this assignment threw on case ${index + 1}. This is a problem with the course, not with your code.`,
          outcome.error.stack ?? outcome.error.message,
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
      throw new CodeSolutionError(
        `The solution of this assignment produced no value for case ${index + 1}. This is a problem with the course, not with your code.`,
        "no outcome in the solution run",
      );
    }
    return value;
  });
}

const SOLUTION_FAILURE_SENTENCE: Record<Exclude<CodeRunOutcome["kind"], "ran">, string> = {
  load_failed: "the module did not load",
  entry_missing: "no function is exported under the expected name",
  timeout: `the run exceeded ${CODE_TIMEOUT_SECONDS} seconds`,
  crashed: "the process exited unexpectedly",
};

/**
 * Why the LEARNER's run did not reach `ran`, as shown to them: the
 * engine's own sentences in the learner's language, node's own text where
 * node has any (a syntax error, a crash) — the same rule the sql kind
 * applies to Postgres errors.
 */
export function describeFailure(run: Exclude<CodeRunOutcome, { kind: "ran" }>, entry: string): string {
  switch (run.kind) {
    case "load_failed":
      return run.error.stack ?? run.error.message;
    case "entry_missing":
      return (
        `Модуль не экспортирует функцию с именем «${entry}» (или под этим именем экспортирована не функция). ` +
        `Экспортировано: ${run.exported.join(", ") || "ничего"}.`
      );
    case "timeout":
      return `Выполнение превысило ${CODE_TIMEOUT_SECONDS} с и было остановлено.`;
    case "crashed":
      return `Процесс завершился аварийно (${run.signal ?? `код ${run.exitCode}`}).${
        run.stderr.trim() === "" ? "" : `\n${run.stderr.trim()}`
      }`;
  }
}
