// Reviewing a course's SKELETON: does the plan hold together, and can this
// engine actually check what the plan says it checks?
//
// None of this is knowledge about a particular course — which is exactly
// why it lives in the repository as a tool instead of in an author's head.
// The rules answer three questions a generator cannot answer for itself:
//
//   1. Is the plan complete and consistent? Every lesson accounted for,
//      every prerequisite earlier than the thing that needs it, no rings.
//   2. Does the plan match the content? A lesson planned as `quiz` must
//      have a quiz; one planned as `sql-result` must carry an `expected`.
//   3. Can the engine run it? The mechanic a `verify` names has to be
//      registered in the capability registry — a plan that assumes a
//      mechanic this build does not have is a plan that cannot ship.
//
// Nothing here touches a database, a sandbox or a running server: the
// input is a loaded course package plus its skills map.
//
// Errors vs warnings: an ERROR means the course as planned is wrong or
// unrunnable; a WARNING means it is probably badly paced. The exit code
// follows errors only — a warning must never be able to block a build,
// or authors will start silencing it.

import { CAPABILITIES, type EngineCapabilities } from "../capabilities.js";
import type { Course, CourseLesson, CourseModule } from "../courses/types.js";
import type { SkillsDocument, SkillsLessonEntry, VerifyKind } from "./skills.js";

export type LintSeverity = "error" | "warning";

export interface LintFinding {
  readonly severity: LintSeverity;
  /** Stable machine-readable rule id, so a generator can react to a
   * specific finding instead of matching on prose. */
  readonly rule: string;
  /**
   * Where the problem is. A MANIFEST coordinate (`modules[1].lessons[3]`)
   * whenever the thing exists there — that is the file an author fixes
   * most often, and the notation courses/validate.ts already uses.
   * Otherwise a skills.yaml coordinate, prefixed `skills.` to say so
   * (`skills.lessons[2].requires[0]`).
   */
  readonly path: string;
  readonly message: string;
}

export interface LintCourseOptions {
  /** `undefined` when the package has no skills.yaml: the plan rules are
   * skipped and only the content-shaped warnings run. */
  readonly skills?: SkillsDocument;
  /**
   * Findings about `verify` not matching the manifest are downgraded to
   * warnings for a course whose own version carries the `skeleton`
   * prerelease identifier (`0.1.0-skeleton`) — the plan is written before
   * the content, and the whole point of linting a skeleton is to review
   * the plan while the lessons are still empty. Defaults to reading the
   * course's own version.
   */
  readonly skeleton?: boolean;
  /**
   * The engine's capability registry, which `verify-unsupported` checks a
   * plan against. Defaults to this build's own
   * (`CAPABILITIES` — the same object docs/contracts/capabilities.json is
   * generated from, which CI proves identical, so the lint needs neither
   * file IO nor a parse that could itself fail).
   *
   * Injectable so a test can ask the question the rule exists for: what
   * happens to a course planned around a mechanic the engine does not
   * have? With the shipped registry every `verify` value is supported by
   * construction, and the rule would be unreachable.
   */
  readonly capabilities?: EngineCapabilities;
}

/** How many lessons in a row with nothing to do before the pacing warning
 * fires. Four is "a whole sitting of reading" — see the rule below. */
export const MAX_LESSONS_WITHOUT_CHECKS = 3;

/** One lesson of the course, flattened into reading order with the
 * coordinates a finding needs. */
interface PositionedLesson {
  readonly lesson: CourseLesson;
  readonly module: CourseModule;
  readonly moduleIndex: number;
  readonly lessonIndex: number;
  /** Position in the whole course, which is what "earlier" means. */
  readonly order: number;
  readonly path: string;
}

/**
 * Runs every rule and returns the findings in a stable order (errors are
 * NOT sorted ahead of warnings — findings come out grouped by rule, so a
 * diff of two lint runs is readable).
 */
export function lintCourse(course: Course, options: LintCourseOptions = {}): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const lessons = flattenLessons(course);
  const skeleton = options.skeleton ?? isSkeletonVersion(course.version);

  // Pacing rules need no plan at all — they read the manifest. Running
  // them for a package without skills.yaml is what makes the lint useful
  // before a plan exists.
  checkPacing(lessons, course, findings);
  checkQuizExplanations(lessons, findings);
  checkStrictGrading(lessons, findings);

  const skills = options.skills;
  if (skills === undefined) {
    return findings;
  }

  const byId = new Map(lessons.map((entry) => [entry.lesson.id, entry]));
  const planned = checkLessonCoverage(skills, lessons, byId, findings);
  checkLessonPrerequisites(planned, byId, findings);
  checkSkills(skills, planned, byId, findings);
  checkVerify(planned, byId, skeleton, options.capabilities ?? CAPABILITIES, findings);
  checkBudgets(skills, planned, course, findings);

  return findings;
}

