// @ts-check
import base from "../../eslint.config.mjs";

// Follows the task-001 pattern: `[...base, { ...service-specific }]`. No
// extra plugins here (react-hooks/react-refresh lint plugins are not in the
// brief's fixed dependency list for this task — deliberately deferred, see
// report) — this only adds the browser globals this package's code runs
// against (`window`, `document`, `fetch`, ...), which base doesn't seat
// since the backend runs in Node instead.
export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        console: "readonly",
        AbortController: "readonly",
      },
    },
  },
];
