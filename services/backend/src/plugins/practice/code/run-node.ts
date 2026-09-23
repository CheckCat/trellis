// Runs a learner's (or the author's) module in a child `node` process and
// reports what happened — nothing here knows about courses, lessons,
// grading or HTTP.
//
// Isolation is process-level, not a security boundary (project decision,
// docs/product/analysis-grey-zones.md): a fresh process per run, an
// empty environment, a temp working directory, a wall-clock timeout that
// ends in SIGKILL, a heap cap, and a cap on how much output is kept. The
// code can still see the container's filesystem and network — the same
// as `node file.ts` in the learner's own terminal, which is the threat
// model this product has.
//
// TypeScript is handled by node itself (`--experimental-strip-types`): on
// 22.16 the flag is required, on >= 22.18 it is the default and harmless.
// Only erasable syntax is supported — node rejects `enum`/`namespace` at
// import time, which surfaces as `load_failed` with node's own message.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CodeLanguage } from "../../../capabilities/index.js";
import type { EncodedValue } from "./compare.js";
import { HARNESS_SOURCE } from "./harness.js";
import {
  CODE_MEMORY_MB,
  CODE_TIMEOUT_SECONDS,
  MAX_CODE_OUTPUT_CHARS,
  MAX_CODE_PROCESS_OUTPUT_CHARS,
  MAX_CODE_VALUE_CHARS,
} from "./limits.js";

export interface CodeRunRequest {
  readonly language: CodeLanguage;
  readonly code: string;
  readonly entry: string;
  /** One array of arguments per case, in order. */
  readonly cases: readonly (readonly unknown[])[];
}

export interface CodeErrorInfo {
  readonly message: string;
  readonly stack?: string;
}

/** What one case produced. Exactly one of `value`/`error` is present. */
export interface CodeCaseOutcome {
  readonly value?: EncodedValue;
  readonly error?: CodeErrorInfo;
  /** Captured `console.*` output of this case. */
  readonly output: string;
  readonly truncated: boolean;
}

export type CodeRunResult = { readonly durationMs: number } & (
  | { readonly kind: "ran"; readonly cases: readonly CodeCaseOutcome[] }
  | { readonly kind: "load_failed"; readonly error: CodeErrorInfo }
  | { readonly kind: "entry_missing"; readonly exported: readonly string[] }
  /** Killed by the timeout; `cases` holds the ones that finished first. */
  | { readonly kind: "timeout"; readonly cases: readonly CodeCaseOutcome[] }
  /** The process ended without a complete result (OOM abort, process.exit). */
  | {
      readonly kind: "crashed";
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly stderr: string;
    }
  /** `node` itself could not be started. */
  | { readonly kind: "unavailable"; readonly message: string }
);

export interface CodeRunner {
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}

export interface CreateNodeRunnerOptions {
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly execPath?: string;
  readonly tmpRoot?: string;
}

/** What the harness writes to result.json — see harness.ts. */
type HarnessResult =
  | { kind: "load_failed"; error: CodeErrorInfo }
  | { kind: "entry_missing"; exported: string[] }
  | { kind: "ran"; cases: CodeCaseOutcome[]; complete: boolean };

interface ProcessOutcome {
  readonly status: "exited" | "timeout" | "spawn_failed";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly message: string;
}

