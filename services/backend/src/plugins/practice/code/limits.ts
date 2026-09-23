// The numbers the code runner is bounded by. A file of constants and
// nothing else, so capabilities.ts can import it (it reports them to
// course authors) without importing the runner.

/** Wall-clock budget for one whole run — the solution's or the
 * learner's — after which the child process is killed. */
export const CODE_TIMEOUT_SECONDS = 10;
/** `--max-old-space-size` of the child process, megabytes. */
export const CODE_MEMORY_MB = 256;
/** Characters of `console.*` output kept per case; the rest is dropped
 * and the case flagged `truncated`. */
export const MAX_CODE_OUTPUT_CHARS = 16_384;
/** Characters of one case's ENCODED return value (its JSON); a larger
 * value is reported as that case's error instead of being carried. Also
 * what bounds result.json, which the backend parses synchronously. */
export const MAX_CODE_VALUE_CHARS = 65_536;
/** Characters of the child's raw stderr kept for crash reports. */
export const MAX_CODE_PROCESS_OUTPUT_CHARS = 65_536;
/** Cases one assignment may declare (manifest.schema.json's maxItems). */
export const MAX_CODE_CASES = 50;
