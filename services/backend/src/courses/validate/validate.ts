import fs from "node:fs";
import path from "node:path";

// Named import, not default: ajv's package.json has no "type": "module", so
// under NodeNext this subpath's .d.ts type-checks as a CommonJS module —
// `import Ajv2020 from "ajv/dist/2020.js"` then resolves to the *namespace*
// type (no construct signature), not the class; the named export sidesteps
// that (verified empirically — see task-006 report, Deferred decisions).
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

import { CAPABILITIES, CODE_LANGUAGES, practiceTypeCapability, type CodeLanguage } from "../../capabilities/index.js";
import manifestSchema from "../manifest.schema.json" with { type: "json" };
import type {
  CourseAnswerField,
  CourseCodeCase,
  CourseCodePractice,
  CourseSandbox,
  CourseQuiz,
  CourseQuizOption,
  CoursePractice,
  CoursePracticeType,
  ValidatedLesson,
  ValidatedManifest,
  ValidatedModule,
  ValidationError,
  ValidationResult,
} from "../types.js";

// One shared, precompiled validator: ajv's compile step is the expensive
// part, and the schema never changes at runtime — compiling it once at
// module load beats recompiling per-course during a rescan.
const ajv = new Ajv2020({ allErrors: true, strict: true });
// The generic makes `validateStructure` act as a type guard (`data is
// RawManifest`) on success, so the semantic pass below doesn't need a manual
// cast past ajv — see validateManifest.
const validateStructure = ajv.compile<RawManifest>(manifestSchema);

// --- Raw manifest shapes (post JSON-Schema, pre semantic validation) -----
// Mirrors manifest.schema.json 1:1. `correct`/`explanation` stay optional
// here (as the manifest may write them) — validate.ts normalizes `correct`
// to a required boolean in the domain model (see types.ts's CourseQuizOption
// doc comment).

interface RawQuizOption {
  readonly id: string;
  readonly text: string;
  readonly correct?: boolean;
  readonly explanation?: string;
}

interface RawQuiz {
  readonly question: string;
  readonly multiple?: boolean;
  readonly options: readonly RawQuizOption[];
}

interface RawAnswerField {
  readonly id: string;
  readonly label: string;
  readonly kind: "number" | "text";
  readonly expected: number | string;
  readonly tolerance?: number;
}

/**
 * The manifest's `practice` block BEFORE the discriminator is applied: the
 * schema declares every property of both kinds on one object, so anything
 * kind-specific is optional here and `validatePractice` below is what
 * decides which combination is actually legal.
 */
interface RawPractice {
  readonly type?: CoursePracticeType;
  readonly prompt: string;
  readonly sandbox?: string;
  readonly check?: string;
  readonly expected?: string;
  /** Only writable alongside `expected` (manifest.schema.json's
   * `dependentRequired`), and normalized to a present boolean by
   * `validatePractice` below. */
  readonly ordered?: boolean;
  readonly solution?: string;
  readonly fields?: readonly RawAnswerField[];
  readonly language?: CodeLanguage;
  readonly entry?: string;
  readonly starter?: string;
  readonly cases?: readonly RawCodeCase[];
}

interface RawCodeCase {
  readonly args: readonly unknown[];
  /** Read with an `in` check, never `!== undefined`: `expected: null` is a value. */
  readonly expected?: unknown;
}

interface RawLesson {
  readonly id: string;
  readonly title: string;
  readonly content?: string;
  readonly quiz?: RawQuiz;
  readonly practice?: RawPractice;
}

interface RawModule {
  readonly id: string;
  readonly title: string;
  readonly lessons: readonly RawLesson[];
}

interface RawSandbox {
  readonly id: string;
  readonly type: "postgres";
  readonly seed?: readonly string[];
}

interface RawManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description?: string;
  readonly sandboxes?: readonly RawSandbox[];
  readonly modules: readonly RawModule[];
}

