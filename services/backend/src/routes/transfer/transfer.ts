// Transfer API: carry progress between computers (home/work) as one
// versioned JSON file.
//
//   GET  /progress/export          -> the file (transfer/format.ts)
//   POST /progress/import          <- the same file, merged into this machine
//
// The import is a two-answer endpoint on purpose. When the file is OLDER
// than the progress already here, the first request writes NOTHING and comes
// back 409 with the full preview of what it would do; the client shows that
// warning (task 016) and repeats the request with `?confirm=true` to go
// ahead. The product asks for a warning, and a warning nobody has to answer
// is not one — this keeps the decision with the user without inventing a
// second "preview" endpoint or a server-side session.
//
// Everything else about the import is deliberately additive: progress is
// merged, never replaced, and a lesson never un-completes (see
// progress/repository.ts's `importProgress`). Even a confirmed stale import
// cannot lose a completion.
//
// One thing the import deliberately does NOT do: it does not re-apply the
// completion-mode gate that `POST .../complete` enforces (a quiz lesson can
// only be completed by answering it, a checked practice lesson by passing
// its check). An import does not COMPLETE anything — it restores completions
// already earned, on another machine, under that machine's copy of the
// course. Refusing them here would mean "transfer your progress, except the
// quizzes you passed", which is the opposite of what the file is for. It
// also cannot be used to cheat a gate: the same person could just as well
// answer the quiz locally, and everything here stays on their own computer.

import type { FastifyInstance } from "fastify";

import { buildProgressExport } from "../../transfer/export/index.js";
import { progressExportFileName, parseProgressExport } from "../../transfer/format/index.js";
import { planProgressImport, type ProgressImportPlan } from "../../transfer/import/index.js";
import { errorResponseSchema } from "../progress/index.js";

export default async function transferRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/progress/export",
    { schema: { response: { 200: progressExportFileSchema } } },
    async (_request, reply) => {
      const records = await fastify.progress.listAllProgress();
      const file = buildProgressExport(records, {
        installedVersion: (courseId) => fastify.courses.get(courseId)?.version,
      });
      // Lets a plain browser navigation save the file under a meaningful
      // name; a fetch-based client (task 016) ignores it and names its own
      // download. Nothing depends on it, so the endpoint stays a normal JSON
      // endpoint that a test can read with `response.json()`.
      void reply.header("content-disposition", `attachment; filename="${progressExportFileName(file.exportedAt)}"`);
      return file;
    },
  );

  fastify.post<{ Querystring: { confirm?: boolean }; Body: unknown }>(
    "/progress/import",
    {
      // A progress file is small (a few hundred bytes per completed lesson),
      // but it grows with every course a person has ever touched — this
      // lifts the ceiling off Fastify's 1MB default while keeping a finite
      // one, so a wrong file (a database dump, a video) is refused by size
      // instead of being parsed.
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        querystring: importQuerystringSchema,
        // No `body` schema on purpose: the body IS a user-picked file, and
        // every problem with it must be reported in this app's own words
        // (parseProgressExport's `problems`), not as an Ajv message about a
        // JSON pointer. Fastify still rejects a body that isn't valid JSON.
        response: { 200: importResultSchema, 400: importRejectionSchema, 409: importResultSchema },
      },
    },
    async (request, reply) => {
      const parsed = parseProgressExport(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.reason === "unsupported_version" ? "unsupported_export_version" : "invalid_export_file",
          message:
            parsed.reason === "not_an_export_file"
              ? "That file is not a Trellis progress export."
              : parsed.reason === "unsupported_version"
                ? "That progress file was written by a newer version of Trellis."
                : "That progress file could not be read — see the problems listed below.",
          problems: parsed.problems,
        });
      }

      const existing = await fastify.progress.listAllProgress();
      const plan = planProgressImport(parsed.file, existing, {
        isCourseInstalled: (courseId) => fastify.courses.get(courseId) !== undefined,
      });

      // A warning is only worth asking about when there is something to warn
      // about: an old file whose every completion is already here (the usual
      // shape of "I re-imported yesterday's file") changes nothing, so asking
      // the user to confirm a no-op would be friction with no decision behind
      // it. `stale` is still reported in the 200 body — the fact that the file
      // is old is information either way; it just isn't a question.
      const worthWarningAbout = plan.stale && plan.records.length > 0;
      if (worthWarningAbout && request.query.confirm !== true) {
        return reply.code(409).send({
          error: "import_older_than_local",
          message:
            `This progress file was saved on ${plan.fileExportedAt}, which is older than the progress already on ` +
            `this computer (last changed ${plan.localLatestProgressAt ?? "never"}). Nothing was imported. ` +
            `Importing it can only add completed lessons — it never removes any — so repeat the request with ` +
            `"?confirm=true" if this is the file you meant to use.`,
          ...toImportPayload(plan, false),
        });
      }

      await fastify.progress.importProgress(plan.records);
      return toImportPayload(plan, true);
    },
  );
}

