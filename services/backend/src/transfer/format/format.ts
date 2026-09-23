// The progress transfer file: what an export contains, and how an incoming
// file is checked before a single row is written.
//
// Product decisions this file implements literally (business-logic.md,
// clarify Q-006): the transfer format is a VERSIONED, APP-LEVEL JSON
// carrying PROGRESS DATA ONLY — never a pg_dump, never a copy of course
// content. Two consequences that are easy to get wrong:
//
//   - No lesson titles, no module structure, no quiz/practice anything. A
//     course is identified here by its id (and versions, see below) and
//     nothing else: the course format and the progress format are separate
//     entities (project invariant), and a title in here would be a stale
//     copy of content the importing machine may hold a different version of.
//   - The file carries its own "last saved" timestamp (`exportedAt`) and the
//     course ids/versions, which is what makes the "this file is older than
//     what you already have" warning (transfer/import.ts) readable from the
//     file alone, without a database.
//
// Versions appear at two levels, and they mean different things:
//   - `courses[].installedVersion` — the version of that course installed on
//     the machine that produced the file, at export time. Absent when the
//     course wasn't installed there (progress for a not-installed course is
//     kept and exported too — clarify Q-009).
//   - `courses[].lessons[].courseVersion` — provenance of that single
//     completion: the course version recorded when the lesson was passed
//     (see `ProgressRecord.courseVersion`). Never a matching key: progress
//     matches on stable ids only.
//
// Nothing here talks to Fastify, Postgres or the filesystem — `parse` takes
// an already-decoded JSON value (the HTTP layer does the decoding) and
// returns either a normalized file or a list of human-readable problems.

/** The `format` marker every Trellis progress file carries. Its only job is
 * to make "the user picked the wrong file" a clear, immediate answer instead
 * of a confusing list of missing fields. */
export const PROGRESS_EXPORT_FORMAT = "trellis.progress";

/**
 * Version of the FILE FORMAT — not of the app, and not of any course. Bump
 * it only when the shape below changes in a way an older reader would
 * misread; add the migration branch in `parseProgressExport` when that
 * happens (a file from a NEWER Trellis is rejected by version, with a
 * message saying so, rather than half-read).
 */
export const PROGRESS_EXPORT_FORMAT_VERSION = 1;

export interface ExportedLessonProgress {
  readonly lessonId: string;
  /** Only completions are ever stored or transferred — "not started" is the
   * absence of an entry (same model as the table, see
   * migrations/001_progress.sql). Written out explicitly so the file is
   * self-describing rather than relying on that convention. */
  readonly status: "completed";
  /** ISO 8601 UTC. When the lesson was FIRST completed. */
  readonly completedAt: string;
  /** Provenance only (see the header comment). */
  readonly courseVersion?: string;
}

export interface ExportedCourseProgress {
  readonly courseId: string;
  /** The course version installed on the exporting machine, when it was
   * installed there at all. */
  readonly installedVersion?: string;
  readonly lessons: readonly ExportedLessonProgress[];
}

export interface ProgressExportFile {
  readonly format: typeof PROGRESS_EXPORT_FORMAT;
  readonly formatVersion: number;
  /** "Метка времени последнего сохранения" — ISO 8601 UTC, the instant the
   * file was produced. The import warning compares this against the newest
   * local progress. */
  readonly exportedAt: string;
  /** Courses with at least one completion, ordered by `courseId`. A course
   * that is installed but has no progress does not appear: this file holds
   * progress, not an inventory of courses. */
  readonly courses: readonly ExportedCourseProgress[];
}

export type ProgressExportRejection =
  /** The JSON is well-formed but is not a Trellis progress file at all (no
   * or wrong `format` marker) — most likely the user picked the wrong file. */
  | "not_an_export_file"
  /** A Trellis progress file whose `formatVersion` this build cannot read. */
  | "unsupported_version"
  /** A Trellis progress file of a supported version with broken contents. */
  | "malformed";