/** `0.1.0-skeleton` — a course whose structure is agreed but whose lessons
 * are not written yet. Read off the semver prerelease, so `1.2.0` and
 * `2.0.0-rc.1` are both ordinary courses. */
export function isSkeletonVersion(version: string): boolean {
  const prerelease = /^[^-+]+-([^+]+)/.exec(version)?.[1];
  return prerelease !== undefined && prerelease.split(".").includes("skeleton");
}

function flattenLessons(course: Course): readonly PositionedLesson[] {
  const result: PositionedLesson[] = [];
  course.modules.forEach((module, moduleIndex) => {
    module.lessons.forEach((lesson, lessonIndex) => {
      result.push({
        lesson,
        module,
        moduleIndex,
        lessonIndex,
        order: result.length,
        path: `modules[${moduleIndex}].lessons[${lessonIndex}]`,
      });
    });
  });
  return result;
}

/** A planned lesson that was matched to a real one, carrying both sides'
 * coordinates. Rules below only ever see matched pairs — an unmatched plan
 * entry has already been reported and cannot be reasoned about. */
interface PlannedLesson {
  readonly entry: SkillsLessonEntry;
  readonly at: PositionedLesson;
  /** Index in `skills.lessons`, for findings about the PLAN. */
  readonly planIndex: number;
}

/** E: the two lists must cover each other exactly — a lesson missing from
 * the plan is an unreviewed lesson, and a plan entry naming nothing is a
 * rule that silently never runs. */
function checkLessonCoverage(
  skills: SkillsDocument,
  lessons: readonly PositionedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  findings: LintFinding[],
): readonly PlannedLesson[] {
  const planned: PlannedLesson[] = [];
  const seen = new Map<string, number>();

  skills.lessons.forEach((entry, planIndex) => {
    const at = byId.get(entry.id);
    if (at === undefined) {
      findings.push({
        severity: "error",
        rule: "lesson-unknown",
        path: `skills.lessons[${planIndex}].id`,
        message: `Lesson "${entry.id}" is planned here but does not exist in manifest.yaml.`,
      });
      return;
    }
    const first = seen.get(entry.id);
    if (first !== undefined) {
      findings.push({
        severity: "error",
        rule: "lesson-duplicated",
        path: `skills.lessons[${planIndex}].id`,
        message: `Lesson "${entry.id}" is planned twice (also at skills.lessons[${first}]) — which entry applies would be undefined.`,
      });
      return;
    }
    seen.set(entry.id, planIndex);
    planned.push({ entry, at, planIndex });
  });

  for (const at of lessons) {
    if (!seen.has(at.lesson.id)) {
      findings.push({
        severity: "error",
        rule: "lesson-undocumented",
        path: at.path,
        message: `Lesson "${at.lesson.id}" is in manifest.yaml but not in ${"skills.yaml"} — every lesson must state how it is verified.`,
      });
    }
  }

  return planned;
}

/** E: a prerequisite must be a real lesson, and it must come earlier. */
function checkLessonPrerequisites(
  planned: readonly PlannedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  findings: LintFinding[],
): void {
  for (const { entry, at } of planned) {
    (entry.requires ?? []).forEach((requiredId, index) => {
      const required = byId.get(requiredId);
      if (required === undefined) {
        findings.push({
          severity: "error",
          rule: "lesson-requires-unknown",
          path: at.path,
          message: `Lesson "${entry.id}" requires "${requiredId}", which is not a lesson of this course.`,
        });
        return;
      }
      if (required.order >= at.order) {
        findings.push({
          severity: "error",
          rule: "lesson-requires-order",
          path: at.path,
          message:
            requiredId === entry.id
              ? `Lesson "${entry.id}" requires itself.`
              : `Lesson "${entry.id}" requires "${requiredId}", which comes later in manifest.yaml (${required.path}) — a prerequisite has to be taught first.`,
        });
      }
      void index;
    });
  }

  reportCycles(planned, findings);
}

/**
 * E: a ring of prerequisites. Reported separately from the ordering rule
 * even though every ring contains at least one forward edge, because the
 * two say different things: one says "move this lesson", the other says
 * "there is no order that would satisfy this at all".
 *
 * Plain iterative DFS over the plan's own graph — courses hold tens of
 * lessons, so the cost of finding every ring is irrelevant, and reporting
 * the ring itself (rather than "a cycle exists") is what makes it fixable.
 */
