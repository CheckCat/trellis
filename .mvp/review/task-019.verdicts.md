# Reviewer replies: task 019

Raw, unparsed. One section per poll.

## reviewer-019-1

```
Confirmed correct — `tests/e2e/` is two levels below root, so `../../tsconfig.base.json` resolves correctly.

I've completed a thorough review, including targeted checks of the actual backend source (not just the diff) for every HTTP contract the e2e test exercises, since this task's core deliverable — whether the test actually passes — is precisely the kind of concrete, named risk worth checking against real call sites:

- `sandbox.ts`: `Body: { sandboxId?: string } | null` — confirms the test's no-body `POST /sandbox/reset` call is valid (optional field).
- `practice.ts`: run body is `{ sql: string }` only — matches.
- `transfer.ts` / `transfer/import.ts`: `toImportPayload`/`ProgressImportTotals` field names and the stale/`worthWarningAbout` logic match the test's assertions on `summary`, `applied`, `stale`, `created` exactly, including the trickier "old file that changes nothing" vs "old file with one new lesson" distinction.
- `progress/model.ts`: `lessonCompletionMode` confirms a practice lesson without `check` is `"manual"` (self-mark via `/complete`), matching the test's `practice-instock` flow.
- `docker-compose.e2e.yml` overrides line up exactly with the real `docker-compose.yml` (service names, env var names, healthcheck semantics, volume naming).
- `eslint.config.mjs` is non-type-aware, so `eslint tests` needs no per-directory `tsconfig` wiring — no gap there.
- `tsconfig.base.json` path resolution from `tests/e2e/tsconfig.json` is correct.

No code defect (bug/security/pattern-violation/minor) survived this inspection.

One gap is worth naming for the record, though it doesn't change the verdict: `.mvp/ci-mirror.sh` runs `npm run lint/build/test`, never `test:e2e` — this is a deliberate, documented choice, but it means the pre-dispatch "CI mirror is green" confirmation never actually executes this task's core deliverable. The implementer's report claims a real `15/15` Docker-based pass, which per review rules I must treat as an unverified claim; I could not independently execute it. I mitigated this by cross-checking every contract point above against the real backend source rather than trusting the report's narrative.

VERDICT: approve
CANNOT_VERIFY: whether `npm run test:e2e` actually passes against a live docker-compose stack — it's deliberately excluded from `.mvp/ci-mirror.sh`/CI, so the pre-review "CI mirror green" confirmation never exercises this task's core deliverable; the report's claimed 15/15 real-Docker pass is unverified per review rules. Mitigated by independently tracing every HTTP contract the test relies on (sandbox reset's optional `sandboxId`, practice/run's body shape, transfer/import's stale-detection and totals shape, `lessonCompletionMode's manual/quiz/practice gating, and the compose override's service/env alignment with the real `docker-compose.yml`) against the actual backend source — all consistent.
FINDINGS: []
```

## reviewer-019-2

```
VERDICT: approve
CANNOT_VERIFY: none — ran `npm run test:e2e` myself (docker compose up --build against the real stack): 15/15 subtests pass; verified teardown leaves no containers/volumes/networks and `git status` clean afterward. Ran `npm run lint --if-present` and `npm run build --if-present` at root (via `rtk proxy` to avoid a harness output-parsing artifact): both exit 0, confirming `eslint tests` and `tsc -p tests/e2e/tsconfig.json` are wired into the same commands CI/ci-mirror.sh call. Cross-checked `.github/workflows/ci.yml` and `.mvp/ci-mirror.sh`: both still call `npm run lint/build/test --if-present` unchanged, and `test:e2e` is a separate script name so it correctly stays out of both, matching the report's claim. Cross-checked all `PILOT` fixture values (lesson/option ids, check queries, seed data) against `courses/pilot-sql/manifest.yaml` and `sandbox/seed.sql` — all match exactly. `docker-compose.e2e.yml`'s port/volume override behavior and frontend healthcheck-implies-backend-healthy reasoning verified against the real `docker-compose.yml` and confirmed working in the live run.
FINDINGS: []
```

## reviewer-019-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```
