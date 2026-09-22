import assert from "node:assert/strict";
import test from "node:test";

import type { EngineCapabilities } from "../capabilities.js";
import { CAPABILITIES } from "../capabilities.js";
import type { Course, CourseLesson, CoursePractice, CourseQuiz } from "../courses/types.js";
import { isSkeletonVersion, lintCourse, MAX_LESSONS_WITHOUT_CHECKS, type LintFinding } from "./course.js";
import { parseSkillsDocument, type SkillsDocument } from "./skills.js";

// --- Fixtures ------------------------------------------------------------
// Courses are built in memory rather than written to disk: every rule here
// is about STRUCTURE, and a temp directory per case would only add IO to
// assertions that never read a file.

const QUIZ: CourseQuiz = {
  question: "Which one?",
  options: [
    { id: "a", text: "A", correct: true },
    { id: "b", text: "B", correct: false, explanation: "Because." },
  ],
};

const SQL_CHECK: CoursePractice = { type: "sql", prompt: "Do it.", sandbox: "main", check: "select true" };
const SQL_EXPECTED: CoursePractice = {
  type: "sql",
  prompt: "Select it.",
  sandbox: "main",
  expected: "select a from t",
  ordered: false,
};
const ANSWER: CoursePractice = {
  type: "answer",
  prompt: "Report it.",
  fields: [{ id: "n", label: "How many?", kind: "number", expected: 1, tolerance: 0 }],
};

/** `id` alone is a plain content lesson; the suffixes attach content. */
type LessonSpec = string | { id: string; quiz?: CourseQuiz; practice?: CoursePractice };

function lesson(spec: LessonSpec): CourseLesson {
  if (typeof spec === "string") {
    return { id: spec, title: spec, content: `# ${spec}` };
  }
  return { id: spec.id, title: spec.id, content: `# ${spec.id}`, quiz: spec.quiz, practice: spec.practice };
}

function course(modules: Readonly<Record<string, readonly LessonSpec[]>>, version = "1.0.0"): Course {
  return {
    id: "fixture",
    version,
    title: "Fixture course",
    dir: "/nonexistent/fixture",
    sandboxes: [{ id: "main", type: "postgres", seed: [] }],
    modules: Object.entries(modules).map(([id, lessons]) => ({
      id,
      title: id,
      lessons: lessons.map(lesson),
    })),
  };
}

/** Parses a skills.yaml body, failing the test if it is not structurally
 * valid — the rules under test assume a well-formed document. */
function skills(yaml: string): SkillsDocument {
  const result = parseSkillsDocument(yaml);
  assert.equal(result.kind, "ok", `fixture skills.yaml did not parse: ${JSON.stringify(result)}`);
  assert.ok(result.kind === "ok");
  return result.skills;
}

function rules(findings: readonly LintFinding[]): string[] {
  return findings.map((finding) => finding.rule);
}

function of(findings: readonly LintFinding[], rule: string): LintFinding[] {
  return findings.filter((finding) => finding.rule === rule);
}

// --- Happy path ----------------------------------------------------------

void test("a consistent plan produces no findings at all", () => {
  const findings = lintCourse(
    course({
      intro: ["start", { id: "quizzed", quiz: QUIZ }],
      practice: [{ id: "written", practice: SQL_EXPECTED }],
    }),
    {
      skills: skills(`
version: 1
skills:
  - id: reading
    title: Read a table
  - id: selecting
    title: Select columns
    requires: [reading]
lessons:
  - id: start
    teaches: [reading]
    verify: self
    hours: 1
  - id: quizzed
    requires: [start]
    verify: quiz
    hours: 1
  - id: written
    teaches: [selecting]
    requires: [quizzed]
    verify: sql-result
    hours: 1
modules:
  - id: intro
    budget_hours: 4
`),
    },
  );

  assert.deepEqual(findings, []);
});

// --- Coverage ------------------------------------------------------------

void test("the plan and the manifest must cover each other exactly", () => {
  const findings = lintCourse(course({ intro: [{ id: "a", quiz: QUIZ }, "b"] }), {
    skills: skills(`
version: 1
lessons:
  - id: a
    verify: quiz
  - id: ghost
    verify: self
`),
  });

  // A planned lesson that does not exist...
  const unknown = of(findings, "lesson-unknown");
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]?.path, "skills.lessons[1].id");
  assert.match(unknown[0]?.message ?? "", /"ghost"/);

  // ...and a real lesson nobody planned. Its path points at the MANIFEST,
  // which is where a reader looks for it.
  const undocumented = of(findings, "lesson-undocumented");
  assert.equal(undocumented.length, 1);
  assert.equal(undocumented[0]?.path, "modules[0].lessons[1]");
  assert.match(undocumented[0]?.message ?? "", /"b"/);
});

