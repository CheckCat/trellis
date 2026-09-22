// `npm run course:lint -- courses/<id>` — review a course package's plan.
//
// Needs no running stack, no database and no sandbox: it reads two files
// off disk and the capability registry compiled into this build. That is a
// requirement, not an accident — the lint is meant to run in the middle of
// writing a course, and on a skeleton whose lessons are still empty.
//
// Exit codes: 0 when there are no errors (warnings alone do not fail — a
// warning that can block a build gets silenced instead of read), 1 when
// the course has errors, 2 when the command itself could not be carried
// out (no such directory, unusable manifest).

import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadCoursePackage } from "./courses/loader.js";
import { lintCourse, type LintFinding } from "./lint/course.js";
import { loadSkillsDocument, SKILLS_FILE_NAME } from "./lint/skills.js";

export interface LintedPackage {
  readonly dir: string;
  readonly findings: readonly LintFinding[];
  /** `false` when the package could not be linted at all (bad manifest,
   * unusable skills.yaml) — distinct from "linted, found errors". */
  readonly linted: boolean;
}

/**
 * Lints one package directory. Never throws: a package that cannot be read
 * comes back as findings, so linting several packages does not stop at the
 * first broken one.
 */
export function lintPackage(dir: string): LintedPackage {
  const loaded = loadCoursePackage(dir);
  if (!loaded.ok) {
    return {
      dir,
      linted: false,
      findings: loaded.errors.map((error) => ({
        severity: "error" as const,
        rule: "manifest-invalid",
        path: error.path,
        message: error.message,
      })),
    };
  }

  const skills = loadSkillsDocument(dir);
  if (skills.kind === "invalid") {
    return {
      dir,
      linted: false,
      findings: skills.errors.map((error) => ({
        severity: "error" as const,
        rule: "skills-invalid",
        path: error.path === "" ? SKILLS_FILE_NAME : `skills.${error.path}`,
        message: error.message,
      })),
    };
  }

  return {
    dir,
    linted: true,
    findings: lintCourse(loaded.course, skills.kind === "ok" ? { skills: skills.skills } : {}),
  };
}

/** One finding, as a line. `severity path rule: message` — greppable, and
 * the path comes early because it is what a reader scans for. */
export function formatFinding(finding: LintFinding): string {
  const label = finding.severity === "error" ? "ERROR" : "WARN ";
  const where = finding.path === "" ? "" : ` ${finding.path}`;
  return `  ${label}${where} [${finding.rule}] ${finding.message}`;
}

export interface LintRunResult {
  readonly errors: number;
  readonly warnings: number;
  readonly lines: readonly string[];
}

/** Runs the lint over every given directory and renders the report. Pure
 * apart from reading the packages, so the tests assert on the same output
 * a user sees. */
export function runLint(dirs: readonly string[]): LintRunResult {
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;

  for (const dir of dirs) {
    const result = lintPackage(dir);
    const own = { errors: 0, warnings: 0 };
    for (const finding of result.findings) {
      if (finding.severity === "error") {
        own.errors += 1;
      } else {
        own.warnings += 1;
      }
    }
    errors += own.errors;
    warnings += own.warnings;

    lines.push(`${dir}: ${own.errors} error(s), ${own.warnings} warning(s)`);
    for (const finding of result.findings) {
      lines.push(formatFinding(finding));
    }
    if (!result.linted) {
      lines.push(`  (the package could not be linted — fix the above first)`);
    }
  }

  return { errors, warnings, lines };
}

function main(argv: readonly string[]): void {
  const args = argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("usage: npm run course:lint -- courses/<id> [courses/<id> ...]\n");
    process.exitCode = 2;
    return;
  }

  // Paths are relative to where the USER typed the command, not to this
  // workspace: npm runs a workspace script with the package as cwd, and
  // sets INIT_CWD to the directory the command was invoked from.
  const base = process.env.INIT_CWD ?? process.cwd();
  const dirs = args.map((arg) => path.resolve(base, arg));

  const result = runLint(dirs);
  process.stdout.write(`${result.lines.join("\n")}\n`);
  process.exitCode = result.errors > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main(process.argv);
}
