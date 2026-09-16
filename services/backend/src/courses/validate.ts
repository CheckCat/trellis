import fs from "node:fs";
import path from "node:path";

// Named import, not default: ajv's package.json has no "type": "module", so
// under NodeNext this subpath's .d.ts type-checks as a CommonJS module —
// `import Ajv2020 from "ajv/dist/2020.js"` then resolves to the *namespace*
// type (no construct signature), not the class; the named export sidesteps
// that (verified empirically — see task-006 report, Deferred decisions).
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

import manifestSchema from "./manifest.schema.json" with { type: "json" };
import type {
  CourseSandbox,
  CourseQuiz,
  CourseQuizOption,
  CoursePractice,
  ValidatedLesson,
  ValidatedManifest,
  ValidatedModule,
  ValidationError,
  ValidationResult,
} from "./types.js";

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
  readonly options: readonly RawQuizOption[];
}

interface RawPractice {
  readonly sandbox: string;
  readonly prompt: string;
  readonly check?: string;
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
        seed.push(seedPath);
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
      contentPath = lesson.content;
    } else {
      errors.push({ path: `${lessonPath}.content`, message: resolved.reason });
    }
  }

  const quiz = lesson.quiz === undefined ? undefined : validateQuiz(lesson.quiz, `${lessonPath}.quiz`, errors);

  let practice: CoursePractice | undefined;
  if (lesson.practice !== undefined) {
    if (!sandboxIds.has(lesson.practice.sandbox)) {
      errors.push({
        path: `${lessonPath}.practice.sandbox`,
        message: `practice.sandbox "${lesson.practice.sandbox}" does not reference a declared sandboxes[].id.`,
      });
    }
    practice = { sandbox: lesson.practice.sandbox, prompt: lesson.practice.prompt, check: lesson.practice.check };
  }

  return { id: lesson.id, title: lesson.title, contentPath, quiz, practice };
}

function validateQuiz(quiz: RawQuiz, quizPath: string, errors: ValidationError[]): CourseQuiz {
  const seenOptionIds = new Set<string>();
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

  if (correctCount !== 1) {
    errors.push({
      path: `${quizPath}.options`,
      message: `Quiz must have exactly one option with correct: true, found ${correctCount}.`,
    });
  }

  return { question: quiz.question, options };
}

type SafePathResult = { readonly ok: true; readonly absolutePath: string } | { readonly ok: false; readonly reason: string };

/**
 * Resolves a manifest-declared relative path (lesson `content`, sandbox
 * `seed[]`) against the package directory and rejects anything that could
 * read outside it: absolute paths, `..` segments, and symlinks that resolve
 * outside the package directory (checked via `fs.realpathSync` on both
 * sides — a lexical `..` check alone can't catch a symlink escape). Also
 * requires the target to actually exist and be a regular file — per the
 * brief, both "path safety" and "file must exist" are the same check here,
 * not two separate passes.
 */
function resolveSafePath(packageDir: string, relativePath: string): SafePathResult {
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