void test("planning the same lesson twice is an error, not a silent last-one-wins", () => {
  const findings = lintCourse(course({ intro: [{ id: "a", quiz: QUIZ }] }), {
    skills: skills(`
version: 1
lessons:
  - id: a
    verify: quiz
  - id: a
    verify: self
`),
  });

  assert.deepEqual(rules(findings), ["lesson-duplicated"]);
  assert.equal(findings[0]?.path, "skills.lessons[1].id");
});

// --- Prerequisite order --------------------------------------------------

void test("a lesson may only require lessons that come earlier in the manifest", () => {
  const findings = lintCourse(course({ intro: ["first", "second"] }), {
    skills: skills(`
version: 1
lessons:
  - id: first
    requires: [second]
    verify: self
  - id: second
    verify: self
`),
  });

  const order = of(findings, "lesson-requires-order");
  assert.equal(order.length, 1);
  // Reported against the lesson that is out of place, naming where the
  // prerequisite actually sits.
  assert.equal(order[0]?.path, "modules[0].lessons[0]");
  assert.match(order[0]?.message ?? "", /"first" requires "second", which comes later/);
  assert.match(order[0]?.message ?? "", /modules\[0\]\.lessons\[1\]/);
});

void test("requiring a lesson that does not exist, and requiring itself, are each named", () => {
  const findings = lintCourse(course({ intro: ["only"] }), {
    skills: skills(`
version: 1
lessons:
  - id: only
    requires: [nope, only]
    verify: self
`),
  });

  assert.equal(of(findings, "lesson-requires-unknown").length, 1);
  assert.match(of(findings, "lesson-requires-unknown")[0]?.message ?? "", /"nope", which is not a lesson/);
  // A self-requirement is both an ordering violation and a one-node ring;
  // the ordering message says the useful thing.
  assert.match(of(findings, "lesson-requires-order")[0]?.message ?? "", /requires itself/);
});

void test("a ring of prerequisites is reported as a ring, once, listing its members", () => {
  const findings = lintCourse(course({ intro: ["a", "b", "c"] }), {
    skills: skills(`
version: 1
lessons:
  - id: a
    requires: [c]
    verify: self
  - id: b
    requires: [a]
    verify: self
  - id: c
    requires: [b]
    verify: self
`),
  });

  const cycles = of(findings, "lesson-requires-cycle");
  // One finding for the ring, however many nodes the walk entered it from.
  assert.equal(cycles.length, 1, JSON.stringify(cycles));
  assert.match(cycles[0]?.message ?? "", /cycle: a -> c -> b -> a|cycle: [abc]( -> [abc]){3}/);
  assert.match(cycles[0]?.message ?? "", /No lesson order can satisfy this/);
  // The forward edge is still reported separately: the two say different
  // things ("move this one" vs "no order exists").
  assert.ok(of(findings, "lesson-requires-order").length > 0);
});

// --- Skills --------------------------------------------------------------

void test("a declared skill nobody teaches is an error", () => {
  const findings = lintCourse(course({ intro: ["a"] }), {
    skills: skills(`
version: 1
skills:
  - id: taught
    title: Taught by a lesson
  - id: orphan
    title: Nobody teaches this
lessons:
  - id: a
    teaches: [taught]
    verify: self
`),
  });

  const orphaned = of(findings, "skill-not-taught");
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0]?.path, "skills.skills[1].id");
  assert.match(orphaned[0]?.message ?? "", /"orphan"/);
});

void test("teaching or requiring an undeclared skill is an error", () => {
  const findings = lintCourse(course({ intro: ["a"] }), {
    skills: skills(`
version: 1
skills:
  - id: known
    title: Known
    requires: [ghost]
lessons:
  - id: a
    teaches: [known, alsoGhost]
    verify: self
`),
  });

  assert.match(of(findings, "skill-unknown")[0]?.message ?? "", /"alsoGhost"/);
  assert.match(of(findings, "skill-requires-unknown")[0]?.message ?? "", /"ghost"/);
});

