// @ts-check
// NOTE: the `eslint` package itself does not export `configs` for flat
// config (verified: `Object.keys(await import("eslint"))` has no
// `configs`) — the recommended core JS ruleset lives in the separate
// `@eslint/js` package maintained by the ESLint team. It is added here as
// a devDependency alongside eslint/typescript-eslint to fulfil the
// `eslint.configs.recommended` requirement; see task-001 report, Deferred
// decisions.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Reusable base config: services/*/eslint.config.mjs imports this array and
// appends service-specific overrides (e.g. `[...base, { ...serviceRules }]`).
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Скрипты обслуживания (scripts/*.mjs) — обычные Node-модули, а не
    // код сервиса: у них нет своего tsconfig и своего eslint.config.mjs,
    // поэтому глобалы Node объявляются здесь. Без этого `console` и
    // `process` в них — no-undef, и файлы фактически оставались
    // непроверенными: корневой `npm run lint` их не охватывал вовсе.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
