#!/bin/sh
# Applies every docker/postgres/init/*.sql file, in lexicographic order
# (hence the zero-padded NN- prefixes — 010 would otherwise sort before 2),
# via psql against whatever connection the ambient PG* environment
# variables (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) describe — psql
# reads those itself, so this script never hardcodes a connection method.
# That's what lets the exact same script serve three different callers with
# three different connection styles:
#   - docker/postgres/init/00-init.sh — the real docker-compose stack,
#     connects over the local unix socket inside the postgres container.
#   - .github/workflows/ci.yml — CI's ephemeral `services: postgres:`,
#     connects over TCP to localhost.
#   - .mvp/ci-mirror.sh — a developer's disposable local Postgres
#     container, connects via `docker exec` (so, also a local unix socket,
#     just inside a throwaway container instead of a long-lived one).
#
# Before this script existed, ci.yml listed 01-roles.sql/02-schemas.sql by
# hand — a new 03-*.sql would apply in the real stack (00-init.sh also
# listed files by hand) but silently never run in CI, even though the
# surrounding comments promised "single source of truth" (see
# final-review-fixes-infra report, minor items; ci-mirror-db-provisioning
# report). Adding a new docker/postgres/init/NNN-*.sql file is now enough —
# every caller picks it up automatically, in order.
set -eu

sql_dir="${1:?usage: apply-all.sh <sql_dir>}"

for f in "$sql_dir"/*.sql; do
  echo "apply-all.sh: applying $f"
  psql -v ON_ERROR_STOP=1 \
    -v app_password="${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set}" \
    -v sandbox_password="${SANDBOX_DB_PASSWORD:?SANDBOX_DB_PASSWORD is not set}" \
    -f "$f"
done