void test("a skill's prerequisite must be taught before the skill itself", () => {
  const findings = lintCourse(course({ intro: ["early", "late"] }), {
    skills: skills(`
version: 1
skills:
  - id: basic
    title: Basic
  - id: advanced
    title: Advanced
    requires: [basic]
lessons:
  - id: early
    teaches: [advanced]
    verify: self
  - id: late
    teaches: [basic]
    verify: self
`),
  });

  const order = of(findings, "skill-requires-order");
  assert.equal(order.length, 1);
  assert.equal(order[0]?.path, "skills.skills[1].requires[0]");
  assert.match(order[0]?.message ?? "", /first taught at modules\[0\]\.lessons\[1\]/);
});

// --- verify --------------------------------------------------------------

void test("verify must match what the lesson actually contains", () => {
  const findings = lintCourse(
    course({
      intro: [
        { id: "has-quiz", quiz: QUIZ },
        { id: "has-check", practice: SQL_CHECK },
        { id: "has-expected", practice: SQL_EXPECTED },
        { id: "has-answer", practice: ANSWER },
        "has-nothing",
      ],
    }),
    {
      skills: skills(`
version: 1
lessons:
  - id: has-quiz
    verify: sql-state
  - id: has-check
    verify: sql-state
  - id: has-expected
    verify: sql-result
  - id: has-answer
    verify: answer
  - id: has-nothing
    verify: quiz
`),
    },
  );

  // Only the two mismatches; the three that agree say nothing.
  const mismatches = of(findings, "verify-mismatch");
  assert.deepEqual(
    mismatches.map((finding) => finding.path),
    ["modules[0].lessons[0]", "modules[0].lessons[4]"],
  );
  assert.equal(mismatches[0]?.severity, "error");
  assert.match(mismatches[0]?.message ?? "", /planned as "sql-state", but the manifest gives it "quiz"/);
  assert.match(mismatches[1]?.message ?? "", /gives it "self"/);
});

void test("a sql practice carrying both mechanics satisfies either plan", () => {
  const both: CoursePractice = { ...SQL_EXPECTED, check: "select true" };
  for (const verify of ["sql-state", "sql-result"]) {
    const findings = lintCourse(course({ intro: [{ id: "a", practice: both }] }), {
      skills: skills(`
version: 1
lessons:
  - id: a
    verify: ${verify}
`),
    });
    assert.deepEqual(findings, [], `verify: ${verify} should be satisfied`);
  }
});

void test("a plan naming a mechanic this engine does not register is an error, never downgraded", () => {
  // The question the rule exists for. With the shipped registry every
  // `verify` value is supported, so the only way to ask it is to hand the
  // lint an engine that has lost a mechanic.
  const withoutExpected: EngineCapabilities = {
    ...CAPABILITIES,
    practiceTypes: CAPABILITIES.practiceTypes.map((practice) =>
      practice.type === "sql"
        ? { ...practice, mechanics: practice.mechanics.filter((mechanic) => mechanic.name !== "expected") }
        : practice,
    ),
  };

  const plan = skills(`
version: 1
lessons:
  - id: a
    verify: sql-result
`);
  const withExpected = course({ intro: [{ id: "a", practice: SQL_EXPECTED }] });

  assert.deepEqual(lintCourse(withExpected, { skills: plan }), [], "supported by the real engine");

  const findings = lintCourse(withExpected, { skills: plan, capabilities: withoutExpected });
  assert.deepEqual(rules(findings), ["verify-unsupported"]);
  assert.equal(findings[0]?.severity, "error");
  assert.match(findings[0]?.message ?? "", /needs the "expected" mechanic of practice type "sql"/);
  assert.match(findings[0]?.message ?? "", /docs\/contracts\/capabilities\.json/);

  // And not downgraded for a skeleton: whether a build has a mechanic does
  // not depend on whether the lessons are written.
  const onSkeleton = lintCourse(withExpected, { skills: plan, capabilities: withoutExpected, skeleton: true });
  assert.equal(of(onSkeleton, "verify-unsupported")[0]?.severity, "error");
});

// --- Skeleton ------------------------------------------------------------

void test("isSkeletonVersion reads the semver prerelease, not the whole string", () => {
  assert.equal(isSkeletonVersion("0.1.0-skeleton"), true);
  assert.equal(isSkeletonVersion("0.2.0-skeleton.3"), true);
  assert.equal(isSkeletonVersion("1.0.0"), false);
  assert.equal(isSkeletonVersion("2.0.0-rc.1"), false);
  // A build-metadata suffix is not a prerelease.
  assert.equal(isSkeletonVersion("1.0.0+skeleton"), false);
});