export type ParsedProgressExport =
  | { readonly ok: true; readonly file: ProgressExportFile }
  | {
      readonly ok: false;
      readonly reason: ProgressExportRejection;
      /** One sentence per problem, safe to show to the person who picked the
       * file (paths like `courses[0].lessons[2].completedAt`, no stack
       * traces). Always non-empty. */
      readonly problems: readonly string[];
    };

// Deliberately stricter than `Date.parse`, which accepts (implementation
// defined) shapes like "March 3 2026" and would let a hand-edited file
// through with a timestamp whose meaning depends on the runtime. Date-time
// with a date, a time, and an EXPLICIT zone ("Z" or a ±hh:mm offset).
//
// Two shapes are refused on purpose:
//   - a plain date ("2026-01-01") — a progress timestamp without a time is
//     not something this app ever writes;
//   - a date-time with no zone ("2026-01-01T10:00:00") — `Date.parse` reads
//     that as the IMPORTING machine's local time, so the same file would
//     canonicalize to a different instant depending on where it is opened,
//     and with it the "is this file older than my progress?" verdict. A
//     transfer format whose meaning depends on the reader's timezone is not
//     a transfer format; this app's own exports always write "Z".
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Validates an already-decoded JSON value as a progress export file and
 * normalizes it (unknown fields dropped, timestamps canonicalized to ISO
 * 8601 UTC). Never throws: every rejection comes back as `problems`.
 *
 * It collects ALL problems rather than failing on the first one — a person
 * fixing a hand-written file should not have to re-upload it once per typo.
 */
