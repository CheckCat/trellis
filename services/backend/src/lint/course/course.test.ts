import assert from "node:assert/strict";
import test from "node:test";

import type { EngineCapabilities } from "../../capabilities/index.js";
import { CAPABILITIES } from "../../capabilities/index.js";
import type { Course, CourseLesson, CoursePractice, CourseQuiz } from "../../courses/types.js";
import { isSkeletonVersion, lintCourse, MAX_LESSONS_WITHOUT_CHECKS, type LintFinding } from "./course.js";
import { parseSkillsDocument, type SkillsDocument } from "../skills/index.js";

// --- Fixtures ------------------------------------------------------------
// Courses are built in memory rather than written to disk: every rule here
// is about STRUCTURE, and a temp directory per case would only add IO to
// assertions that never read a file.

const QUIZ: CourseQuiz = {
  question: "Which one?",
  multiple: false,
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

/** `id` alone is a plain content lesson; the fields attach content.
 *
 * `content` is the lesson's Markdown, spelled out only by the rules that
 * read it. It is a field of the lesson rather than a map passed beside the
 * course on purpose: the text reaches the rules here exactly the way it
 * reaches them in production, through `CourseLesson.content`. The previous
 * shape — a separate `lessonTexts` map the test filled in by hand — let
 * these tests pass while the CLI delivered no text at all. */
type LessonSpec = string | { id: string; content?: string; quiz?: CourseQuiz; practice?: CoursePractice };

/** The default body of a fixture lesson: long enough not to trip
 * `lesson-too-short`, which is a rule about real courses and only noise in
 * a test about structure. Tests that care about the text say so with an
 * explicit `content`. */
const FILLER =
  "Этот урок существует только в тестах, и его текст ничего не объясняет. " +
  "Он нужен лишь затем, чтобы урок не считался пустым: правило lesson-too-short " +
  "измеряет длину прозы, а не её смысл, и структурные проверки не должны " +
  "спотыкаться о него. Ни одно правило линта не смотрит на содержание этого " +
  "абзаца — проверяется только то, что он есть и что он достаточно длинный, " +
  "поэтому мысль здесь повторяется дважды без всякой пользы для читателя.";

/** What an unwritten lesson looks like: the marker the course-author skill
 * tells an author to leave behind. The rules that used to key on the
 * COURSE's `-skeleton` version key on this instead. */
function placeholder(id: string): string {
  return `# ${id}\n\n> ЗАГЛУШКА — текст урока не написан.\n`;
}

function body(id: string): string {
  return `# ${id}\n\n${FILLER}`;
}

function lesson(spec: LessonSpec): CourseLesson {
  if (typeof spec === "string") {
    return { id: spec, title: spec, content: body(spec) };
  }
  return {
    id: spec.id,
    title: spec.id,
    content: spec.content ?? body(spec.id),
    quiz: spec.quiz,
    practice: spec.practice,
  };
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

/** Course-level advice fires for ANY plan without a glossary, so repeating
 * it in every structural assertion would turn each of those tests into a
 * test of two things. Both warnings have their own tests below. */
const ADVICE = new Set(["course-without-glossary", "course-without-grants"]);

function ruleset(findings: readonly LintFinding[]): string[] {
  return rules(findings).filter((rule) => !ADVICE.has(rule));
}

function of(findings: readonly LintFinding[], rule: string): LintFinding[] {
  return findings.filter((finding) => finding.rule === rule);
}

// --- Happy path ----------------------------------------------------------

void test("a consistent plan produces no findings at all", () => {
  const findings = lintCourse(
    course({
      intro: [
        { id: "start", content: `${body("start")}\n\nКоманда SELECT читает данные из таблицы.` },
        { id: "quizzed", quiz: QUIZ },
      ],
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
terms:
  - term: SELECT
    introduced_in: start
    grants: [sql:select]
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

  assert.deepEqual(ruleset(findings), ["lesson-duplicated"]);
  assert.equal(of(findings, "lesson-duplicated")[0]?.path, "skills.lessons[1].id");
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
    assert.deepEqual(ruleset(findings), [], `verify: ${verify} should be satisfied`);
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

  assert.deepEqual(ruleset(lintCourse(withExpected, { skills: plan })), [], "supported by the real engine");

  const findings = lintCourse(withExpected, { skills: plan, capabilities: withoutExpected });
  assert.deepEqual(ruleset(findings), ["verify-unsupported"]);
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

void test("an UNWRITTEN lesson makes verify a warning, so the plan can still be reviewed", () => {
  const plan = skills(`
version: 1
lessons:
  - id: a
    verify: quiz
`);
  const written = lintCourse(course({ intro: [{ id: "a", content: body("a") }] }, "1.0.0"), { skills: plan });
  const stub = lintCourse(course({ intro: [{ id: "a", content: placeholder("a") }] }, "0.1.0-skeleton"), {
    skills: plan,
  });

  assert.equal(of(written, "verify-mismatch")[0]?.severity, "error");
  assert.equal(of(stub, "verify-mismatch")[0]?.severity, "warning");
  assert.match(of(stub, "verify-mismatch")[0]?.message ?? "", /this lesson is still a placeholder/);
});

void test("a WRITTEN lesson is held to the plan even while the course is a skeleton", () => {
  // The reason the exemption moved from the course to the lesson. An
  // author with five modules written and two to go had to choose between
  // being checked on the five and lying about the two; now the suffix
  // excuses only the lessons that say they are unwritten.
  const plan = skills(`
version: 1
lessons:
  - id: done
    verify: quiz
  - id: todo
    verify: quiz
`);
  const findings = lintCourse(
    course({ intro: [{ id: "done", content: body("done") }, { id: "todo", content: placeholder("todo") }] }, "0.1.0-skeleton"),
    { skills: plan },
  );

  const mismatches = of(findings, "verify-mismatch");
  assert.deepEqual(
    mismatches.map((finding) => [finding.path, finding.severity]),
    [
      ["modules[0].lessons[0]", "error"],
      ["modules[0].lessons[1]", "warning"],
    ],
  );
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

// --- Vocabulary ----------------------------------------------------------
// The rule a non-technical course needs most. Everything above reasons
// about the plan; these read the lessons themselves, so their fixtures
// carry real `content`.

const GLOSSARY_PLAN = `
version: 1
terms:
  - term: текучесть
    introduced_in: turnover
lessons:
  - id: intro
    verify: self
  - id: turnover
    verify: self
`;


void test("a term used before the lesson that explains it is an error", () => {
  const findings = lintCourse(
    course({
      m: [
        // The defect in one line: module 1 speaks as if the reader already
        // knew the word. Nothing about the plan is wrong — only the text.
        { id: "intro", content: "# Введение\n\nВысокая текучесть — наша главная проблема." },
        { id: "turnover", content: "# Текучесть\n\nТекучесть — это доля сотрудников, ушедших за период." },
      ],
    }),
    { skills: skills(GLOSSARY_PLAN) },
  );

  const found = of(findings, "term-used-before-introduced");
  assert.equal(found.length, 1);
  assert.match(found[0]?.message ?? "", /"текучесть"/);
  // The finding points at the lesson that has to change, not at the plan.
  assert.equal(found[0]?.path, "modules[0].lessons[0]");
});

void test("an inflected form counts as the same word", () => {
  const findings = lintCourse(
    course({
      m: [
        { id: "intro", content: "# Введение\n\nПоговорим о текучести кадров." },
        { id: "turnover", content: "# Текучесть\n\nТекучесть — это доля ушедших." },
      ],
    }),
    { skills: skills(GLOSSARY_PLAN) },
  );

  assert.equal(of(findings, "term-used-before-introduced").length, 1);
});

void test("a deliberate announcement is declared, not silenced", () => {
  const findings = lintCourse(
    course({
      m: [
        { id: "intro", content: "# Введение\n\nТекучесть разберём во втором модуле." },
        { id: "turnover", content: "# Текучесть\n\nТекучесть — это доля ушедших." },
      ],
    }),
    {
      skills: skills(`
version: 1
terms:
  - term: текучесть
    introduced_in: turnover
    mentioned_before: [intro]
lessons:
  - id: intro
    verify: self
  - id: turnover
    verify: self
`),
    },
  );

  assert.deepEqual(of(findings, "term-used-before-introduced"), []);
});

void test("a lesson that does not actually introduce its term is an error", () => {
  const findings = lintCourse(
    course({
      m: [
        { id: "intro", content: "# Введение\n\nО метриках вообще." },
        // The plan promises this lesson explains the word; the text never
        // uses it. Either the plan or the lesson is lying.
        { id: "turnover", content: "# Увольнения\n\nСчитаем ушедших за период." },
      ],
    }),
    { skills: skills(GLOSSARY_PLAN) },
  );

  assert.equal(of(findings, "term-not-introduced").length, 1);
});

void test("a course without a glossary is warned about once", () => {
  const findings = lintCourse(course({ m: [{ id: "one", practice: SQL_EXPECTED, content: "# One\n\nSome text." }] }), {
    skills: skills(`
version: 1
lessons:
  - id: one
    verify: sql-result
`),
  });

  assert.deepEqual(rules(findings).filter((rule) => rule.startsWith("course-without")), [
    "course-without-glossary",
  ]);
});

// --- Untaught SQL --------------------------------------------------------

void test("an exercise needing what the course has not explained is an error", () => {
  // This is the pilot's own defect, reduced: an exercise that filters
  // rows, standing before the lesson that explains WHERE — and never
  // using the word "WHERE" in its text, so no prose rule could see it.
  const findings = lintCourse(
    course({
      m: [
        { id: "select-basics", content: "# SELECT\n\nКоманда `SELECT` читает данные." },
        {
          id: "practice",
          content: "# Практика\n\nВыберите нужные книги.",
          practice: { type: "sql", prompt: "Filter.", sandbox: "main", expected: "select a from t where b = 1" },
        },
        { id: "where-clause", content: "# WHERE\n\nКлючевое слово `WHERE` отбирает строки." },
      ],
    }),
    {
      skills: skills(`
version: 1
terms:
  - term: SELECT
    introduced_in: select-basics
    grants: [sql:select]
  - term: WHERE
    introduced_in: where-clause
    grants: [sql:where]
lessons:
  - id: select-basics
    verify: self
  - id: practice
    verify: sql-result
  - id: where-clause
    verify: self
`),
    },
  );

  const found = of(findings, "practice-uses-untaught");
  assert.equal(found.length, 1);
  // The message names the grant exactly as a plan would write it, so the
  // fix is a copy-paste rather than a translation.
  assert.match(found[0]?.message ?? "", /sql:where/);
});

void test("the same exercise after the explanation is fine", () => {
  const findings = lintCourse(
    course({
      m: [
        { id: "select-basics", content: "# SELECT\n\nКоманда `SELECT` читает данные." },
        { id: "where-clause", content: "# WHERE\n\nКлючевое слово `WHERE` отбирает строки." },
        {
          id: "practice",
          content: "# Практика\n\nВыберите нужные книги.",
          practice: { type: "sql", prompt: "Filter.", sandbox: "main", expected: "select a from t where b = 1" },
        },
      ],
    }),
    {
      skills: skills(`
version: 1
terms:
  - term: SELECT
    introduced_in: select-basics
    grants: [sql:select]
  - term: WHERE
    introduced_in: where-clause
    grants: [sql:where]
lessons:
  - id: select-basics
    verify: self
  - id: where-clause
    verify: self
  - id: practice
    verify: sql-result
`),
    },
  );

  assert.deepEqual(of(findings, "practice-uses-untaught"), []);
});

void test("a construct no term explains at all is reported differently", () => {
  const findings = lintCourse(
    course({
      m: [
        { id: "basics", content: "# Basics\n\nКоманда `SELECT` читает данные." },
        {
          id: "practice",
          content: "# Практика\n\nСоберите данные.",
          practice: { type: "sql", prompt: "Join.", sandbox: "main", expected: "select a from t join u on t.id = u.id" },
        },
      ],
    }),
    {
      skills: skills(`
version: 1
terms:
  - term: SELECT
    introduced_in: basics
    grants: [sql:select]
lessons:
  - id: basics
    verify: self
  - id: practice
    verify: sql-result
`),
    },
  );

  const found = of(findings, "practice-uses-untaught");
  assert.equal(found.length, 1);
  assert.match(found[0]?.message ?? "", /no term of this course explains/);
});

void test("a mentioned_before entry that excuses nothing is a warning", () => {
  const plan = skills(`
version: 1
lessons:
  - id: before
    verify: self
  - id: home
    verify: self
  - id: after
    verify: self
terms:
  - term: сезонность
    introduced_in: home
    mentioned_before: [before, after]
`);
  const findings = lintCourse(
    course({
      m: [
        // Says nothing about the term, so its exemption is dead.
        { id: "before", content: body("before") },
        { id: "home", content: `# home\n\nСезонность — это колебания по месяцам. ${FILLER}` },
        { id: "after", content: body("after") },
      ],
    }),
    { skills: plan },
  );

  const unused = of(findings, "term-mentioned-before-unused");
  assert.equal(unused.length, 2);
  assert.ok(unused.every((finding) => finding.severity === "warning"));
  // "after" comes later than the introducing lesson: there was never
  // anything there to excuse.
  assert.match(unused.map((finding) => finding.message).join("\n"), /comes no earlier than "home"/);
  assert.match(unused.map((finding) => finding.message).join("\n"), /nothing in that lesson mentions it/);
});

void test("a mentioned_before entry that IS doing its job stays silent", () => {
  const plan = skills(`
version: 1
lessons:
  - id: intro
    verify: self
  - id: home
    verify: self
terms:
  - term: сезонность
    introduced_in: home
    mentioned_before: [intro]
`);
  const findings = lintCourse(
    course({
      m: [
        { id: "intro", content: `# intro\n\nДальше разберём сезонность. ${FILLER}` },
        { id: "home", content: `# home\n\nСезонность — это колебания по месяцам. ${FILLER}` },
      ],
    }),
    { skills: plan },
  );

  assert.deepEqual(of(findings, "term-mentioned-before-unused"), []);
  // And the exemption still does what it exists for.
  assert.deepEqual(of(findings, "term-used-before-introduced"), []);
});

// --- Empty and guessable content ----------------------------------------

void test("a placeholder lesson is an error once the course stops calling itself a skeleton", () => {
  const placeholder: LessonSpec = { id: "one", content: "# One\n\n> ЗАГЛУШКА — текст урока не написан.\n" };

  const shipped = lintCourse(course({ m: [placeholder] }, "1.0.0"));
  assert.equal(of(shipped, "lesson-is-placeholder").length, 1);

  // While the version says skeleton, placeholders are the point.
  const skeleton = lintCourse(course({ m: [placeholder] }, "0.1.0-skeleton"));
  assert.deepEqual(of(skeleton, "lesson-is-placeholder"), []);
});

void test("a lesson too short to explain anything is a warning", () => {
  const findings = lintCourse(course({ m: [{ id: "one", content: "# One\n\nКороткий урок." }] }));

  assert.equal(of(findings, "lesson-too-short").length, 1);
});

void test("inside a skeleton, a short WRITTEN lesson still warns and a placeholder does not", () => {
  // `lesson-too-short` used to be off for the whole package while the
  // version carried `-skeleton` — so the lessons an author had actually
  // finished went unmeasured for as long as any lesson was unfinished.
  const findings = lintCourse(
    course(
      {
        m: [
          { id: "stub", content: placeholder("stub") },
          { id: "thin", content: "# Thin\n\nКороткий урок." },
        ],
      },
      "0.1.0-skeleton",
    ),
  );

  assert.deepEqual(
    of(findings, "lesson-too-short").map((finding) => finding.path),
    ["modules[0].lessons[1]"],
  );
});

void test("a term whose lesson is still a placeholder is not yet expected to explain it", () => {
  const plan = skills(`
version: 1
lessons:
  - id: stub
    verify: self
terms:
  - term: сезонность
    introduced_in: stub
`);
  // The introducing lesson is unwritten, so "its text never uses the word"
  // is not a defect — it is the state the author is in.
  const stub = lintCourse(course({ m: [{ id: "stub", content: placeholder("stub") }] }, "0.1.0-skeleton"), {
    skills: plan,
  });
  assert.deepEqual(of(stub, "term-not-introduced"), []);

  // Written, and still silent about the term it was supposed to
  // introduce: a defect even though the course is a skeleton.
  const written = lintCourse(course({ m: [{ id: "stub", content: body("stub") }] }, "0.1.0-skeleton"), {
    skills: plan,
  });
  assert.equal(of(written, "term-not-introduced").length, 1);
});

void test("a quiz whose correct option is visibly the longest is a warning", () => {
  const findings = lintCourse(
    course({
      m: [
        {
          id: "quizzed",
          quiz: {
            question: "Why?",
            multiple: false,
            options: [
              {
                id: "long",
                text: "Потому что метрика считается за период и сравнивается со средней численностью",
                correct: true,
              },
              { id: "a", text: "Просто так", correct: false, explanation: "Нет." },
              { id: "b", text: "Не знаю", correct: false, explanation: "Нет." },
            ],
          },
        },
      ],
    }),
  );

  assert.equal(of(findings, "quiz-answer-guessable").length, 1);
});

void test("a multi-select quiz where any correct option stands out by length is a warning", () => {
  // The first correct option is inconspicuous; the second gives itself
  // away. Checking only the first would miss it.
  const findings = lintCourse(
    course({
      m: [
        {
          id: "quizzed",
          quiz: {
            question: "Which apply?",
            multiple: true,
            options: [
              { id: "short-right", text: "Да", correct: true },
              {
                id: "long-right",
                text: "Потому что метрика считается за период и сравнивается со средней численностью",
                correct: true,
              },
              { id: "a", text: "Просто так", correct: false, explanation: "Нет." },
              { id: "b", text: "Не знаю", correct: false, explanation: "Нет." },
            ],
          },
        },
      ],
    }),
  );

  assert.equal(of(findings, "quiz-answer-guessable").length, 1);
});

void test("an exact fractional answer warns, because everyone rounds somewhere", () => {
  const findings = lintCourse(
    course({
      m: [
        {
          id: "answered",
          practice: {
            type: "answer",
            prompt: "Report it.",
            fields: [{ id: "rate", label: "Текучесть, %", kind: "number", expected: 18.4, tolerance: 0 }],
          },
        },
      ],
    }),
  );

  assert.equal(of(findings, "answer-number-without-tolerance").length, 1);
});
