// Finding the repository root from inside the compiled service.
//
// Needed by the two things that straddle the service boundary: the
// capabilities CLI, which writes docs/contracts/capabilities.json at the
// repo root, and capabilities.test.ts, which reads
// docker/postgres/init/02-schemas.sql to check a limit this service only
// reports. Both must work regardless of the working directory and of
// whether they run from `dist/` or `dist-test/`, which rules out both
// `process.cwd()` and a hardcoded `../../..`.
//
// Nothing in the running server imports this: the service itself never
// reads outside its own directory.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The root package.json's `name` — the marker that says "this is the
 * repository, not one of its workspaces". */
const ROOT_PACKAGE_NAME = "trellis";

/**
 * Walks up from this module until it finds the workspace root, identified
 * by a package.json named `trellis`. Throws rather than guessing: every
 * caller writes or reads a specific repo-relative path, and silently
 * resolving it against the wrong directory would be worse than failing.
 */
export function findRepoRoot(from: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let current = path.resolve(from);
  for (;;) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (typeof parsed === "object" && parsed !== null && (parsed as { name?: unknown }).name === ROOT_PACKAGE_NAME) {
          return current;
        }
      } catch {
        // An unreadable/!JSON package.json on the way up is not this
        // function's problem — keep walking.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not find the repository root above "${from}" ` +
          `(looked for a package.json named "${ROOT_PACKAGE_NAME}").`,
      );
    }
    current = parent;
  }
}

/** Absolute path of a repo-relative path, e.g. `docs/contracts/capabilities.json`. */
export function repoPath(...segments: string[]): string {
  return path.join(findRepoRoot(), ...segments);
}
