// @ts-check
import base from "../../eslint.config.mjs";

// Follows the task-001 pattern: `[...base, { ...service-specific }]`. The
// override object below only adds an ignore for dist-test/ (tsconfig.test.json's
// compiled-test output — base's `**/dist/**` ignore doesn't match this
// differently-named directory). No `parserOptions.project` here (yet): base
// only pulls in `tseslint.configs.recommended` (syntactic rules), not the
// type-checked variant, so a TS "program" isn't needed for linting, and
// wiring one up buys nothing but cost — @typescript-eslint/parser errors on
// any file outside the given tsconfig's `include` (this config file itself,
// and *.test.ts, which tsconfig.json deliberately excludes from the prod
// build). Revisit if a later task (005/006) wants type-checked rules or
// other service-specific overrides — this is the slot for them (see
// task-003 report, Deferred decisions / Fix round 1).
export default [
  ...base,
  {
    ignores: ["dist-test/**"],
  },
];
