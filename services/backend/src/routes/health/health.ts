import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * GET /health — readiness probe. Backs the docker-compose `backend`
 * healthcheck (see docker-compose.yml, which polls this endpoint from
 * inside the container) and the startup script (task 018): "healthy" here
 * is defined as "the database is reachable" (migrations having already run
 * to completion before the server starts listening at all — see
 * server.ts/migrate.ts — so a 200 here also implies migrations are applied).
 *
 * Checks the db by running a trivial query through `fastify.db` (decorated
 * in server.ts) rather than tracking connectivity state separately — one
 * source of truth (can we query right now?), no state that can drift from
 * reality.
 */
export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "db"],
            additionalProperties: false,
            properties: {
              status: { type: "string", enum: ["ok"] },
              db: { type: "string", enum: ["ok"] },
            },
          },
          503: {
            type: "object",
            required: ["status", "db"],
            additionalProperties: false,
            properties: {
              status: { type: "string", enum: ["degraded"] },
              db: { type: "string", enum: ["down"] },
            },
          },
        },
      },
    },
    async (request, reply: FastifyReply) => {
      try {
        await fastify.db.query("select 1");
        return { status: "ok" as const, db: "ok" as const };
      } catch (err) {
        request.log.error({ err }, "health check: database unreachable");
        return reply.code(503).send({ status: "degraded" as const, db: "down" as const });
      }
    },
  );
}
