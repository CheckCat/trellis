# npm command sequence below (ci/lint/build/test) must stay byte-identical
# (same commands, same order) to the `steps:` in .github/workflows/ci.yml —
# that's the whole contract of this file.
#
# This script provisions its own one-shot, throwaway Postgres container
# before `npm run test`, exactly like ci.yml's `services: postgres:` does,
# through the same docker/postgres/init/apply-all.sh both of them (and the
# real docker-compose stack's own 00-init.sh) share as the single source of
# truth for which SQL files to apply, in which order. Before this, DB-backed
# tests (migration apply/idempotency/mismatch-guard, advisory-lock
# serialization, transaction commit/rollback — see
# services/backend/src/db/*.test.ts) only ever ran in CI, never locally: a
# green `ci-mirror.sh` no longer actually predicted a green CI run for
# exactly the code task 007 is about to build on (see
# ci-mirror-db-provisioning report for the incident that prompted this).
#
# The container this starts is fully disposable and deliberately isolated
# from anything a developer might have running:
#   - its own name (trellis-ci-mirror-postgres), so it never collides with
#     or touches the docker-compose `postgres` service/container;
#   - a Docker-assigned ephemeral host port (`-p 127.0.0.1::5432`), so it
#     never touches the real stack's fixed 5433 — this script works fine
#     with `docker compose up -d postgres` already running;
#   - no named volume — nothing here ever touches `trellis_pgdata`.
# It is torn down via `trap` on every exit path this script can take:
# success, a failing test, or Ctrl-C.
#
# If Docker isn't installed/reachable at all, this script does not fail: it
# prints a message and falls back to the previous behavior — DB-backed
# tests skip with a stated reason, exactly as they did before this
# provisioning existed.
set -euo pipefail

CI_MIRROR_PG_CONTAINER="trellis-ci-mirror-postgres"
CI_MIRROR_PG_PASSWORD="ci-mirror-postgres-password"
CI_MIRROR_APP_DB_PASSWORD="ci-mirror-app-role-password"
CI_MIRROR_SANDBOX_DB_PASSWORD="ci-mirror-sandbox-role-password"
CI_MIRROR_DB_STARTED=0

cleanup_ci_mirror_db() {
  if [ "$CI_MIRROR_DB_STARTED" = "1" ]; then
    echo "ci-mirror.sh: stopping disposable test Postgres ($CI_MIRROR_PG_CONTAINER)..."
    # --rm (at `docker run` below) removes the container as soon as it
    # stops, so `stop` alone is the full teardown — no separate `rm` needed,
    # and `|| true` means a container that's already gone (e.g. this trap
    # firing twice) doesn't turn a clean exit into a reported failure.
    docker stop "$CI_MIRROR_PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup_ci_mirror_db EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "ci-mirror.sh: Docker не найден, тесты слоя данных будут пропущены (5 тестов в services/backend/src/db/*.test.ts сами себя скипнут с указанием причины — миграции, advisory-lock, транзакции)."
else
  # Defensive: a container from a previous crashed/interrupted run could
  # still be around under this fixed name.
  docker rm -f "$CI_MIRROR_PG_CONTAINER" >/dev/null 2>&1 || true

  echo "ci-mirror.sh: starting disposable test Postgres ($CI_MIRROR_PG_CONTAINER)..."
  docker run --rm -d \
    --name "$CI_MIRROR_PG_CONTAINER" \
    -p "127.0.0.1::5432" \
    -e POSTGRES_DB=trellis_test \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="$CI_MIRROR_PG_PASSWORD" \
    -v "$(pwd)/docker/postgres/init:/sql:ro" \
    postgres:17-alpine >/dev/null
  CI_MIRROR_DB_STARTED=1

  echo "ci-mirror.sh: waiting for it to accept connections..."
  attempt=0
  until docker exec "$CI_MIRROR_PG_CONTAINER" pg_isready -U postgres -d trellis_test >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "ci-mirror.sh: disposable Postgres did not become ready in time" >&2
      exit 1
    fi
    sleep 1
  done

  CI_MIRROR_PG_PORT="$(docker port "$CI_MIRROR_PG_CONTAINER" 5432/tcp | cut -d: -f2)"

  echo "ci-mirror.sh: applying docker/postgres/init/*.sql (docker/postgres/init/apply-all.sh — same script CI and the docker-compose stack use)..."
  # 02-schemas.sql's sandbox GRANT targets a database literally named
  # `trellis` (matches prod's POSTGRES_DB, unparameterized) — this throwaway
  # `CREATE DATABASE trellis` exists solely so that statement resolves;
  # nothing else ever connects to it. Same trick as ci.yml.
  docker exec \
    -e PGUSER=postgres \
    -e PGDATABASE=postgres \
    "$CI_MIRROR_PG_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE trellis;"
  docker exec \
    -e PGUSER=postgres \
    -e PGDATABASE=trellis_test \
    -e APP_DB_PASSWORD="$CI_MIRROR_APP_DB_PASSWORD" \
    -e SANDBOX_DB_PASSWORD="$CI_MIRROR_SANDBOX_DB_PASSWORD" \
    "$CI_MIRROR_PG_CONTAINER" \
    sh /sql/apply-all.sh /sql

  # Both point at the same disposable `trellis_test` database — this
  # container never holds anything a developer needs to keep, so there's no
  # "real DB to protect" distinction to make locally either (same reasoning
  # as ci.yml).
  export DATABASE_URL="postgres://trellis_app:${CI_MIRROR_APP_DB_PASSWORD}@127.0.0.1:${CI_MIRROR_PG_PORT}/trellis_test"
  export TRELLIS_TEST_DATABASE_URL="$DATABASE_URL"
  echo "ci-mirror.sh: disposable test Postgres ready on 127.0.0.1:${CI_MIRROR_PG_PORT} (db trellis_test)."
fi

if [ -f package-lock.json ]; then npm ci; fi
if [ -f package.json ]; then npm run lint --if-present; fi
if [ -f package.json ]; then npm run build --if-present; fi
if [ -f package.json ]; then npm run test --if-present; fi
