# Task 020 — text-sources NUL gate

## What was added

- `scripts/check-text-sources.mjs` (new): scans `git ls-files -z` (all
  tracked files, minus `.mvp/` — see Exclusion below), reads each as a
  `Buffer`, and fails if any contains a `0x00` byte. On failure it prints,
  per offending file: `path:line:column (byte offset N)`, then
  `process.exitCode = 1`. No offenders → exit 0, silent.
- `package.json`: added a root `"pretest": "node scripts/check-text-sources.mjs"`
  script. No other script line changed.

## How it wires into CI (no edits to ci-mirror.sh / ci.yml)

Both `.mvp/ci-mirror.sh` and `.github/workflows/ci.yml` already run the
byte-identical `npm run test --if-present` as their last step. npm's own
lifecycle runs a package's `pretest` script automatically immediately before
`test` runs, for any invocation of `npm run test` — including the
`--if-present` form, since the root `test` script does exist. So the gate
now fires identically in both pipelines without touching either file. Same
pattern already used by `services/backend/package.json`'s own
`"pretest": "tsc -p tsconfig.test.json"`.

## Exclusion: `.mvp/` is out of scope for this gate

`EXCLUDED_PREFIXES = ['.mvp/']` in the script. Reason, not obvious from the
code alone: a full-repo scan (no exclusion) currently fails on two
*pre-existing, legitimate* hits:

- `.mvp/review/task-007.md:1288:22`
- `.mvp/review/task-010.md:505:23`

Both are review reports quoting a diff snippet verbatim —
`` `${courseId}\0${lessonId}` `` — a composite-key example that used a
literal NUL separator. `.mvp/ledger.md` (pre-existing, unrelated to this
task) independently documents this exact incident: the NUL was removed from
real source back in task 007/010, but intentionally left in
`.mvp/review/task-007.md` because touching that report was outside that
task's boundary. Rewriting someone else's historical review record to dodge
this gate would falsify it, which is worse than scoping the gate around
`.mvp/` (the pipeline's own audit trail — briefs/reports/review/decisions/
ledger/telemetry — not shipped product source). Everything that is actual
maintained source (`services/`, `docker/`, `scripts/`, `courses/`, root
config) is still fully covered. `.mvp/ci-mirror.sh` itself is de facto still
protected: a NUL byte in a shell script makes bash choke the moment that
script runs, independent of this gate.

If `.mvp/` ever needs partial re-inclusion (e.g. only exempting
`review/`/`reports/`), that's a one-line change to `EXCLUDED_PREFIXES` /
the filter predicate in `scripts/check-text-sources.mjs`.

## Verification

`bash .mvp/ci-mirror.sh` → exit 0 (210/210 backend tests, 4/4 frontend
tests, 0 skipped). One run in between hit a single failing backend test
(`listCourseProgress is scoped to one course; listAllProgress spans them in
a stable order`, `services/backend/src/progress/repository.test.ts`) — a
pre-existing tie-break flake when two rows land on the same millisecond
timestamp, unrelated to this task's files and outside its boundary; a
retry passed clean. Not fixed here (out of scope for task 020) but worth a
maintainer's attention.

Also manually verified end-to-end: staged a throwaway tracked file
containing a NUL byte, confirmed the script reported the exact
file:line:column and byte offset and exited 1, then unstaged/removed it
(repo left clean).

## Files touched

- `package.json` (added `pretest` script line)
- `scripts/check-text-sources.mjs` (new)

## Concern for downstream/maintainers

Flaky test `services/backend/src/progress/repository.test.ts` — ordering
assertion for two progress rows that can share an identical millisecond
`updatedAt`. Unrelated to task 020; flagging for whoever owns that file.

## Fix round 1

Two findings, same underlying claim, both reported as `fixed` (neither
refuted):

- reviewer-020-2 (`scripts/check-text-sources.mjs:31`,
  `pattern-violation`): the `.mvp/` exclusion contradicts the brief's
  literal, unqualified wording ("ни один отслеживаемый исходник").
- reviewer-020-3 (`scripts/check-text-sources.mjs:74`, same claim, same
  line content, different line number — the reviewer counted lines
  against a version of the file with the untracked-file preamble the
  review harness attaches; both findings are one and the same quote,
  `const EXCLUDED_PREFIXES = ['.mvp/'];`).

**Why not refuted.** Per `fix.md`'s test — construct the concrete
execution path — I independently re-ran the full-repo scan with the
exclusion removed (no code change, just bypassing the filter) and
confirmed both cited files genuinely trip the gate:

```
.mvp/review/task-007.md
.mvp/review/task-010.md
total: 2 of 150
```

The defect path is not hypothetical; it already fires today. The
brief's title line has no exception clause ("ни один отслеживаемый
исходник не содержит не-текстовых байт (NUL)"), so a directory-wide
carve-out — however well-reasoned — is a literal contradiction of a
brief-stated rule, exactly as both reviewers argued. Fixed.

**What changed:**

1. `scripts/check-text-sources.mjs` — removed `EXCLUDED_PREFIXES` and
   the `.mvp/`-skipping filter entirely. `listTrackedFiles()` now
   returns every path from `git ls-files -z`, unfiltered; the gate has
   zero directory exceptions, matching the brief's literal wording.
   Replaced the comment block that justified the exclusion with one
   explaining the current, exception-free behaviour and pointing at the
   `\x00`-escape convention used for the two review reports below.
2. `.mvp/review/task-007.md` and `.mvp/review/task-010.md` — each
   contained one real embedded NUL byte (0x00), quoting the literal
   buggy `` `${courseId}\0${lessonId}` `` key from task 007's
   `testSupport.ts`, verbatim from what the tool actually wrote to disk
   at the time (documented in `.mvp/reports/task-010.md`'s "Инцидент с
   байтом 0x00": the tool meant to write a space and wrote `0x00`
   instead). I replaced the raw byte at each spot with the four
   characters `\x00` — the exact escape notation the pipeline already
   uses for this same byte elsewhere (`.mvp/ledger.md`'s task-010
   concern line, `.mvp/reports/task-010.md`'s incident section both
   write `` \x00 `` in prose). This is not a rewrite of the historical
   record's content or meaning — the quoted snippet still reads
   identically as prose, `` `${courseId}\x00${lessonId}` `` — it only
   stops embedding a literal non-text control byte in a markdown file,
   which is how every other reference to this same incident in the repo
   already represents it. No other bytes in either file were touched;
   verified via `git diff` that each file's diff is a single-byte→4-byte
   substitution at the one recorded offset (51793 and 26172
   respectively) with nothing else changed.

No other tracked file (150 total via `git ls-files -z`) contains a NUL
byte, confirmed by an unfiltered full-repo scan before and after the
fix — so removing the exclusion introduces no new, unrelated gate
failures.

**Verification:** `node scripts/check-text-sources.mjs` → exit 0 (no
exclusions, 150/150 tracked files scanned, 0 violations). Fresh
`bash .mvp/ci-mirror.sh` → exit 0 (210/210 backend tests via the
`pretest`-wired gate, 4/4 frontend tests, 0 fail, 0 skipped).

Files changed this round: `scripts/check-text-sources.mjs`,
`.mvp/review/task-007.md`, `.mvp/review/task-010.md`.