void test("a skeleton's empty lessons make verify a warning, so the plan can still be reviewed", () => {
  const plan = skills(`
version: 1
lessons:
  - id: a
    verify: quiz
`);
  // Same course, same plan, only the version differs.
  const written = lintCourse(course({ intro: ["a"] }, "1.0.0"), { skills: plan });
  const skeleton = lintCourse(course({ intro: ["a"] }, "0.1.0-skeleton"), { skills: plan });

  assert.equal(of(written, "verify-mismatch")[0]?.severity, "error");
  assert.equal(of(skeleton, "verify-mismatch")[0]?.severity, "warning");
  assert.match(of(skeleton, "verify-mismatch")[0]?.message ?? "", /this course's version is a skeleton/);
});

// --- Pacing and budgets --------------------------------------------------

void test("a long stretch with nothing to do warns once, at the start of the run", () => {
  const long = Array.from({ length: MAX_LESSONS_WITHOUT_CHECKS + 1 }, (_, index) => `plain-${index}`);
  const findings = lintCourse(course({ intro: [{ id: "quizzed", quiz: QUIZ }, ...long] }));

  const stretch = of(findings, "long-stretch-without-checks");
  assert.equal(stretch.length, 1);
  assert.equal(stretch[0]?.severity, "warning");
  assert.equal(stretch[0]?.path, "modules[0].lessons[1]");
  assert.match(stretch[0]?.message ?? "", new RegExp(`${MAX_LESSONS_WITHOUT_CHECKS + 1} lessons in a row`));

  // Exactly at the threshold is fine — the warning is about a stretch, not
  // about every gap.
  const atLimit = Array.from({ length: MAX_LESSONS_WITHOUT_CHECKS }, (_, index) => `plain-${index}`);
  assert.deepEqual(of(lintCourse(course({ intro: [...atLimit, { id: "q", quiz: QUIZ }] })), "long-stretch-without-checks"), []);
});

void test("a module with nothing verifiable warns, and the pacing rules need no skills.yaml", () => {
  // No `skills` option at all: this is what linting a package that has not
  // been planned yet answers.
  const findings = lintCourse(course({ reading: ["a", "b"], doing: [{ id: "c", practice: SQL_CHECK }] }));

  assert.deepEqual(
    of(findings, "module-without-checks").map((finding) => finding.path),
    ["modules[0]"],
  );
  // Plan rules did not run, so no lesson-undocumented for a, b or c.
  assert.deepEqual(of(findings, "lesson-undocumented"), []);
});

void test("planned hours over a module's budget warn; a budget for no module is an error", () => {
  const findings = lintCourse(course({ intro: [{ id: "a", quiz: QUIZ }, { id: "b", quiz: QUIZ }] }), {
    skills: skills(`
version: 1
lessons:
  - id: a
    verify: quiz
    hours: 3
  - id: b
    verify: quiz
    hours: 4
modules:
  - id: intro
    budget_hours: 6
  - id: ghost
    budget_hours: 10
`),
  });

  const over = of(findings, "module-over-budget");
  assert.equal(over.length, 1);
  assert.equal(over[0]?.severity, "warning");
  assert.equal(over[0]?.path, "modules[0]");
  assert.match(over[0]?.message ?? "", /plans 7 hours against a budget of 6/);

  const ghost = of(findings, "module-unknown");
  assert.equal(ghost.length, 1);
  assert.equal(ghost[0]?.severity, "error");
  assert.equal(ghost[0]?.path, "skills.modules[1].id");
});

void test("a wrong quiz option with no explanation warns, one finding per option", () => {
  const silent: CourseQuiz = {
    question: "Which one?",
    options: [
      { id: "right", text: "A", correct: true },
      { id: "wrong-1", text: "B", correct: false },
      { id: "wrong-2", text: "C", correct: false, explanation: "C mixes up two periods." },
      { id: "wrong-3", text: "D", correct: false },
    ],
  };
  const findings = lintCourse(course({ intro: [{ id: "q", quiz: silent }] }));

  const silentOptions = of(findings, "quiz-wrong-option-without-explanation");
  assert.deepEqual(
    silentOptions.map((finding) => finding.path),
    ["modules[0].lessons[0].quiz.options[1]", "modules[0].lessons[0].quiz.options[3]"],
  );
  assert.equal(silentOptions[0]?.severity, "warning");
  assert.match(silentOptions[0]?.message ?? "", /Wrong option "wrong-1"/);
});

void test("the correct option needs no explanation, and a fully annotated quiz is silent", () => {
  // `QUIZ`'s only wrong option carries an explanation and its correct one
  // does not — the shape every course should end up in.
  assert.deepEqual(of(lintCourse(course({ intro: [{ id: "q", quiz: QUIZ }] })), "quiz-wrong-option-without-explanation"), []);
});