/**
 * Validates a parsed manifest.yaml (already YAML-parsed by the caller —
 * loader.ts) against the structural JSON Schema, then runs the semantic
 * checks the schema can't express (id uniqueness, exactly-one-correct quiz
 * option, sandbox references, lesson non-emptiness, path safety —
 * task-006 brief). Never throws: one broken course must not take the whole
 * registry (or app startup) down with it — see the brief and
 * .mvp/invariants.md.
 *
 * `packageDir` is the absolute path to the course package directory, used
 * only to resolve/check `content` and `sandboxes[].seed[]` paths — this
 * function does not read the referenced files' contents (that's loader.ts).
 * On success, `manifest.modules[].lessons[].contentPath` and
 * `manifest.sandboxes[].seed[]` are the absolute, realpath'd, ALREADY
 * VALIDATED paths (see `resolveSafePath`), not the raw relative strings
 * from the manifest — callers read/execute them directly.
 */
export function validateManifest(manifestSource: unknown, packageDir: string): ValidationResult {
  if (!validateStructure(manifestSource)) {
    // The semantic pass below assumes the manifest already matches
    // manifest.schema.json's shape (e.g. that `modules[i].lessons` is an
    // array, not `undefined`) — running it against a structurally invalid
    // manifest would throw a TypeError instead of a useful ValidationError,
    // so it's skipped entirely here (fix round 1: made explicit in the
    // payload itself, not just this comment, so a course author fixing a
    // typo doesn't assume the schema errors were the *only* problems and
    // then hit a second wave of semantic errors after fixing them).
    return {
      ok: false,
      errors: [
        ...(validateStructure.errors ?? []).map(describeAjvError),
        {
          path: "",
          message:
            "Structural errors must be fixed first — semantic checks (id uniqueness, exactly-one-correct " +
            "quiz option, sandbox references, path safety, ...) were not run against this manifest.",
        },
      ],
    };
  }

  // `validateStructure` is `ValidateFunction<RawManifest>` — the `if` above
  // is also a type guard, so `manifestSource` is narrowed to `RawManifest`
  // here without a manual cast (required fields present, types correct, no
  // unknown properties, all already checked by manifest.schema.json).
  const raw = manifestSource;
  const errors: ValidationError[] = [];

  const sandboxes = validateSandboxes(raw.sandboxes ?? [], packageDir, errors);
  const sandboxIds = new Set(sandboxes.map((sandbox) => sandbox.id));
  const modules = validateModules(raw.modules, packageDir, sandboxIds, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: ValidatedManifest = {
    id: raw.id,
    version: raw.version,
    title: raw.title,
    description: raw.description,
    sandboxes,
    modules,
  };
  return { ok: true, manifest };
}

function validateSandboxes(
  rawSandboxes: readonly RawSandbox[],
  packageDir: string,
  errors: ValidationError[],
): CourseSandbox[] {
  const seenIds = new Set<string>();
  return rawSandboxes.map((sandbox, index) => {
    const sandboxPath = `sandboxes[${index}]`;
    if (seenIds.has(sandbox.id)) {
      errors.push({
        path: `${sandboxPath}.id`,
        message: `Duplicate sandbox id "${sandbox.id}" — sandbox ids must be unique within a course.`,
      });
    } else {
      seenIds.add(sandbox.id);
    }

    const seed: string[] = [];
    (sandbox.seed ?? []).forEach((seedPath, seedIndex) => {
      const resolved = resolveSafePath(packageDir, seedPath);
      if (resolved.ok) {
        // Store the validated ABSOLUTE (realpath'd) path, not the raw
        // manifest string — task 009 reads/executes these directly and must
        // not need to re-derive or re-escape a relative path itself (final
        // review, backend fixes round: the domain must carry checked paths,
        // not raw ones with the checking logic locked away in this file).
        seed.push(resolved.absolutePath);
      } else {
        errors.push({ path: `${sandboxPath}.seed[${seedIndex}]`, message: resolved.reason });
      }
    });

    return { id: sandbox.id, type: sandbox.type, seed };
  });
}

function validateModules(
  rawModules: readonly RawModule[],
  packageDir: string,
  sandboxIds: ReadonlySet<string>,
  errors: ValidationError[],
): ValidatedModule[] {
  const seenModuleIds = new Set<string>();
  // Lesson ids are unique across the *whole course*, not per module — this
  // Set is shared across the entire .map() below, deliberately not reset
  // per module (task-006 brief, "Правила формата").
  const seenLessonIds = new Set<string>();

  return rawModules.map((module, moduleIndex) => {
    const modulePath = `modules[${moduleIndex}]`;
    if (seenModuleIds.has(module.id)) {
      errors.push({
        path: `${modulePath}.id`,
        message: `Duplicate module id "${module.id}" — module ids must be unique within a course.`,
      });
    } else {
      seenModuleIds.add(module.id);
    }

    const lessons = module.lessons.map((lesson, lessonIndex) =>
      validateLesson(lesson, `${modulePath}.lessons[${lessonIndex}]`, packageDir, sandboxIds, seenLessonIds, errors),
    );

    return { id: module.id, title: module.title, lessons };
  });
}

function validateLesson(
  lesson: RawLesson,
  lessonPath: string,
  packageDir: string,
  sandboxIds: ReadonlySet<string>,
  seenLessonIds: Set<string>,
  errors: ValidationError[],
): ValidatedLesson {
  if (seenLessonIds.has(lesson.id)) {
    errors.push({
      path: `${lessonPath}.id`,
      message: `Duplicate lesson id "${lesson.id}" — lesson ids must be unique across the whole course, not just within a module.`,
    });
  } else {
    seenLessonIds.add(lesson.id);
  }

  if (lesson.content === undefined && lesson.quiz === undefined && lesson.practice === undefined) {
    errors.push({
      path: lessonPath,
      message: `Lesson "${lesson.id}" has none of content/quiz/practice — a lesson must carry at least one.`,
    });
  }

  let contentPath: string | undefined;
  if (lesson.content !== undefined) {
    const resolved = resolveSafePath(packageDir, lesson.content);
    if (resolved.ok) {
      // Same reasoning as sandbox seed paths above: absolute, validated
      // path, not the raw manifest string — loader.ts reads this directly.
      contentPath = resolved.absolutePath;
    } else {
      errors.push({ path: `${lessonPath}.content`, message: resolved.reason });
    }
  }

  const quiz = lesson.quiz === undefined ? undefined : validateQuiz(lesson.quiz, `${lessonPath}.quiz`, errors);

  const practice =
    lesson.practice === undefined
      ? undefined
      : validatePractice(lesson.practice, `${lessonPath}.practice`, sandboxIds, errors);

  return { id: lesson.id, title: lesson.title, contentPath, quiz, practice };
}

/**
 * Applies the `type` discriminator the JSON Schema deliberately doesn't:
 * the schema declares both kinds' properties on one object (so an unknown
 * property is still a structural error), and this decides which of them
 * are legal together.
 *
 * Done here rather than as a schema `oneOf` so that writing `sandbox:` on
 * an `answer` assignment produces one sentence naming the offending
 * property, instead of ajv reporting every way the manifest failed to
 * match either branch.
 *
 * Always returns a practice, even when it pushed errors: `validateManifest`
 * discards the whole domain model as soon as `errors` is non-empty, and
 * returning a value here keeps the rest of the lesson's checks running so
 * an author sees every problem at once (same contract as `validateQuiz`).
 */
/**
 * Every property any practice type declares, mapped to the types that
 * declare it — built from the capability registry at module load.
 *
 * This is what makes a property "foreign": writing `sandbox:` on an
 * `answer` assignment is wrong because the `answer` capability document
 * does not list it, not because this file happens to remember that it
 * shouldn't. The lists used to be written out by hand here, and a hand-
 * written list of another type's properties is a list that goes stale the
 * moment a type gains a field — silently, by accepting it.
 *
 * Properties nobody declares are NOT this map's problem:
 * manifest.schema.json carries `additionalProperties: false` on the
 * practice block, so a typo is rejected structurally before the semantic
 * pass runs. What is left over is exactly the known-but-wrong-type case.
 */
const PRACTICE_FIELD_OWNERS: ReadonlyMap<string, readonly CoursePracticeType[]> = (() => {
  const owners = new Map<string, CoursePracticeType[]>();
  for (const capability of CAPABILITIES.practiceTypes) {
    for (const field of capability.manifestFields) {
      const declared = owners.get(field.name);
      if (declared === undefined) {
        owners.set(field.name, [capability.type]);
      } else {
        declared.push(capability.type);
      }
    }
  }
  return owners;
})();

/** The properties one practice type accepts, in the registry's order —
 * used to answer "then what may I write?" in the rejection itself. */
function declaredFields(type: CoursePracticeType): string {
  return (practiceTypeCapability(type)?.manifestFields ?? []).map((field) => field.name).join(", ");
}

/**
 * Rejects properties that belong to a DIFFERENT practice type than the one
 * declared. One error per offending property, naming it and the type it
 * belongs to: a course author who wrote `sandbox:` under `type: answer`
 * needs to know which half of the pair is the mistake.
 *
 * Foreign properties are rejected rather than ignored — project invariant.
 * Ignoring them would let a manifest declare a grading mechanic that never
 * runs, and the author would find out from a learner.
 */
function rejectForeignFields(
  practice: RawPractice,
  type: CoursePracticeType,
  practicePath: string,
  errors: ValidationError[],
): void {
  const written = practice as unknown as Record<string, unknown>;
  for (const [name, owners] of PRACTICE_FIELD_OWNERS) {
    if (owners.includes(type) || written[name] === undefined) {
      continue;
    }
    const belongsTo = owners.map((owner) => `"${owner}"`).join(" / ");
    errors.push({
      path: `${practicePath}.${name}`,
      message: `"${name}" belongs to a practice of type ${belongsTo}, not "${type}". A practice of type "${type}" may declare: ${declaredFields(type)}.`,
    });
  }
}

function validatePractice(
  practice: RawPractice,
  practicePath: string,
  sandboxIds: ReadonlySet<string>,
  errors: ValidationError[],
): CoursePractice {
  // Absent means `sql`: courses written before the `answer` mechanic
  // existed must stay valid, unchanged, forever.
  const type: CoursePracticeType = practice.type ?? "sql";

  rejectForeignFields(practice, type, practicePath, errors);

  if (type === "code") {
    return validateCodePractice(practice, practicePath, errors);
  }

  if (type === "answer") {
    if (practice.fields === undefined) {
      errors.push({
        path: `${practicePath}.fields`,
        message: `A practice of type "answer" must declare "fields" — at least one value the learner is asked to report.`,
      });
      return { type: "answer", prompt: practice.prompt, fields: [] };
    }
    return {
      type: "answer",
      prompt: practice.prompt,
      fields: validateAnswerFields(practice.fields, `${practicePath}.fields`, errors),
    };
  }

  if (practice.sandbox === undefined) {
    errors.push({
      path: `${practicePath}.sandbox`,
      message: `A practice of type "sql" must declare "sandbox" — the course sandbox its SQL runs in.`,
    });
  } else if (!sandboxIds.has(practice.sandbox)) {
    errors.push({
      path: `${practicePath}.sandbox`,
      message: `practice.sandbox "${practice.sandbox}" does not reference a declared sandboxes[].id.`,
    });
  }

  return {
    type: "sql",
    prompt: practice.prompt,
    // Placeholder for the missing-sandbox case above: an error was already
    // recorded, so this model is on its way to being discarded — it exists
    // only so the remaining lessons still get validated.
    sandbox: practice.sandbox ?? "",
    check: practice.check,
    expected: practice.expected,
    solution: practice.solution,
    // "по умолчанию false" is resolved here, once, rather than at every
    // read site: `ordered` exists in the domain model exactly when
    // `expected` does (types.ts). The schema's `dependentRequired`
    // already rejected an `ordered` without an `expected`, so there is
    // no manifest-declared value to drop here.
    ...(practice.expected === undefined ? {} : { ordered: practice.ordered ?? false }),
  };
}

/**
 * `type: code`. The schema already pinned the shapes (language enum,
 * entry pattern, cases min/max, args is an array); what is left is what a
 * schema cannot say: which fields this type REQUIRES (the schema's
 * `required` is shared by all types, so it lists only `prompt`), that
 * `default` is not an entry name, and that every case has SOME reference
 * — its own `expected`, or the assignment's `solution`.
 *
 * Always returns a practice, even after pushing errors (same contract as
 * validateAnswerFields: the model is about to be discarded, but the other
 * lessons still get checked).
 */
function validateCodePractice(
  practice: RawPractice,
  practicePath: string,
  errors: ValidationError[],
): CourseCodePractice {
  if (practice.language === undefined) {
    errors.push({
      path: `${practicePath}.language`,
      message: `A practice of type "code" must declare "language" — one of: ${CODE_LANGUAGES.join(", ")}.`,
    });
  }
  if (practice.entry === undefined) {
    errors.push({
      path: `${practicePath}.entry`,
      message: `A practice of type "code" must declare "entry" — the name of the function the learner's module exports.`,
    });
  } else if (practice.entry === "default") {
    errors.push({
      path: `${practicePath}.entry`,
      message: `"entry" must be a NAMED export; "default" is not one. Name the function ("export function sum") and write that name.`,
    });
  }
  if (practice.cases === undefined) {
    errors.push({
      path: `${practicePath}.cases`,
      message: `A practice of type "code" must declare "cases" — at least one set of arguments the function is called with.`,
    });
  }

  const cases: CourseCodeCase[] = (practice.cases ?? []).map((rawCase, index) => {
    // YAML has no undefined, so "the key is there" is the whole test —
    // `expected: null` is a reference value, not a missing one.
    const hasExpected = Object.hasOwn(rawCase, "expected");
    if (!hasExpected && practice.solution === undefined) {
      errors.push({
        path: `${practicePath}.cases[${index}].expected`,
        message:
          `Case ${index + 1} has no "expected" and the assignment declares no "solution" — the engine would have ` +
          `nothing to compare the learner's result with. Write the value, or add a "solution".`,
      });
    }
    return {
      args: rawCase.args,
      reference: hasExpected ? { kind: "expected", value: rawCase.expected } : { kind: "solution" },
    };
  });

  return {
    type: "code",
    // Placeholders for the missing-field cases above: an error was already
    // recorded and this model is on its way to being discarded.
    language: practice.language ?? "typescript",
    prompt: practice.prompt,
    entry: practice.entry ?? "",
    ...(practice.starter === undefined ? {} : { starter: practice.starter }),
    cases,
    ...(practice.solution === undefined ? {} : { solution: practice.solution }),
  };
}

function validateAnswerFields(
  fields: readonly RawAnswerField[],
  fieldsPath: string,
  errors: ValidationError[],
): CourseAnswerField[] {
  const seenIds = new Set<string>();

  return fields.map((field, index) => {
    const fieldPath = `${fieldsPath}[${index}]`;
    if (seenIds.has(field.id)) {
      errors.push({
        path: `${fieldPath}.id`,
        message: `Duplicate answer field id "${field.id}" — field ids must be unique within a practice assignment (they are the keys the client submits answers under).`,
      });
    } else {
      seenIds.add(field.id);
    }

    // The schema allows `expected` to be a number OR a string, because the
    // right one depends on a sibling property; naming the mismatch is this
    // pass's job.
    const numeric = field.kind === "number";
    if (numeric && typeof field.expected !== "number") {
      errors.push({
        path: `${fieldPath}.expected`,
        // The VALUE is never quoted back — `expected` is the answer to the
        // exercise, and a validation error is not a place to print it.
        message: `Answer field "${field.id}" is kind "number", so its "expected" must be a number, not a string.`,
      });
    }
    if (!numeric && typeof field.expected !== "string") {
      errors.push({
        path: `${fieldPath}.expected`,
        message: `Answer field "${field.id}" is kind "text", so its "expected" must be a string, not a number.`,
      });
    } else if (!numeric && (field.expected as string).trim() === "") {
      errors.push({
        path: `${fieldPath}.expected`,
        // Answers are compared trimmed (plugins/practice/answer/grade.ts), so a blank
        // expected value would be matched by a learner submitting nothing
        // at all — an assignment that grades itself.
        message: `Answer field "${field.id}" has a blank "expected" — there would be nothing to get right.`,
      });
    }
    if (!numeric && field.tolerance !== undefined) {
      errors.push({
        path: `${fieldPath}.tolerance`,
        message: `Answer field "${field.id}" is kind "text": "tolerance" only means something for a numeric field.`,
      });
    }

    return {
      id: field.id,
      label: field.label,
      kind: field.kind,
      expected: field.expected,
      // Same normalization choice as `ordered` above: the default lives
      // here, once, and the domain model carries `tolerance` exactly when
      // the field is numeric.
      ...(numeric ? { tolerance: field.tolerance ?? 0 } : {}),
    };
  });
}

function validateQuiz(quiz: RawQuiz, quizPath: string, errors: ValidationError[]): CourseQuiz {
  const seenOptionIds = new Set<string>();
  // Same normalization as an option's `correct`: the manifest may omit it,
  // the domain model always carries a boolean.
  const multiple = quiz.multiple === true;
  let correctCount = 0;

  const options: CourseQuizOption[] = quiz.options.map((option, index) => {
    const optionPath = `${quizPath}.options[${index}]`;
    if (seenOptionIds.has(option.id)) {
      errors.push({
        path: `${optionPath}.id`,
        message: `Duplicate quiz option id "${option.id}" — option ids must be unique within a quiz.`,
      });
    } else {
      seenOptionIds.add(option.id);
    }

    const correct = option.correct === true;
    if (correct) {
      correctCount += 1;
    } else if (option.explanation === undefined) {
      errors.push({
        path: `${optionPath}.explanation`,
        message: `Incorrect quiz option "${option.id}" is missing "explanation" — every incorrect option must explain why it's wrong.`,
      });
    }

    return { id: option.id, text: option.text, correct, explanation: option.explanation };
  });

  if (multiple) {
    // A multi-select quiz needs both sides to mean anything: no correct
    // option = nothing to submit, no incorrect option = "check everything".
    if (correctCount === 0) {
      errors.push({
        path: `${quizPath}.options`,
        message: `A multiple: true quiz must have at least one option with correct: true, found 0.`,
      });
    }
    if (correctCount === quiz.options.length) {
      errors.push({
        path: `${quizPath}.options`,
        message:
          `A multiple: true quiz must have at least one incorrect option — ` +
          `"check every box" grades nothing.`,
      });
    }
  } else if (correctCount !== 1) {
    // Deliberately NOT relaxed by the mere presence of several correct
    // options: a second correct: true without multiple: true is far more
    // likely a typo than an intent, and silently switching the quiz kind
    // would hide it.
    errors.push({
      path: `${quizPath}.options`,
      message: `Quiz must have exactly one option with correct: true, found ${correctCount}.`,
    });
  }

  return { question: quiz.question, multiple, options };
}

export type SafePathResult =
  | { readonly ok: true; readonly absolutePath: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves a manifest-declared relative path (lesson `content`, sandbox
 * `seed[]`) against the package directory and rejects anything that could
 * read outside it: absolute paths, `..` segments, and symlinks that resolve
 * outside the package directory (checked via `fs.realpathSync` on both
 * sides — a lexical `..` check alone can't catch a symlink escape). Also
 * requires the target to actually exist and be a regular file — per the
 * brief, both "path safety" and "file must exist" are the same check here,
 * not two separate passes.
 *
 * Exported (final review, backend fixes round) so task 009 can re-run this
 * exact same check on a sandbox's `seed[]` entries immediately before
 * executing them — `Course.sandboxes[].seed` already carries the absolute,
 * validated path from *this* scan (see below), but a scan can be
 * arbitrarily old by the time 009 acts on it (no filesystem watcher —
 * `POST /courses/rescan` is explicit), and the file underneath could have
 * changed or been swapped since. Re-validating right before executing SQL
 * from disk costs nothing and closes that window as far as this function
 * can.
 */
export function resolveSafePath(packageDir: string, relativePath: string): SafePathResult {
  if (path.isAbsolute(relativePath)) {
    return { ok: false, reason: `Path "${relativePath}" must be relative to the package directory, not absolute.` };
  }
  if (relativePath.split(/[/\\]+/).includes("..")) {
    return {
      ok: false,
      reason: `Path "${relativePath}" is not allowed to contain ".." (must stay inside the package directory).`,
    };
  }

  const candidate = path.resolve(packageDir, relativePath);

  let realPackageDir: string;
  try {
    realPackageDir = fs.realpathSync(packageDir);
  } catch {
    return { ok: false, reason: `Package directory "${packageDir}" could not be resolved.` };
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return { ok: false, reason: `Path "${relativePath}" does not point to an existing file.` };
  }

  const relativeFromPackageDir = path.relative(realPackageDir, realCandidate);
  if (relativeFromPackageDir.startsWith("..") || path.isAbsolute(relativeFromPackageDir)) {
    return {
      ok: false,
      reason: `Path "${relativePath}" resolves outside the package directory (possibly via a symlink).`,
    };
  }

  const stat = fs.statSync(realCandidate);
  if (!stat.isFile()) {
    return { ok: false, reason: `Path "${relativePath}" does not point to a regular file.` };
  }

  return { ok: true, absolutePath: realCandidate };
}

/** Converts one ajv error into this module's `{ path, message }` shape. The
 * manifest-relative path uses the brief's dotted/bracket notation
 * (`modules[1].lessons[0]...`), not ajv's native `/`-separated
 * `instancePath` — for `required` failures specifically, the missing
 * property name is appended, since ajv's own `instancePath` for that
 * keyword points at the *containing* object, not the missing field. */
function describeAjvError(err: ErrorObject): ValidationError {
  let manifestPath = ajvInstancePathToManifestPath(err.instancePath);
  if (err.keyword === "required") {
    const missingProperty = (err.params as { missingProperty: string }).missingProperty;
    manifestPath = manifestPath === "" ? missingProperty : `${manifestPath}.${missingProperty}`;
  }

  let message: string;
  if (err.keyword === "additionalProperties") {
    const additionalProperty = (err.params as { additionalProperty: string }).additionalProperty;
    message = `Unexpected property "${additionalProperty}" — additional properties are not allowed here.`;
  } else if (err.keyword === "required") {
    message = `Missing required property "${(err.params as { missingProperty: string }).missingProperty}".`;
  } else {
    message = err.message ?? "Manifest does not match the expected schema.";
  }

  return { path: manifestPath, message };
}

function ajvInstancePathToManifestPath(instancePath: string): string {
  const segments = instancePath.split("/").filter((segment) => segment !== "");
  let result = "";
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      result += `[${segment}]`;
    } else {
      result += result === "" ? segment : `.${segment}`;
    }
  }
  return result;
}
