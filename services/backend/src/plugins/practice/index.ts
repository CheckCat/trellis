// Practice API — the plugin, and nothing else.
//
// This file names no practice type, no endpoint and no grading rule: it
// loops over the strategy registry and lets each mechanic register its own
// routes. That is the whole point of the split. A future `code` (a runner
// with tests) or `file` (checking an uploaded file) mechanic is a module
// beside this one plus an entry in capabilities.ts and registry.ts — this
// file does not change, which is the project invariant made structural
// rather than merely stated.
//
// `strategies` is injectable for the same reason `buildServer` takes a
// `pool`/`registry`/`progress`: so a test can prove that claim by
// registering a mechanic the shipped build has never heard of.

import type { FastifyInstance } from "fastify";

import { practiceStrategies } from "./registry.js";
import type { PracticeStrategy } from "./api.js";

export interface PracticeRoutesOptions {
  /** Defaults to the built-in registry. */
  readonly strategies?: readonly PracticeStrategy[];
}

export default async function practiceRoutes(
  fastify: FastifyInstance,
  options: PracticeRoutesOptions = {},
): Promise<void> {
  for (const strategy of options.strategies ?? practiceStrategies()) {
    await strategy.register(fastify);
  }
}

export { PRACTICE_STRATEGIES, practiceStrategies } from "./registry.js";
export type { PracticeStrategy } from "./api.js";
