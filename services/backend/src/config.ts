// The single place in this service that reads `process.env` — everything
// else consumes `AppConfig`, never `process.env` directly.
//
// `parseConfig` is a pure function with no top-level call against the real
// `process.env` anywhere in this module, so importing `config.ts` has no
// side effects: it stays safe to import from tests (which call `parseConfig`
// with a substitute env) as well as from the server entry point. An eager
// module-level singleton (`export const config = parseConfig()`) would make
// every file that imports this module — including test files that only want
// to exercise the parsing logic itself — require real
// DATABASE_URL/SANDBOX_DATABASE_URL values just to load. See task-003 report,
// Deferred decisions.

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly sandboxDatabaseUrl: string;
  readonly coursesDir: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
// Exported (not just a local const) so server.ts's buildServer() can fall
// back to the same default when no explicit coursesDir/registry override is
// given — one source of truth for "where courses live if COURSES_DIR isn't
// set", instead of the default being duplicated/drifting between the two
// files (see task-006 report, courses registry wiring in buildServer).
export const DEFAULT_COURSES_DIR = "/courses";

function requireNonEmpty(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: expected an integer in 1-65535, got "${raw}"`);
  }
  return port;
}

/**
 * Parses and validates the process environment into an immutable AppConfig.
 * Defaults to `process.env`; tests pass a substitute object.
 *
 * Fails fast with a descriptive Error on the first missing/invalid required
 * value — never a silent `undefined` surfacing deeper in the app.
 *
 * `databaseUrl`/`sandboxDatabaseUrl` are only validated as non-empty strings
 * here — nothing in this task connects to Postgres (that's task 005).
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(env.PORT);
  const databaseUrl = requireNonEmpty(env, "DATABASE_URL");
  const sandboxDatabaseUrl = requireNonEmpty(env, "SANDBOX_DATABASE_URL");
  const coursesDir = env.COURSES_DIR?.trim() || DEFAULT_COURSES_DIR;

  return Object.freeze({
    host,
    port,
    databaseUrl,
    sandboxDatabaseUrl,
    coursesDir,
  });
}
