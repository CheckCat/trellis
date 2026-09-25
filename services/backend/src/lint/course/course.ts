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

import { CAPABILITIES, type EngineCapabilities } from "../../capabilities/index.js";
import type { Course, CourseLesson, CourseModule } from "../../courses/types.js";
import type { SkillsDocument, SkillsLessonEntry, TermEntry, VerifyKind } from "../skills/index.js";
import { mentions, phrasesOf, stemsOf } from "../terms/index.js";
import { analyzerFor, grantId, isKnownGrant, knownGrants } from "../features/index.js";
import { gradeAnswers } from "../../plugins/practice/answer/grade.js";

export type LintSeverity = "error" | "warning";

export interface LintFinding {
  readonly severity: LintSeverity;
  /** Stable machine-readable rule id, so a generator can react to a
   * specific finding instead of matching on prose. Typed against
   * `LINT_RULES`: a rule the list does not know about is a compile error,
   * not a surprise in someone's output. */
  readonly rule: LintRule;
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
  checkQuizGuessable(lessons, findings);
  checkStrictGrading(lessons, findings);
  checkAnswerFields(lessons, findings);
  checkPlaceholders(lessons, skeleton, findings);

  const skills = options.skills;
  if (skills === undefined) {
    return findings;
  }

  const byId = new Map(lessons.map((entry) => [entry.lesson.id, entry]));
  const planned = checkLessonCoverage(skills, lessons, byId, findings);
  checkLessonPrerequisites(planned, byId, findings);
  checkSkills(skills, planned, byId, findings);
  checkVerify(planned, byId, options.capabilities ?? CAPABILITIES, findings);
  checkBudgets(skills, planned, course, findings);
  checkTerms(skills, lessons, byId, skeleton, findings);
  checkGrants(skills, planned, byId, skeleton, findings);

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
export const VERIFY_MECHANICS: Readonly<Record<VerifyKind, { practiceType?: string; mechanic?: string }>> = {
  quiz: {},
  "sql-state": { practiceType: "sql", mechanic: "check" },
  "sql-result": { practiceType: "sql", mechanic: "expected" },
  answer: { practiceType: "answer", mechanic: "fields" },
  code: { practiceType: "code", mechanic: "cases" },
  self: {},
};

/**
 * E: `verify` has to be something this engine can do, and has to match
 * what the lesson actually contains.
 *
 * The two halves are separate rules on purpose. "The engine has no such
 * mechanic" is never downgraded — a build either has it or does not,
 * whether or not the content is written. "The lesson doesn't contain it
 * yet" IS downgraded, but only for a lesson that still says it is
 * unwritten: that is what makes a skeleton reviewable without also
 * excusing the lessons around it that are finished.
 */
function checkVerify(
  planned: readonly PlannedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
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
    const placeholder = isPlaceholderLesson(at.lesson);
    findings.push({
      // An unwritten lesson is deliberately empty — the plan is the thing
      // under review, and holding it to content nobody has written yet
      // would make the whole exercise impossible. A lesson that IS
      // written is held to the plan even while the course as a whole is
      // still a skeleton: text without the quiz it was planned to carry
      // is a half-done lesson, and saying so is the point.
      severity: placeholder ? "warning" : "error",
      rule: "verify-mismatch",
      path: at.path,
      message:
        `Lesson "${entry.id}" is planned as "${entry.verify}", but the manifest gives it ` +
        `${actual.length === 0 ? "no verification the engine recognizes" : actual.map((kind) => `"${kind}"`).join(", ")}.` +
        (placeholder ? " (Warning only: this lesson is still a placeholder.)" : ""),
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
    } else if (practice.type === "code") {
      kinds.push("code");
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

/** W: pacing. Neither of these makes a course wrong; both make it worse to
 * sit through, and neither is visible by reading one lesson at a time —
 * which is why a tool is the right place for them. */
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

/** A lesson whose text still carries this marker is a skeleton entry:
 * agreed structure, unwritten content. Matched case-insensitively at a
 * word boundary so the word can be used normally in a sentence about
 * something else. */
const PLACEHOLDER_MARKER = /(^|[^\p{L}])ЗАГЛУШКА([^\p{L}]|$)/iu;

/**
 * Is THIS lesson still unwritten?
 *
 * The finer half of `-skeleton`. The version suffix is a property of the
 * whole course, and using it to mute content rules mutes them for the
 * lessons that ARE written too — which is the situation an author is in
 * for most of the course's life: five modules done, two to go, and no way
 * to be checked on the five without lying about the two.
 *
 * So the suffix now decides only the course-wide questions ("may this
 * package still ship placeholders at all", "may the plan still have no
 * glossary"), and the per-lesson questions ask the lesson. A lesson
 * answers by carrying the marker: an explicit claim by its author, not a
 * guess from its length.
 */
function isPlaceholderLesson(lesson: CourseLesson): boolean {
  return lesson.content !== undefined && PLACEHOLDER_MARKER.test(lesson.content);
}

/** Below this many characters of prose a lesson is not an explanation.
 * Deliberately low: a short lesson is a style, an empty one is a hole. */
export const MIN_LESSON_PROSE = 400;

/** E/W: a course out of skeleton must not ship placeholder lessons.
 *
 * This is the rule that makes "the course is empty" a build failure. It
 * exists because the previous answer to an empty lesson was a human
 * noticing, and a human reviewing seventy lessons stops noticing around
 * the twentieth. */
function checkPlaceholders(lessons: readonly PositionedLesson[], skeleton: boolean, findings: LintFinding[]): void {
  for (const entry of lessons) {
    const text = entry.lesson.content;
    if (text === undefined) {
      // A lesson that is only a quiz or only an exercise declares no
      // `content` at all, so there is no text to be a placeholder.
      continue;
    }
    if (isPlaceholderLesson(entry.lesson)) {
      // "Still a placeholder" is the one question here that IS about the
      // whole package: a skeleton is allowed to be full of them, and a
      // course that dropped the suffix is not. Either way there is no
      // written text below to measure.
      if (!skeleton) {
        findings.push({
          severity: "error",
          rule: "lesson-is-placeholder",
          path: entry.path,
          message: `Lesson "${entry.lesson.id}" is still a placeholder, but this course no longer calls itself a skeleton.`,
        });
      }
      continue;
    }
    if (entry.lesson.practice !== undefined) {
      // An exercise lesson is not an explanation: its substance is the
      // assignment, and the prose above it introduces that assignment.
      // Holding it to the length of a teaching lesson would fire on every
      // practice lesson of every course, and a warning that is always on
      // is a warning nobody reads.
      continue;
    }
    const prose = text.replace(/^#.*$/gm, "").trim();
    if (prose.length < MIN_LESSON_PROSE) {
      findings.push({
        severity: "warning",
        rule: "lesson-too-short",
        path: entry.path,
        message: `Lesson "${entry.lesson.id}" has ${prose.length} characters of text — too little to explain anything.`,
      });
    }
  }
}

/** How much longer the correct option may be before the quiz is
 * guessable without knowing the answer. */
const GUESSABLE_RATIO = 1.6;
const GUESSABLE_MARGIN = 24;

/** W: the correct option must not stand out by length.
 *
 * A generated quiz tends to explain itself in the right answer and leave
 * the wrong ones curt. The learner then scores full marks by picking the
 * longest line, and the course believes it taught something. */
function checkQuizGuessable(lessons: readonly PositionedLesson[], findings: LintFinding[]): void {
  for (const entry of lessons) {
    const quiz = entry.lesson.quiz;
    if (quiz === undefined) {
      continue;
    }
    // Every correct option is held to the limit: in a multi-select quiz
    // one conspicuous right answer betrays part of the set just as surely.
    const correctOnes = quiz.options.filter((option) => option.correct === true);
    const others = quiz.options.filter((option) => option.correct !== true);
    if (correctOnes.length === 0 || others.length === 0) {
      continue;
    }
    const longestWrong = Math.max(...others.map((option) => option.text.length));
    const standout = correctOnes.find(
      (option) =>
        option.text.length >= longestWrong * GUESSABLE_RATIO &&
        option.text.length - longestWrong >= GUESSABLE_MARGIN,
    );
    if (standout !== undefined) {
      findings.push({
        severity: "warning",
        rule: "quiz-answer-guessable",
        path: `${entry.path}.quiz`,
        message: `The correct option is ${standout.text.length} characters against ${longestWrong} for the longest wrong one — it can be picked without knowing the answer.`,
      });
    }
  }
}

/** E/W: an `answer` exercise whose own reference would not pass it.
 *
 * The self-check is the cheap half: feeding `expected` back through the
 * very function that grades a learner catches a reference that cannot be
 * right. The tolerance warning is the half that matters in practice — a
 * fractional answer with an exact-equality tolerance fails everyone who
 * rounded in Excel, which is everyone. */
function checkAnswerFields(lessons: readonly PositionedLesson[], findings: LintFinding[]): void {
  for (const entry of lessons) {
    const practice = entry.lesson.practice;
    if (practice?.type !== "answer") {
      continue;
    }
    const reference: Record<string, string> = {};
    for (const field of practice.fields) {
      reference[field.id] = String(field.expected);
    }
    if (!gradeAnswers(practice.fields, reference).ok) {
      findings.push({
        severity: "error",
        rule: "answer-expected-fails-own-check",
        path: `${entry.path}.practice.fields`,
        message: "The reference answers do not pass this exercise's own grading — nobody can pass it.",
      });
    }
    practice.fields.forEach((field, index) => {
      if (field.kind !== "number" || typeof field.expected !== "number") {
        return;
      }
      if (!Number.isInteger(field.expected) && (field.tolerance ?? 0) === 0) {
        findings.push({
          severity: "warning",
          rule: "answer-number-without-tolerance",
          path: `${entry.path}.practice.fields[${index}]`,
          message: `Field "${field.id}" expects ${field.expected} exactly. A learner who rounded anywhere on the way will be told they are wrong.`,
        });
      }
    });
  }
}

/**
 * Everything of a lesson the learner reads that does NOT live in its
 * Markdown: the title, the quiz, the exercise prompt, the labels of an
 * `answer` assignment's fields.
 *
 * It matters because the defect the glossary exists to catch hides here
 * most often. An exercise lesson's Markdown can be three lines, while the
 * sentence that actually reaches the learner — "отфильтруйте строки через
 * WHERE" — sits in the manifest. Reading only the Markdown would leave the
 * single most likely place for a term-from-the-future unread.
 *
 * Quiz explanations are in: the learner sees them the moment they answer
 * wrongly. Nothing that never reaches the learner is — no `check`, no
 * `expected`, no `solution`, no `fields[].expected`. Those are the answers
 * to the exercise, and this corpus models what a learner has READ.
 */
function visibleTextOf(lesson: CourseLesson): string {
  const parts: string[] = [lesson.title];
  const quiz = lesson.quiz;
  if (quiz !== undefined) {
    parts.push(quiz.question);
    for (const option of quiz.options) {
      parts.push(option.text);
      if (option.explanation !== undefined) {
        parts.push(option.explanation);
      }
    }
  }
  const practice = lesson.practice;
  if (practice !== undefined) {
    parts.push(practice.prompt);
    if (practice.type === "answer") {
      for (const field of practice.fields) {
        parts.push(field.label);
      }
    }
  }
  return parts.join("\n\n");
}

/** E/W: the course's own vocabulary, held to reading order.
 *
 * The rule a non-technical course needs most: module 1 using "eNPS" as if
 * it were common knowledge is the same defect as an exercise needing
 * WHERE before WHERE is taught. What it can prove is narrow but exact —
 * the WORD appears in a lesson earlier than the lesson that owns it.
 * Leaning on a concept without naming it stays invisible to it, and
 * stays the author's job. */
function checkTerms(
  skills: SkillsDocument,
  lessons: readonly PositionedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  skeleton: boolean,
  findings: LintFinding[],
): void {
  const terms = skills.terms ?? [];
  if (terms.length === 0) {
    if (!skeleton && lessons.length > 0) {
      findings.push({
        severity: "warning",
        rule: "course-without-glossary",
        path: "skills.terms",
        message:
          "The plan declares no terms, so nothing stops a lesson from using a word the course explains later.",
      });
    }
    return;
  }
  // Two corpora, because the two rules below ask different questions.
  //
  // "Where is this term EXPLAINED?" can only be answered by a lesson's
  // prose: a word that appears solely in an exercise prompt has been used,
  // not taught.
  //
  // "Where does the learner MEET this term?" has to cover everything the
  // learner reads, and for an exercise lesson that is mostly the manifest —
  // the prompt, the quiz, the labels of the fields to fill in. A lesson can
  // carry no Markdown at all and still put a word in front of the learner.
  //
  // Stemming each lesson once: a course has few terms and many words.
  const proseStems = new Map<string, readonly string[]>();
  const seenStems = new Map<string, readonly string[]>();
  for (const entry of lessons) {
    const prose = entry.lesson.content;
    if (prose !== undefined) {
      proseStems.set(entry.lesson.id, stemsOf(prose));
    }
    seenStems.set(entry.lesson.id, stemsOf([prose ?? "", visibleTextOf(entry.lesson)].join("\n\n")));
  }

  terms.forEach((term: TermEntry, index: number) => {
    const home = byId.get(term.introduced_in);
    if (home === undefined) {
      findings.push({
        severity: "error",
        rule: "term-introduced-unknown",
        path: `skills.terms[${index}].introduced_in`,
        message: `Term "${term.term}" is introduced by lesson "${term.introduced_in}", which the manifest does not have.`,
      });
      return;
    }

    const allowed = new Set(term.mentioned_before ?? []);
    for (const id of allowed) {
      if (!byId.has(id)) {
        findings.push({
          severity: "error",
          rule: "term-mentioned-before-unknown",
          path: `skills.terms[${index}].mentioned_before`,
          message: `Term "${term.term}" allows an early mention in lesson "${id}", which the manifest does not have.`,
        });
      }
    }

    const phrases = phrasesOf(term);

    // Every `mentioned_before` entry is a hand-written exemption from the
    // rule below, and nothing can check the thing that actually matters —
    // whether the early mention really announces the term ("разберём в
    // модуле 3") instead of leaning on it as known. That half stays with
    // the reviewer.
    //
    // What a machine CAN do is keep the list from growing quietly: an
    // entry that exempts nothing is removed, so the list only ever holds
    // live exemptions and stays short enough to read. Nine lessons of the
    // pilot already needed eight entries; seventy-five lessons would bury
    // the real ones among the stale.
    for (const id of allowed) {
      const mentioned = byId.get(id);
      if (mentioned === undefined) {
        // Already reported as `term-mentioned-before-unknown` above.
        continue;
      }
      if (mentioned.order >= home.order) {
        findings.push({
          severity: "warning",
          rule: "term-mentioned-before-unused",
          path: `skills.terms[${index}].mentioned_before`,
          message:
            `Term "${term.term}" allows an early mention in lesson "${id}", which comes no earlier than ` +
            `"${home.lesson.id}", the lesson that introduces it — there is nothing there to excuse.`,
        });
        continue;
      }
      const stems = seenStems.get(id);
      // An unwritten lesson cannot mention anything yet; the exemption is
      // for text that is still to come.
      if (stems !== undefined && !isPlaceholderLesson(mentioned.lesson) && !mentions(stems, phrases)) {
        findings.push({
          severity: "warning",
          rule: "term-mentioned-before-unused",
          path: `skills.terms[${index}].mentioned_before`,
          message:
            `Term "${term.term}" allows an early mention in lesson "${id}", but nothing in that lesson mentions ` +
            `it — the exemption does nothing and can be removed.`,
        });
      }
    }
    const homeStems = proseStems.get(home.lesson.id);
    if (homeStems !== undefined && !isPlaceholderLesson(home.lesson) && !mentions(homeStems, phrases)) {
      findings.push({
        severity: "error",
        rule: "term-not-introduced",
        path: `skills.terms[${index}].introduced_in`,
        message: `Lesson "${home.lesson.id}" is supposed to introduce "${term.term}", but its text never uses the word.`,
      });
    }

    for (const entry of lessons) {
      if (entry.order >= home.order || allowed.has(entry.lesson.id)) {
        continue;
      }
      const stems = seenStems.get(entry.lesson.id);
      if (stems !== undefined && mentions(stems, phrases)) {
        findings.push({
          severity: "error",
          rule: "term-used-before-introduced",
          path: entry.path,
          message: `Lesson "${entry.lesson.id}" uses "${term.term}", which is only explained later, in "${home.lesson.id}". Move the explanation, reword it, or list this lesson in mentioned_before.`,
        });
      }
    }
  });
}

/** E/W: an exercise must be solvable with what the course has taught.
 *
 * The same question as checkTerms, asked of a different witness. A term
 * catches what the text SAYS; this catches what an exercise REQUIRES —
 * and the gap between the two is where the worst case lives. Our own
 * pilot had it: an exercise asking the learner to filter rows, one lesson
 * before WHERE is explained, and never using the word "WHERE" in its
 * text. No prose rule can see that. The author's own reference answer
 * can: if solving it needed WHERE, so does the learner.
 *
 * Nothing here knows what SQL is. A plan grants `sql:where`; which kinds
 * exist and what they mean belongs to the analyzer registry
 * (lint/features.ts), so a course in another language needs an analyzer
 * and not an edit to this rule or to the plan's schema.
 *
 * Availability is taken from the TERM that explains a feature, not from
 * the skill a plan says a lesson teaches. A practice lesson can be
 * planned as `teaches: [filter-rows]` while explaining nothing at all —
 * which is precisely the defect, so it cannot also be the evidence.
 */
function checkGrants(
  skills: SkillsDocument,
  planned: readonly PlannedLesson[],
  byId: ReadonlyMap<string, PositionedLesson>,
  skeleton: boolean,
  findings: LintFinding[],
): void {
  const terms = skills.terms ?? [];
  const granting = terms.filter((term) => (term.grants ?? []).length > 0);
  const analyzable = planned.filter((entry) => {
    const practice = entry.at.lesson.practice;
    return practice !== undefined && analyzerFor(practice) !== undefined;
  });

  if (granting.length === 0) {
    // A course with no glossary at all is already told so once, by
    // course-without-glossary. Saying it twice for the same omission
    // teaches authors to read lint findings diagonally.
    if (terms.length > 0 && analyzable.length > 0 && !skeleton) {
      findings.push({
        severity: "warning",
        rule: "course-without-grants",
        path: "skills.terms",
        message:
          "No term grants anything, so nothing stops an exercise from needing what the course has not explained yet.",
      });
    }
    return;
  }

  // Where each feature becomes available: the position of the lesson that
  // introduces the earliest term granting it.
  const availableFrom = new Map<string, number>();
  granting.forEach((term, index) => {
    const home = byId.get(term.introduced_in);
    for (const grant of term.grants ?? []) {
      if (!isKnownGrant(grant)) {
        findings.push({
          severity: "error",
          rule: "grant-unknown",
          path: `skills.terms[${index}].grants`,
          message: `Term "${term.term}" grants "${grant}", which no analyzer registers. Known: ${knownGrants().join(", ")}.`,
        });
        continue;
      }
      if (home === undefined) {
        // Already reported by checkTerms as term-introduced-unknown.
        continue;
      }
      const current = availableFrom.get(grant);
      if (current === undefined || home.order < current) {
        availableFrom.set(grant, home.order);
      }
    }
  });

  for (const lesson of analyzable) {
    const practice = lesson.at.lesson.practice;
    if (practice === undefined) {
      continue;
    }
    const analyzer = analyzerFor(practice);
    if (analyzer === undefined) {
      continue;
    }
    for (const feature of analyzer.extract(practice)) {
      const grant = grantId(analyzer.kind, feature);
      const from = availableFrom.get(grant);
      if (from === undefined || from > lesson.at.order) {
        findings.push({
          severity: "error",
          rule: "practice-uses-untaught",
          path: `${lesson.at.path}.practice`,
          message:
            from === undefined
              ? `Solving this needs ${grant}, which no term of this course explains.`
              : `Solving this needs ${grant}, explained later in the course.`,
        });
      }
    }
  }
}

/**
 * Every rule this lint can report.
 *
 * Not a description of the code but a constraint on it: `LintFinding.rule`
 * is typed as `LintRule`, so reporting a rule that is not on this list does
 * not compile. The reverse direction — a rule listed here that nothing
 * reports, or that reports something courses/README.md never documents —
 * is what course.rules.test.ts checks. Both halves earn their keep: the
 * list used to say "exported so the tests can assert..." while no test did,
 * and it carried a rule that could never fire.
 */
export const LINT_RULES = [
  // Reported by the CLI before `lintCourse` runs at all: a package that
  // does not load has nothing to lint, and saying so under a rule id keeps
  // every line of the tool's output shaped the same way.
  "manifest-invalid",
  "skills-invalid",
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
  "quiz-answer-guessable",
  "practice-check-without-solution",
  "lesson-is-placeholder",
  "lesson-too-short",
  "answer-expected-fails-own-check",
  "answer-number-without-tolerance",
  "term-introduced-unknown",
  "term-mentioned-before-unknown",
  "term-mentioned-before-unused",
  "term-not-introduced",
  "term-used-before-introduced",
  "course-without-glossary",
  "grant-unknown",
  "practice-uses-untaught",
  "course-without-grants",
] as const;

/** The rule ids a finding may carry — derived from the list above, so the
 * list cannot fall behind the code. */
export type LintRule = (typeof LINT_RULES)[number];
