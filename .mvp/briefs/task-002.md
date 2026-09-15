# Task 002 — docker-compose стек и инициализация Postgres

## Task

Описать весь локальный стек в `docker-compose.yml` и инициализацию Postgres:
именованный volume, схема ядра под ролью приложения, отдельная схема песочницы
под sandbox-ролью с правами **только** на неё, healthcheck у каждого сервиса.

Скелеты сервисов (`services/backend/Dockerfile`, `services/frontend/Dockerfile`)
делают задачи 003/004 — на момент твоей работы их ещё нет. Compose ты пишешь
сразу на все три сервиса (это решение оператора: отдельной задачи «дополнить
compose» в плане нет). Верифицируешь соответственно: `docker compose config`
проходит целиком, фактически поднимаешь и проверяешь только `postgres`.

### Требования (значения — дословно)

1. **`docker-compose.yml`**
   - `name: trellis`
   - сервис `postgres`:
     - образ `postgres:17-alpine`
     - `POSTGRES_DB=trellis`, `POSTGRES_USER=postgres`,
       `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`; пароли ролей приложения и
       песочницы передаются в контейнер как `APP_DB_PASSWORD`,
       `SANDBOX_DB_PASSWORD` — init-скрипт читает их из окружения
     - именованный volume `trellis_pgdata` → `/var/lib/postgresql/data`
     - публикация порта **только на localhost**:
       `127.0.0.1:${POSTGRES_PORT:-5433}:5432`
     - healthcheck: `pg_isready -U postgres -d trellis` (interval/timeout/retries
       разумные, не `sleep`)
   - сервис `backend`:
     - `build: { context: ., dockerfile: services/backend/Dockerfile }`
       (контекст — корень: нужен корневой lockfile для `npm ci` в workspaces)
     - env: `HOST=0.0.0.0`, `PORT=3001`,
       `DATABASE_URL=postgres://trellis_app:${APP_DB_PASSWORD}@postgres:5432/trellis`,
       `SANDBOX_DATABASE_URL=postgres://trellis_sandbox:${SANDBOX_DB_PASSWORD}@postgres:5432/trellis`,
       `COURSES_DIR=/courses`
     - bind-mount `./courses:/courses:ro`
     - публикация `127.0.0.1:${BACKEND_PORT:-3001}:3001`
     - `depends_on: postgres: { condition: service_healthy }`
     - healthcheck по `GET /health` внутри контейнера
   - сервис `frontend`:
     - `build: { context: ., dockerfile: services/frontend/Dockerfile }`
     - публикация `127.0.0.1:${FRONTEND_PORT:-3000}:80` (статика отдаётся
       веб-сервером внутри образа; точный внутренний порт согласуй с этим
       значением и зафиксируй в отчёте — задача 004 обязана его соблюсти)
     - `depends_on: backend: { condition: service_healthy }`
     - healthcheck: HTTP 200 на корне
   - `restart: unless-stopped` у долгоживущих сервисов
   - Наружу (0.0.0.0) не публикуется НИЧЕГО — все порты с префиксом `127.0.0.1:`

2. **Инициализация Postgres.** Пароли ролей не хардкодятся — берутся из
   окружения контейнера. Так как `/docker-entrypoint-initdb.d` выполняет `.sql`
   без подстановки переменных, используй такой layout (и смонтируй обе
   директории отдельно):
   - `docker/postgres/init/00-init.sh` — исполняемый (`chmod +x`), монтируется в
     `/docker-entrypoint-initdb.d/00-init.sh:ro`; прогоняет оба SQL-файла через
     `psql` с переменными (`-v app_password="$APP_DB_PASSWORD"` и т. д.),
     `set -euo pipefail`, падает с понятным сообщением, если переменная пуста
   - `docker/postgres/init/01-roles.sql`, `docker/postgres/init/02-schemas.sql` —
     монтируются как `/sql:ro` (НЕ внутрь `/docker-entrypoint-initdb.d`, иначе
     выполнятся дважды)

3. **`01-roles.sql`** — роли `trellis_app` и `trellis_sandbox`:
   `LOGIN`, пароль из psql-переменной, без `SUPERUSER`/`CREATEROLE`/`CREATEDB`.
   Идемпотентность (`DO $$ ... IF NOT EXISTS`) приветствуется.

