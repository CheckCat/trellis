# Task 021 report — narrow the non-text-byte gate to exclude `.mvp/`

## What changed

`scripts/check-text-sources.mjs` — `listTrackedFiles()` now excludes any
path equal to `.mvp` or starting with `.mvp/` from the set returned by
`git ls-files -z`. The NUL-byte gate (wired as npm's `pretest` lifecycle
hook, unchanged) still scans every other git-tracked path in the repo —
all of `services/backend`, `services/frontend`, `scripts/`, root config,
docs, etc. — exactly as before. Only `.mvp/` (the pipeline's generated
audit trail, where review packages legitimately quote arbitrary bytes
including raw NUL as evidence) is now out of scope.

Comments at the top of the file and above `listTrackedFiles` were rewritten
to state the actual scope (all tracked source except `.mvp/`) and explain
why `.mvp/` is carved out (self-reproducing red gate when a review package
cites a NUL byte it's reporting on).

## Exports / interface

No exported symbol signatures changed — `main()` remains the sole
entry point, invoked via `node scripts/check-text-sources.mjs` (directly,
and automatically via npm's `pretest` hook before `npm test`). Exit code
contract unchanged: `0` clean, `1` on any NUL byte found in a scanned file,
printed as `file:line:column (byte offset N)`.

## Files touched

- `scripts/check-text-sources.mjs` (only file in boundary touched)

## Verification

`bash .mvp/ci-mirror.sh` — exit 0 (lint, build, both workspace test suites
including DB-backed backend tests against the disposable ci-mirror
Postgres, and frontend vitest — all green). `node scripts/check-text-sources.mjs`
run standalone also exits 0.

## Concerns

None. Change is a pure scope narrowing plus comment accuracy fix; no
behavioral change for any file outside `.mvp/`.
