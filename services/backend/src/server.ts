import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { parseConfig } from "./config.ts";
import healthRoutes from "./routes/health.ts";

/**
 * Builds a configured Fastify instance with all core plugins registered, but
 * never starts listening. Tests use this directly with `app.inject()`
 * (no real socket opened, no env vars required). Tasks 005/006 register
 * their own plugins on this same instance (data layer, course registry)
 * before the entry point below calls `listen()`.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  return app;
}

// Only starts listening when this file is executed directly (`node
// dist/server.js` / `npm start`), never on import — so `buildServer` stays
// safe to import from tests without requiring DATABASE_URL/
// SANDBOX_DATABASE_URL to be set or opening a real socket.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = parseConfig();
  const app = buildServer();
  app.listen({ host: config.host, port: config.port }).catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
}