4. **`02-schemas.sql`** — модель прав, это ядро задачи:
   - схема `core` — `AUTHORIZATION trellis_app` (прогресс платформы)
   - схема `sandbox` — `AUTHORIZATION trellis_sandbox` (практика)
   - `REVOKE ALL ON SCHEMA public FROM PUBLIC` (и от обеих ролей) — мусорить в
     `public` никто не может
   - `REVOKE ALL ON SCHEMA core FROM trellis_sandbox` — sandbox-роль
     **физически не видит** данные платформы
   - `REVOKE ALL ON SCHEMA sandbox FROM trellis_app` — роль приложения не лезет
     в песочницу
   - `GRANT CREATE ON DATABASE trellis TO trellis_sandbox` — нужно для операции
     «сбросить песочницу» (задача 008 делает `DROP SCHEMA sandbox CASCADE` +
     `CREATE SCHEMA sandbox` от sandbox-роли). Ничего сверх этого sandbox-роли
     не выдавать.
   - `ALTER ROLE trellis_app SET search_path = core;`
     `ALTER ROLE trellis_sandbox SET search_path = sandbox;`
   - Права на БД `trellis`: `REVOKE ALL ON DATABASE trellis FROM PUBLIC`,
     `GRANT CONNECT` обеим ролям

5. **`.env.example`** — с комментариями «как инсталлер», значения-плейсхолдеры:
   `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SANDBOX_DB_PASSWORD`,
   `POSTGRES_PORT=5433`, `BACKEND_PORT=3001`, `FRONTEND_PORT=3000`.
   Сам `.env` не коммитится (уже в `.gitignore` из задачи 001), но для локальной
   проверки создать его можно.

### Готов когда

- `docker compose config` проходит без ошибок (весь стек, включая ещё не
  существующие Dockerfile'ы — `config` их не требует)
- `docker compose up -d postgres` поднимает БД, healthcheck становится healthy
- Проверено **фактическими запросами** (зафиксируй вывод в отчёте):
  - под `trellis_app`: `CREATE TABLE core.t(...)` работает
  - под `trellis_sandbox`: `SELECT` из таблицы в `core` → `permission denied`
  - под `trellis_sandbox`: `DROP SCHEMA sandbox CASCADE; CREATE SCHEMA sandbox;`
    работает
  - под `trellis_app`: `CREATE TABLE sandbox.t(...)` → `permission denied`
- Данные переживают пересоздание контейнера: `docker compose down` (БЕЗ `-v`) →
  `up -d postgres` → созданная таблица на месте
- `bash .mvp/ci-mirror.sh` завершается кодом 0
- После проверок приберись: `docker compose down -v` допустим — реальных данных
  ещё нет; volume пересоздастся

## Boundary

`.` — корень репозитория, но только эти пути: `docker-compose.yml`,
`docker/postgres/**`, `.env.example` (+ твой отчёт `.mvp/reports/task-002.md`).
НЕ трогай `services/**`, `package.json`, `tsconfig.base.json`,
`eslint.config.mjs`, `.github/**`, `docs/**`, `.mvp/plan.json`.

## Interfaces from dependencies

Задача 001 (корень монорепозитория) — см. `.mvp/reports/task-001.md`.

## Общий контракт проекта (соблюдать)

- Имя compose-проекта `trellis`; сервисы `postgres`, `backend`, `frontend`.
- Порты на хосте (только 127.0.0.1): frontend `3000`, backend `3001`,
  postgres `5433` → 5432.
- БД `trellis`; роли `trellis_app` (владелец `core`) и `trellis_sandbox`
  (владелец `sandbox`); суперпользователь `postgres` — только для init.
- Именованный volume `trellis_pgdata`.
- Backend внутри контейнера слушает `0.0.0.0:3001`; «только localhost»
  обеспечивается публикацией порта как `127.0.0.1:3001:3001`, а не биндом внутри
  контейнера (решение оператора, не переоткрывай).
- Миграции схемы `core` — НЕ здесь: их прогоняет backend при старте (задача 005).
  Твои init-скрипты создают только роли, схемы и права.

## Project invariants

Полный список — `.mvp/invariants.md`. Критичное здесь:

- Postgres-песочница: отдельная схема + роль с правами только на эту схему.
  Seed-, check- и пользовательские запросы выполняются от sandbox-роли —
  никогда от роли приложения или суперпользователя.
- Данные прогресса — только в именованном volume; пересоздание контейнеров не
  теряет данные.
- Backend слушает только localhost, наружу порты не публикуются; внешних
  сервисов нет.
- Ожидание готовности — через healthcheck, никогда `sleep`.
