// Sandbox API: see whether a course's practice sandbox is prepared.
//
// There was a second endpoint here — "сбросить песочницу", a manual rebuild
// from the course's seed. It went away when every practice attempt began
// re-seeding on its own (plugins/practice/sql/route.ts): a button that restores the
// starting state is noise next to an engine that never leaves it. The
// provisioner's `reset` stays — it is what the attempt path rebuilds with.
//
// Nothing here knows any SQL. The endpoint calls `fastify.sandbox` (the
// provisioner) and translates its one error type into an honest HTTP
// status; whether the sandbox is a Postgres schema or something else is not
// this file's business.
//
// Note what is NOT exposed: no endpoint returns seed SQL text, and none runs
// arbitrary SQL — running the user's own SQL in the sandbox is task 009's
// `plugins/practice/sql/`, deliberately a separate surface.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { isSandboxError, type SandboxErrorKind, type SandboxState } from "../../sandbox/types.js";
import { sendCourseNotFound } from "../progress/index.js";

/** The whole mapping from "what went wrong" to "what the client sees". Kept
 * as data (and exhaustive by `Record<SandboxErrorKind, ...>`, so adding a
 * kind without deciding its status is a compile error) rather than a chain
 * of ifs that could quietly answer 500 for a new kind. */
export const STATUS_BY_KIND: Record<SandboxErrorKind, number> = {
  course_not_found: 404,
  sandbox_not_found: 404,
  ambiguous_sandbox: 400,
  // Course content is broken (a seed file vanished, or the database rejected
  // it). The request was well-formed and the server is fine — 422.
  seed_unreadable: 422,
  seed_failed: 422,
  // The sandbox backend itself is unreachable or not configured — the same
  // class of answer /health gives when Postgres is down.
  unavailable: 503,
};

export default async function sandboxRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { courseId: string } }>(
    "/courses/:courseId/sandbox",
    {
      schema: {
        params: courseParamsSchema,
        response: { 200: sandboxStatusResponseSchema, 404: sandboxErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const course = fastify.courses.get(request.params.courseId);
      if (course === undefined) {
        return sendCourseNotFound(reply, request.params.courseId);
      }
      // Scoped to this course on purpose: another course's live sandbox is
      // not this course's sandbox, and reporting it as "ready" would tell
      // the UI a practice lesson can run against seed data that isn't there.
      const state = fastify.sandbox.status(course.id);
      return toStatusPayload(state);
    },
  );

}

/** The status response: `active` first, everything else only when there is
 * something to describe. A client checks `active` — it never has to infer
 * readiness from the presence of some other field. */
function toStatusPayload(state: SandboxState | undefined) {
  if (state === undefined) {
    return { active: false };
  }
  return {
    active: true,
    courseId: state.courseId,
    sandboxId: state.sandboxId,
    type: state.type,
    // Package-relative paths (`sandbox/01-schema.sql`) — what a course
    // author wrote in the manifest. Absolute host paths would leak where
    // courses are mounted and mean nothing to the reader.
    seedFiles: [...state.seedFiles],
    readyAt: state.readyAt,
  };
}

/** Shared with plugins/practice/sql/ (task 009): preparing a course's sandbox
 * before running practice SQL goes through the same `fastify.sandbox.ensure`
 * and can fail in exactly the same ways, so both surfaces must answer the
 * same status and the same body for the same `SandboxError` — a second copy
 * of this mapping would be free to drift. */
export function sendSandboxError(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
  if (!isSandboxError(err)) {
    // Not ours to translate — let Fastify's own error handler produce the
    // 500 and log it, rather than dressing an unknown bug up as a tidy
    // sandbox error.
    throw err;
  }
  const status = STATUS_BY_KIND[err.kind];
  if (status >= 500) {
    request.log.error({ err }, "practice sandbox is unavailable");
  } else {
    request.log.warn({ err }, "practice sandbox request rejected");
  }
  return reply.code(status).send({
    error: err.kind,
    message: err.message,
    ...(err.seedFile === undefined ? {} : { seedFile: err.seedFile }),
    ...(err.databaseError === undefined ? {} : { databaseError: err.databaseError }),
  });
}

// --- JSON Schemas (plain JSON Schema, same choice as routes/courses.ts) ---

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string" } },
} as const;

const sandboxStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["active"],
  properties: {
    active: { type: "boolean" },
    courseId: { type: "string" },
    sandboxId: { type: "string" },
    type: { type: "string" },
    seedFiles: { type: "array", items: { type: "string" } },
    readyAt: { type: "string" },
  },
} as const;

// Like routes/progress.ts's `errorResponseSchema`, plus the two fields a
// broken seed needs: which file, and what the database said about it —
// verbatim, so a course author can act on it without reading server logs.
const sandboxErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    seedFile: { type: "string" },
    databaseError: { type: "string" },
  },
} as const;