export function createNodeRunner(options: CreateNodeRunnerOptions = {}): CodeRunner {
  const timeoutMs = options.timeoutMs ?? CODE_TIMEOUT_SECONDS * 1000;
  const memoryMb = options.memoryMb ?? CODE_MEMORY_MB;
  const execPath = options.execPath ?? process.execPath;
  const tmpRoot = options.tmpRoot ?? os.tmpdir();

  return {
    async run(request) {
      const started = Date.now();
      const dir = await fs.promises.mkdtemp(path.join(tmpRoot, "trellis-code-"));
      try {
        // `.mts`/`.mjs`, not `.ts`/`.js`: the extension alone fixes the
        // module format, so node never has to guess ESM from the text.
        const modulePath = path.join(dir, request.language === "typescript" ? "attempt.mts" : "attempt.mjs");
        const harnessPath = path.join(dir, "harness.mjs");
        const casesPath = path.join(dir, "cases.json");
        const resultPath = path.join(dir, "result.json");
        await Promise.all([
          fs.promises.writeFile(modulePath, request.code, "utf8"),
          fs.promises.writeFile(harnessPath, HARNESS_SOURCE, "utf8"),
          fs.promises.writeFile(casesPath, JSON.stringify(request.cases), "utf8"),
        ]);

        const outcome = await runProcess(
          execPath,
          [
            "--experimental-strip-types",
            "--no-warnings=ExperimentalWarning",
            `--max-old-space-size=${memoryMb}`,
            "--disallow-code-generation-from-strings",
            harnessPath,
            modulePath,
            request.entry,
            casesPath,
            resultPath,
            String(MAX_CODE_OUTPUT_CHARS),
            String(MAX_CODE_VALUE_CHARS),
          ],
          dir,
          timeoutMs,
        );
        const durationMs = Date.now() - started;

        if (outcome.status === "spawn_failed") {
          return { kind: "unavailable", message: outcome.message, durationMs };
        }
        const snapshot = readSnapshot(resultPath);
        // A complete result outranks the deadline: the harness exits as
        // soon as it has written it, so hitting the deadline WITH a
        // complete file means something the learner's code left behind
        // held the process open — not that their function was slow.
        const complete = snapshot !== undefined && (snapshot.kind !== "ran" || snapshot.complete);
        if (outcome.status === "timeout" && !complete) {
          return { kind: "timeout", cases: snapshot?.kind === "ran" ? snapshot.cases : [], durationMs };
        }
        if (snapshot === undefined || (snapshot.kind === "ran" && !snapshot.complete)) {
          return {
            kind: "crashed",
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            stderr: outcome.stderr,
            durationMs,
          };
        }
        switch (snapshot.kind) {
          case "load_failed":
            return { kind: "load_failed", error: tidyError(snapshot.error, dir, modulePath), durationMs };
          case "entry_missing":
            return { kind: "entry_missing", exported: snapshot.exported, durationMs };
          case "ran":
            return { kind: "ran", cases: snapshot.cases, durationMs };
        }
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Node's stack, made about the learner's file: the temp directory (an
 * implementation detail nobody can act on) becomes the module's bare
 * name, and node's internal loader frames — which follow every syntax
 * error and say nothing about the code — are dropped.
 */
function tidyError(error: CodeErrorInfo, dir: string, modulePath: string): CodeErrorInfo {
  const strip = (text: string) =>
    text
      .split(pathToFileURL(dir).href + "/")
      .join("")
      .split(dir + path.sep)
      .join("");
  const message = strip(error.message);
  if (error.stack === undefined) {
    return { message };
  }
  const stack = strip(error.stack)
    .split("\n")
    .filter((line) => !/^\s+at .*node:internal/.test(line))
    .join("\n");
  void modulePath;
  return { message, stack };
}

function readSnapshot(resultPath: string): HarnessResult | undefined {
  try {
    return JSON.parse(fs.readFileSync(resultPath, "utf8")) as HarnessResult;
  } catch {
    return undefined;
  }
}

function runProcess(
  execPath: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stderr = "";
    const settle = (outcome: ProcessOutcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };

    // `detached`: the child leads its own process group, so the kill below
    // takes everything the learner's code spawned along with it. Without
    // that, a grandchild outlives the deadline — and, holding our stdio
    // pipes, would keep this promise from ever settling.
    const child = spawn(execPath, args, { cwd, env: {}, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const killGroup = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    // stdout is drained and dropped: the learner's console output reaches
    // us through result.json, and an undrained pipe would stall the child
    // once it filled (Review Focus 3).
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CODE_PROCESS_OUTPUT_CHARS) {
        stderr += chunk.toString("utf8").slice(0, MAX_CODE_PROCESS_OUTPUT_CHARS - stderr.length);
      }
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      settle({ status: "spawn_failed", exitCode: null, signal: null, stderr, message: err.message });
    });
    // Settle on `exit`, not `close`: `close` waits for every stdio pipe to
    // shut, and a grandchild that inherited them keeps them open forever.
    // A short grace period lets stderr already in flight arrive.
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      killGroup();
      setTimeout(() => settle({ status: timedOut ? "timeout" : "exited", exitCode, signal, stderr, message: "" }), 50);
    });
  });
}
