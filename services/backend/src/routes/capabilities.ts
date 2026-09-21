// GET /capabilities — what this engine can do, as data.
//
// The audience is whoever writes a course package: a person reading
// courses/README.md, or a generator that should READ what the engine
// accepts instead of remembering it. Both get the same document that
// docs/contracts/capabilities.json holds, from the same object
// (capabilities.ts) — a running build can therefore never disagree with
// the committed contract about what it supports.
//
// Read-only, unauthenticated and free of any per-request state: this is a
// description of the build, identical for every caller.

import type { FastifyInstance } from "fastify";

import { CAPABILITIES } from "../capabilities.js";

export default async function capabilitiesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/capabilities",
    {
      // No response schema on purpose, unlike every other route here.
      // fast-json-stringify would need a second, hand-written description
      // of a document whose whole reason to exist is being the single
      // description — and any field it failed to declare would be silently
      // dropped from the answer. The payload is a frozen constant, not
      // user data, so there is nothing to validate away.
      schema: { response: {} },
    },
    async () => CAPABILITIES,
  );
}
