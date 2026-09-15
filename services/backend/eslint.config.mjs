// @ts-check
import base from "../../eslint.config.mjs";

// No service-specific parserOptions.project here (yet): the base config
// only pulls in `tseslint.configs.recommended` (syntactic rules), not the
// type-checked variant, so a TS "program" isn't needed for linting and
// wiring one up buys nothing but cost — @typescript-eslint/parser errors on
// any file outside the given tsconfig's `include` (this config file itself,
// and *.test.ts, which tsconfig.json deliberately excludes from the build).
// Revisit if a later task wants type-checked rules (see task-003 report,
// Deferred decisions).
export default [...base];
