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
# ci-mirror-db-provisioning report for the incident that prompted this, and
# its "Fix round 1" section for a second incident: a broken port/connection
# string used to still report green because nothing checked that the
# DB-backed tests actually ran instead of skipping).
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
CI_MIRROR_CLEANED_UP=0

# Idempotent on purpose: both the EXIT trap and the INT/TERM trap call this,
# and the guard makes sure the "stopping..." message and the actual
# `docker stop` only ever happen once, whichever trap gets there first.
cleanup_ci_mirror_db() {
  if [ "$CI_MIRROR_CLEANED_UP" = "1" ]; then
    return 0
  fi
  CI_MIRROR_CLEANED_UP=1
  if [ "$CI_MIRROR_DB_STARTED" = "1" ]; then
    echo "ci-mirror.sh: stopping disposable test Postgres ($CI_MIRROR_PG_CONTAINER)..."
    # --rm (at `docker run` below) removes the container as soon as it
    # stops, so `stop` alone is the full teardown — no separate `rm` needed,
    # and `|| true` means a container that's already gone doesn't turn a
    # clean exit into a reported failure.
    docker stop "$CI_MIRROR_PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}

# EXIT alone is NOT enough: on a signal, if the handler only cleans up and
# returns without exiting, bash resumes the script at whatever it was doing
# (e.g. the next `docker exec` in the readiness loop) — against a container
# the trap just stopped, producing a confusing "No such container" `set -e`
# failure (code 1) instead of an honest "you pressed Ctrl-C" (code 130).
# INT/TERM get their own handler that stops the world immediately.
on_ci_mirror_interrupt() {
  sig="$1"
  cleanup_ci_mirror_db
  case "$sig" in
    INT) exit 130 ;;
    TERM) exit 143 ;;
  esac
}
trap cleanup_ci_mirror_db EXIT
trap 'on_ci_mirror_interrupt INT' INT
trap 'on_ci_mirror_interrupt TERM' TERM

# Waits until Postgres is reachable on the *external* 127.0.0.1:<port> path
# — the exact address DATABASE_URL/TRELLIS_TEST_DATABASE_URL below use, not
# the container's internal unix socket. Those are not the same thing: the
# official postgres image's first-boot temp server (used internally for
# initdb bookkeeping) only ever listens on the unix socket, never on TCP —
# `docker exec ... pg_isready` against that socket can report "ready" before
# the final, externally-reachable server (the one `npm run test` actually
# connects to) is listening at all. A previous version of this script probed
# the internal socket and could report a fully green run — 0 failures, but
# also every DB-backed test silently skipped with "Postgres is not
# reachable" — because the readiness check and the connection string it
# unblocked were checking two different servers (ci-mirror-db-provisioning
# report, Fix round 1, Critical).
wait_for_external_pg() {
  port="$1"
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h 127.0.0.1 -p "$port" -U postgres -d trellis_test >/dev/null 2>&1
  else
    # No pg_isready on the host: a raw TCP connect to the exact host:port
    # DATABASE_URL will use is still a meaningfully stronger signal than the
    # internal-socket check above would be — good enough as a fallback.
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null
  fi
}

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

  # The host-side port mapping exists as soon as the container is created —
  # it does not depend on Postgres itself being ready yet — so this is safe
  # to read right away, before the readiness loop.
  CI_MIRROR_PG_PORT="$(docker port "$CI_MIRROR_PG_CONTAINER" 5432/tcp | cut -d: -f2)"

  echo "ci-mirror.sh: waiting for it to accept connections on 127.0.0.1:${CI_MIRROR_PG_PORT} (the same address DATABASE_URL will use)..."
  attempt=0
  until wait_for_external_pg "$CI_MIRROR_PG_PORT"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "ci-mirror.sh: disposable Postgres did not become reachable on 127.0.0.1:${CI_MIRROR_PG_PORT} in time" >&2
      exit 1
    fi
    sleep 1
  done

  echo "ci-mirror.sh: applying docker/postgres/init/*.sql (docker/postgres/init/apply-all.sh — same script CI and the docker-compose stack use)..."
  # 02-schemas.sql's sandbox GRANT targets a database literally named
  # `trellis` (matches prod's POSTGRES_DB, unparameterized) — this throwaway
  # `CREATE DATABASE trellis` exists solely so that statement resolves;
  # nothing else ever connects to it. Same trick as ci.yml. Applying SQL via
  # `docker exec` (the internal socket) is still fine here, unlike the
  # readiness probe above: by this point external reachability is already
  # confirmed, and the internal socket is certainly no less ready than that.
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

if [ -f package.json ]; then
  # A green exit here is not enough on its own: `npm run test` exiting 0
  # only proves nothing *failed* — it says nothing about whether the
  # DB-backed tests actually ran instead of quietly skipping (their skip
  # path is itself a passing/green outcome from `node --test`'s point of
  # view, by design, for the "no Docker" case above). When a disposable
  # Postgres WAS provisioned, a skip means the provisioning was broken in
  # some way the container's own health didn't reveal (wrong port, wrong
  # credentials, wrong database name, ...) — that must fail the run, loudly,
  # not report green (ci-mirror-db-provisioning report, Fix round 1,
  # Critical).
  ci_mirror_test_log="$(mktemp)"
  set +e
  npm run test --if-present 2>&1 | tee "$ci_mirror_test_log"
  ci_mirror_test_exit="${PIPESTATUS[0]}"
  set -e
  if [ "$ci_mirror_test_exit" -ne 0 ]; then
    rm -f "$ci_mirror_test_log"
    exit "$ci_mirror_test_exit"
  fi
  if [ "$CI_MIRROR_DB_STARTED" = "1" ]; then
    # node --test's TAP summary prints one "# skipped N" line per test file
    # run this way (services/backend); sum defensively in case that ever
    # changes. Vitest (frontend) doesn't emit this line at all, so it never
    # contributes to the count.
    ci_mirror_skipped_total="$(grep -oE '^# skipped [0-9]+' "$ci_mirror_test_log" | awk '{s+=$3} END {print s+0}')"
    if [ "$ci_mirror_skipped_total" -gt 0 ]; then
      echo "ci-mirror.sh: $ci_mirror_skipped_total test(s) reported skipped even though a disposable Postgres was provisioned for this run — the DB-backed tests in services/backend/src/db/*.test.ts did not actually execute (see ci-mirror-db-provisioning report, Fix round 1). Treating this as a failure: a green ci-mirror.sh must mean those tests ran, not that they silently skipped." >&2
      rm -f "$ci_mirror_test_log"
      exit 1
    fi
  fi
  rm -f "$ci_mirror_test_log"
fi