function reportCycles(planned: readonly PlannedLesson[], findings: LintFinding[]): void {
  const requires = new Map<string, readonly string[]>(planned.map((p) => [p.entry.id, p.entry.requires ?? []]));
  const pathOf = new Map<string, string>(planned.map((p) => [p.entry.id, p.at.path]));
  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();

  const walk = (id: string, stack: string[]): void => {
    const seenAt = stack.indexOf(id);
    if (seenAt !== -1) {
      const ring = [...stack.slice(seenAt), id];
      // One finding per ring, keyed on its members, whichever node the
      // walk happened to enter it from.
      const key = [...ring.slice(0, -1)].sort().join(">");
      if (!reported.has(key)) {
        reported.add(key);
        findings.push({
          severity: "error",
          rule: "lesson-requires-cycle",
          path: pathOf.get(ring[0] ?? "") ?? "",
          message: `Lessons require each other in a cycle: ${ring.join(" -> ")}. No lesson order can satisfy this.`,
        });
      }
      return;
    }
    if (state.get(id) === "done") {
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of requires.get(id) ?? []) {
      if (requires.has(next)) {
        walk(next, stack);
      }
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const { entry } of planned) {
    walk(entry.id, []);
  }
}

/** E: every skill is taught by someone, every reference resolves, and a
 * skill's own prerequisites are taught before it. */
function checkSkills(
  skills: SkillsDocument,
  planned: readonly PlannedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  findings: LintFinding[],
): void {
  const declared = new Map((skills.skills ?? []).map((skill, index) => [skill.id, index]));

  // Where in the course each skill first appears. A skill taught by
  // several lessons is fine — the first one is when the learner has it.
  const firstTaught = new Map<string, PositionedLesson>();
  for (const { entry, at } of planned) {
    for (const skillId of entry.teaches ?? []) {
      if (!declared.has(skillId)) {
        findings.push({
          severity: "error",
          rule: "skill-unknown",
          path: at.path,
          message: `Lesson "${entry.id}" teaches "${skillId}", which is not declared in skills[].`,
        });
        continue;
      }
      const known = firstTaught.get(skillId);
      if (known === undefined || at.order < known.order) {
        firstTaught.set(skillId, at);
      }
    }
  }

  (skills.skills ?? []).forEach((skill, index) => {
    if (!firstTaught.has(skill.id)) {
      findings.push({
        severity: "error",
        rule: "skill-not-taught",
        path: `skills.skills[${index}].id`,
        message: `Skill "${skill.id}" is declared but no lesson teaches it.`,
      });
    }
    (skill.requires ?? []).forEach((requiredId, requireIndex) => {
      const path = `skills.skills[${index}].requires[${requireIndex}]`;
      if (!declared.has(requiredId)) {
        findings.push({
          severity: "error",
          rule: "skill-requires-unknown",
          path,
          message: `Skill "${skill.id}" requires "${requiredId}", which is not declared in skills[].`,
        });
        return;
      }
      const prerequisite = firstTaught.get(requiredId);
      const dependent = firstTaught.get(skill.id);
      if (prerequisite === undefined || dependent === undefined) {
        // One of the two is never taught — already reported above, and
        // "earlier than nowhere" is not a question worth answering.
        return;
      }
      if (prerequisite.order >= dependent.order) {
        findings.push({
          severity: "error",
          rule: "skill-requires-order",
          path,
          message:
            requiredId === skill.id
              ? `Skill "${skill.id}" requires itself.`
              : `Skill "${skill.id}" requires "${requiredId}", but "${requiredId}" is first taught at ${prerequisite.path} — not before "${skill.id}" at ${dependent.path}.`,
        });
      }
    });
  });

  void byId;
}

/** What each `verify` promises: the practice type and the grading mechanic
 * of capabilities.ts that has to be registered for it to be runnable. */
const VERIFY_MECHANICS: Readonly<Record<VerifyKind, { practiceType?: string; mechanic?: string }>> = {
  quiz: {},
  "sql-state": { practiceType: "sql", mechanic: "check" },
  "sql-result": { practiceType: "sql", mechanic: "expected" },
  answer: { practiceType: "answer", mechanic: "fields" },
  self: {},
};

/**
 * E: `verify` has to be something this engine can do, and has to match
 * what the lesson actually contains.
 *
 * The two halves are separate rules on purpose. "The engine has no such
 * mechanic" is never downgraded — a build either has it or does not,
 * whether or not the content is written. "The lesson doesn't contain it
 * yet" IS downgraded for a skeleton, which is the whole reason a skeleton
 * can be reviewed at all.
 */
function checkVerify(
  planned: readonly PlannedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  skeleton: boolean,
  capabilities: EngineCapabilities,
  findings: LintFinding[],
): void {
  for (const { entry, at } of planned) {
    const required = VERIFY_MECHANICS[entry.verify];
    if (required.practiceType !== undefined) {
      const capability = capabilities.practiceTypes.find((candidate) => candidate.type === required.practiceType);
      const mechanic = capability?.mechanics.some((candidate) => candidate.name === required.mechanic);
      if (capability === undefined || mechanic !== true) {
        findings.push({
          severity: "error",
          rule: "verify-unsupported",
          path: at.path,
          message:
            `Lesson "${entry.id}" is verified as "${entry.verify}", which needs the "${required.mechanic}" mechanic of ` +
            `practice type "${required.practiceType}" — this engine does not register it ` +
            `(see docs/contracts/capabilities.json).`,
        });
        continue;
      }
    }

    const actual = describeActualVerification(at.lesson);
    if (actual.includes(entry.verify)) {
      continue;
    }
    findings.push({
      // A skeleton's lessons are deliberately empty — the plan is the
      // thing under review, and holding it to content nobody has written
      // yet would make the whole exercise impossible.
      severity: skeleton ? "warning" : "error",
      rule: "verify-mismatch",
      path: at.path,
      message:
        `Lesson "${entry.id}" is planned as "${entry.verify}", but the manifest gives it ` +
        `${actual.length === 0 ? "no verification the engine recognizes" : actual.map((kind) => `"${kind}"`).join(", ")}.` +
        (skeleton ? " (Warning only: this course's version is a skeleton.)" : ""),
    });
  }

  void byId;
}

/** Every `verify` value the lesson's actual content would satisfy. A
 * lesson may satisfy more than one (a `sql` practice carrying both a
 * `check` and an `expected`), and any of them is a correct plan. */
function describeActualVerification(lesson: CourseLesson): readonly VerifyKind[] {
  const kinds: VerifyKind[] = [];
  if (lesson.quiz !== undefined) {
    kinds.push("quiz");
  }
  const practice = lesson.practice;
  if (practice !== undefined) {
    if (practice.type === "answer") {
      kinds.push("answer");
    } else {
      if (practice.check !== undefined || practice.solution !== undefined) {
        // Both mechanics answer "did the database end up right": `check`
        // by a predicate the author wrote, `solution` by comparing the
        // whole state. A plan that says "sql-state" is satisfied by
        // either, and the plan is not the place to pick between them.
        kinds.push("sql-state");
      }
      if (practice.expected !== undefined) {
        kinds.push("sql-result");
      }
    }
  }
  if (kinds.length === 0) {
    // Nothing the engine grades — which is exactly what `self` claims.
    kinds.push("self");
  }
  return kinds;
}

/** W: pacing. Neither of these makes a course wrong; both make it worse to
 * sit through, and neither is visible by reading one lesson at a time —
 * which is why a tool is the right place for them. */
/**
 * W: a wrong quiz option should say WHY it is wrong.
 *
 * The engine cannot require this — `explanation` is optional in the
 * manifest schema and a course without it is perfectly runnable, which is
 * why this is a warning and not an error. But a quiz that answers "Неверно"
 * and nothing else teaches nothing: the learner who picked that option did
 * so for a reason, and the one sentence explaining the reason is the only
 * part of the quiz that does any teaching. This rule is where that rule of
 * authorship lives, since it cannot live in the type system.
 *
 * Correct options are not checked: an explanation there is welcome but
 * optional — being right is already the feedback.
 */
function checkQuizExplanations(lessons: readonly PositionedLesson[], findings: LintFinding[]): void {
  for (const at of lessons) {
    const quiz = at.lesson.quiz;
    if (quiz === undefined) {
      continue;
    }
    quiz.options.forEach((option, optionIndex) => {
      if (option.correct || option.explanation !== undefined) {
        return;
      }
      findings.push({
        severity: "warning",
        rule: "quiz-wrong-option-without-explanation",
        path: `${at.path}.quiz.options[${optionIndex}]`,
        message:
          `Wrong option "${option.id}" of lesson "${at.lesson.id}" has no explanation — a learner who picks it ` +
          `is told only that they are wrong.`,
      });
    });
  }
}

/**
 * W: an exercise that changes data should be graded by its SOLUTION.
 *
 * `check` grades a predicate, and a predicate grades only what its author
 * thought to ask. The classic hole: an assignment says "mark book 1 as out
 * of stock", the check asks whether book 1 is out of stock, and
 * `update books set in_stock = false` — every row ruined — passes it.
 * Writing a check strict enough to catch that means spelling out "and
 * nothing else changed" against exact seed counts, table by table; on a
 * real course nobody does, which is why this is a rule of authorship
 * rather than a hope.
 *
 * `solution` closes it without the author thinking about it at all: the
 * engine compares the whole sandbox state. So a `check`-only assignment is
 * worth a warning — not an error, because a check-only exercise is still
 * valid and still runs, and because some conditions genuinely are
 * predicates ("no salary went negative") with no single right state.
 *
 * Assignments carrying `expected` are left alone: a SELECT exercise leaves
 * no state to compare, and `expected` is already its strict mechanic.
 */
function checkStrictGrading(lessons: readonly PositionedLesson[], findings: LintFinding[]): void {
  for (const at of lessons) {
    const practice = at.lesson.practice;
    if (practice === undefined || practice.type !== "sql") {
      continue;
    }
    if (practice.check === undefined || practice.solution !== undefined || practice.expected !== undefined) {
      continue;
    }
    findings.push({
      severity: "warning",
      rule: "practice-check-without-solution",
      path: `${at.path}.practice.check`,
      message:
        `Lesson "${at.lesson.id}" is graded by "check" alone — a predicate passes any attempt that satisfies ` +
        `it, including one that changed rows the assignment never mentioned. Add "solution" (the author's own ` +
        `SQL) to have the engine compare the whole resulting state instead.`,
    });
  }
}

function checkPacing(lessons: readonly PositionedLesson[], course: Course, findings: LintFinding[]): void {
  let runStart: PositionedLesson | undefined;
  let run = 0;
  const flush = (): void => {
    if (run > MAX_LESSONS_WITHOUT_CHECKS && runStart !== undefined) {
      findings.push({
        severity: "warning",
        rule: "long-stretch-without-checks",
        path: runStart.path,
        message: `${run} lessons in a row carry neither a quiz nor a practice assignment, starting at "${runStart.lesson.id}".`,
      });
    }
    runStart = undefined;
    run = 0;
  };

  for (const at of lessons) {
    if (at.lesson.quiz === undefined && at.lesson.practice === undefined) {
      runStart ??= at;
      run += 1;
    } else {
      flush();
    }
  }
  flush();

  course.modules.forEach((module, moduleIndex) => {
    const hasCheck = module.lessons.some((lesson) => lesson.quiz !== undefined || lesson.practice !== undefined);
    if (!hasCheck) {
      findings.push({
        severity: "warning",
        rule: "module-without-checks",
        path: `modules[${moduleIndex}]`,
        message: `Module "${module.id}" has no quiz and no practice at all — nothing in it can be verified.`,
      });
    }
  });
}

/** W: planned hours over the module's declared budget. E: a budget for a
 * module that does not exist, which is a budget that silently never
 * applies. */
function checkBudgets(
  skills: SkillsDocument,
  planned: readonly PlannedLesson[],
  course: Course,
  findings: LintFinding[],
): void {
  const moduleIndexById = new Map(course.modules.map((module, index) => [module.id, index]));

  (skills.modules ?? []).forEach((budget, index) => {
    const moduleIndex = moduleIndexById.get(budget.id);
    if (moduleIndex === undefined) {
      findings.push({
        severity: "error",
        rule: "module-unknown",
        path: `skills.modules[${index}].id`,
        message: `Module "${budget.id}" has a budget here but does not exist in manifest.yaml — the budget would never apply.`,
      });
      return;
    }
    const hours = planned
      .filter((lesson) => lesson.at.moduleIndex === moduleIndex)
      .reduce((total, lesson) => total + (lesson.entry.hours ?? 0), 0);
    if (hours > budget.budget_hours) {
      findings.push({
        severity: "warning",
        rule: "module-over-budget",
        path: `modules[${moduleIndex}]`,
        message: `Module "${budget.id}" plans ${hours} hours against a budget of ${budget.budget_hours}.`,
      });
    }
  });
}

/** Every rule this lint can report, with the severity it reports at.
 * Exported so the tests can assert that the list in courses/README.md and
 * the rules that actually exist are the same set. */
export const LINT_RULES: readonly string[] = [
  "lesson-unknown",
  "lesson-duplicated",
  "lesson-undocumented",
  "lesson-requires-unknown",
  "lesson-requires-order",
  "lesson-requires-cycle",
  "skill-unknown",
  "skill-not-taught",
  "skill-requires-unknown",
  "skill-requires-order",
  "verify-unsupported",
  "verify-mismatch",
  "long-stretch-without-checks",
  "module-without-checks",
  "module-over-budget",
  "module-unknown",
];