export function parseProgressExport(value: unknown): ParsedProgressExport {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      reason: "not_an_export_file",
      problems: ["The file does not contain a JSON object — a Trellis progress file is a single JSON object."],
    };
  }

  if (value.format !== PROGRESS_EXPORT_FORMAT) {
    return {
      ok: false,
      reason: "not_an_export_file",
      problems: [
        `This is not a Trellis progress file: its "format" field is ${describeValue(value.format)}, ` +
          `expected "${PROGRESS_EXPORT_FORMAT}".`,
      ],
    };
  }

  const formatVersion = value.formatVersion;
  if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return {
      ok: false,
      reason: "malformed",
      problems: [`formatVersion: expected a positive whole number, got ${describeValue(formatVersion)}.`],
    };
  }
  if (formatVersion > PROGRESS_EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported_version",
      problems: [
        `This progress file is version ${formatVersion}, but this version of Trellis can only read files up to ` +
          `version ${PROGRESS_EXPORT_FORMAT_VERSION}. Update Trellis on this computer, or export again from an ` +
          `older one.`,
      ],
    };
  }
  // Only version 1 exists so far. When version 2 arrives, this is where its
  // branch goes (read the old shape, upgrade it here) — never by loosening
  // the checks below, which describe version 1 and must keep describing it.

  const problems: string[] = [];
  const exportedAt = readTimestamp(value.exportedAt, "exportedAt", problems);

  const courses: ExportedCourseProgress[] = [];
  const rawCourses = value.courses;
  if (!Array.isArray(rawCourses)) {
    problems.push(`courses: expected an array, got ${describeValue(rawCourses)}.`);
  } else {
    const seenCourseIds = new Set<string>();
    rawCourses.forEach((rawCourse, courseIndex) => {
      const at = `courses[${courseIndex}]`;
      if (!isPlainObject(rawCourse)) {
        problems.push(`${at}: expected an object, got ${describeValue(rawCourse)}.`);
        return;
      }
      const courseId = readNonEmptyString(rawCourse.courseId, `${at}.courseId`, problems);
      if (courseId !== undefined) {
        if (seenCourseIds.has(courseId)) {
          // Two entries for one course would make the import order-dependent
          // (and, in the database, a single statement trying to upsert the
          // same key twice) — rejected instead of silently merged.
          problems.push(`${at}.courseId: duplicate course id "${courseId}" — each course may appear only once.`);
        }
        seenCourseIds.add(courseId);
      }
      const installedVersion = readOptionalNonEmptyString(
        rawCourse.installedVersion,
        `${at}.installedVersion`,
        problems,
      );

      const lessons: ExportedLessonProgress[] = [];
      const rawLessons = rawCourse.lessons;
      if (!Array.isArray(rawLessons)) {
        problems.push(`${at}.lessons: expected an array, got ${describeValue(rawLessons)}.`);
      } else {
        const seenLessonIds = new Set<string>();
        rawLessons.forEach((rawLesson, lessonIndex) => {
          const lessonAt = `${at}.lessons[${lessonIndex}]`;
          if (!isPlainObject(rawLesson)) {
            problems.push(`${lessonAt}: expected an object, got ${describeValue(rawLesson)}.`);
            return;
          }
          const lessonId = readNonEmptyString(rawLesson.lessonId, `${lessonAt}.lessonId`, problems);
          if (lessonId !== undefined) {
            if (seenLessonIds.has(lessonId)) {
              problems.push(
                `${lessonAt}.lessonId: duplicate lesson id "${lessonId}" in course ` +
                  `"${courseId ?? "?"}" — each lesson may appear only once.`,
              );
            }
            seenLessonIds.add(lessonId);
          }
          if (rawLesson.status !== "completed") {
            problems.push(
              `${lessonAt}.status: expected "completed" (the only status a progress file carries), got ` +
                `${describeValue(rawLesson.status)}.`,
            );
          }
          const completedAt = readTimestamp(rawLesson.completedAt, `${lessonAt}.completedAt`, problems);
          const courseVersion = readOptionalNonEmptyString(
            rawLesson.courseVersion,
            `${lessonAt}.courseVersion`,
            problems,
          );
          if (lessonId !== undefined && completedAt !== undefined && rawLesson.status === "completed") {
            lessons.push({ lessonId, status: "completed", completedAt, courseVersion });
          }
        });
      }

      if (courseId !== undefined) {
        courses.push({ courseId, installedVersion, lessons });
      }
    });
  }

  if (problems.length > 0 || exportedAt === undefined) {
    return { ok: false, reason: "malformed", problems };
  }
  return { ok: true, file: { format: PROGRESS_EXPORT_FORMAT, formatVersion, exportedAt, courses } };
}

/**
 * Suggested download name for an export, e.g.
 * `trellis-progress-2026-09-16T12-30-00Z.json`. Colons are not legal in
 * Windows filenames (the target platform for the launcher scripts), so the
 * timestamp is punctuated with dashes rather than pasted in raw.
 */
export function progressExportFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `trellis-progress-${stamp}.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, at: string, problems: string[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    problems.push(`${at}: expected a non-empty string, got ${describeValue(value)}.`);
    return undefined;
  }
  return value;
}

function readOptionalNonEmptyString(value: unknown, at: string, problems: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readNonEmptyString(value, at, problems);
}

/** Accepts an ISO 8601 date-time WITH a zone, returns it canonicalized to
 * UTC (see `ISO_DATE_TIME` for why the zone is required). */
function readTimestamp(value: unknown, at: string, problems: string[]): string | undefined {
  if (typeof value !== "string" || !ISO_DATE_TIME.test(value)) {
    problems.push(
      `${at}: expected an ISO 8601 timestamp with a time zone (e.g. "2026-09-16T12:30:00.000Z" or ` +
        `"2026-09-16T15:30:00+03:00"), got ${describeValue(value)}.`,
    );
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    problems.push(`${at}: "${value}" is not a real date.`);
    return undefined;
  }
  return new Date(parsed).toISOString();
}

/** Short, quoted rendering of an unexpected value for an error message —
 * never the whole file, never a stack trace. */
function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "an array";
  return "an object";
}