/** The plan as the API reports it — the same body for the applied (200) and
 * the refused (409) case, so a client renders one shape either way and only
 * looks at `applied`. `records` is deliberately not part of it: the client
 * needs counts, not a copy of its own file back. */
function toImportPayload(plan: ProgressImportPlan, applied: boolean) {
  return {
    applied,
    stale: plan.stale,
    fileExportedAt: plan.fileExportedAt,
    localLatestProgressAt: plan.localLatestProgressAt,
    summary: plan.totals,
    courses: plan.courses,
    coursesNotInstalled: plan.coursesNotInstalled,
  };
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const exportedLessonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lessonId", "status", "completedAt"],
  properties: {
    lessonId: { type: "string" },
    status: { type: "string", enum: ["completed"] },
    completedAt: { type: "string" },
    courseVersion: { type: "string" },
  },
} as const;

const progressExportFileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "formatVersion", "exportedAt", "courses"],
  properties: {
    format: { type: "string" },
    formatVersion: { type: "integer" },
    exportedAt: { type: "string" },
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["courseId", "lessons"],
        properties: {
          courseId: { type: "string" },
          installedVersion: { type: "string" },
          lessons: { type: "array", items: exportedLessonSchema },
        },
      },
    },
  },
} as const;

const importQuerystringSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Answering the "this file is older than your progress" warning. Has no
    // effect on any other outcome — it is not a "force" flag.
    confirm: { type: "boolean" },
  },
} as const;

const importCourseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["courseId", "installed", "lessons", "created", "earlierCompletions", "unchanged"],
  properties: {
    courseId: { type: "string" },
    installed: { type: "boolean" },
    fileVersion: { type: "string" },
    lessons: { type: "integer" },
    created: { type: "integer" },
    earlierCompletions: { type: "integer" },
    unchanged: { type: "integer" },
  },
} as const;

const importResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["applied", "stale", "fileExportedAt", "summary", "courses", "coursesNotInstalled"],
  properties: {
    // Present (with `applied: false`) on the 409 too — see toImportPayload.
    error: { type: "string" },
    message: { type: "string" },
    applied: { type: "boolean" },
    stale: { type: "boolean" },
    fileExportedAt: { type: "string" },
    localLatestProgressAt: { type: "string" },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["courses", "lessons", "created", "earlierCompletions", "unchanged"],
      properties: {
        courses: { type: "integer" },
        lessons: { type: "integer" },
        created: { type: "integer" },
        earlierCompletions: { type: "integer" },
        unchanged: { type: "integer" },
      },
    },
    courses: { type: "array", items: importCourseSchema },
    coursesNotInstalled: { type: "array", items: { type: "string" } },
  },
} as const;

/** `errorResponseSchema` plus the per-field problems found in the file. */
const importRejectionSchema = {
  ...errorResponseSchema,
  properties: {
    ...errorResponseSchema.properties,
    problems: { type: "array", items: { type: "string" } },
  },
} as const;
