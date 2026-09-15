import type { FastifyInstance } from "fastify";

/**
 * GET /health — liveness probe. Backs the docker-compose `backend`
 * healthcheck (see docker-compose.yml, which polls this endpoint from
 * inside the container) and the startup script (task 018).
 *
 * No DB check here: there is no database connection yet at this stage of
 * the project (task 005 owns the data layer). Task 005 is expected to
 * extend this response once a connection exists to probe.
 */
export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status"],
            additionalProperties: false,
            properties: {
              status: { type: "string", enum: ["ok"] },
            },
          },
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );
}
