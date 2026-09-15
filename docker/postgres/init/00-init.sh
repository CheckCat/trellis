#!/usr/bin/env bash
# Прогоняет роли и схемы через psql с переменными вместо plain-text паролей
# в .sql. Официальный образ postgres выполняет .sh-файлы из
# /docker-entrypoint-initdb.d напрямую (этот скрипт лежит там), а сами .sql
# смонтированы отдельно в /sql:ro — если бы они тоже лежали в
# /docker-entrypoint-initdb.d, entrypoint прогнал бы их ещё раз сам, уже без
# переменных, и упал бы.
set -euo pipefail

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "00-init.sh: переменная APP_DB_PASSWORD пуста или не задана — задай её в .env" >&2
  exit 1
fi

if [ -z "${SANDBOX_DB_PASSWORD:-}" ]; then
  echo "00-init.sh: переменная SANDBOX_DB_PASSWORD пуста или не задана — задай её в .env" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" \
  -v sandbox_password="$SANDBOX_DB_PASSWORD" \
  -f /sql/01-roles.sql

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -f /sql/02-schemas.sql

echo "00-init.sh: роли и схемы созданы (trellis_app/core, trellis_sandbox/sandbox)"
