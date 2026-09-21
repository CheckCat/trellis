// Keeps docs/contracts/capabilities.json in step with capabilities.ts.
//
//   npm run capabilities:write   — regenerate the file
//   npm run capabilities:check   — fail if it is out of date (CI)
//
// Why a committed file at all, when `GET /capabilities` serves the same
// object: a course author (or a generator) needs to read the contract
// without running the stack, a diff in a pull request needs to SHOW that
// the engine's contract changed, and `capabilities:check` is what turns
// "somebody edited capabilities.ts and forgot" from a silent drift into a
// red build.
//
// The file is generated, never hand-edited — `capabilities:check` would
// reject an edit anyway.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CAPABILITIES } from "./capabilities.js";
import { repoPath } from "./repoRoot.js";

/** Repo-relative, so the message a failing check prints matches what a
 * developer would type. */
export const CAPABILITIES_CONTRACT_PATH = "docs/contracts/capabilities.json";

/**
 * Exactly what the file should contain. Two-space indentation and a
 * trailing newline — the shape every other JSON file in this repo has, and
 * what an editor saving the file would produce, so `capabilities:check`
 * never fails over whitespace nobody chose.
 */
export function renderCapabilitiesContract(): string {
  return `${JSON.stringify(CAPABILITIES, null, 2)}\n`;
}

function write(target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderCapabilitiesContract(), "utf8");
  process.stdout.write(`capabilities: wrote ${CAPABILITIES_CONTRACT_PATH}\n`);
}

function check(target: string): void {
  const expected = renderCapabilitiesContract();
  let actual: string;
  try {
    actual = fs.readFileSync(target, "utf8");
  } catch {
    process.stderr.write(
      `capabilities: ${CAPABILITIES_CONTRACT_PATH} is missing. Run \`npm run capabilities:write\` and commit it.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (actual !== expected) {
    process.stderr.write(
      `capabilities: ${CAPABILITIES_CONTRACT_PATH} is out of date — capabilities.ts describes a different engine. ` +
        "Run `npm run capabilities:write` and commit the result.\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`capabilities: ${CAPABILITIES_CONTRACT_PATH} is up to date\n`);
}

function main(argv: readonly string[]): void {
  const command = argv[2];
  const target = repoPath(CAPABILITIES_CONTRACT_PATH);
  if (command === "write") {
    write(target);
    return;
  }
  if (command === "check") {
    check(target);
    return;
  }
  process.stderr.write("usage: node dist/capabilities-cli.js <write|check>\n");
  process.exitCode = 2;
}

// Only acts when executed directly — the same guard server.ts uses, so
// importing this module (renderCapabilitiesContract, from the tests) never
// touches the filesystem.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main(process.argv);
}
