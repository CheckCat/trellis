# npm command sequence below must stay byte-identical (same commands, same
# order) to the `steps:` in .github/workflows/ci.yml — that's the whole
# contract of this file.
#
# One intentional asymmetry: CI additionally provisions an ephemeral
# Postgres service + runs docker/postgres/init/{01-roles,02-schemas}.sql
# against it before `npm run test`, so DATABASE_URL/TRELLIS_TEST_DATABASE_URL
# are set and the DB-backed tests (services/backend/src/db/*.test.ts) run
# for real instead of skipping (final-review-fixes-infra report, Important
# 1). That's infra provisioning, not an npm command, so it isn't replicated
# here — this script intentionally stays green via the same skip-with-reason
# path those tests already use when DATABASE_URL/TRELLIS_TEST_DATABASE_URL
# are unset. To get the same DB coverage locally: `cp .env.example .env` +
# `docker compose up -d postgres` (waits for the healthcheck itself), then
# export DATABASE_URL to your dev DB and TRELLIS_TEST_DATABASE_URL to a
# separate `*_test`-named database before running this script.
set -e
if [ -f package-lock.json ]; then npm ci; fi
if [ -f package.json ]; then npm run lint --if-present; fi
if [ -f package.json ]; then npm run build --if-present; fi
if [ -f package.json ]; then npm run test --if-present; fi
