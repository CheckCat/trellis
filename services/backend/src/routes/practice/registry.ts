// Which strategy grades which `practice.type`.
//
// Typed as a total map over `CoursePracticeType` on purpose: that type is
// derived from `PRACTICE_TYPES` in capabilities.ts, so registering a kind
// there without writing a strategy for it is a COMPILE error, not a 404
// discovered in production. The two registries cannot drift.
//
// Adding a mechanic is: an entry in capabilities.ts's `PRACTICE_TYPES` and
// `practiceTypes`, a module beside this one, and one line here. Nothing in
// index.ts, nothing in shared.ts, nothing in the provisioner.

import type { CoursePracticeType } from "../../capabilities.js";
import { answerPracticeStrategy } from "./answer.js";
import { sqlPracticeStrategy } from "./sql.js";
import type { PracticeStrategy } from "./shared.js";

export const PRACTICE_STRATEGIES: Readonly<Record<CoursePracticeType, PracticeStrategy>> = {
  sql: sqlPracticeStrategy,
  answer: answerPracticeStrategy,
};

/** The registered strategies, in `PRACTICE_TYPES` order. */
export function practiceStrategies(): readonly PracticeStrategy[] {
  return Object.values(PRACTICE_STRATEGIES);
}
