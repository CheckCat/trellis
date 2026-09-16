#!/usr/bin/env bash
# Прогоняет роли и схемы через psql с переменными вместо plain-text паролей
# в .sql. Официальный образ postgres выполняет .sh-файлы из
# /docker-entrypoint-initdb.d напрямую (этот скрипт лежит там), а сами .sql
# смонтированы отдельно в /sql:ro — если бы они тоже лежали в
# /docker-entrypoint-initdb.d, entrypoint прогнал бы их ещё раз сам, уже без
# переменных, и упал бы.
#
# Список файлов и порядок применения здесь не перечисляются — за это
# отвечает apply-all.sh (тоже смонтирован в /sql, рядом с *.sql), общий для
# этого скрипта, CI (.github/workflows/ci.yml) и .mvp/ci-mirror.sh. Раньше
# каждый вызывающий сам перечислял 01-roles.sql/02-schemas.sql вручную —
# новый NNN-*.sql файл подхватывали бы не все из них одинаково (см.
# ci-mirror-db-provisioning report).
set -euo pipefail

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "00-init.sh: переменная APP_DB_PASSWORD пуста или не задана — задай её в .env" >&2
  exit 1
fi

if [ -z "${SANDBOX_DB_PASSWORD:-}" ]; then
  echo "00-init.sh: переменная SANDBOX_DB_PASSWORD пуста или не задана — задай её в .env" >&2
  exit 1
fi

export PGUSER="$POSTGRES_USER"
export PGDATABASE="$POSTGRES_DB"

sh /sql/apply-all.sh /sql

echo "00-init.sh: роли и схемы созданы (trellis_app/core, trellis_sandbox/sandbox)"
