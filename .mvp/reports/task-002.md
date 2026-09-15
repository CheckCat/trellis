# Task 002 — docker-compose стек и инициализация Postgres — отчёт

## Что создано

- `docker-compose.yml` — `name: trellis`, сервисы `postgres`/`backend`/`frontend`,
  все порты публикуются только на `127.0.0.1:*`, `restart: unless-stopped` у всех
  трёх, healthcheck у каждого, `depends_on: condition: service_healthy` в цепочке
  postgres → backend → frontend. `backend`/`frontend` собираются с `context: .`
  (корневой lockfile нужен для `npm ci` в workspaces) — их Dockerfile'ов ещё нет
  (задачи 003/004), `docker compose config` этого не требует.
- `docker/postgres/init/00-init.sh` — исполняемый (`chmod +x`), монтируется
  единственным файлом в `/docker-entrypoint-initdb.d/00-init.sh:ro`. Проверяет
  `APP_DB_PASSWORD`/`SANDBOX_DB_PASSWORD` на пустоту (`set -euo pipefail` + explicit
  guard), прогоняет `01-roles.sql` и `02-schemas.sql` через `psql -v ON_ERROR_STOP=1`
  с psql-переменными `app_password`/`sandbox_password`.
- `docker/postgres/init/01-roles.sql`, `docker/postgres/init/02-schemas.sql` —
  монтируются директорией в `/sql:ro` (не внутрь `/docker-entrypoint-initdb.d`, иначе
  entrypoint прогнал бы их сам ещё раз без psql-переменных и упал бы).
- `.env.example` — `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SANDBOX_DB_PASSWORD`,
  `POSTGRES_PORT=5433`, `BACKEND_PORT=3001`, `FRONTEND_PORT=3000`, комментарии
  «как инсталлеру».

## Найденный и исправленный баг: psql-подстановка внутри `DO $$ ... $$`

Первая версия `01-roles.sql` использовала `DO $$ ... IF NOT EXISTS ... CREATE ROLE
... PASSWORD :'app_password'; ... $$;`. Реальный прогон контейнера упал:

```
psql:/sql/01-roles.sql:12: ERROR:  syntax error at or near ":"
LINE 4:     CREATE ROLE trellis_app LOGIN PASSWORD :'app_password';
```

Причина: psql-клиент интерполирует `:'var'` только в тексте верхнего уровня
SQL-скрипта, а не внутри тела dollar-quoted строки (`$$ ... $$`) — там `:'var'`
уходит на сервер буквально и Postgres не может это распарсить. Переписал на
идиому `\gexec` (генерируем `CREATE ROLE ...` строкой на верхнем уровне и
выполняем результат условно через `WHERE NOT EXISTS (...)`), это НЕ внутри
dollar-quoting, подстановка работает. Второй найденный по пути нюанс: после
подстановки `:'app_password'` кавычки — это синтаксис литерала на стороне
psql, в текстовом значении (после разбора SELECT'а) их уже нет, поэтому без
`quote_literal(:'app_password')` `\gexec` пытался выполнить `CREATE ROLE ...
PASSWORD app_role_local_pw_2` без кавычек — тоже syntax error. Финальная
версия `01-roles.sql`:

```sql
SELECT 'CREATE ROLE trellis_app LOGIN PASSWORD ' || quote_literal(:'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trellis_app') \gexec
```

Перепроверено с нуля (`docker compose down -v` → `up -d postgres`) — контейнер
здоровый, `docker logs` чистый (`CREATE ROLE` x2, `ALTER ROLE` x2, все
`REVOKE`/`GRANT`/`CREATE SCHEMA` из `02-schemas.sql`, финальное сообщение
`00-init.sh: роли и схемы созданы`).

## Итоговая модель прав

| Роль | `core` | `sandbox` | `public` | БД `trellis` |
|---|---|---|---|---|
| `trellis_app` | владелец (`AUTHORIZATION`), полный доступ, `search_path=core` | нет прав (`REVOKE ALL`) | нет прав | `CONNECT` |
| `trellis_sandbox` | нет прав (`REVOKE ALL`) | владелец (`AUTHORIZATION`), полный доступ + `CREATE ON DATABASE` (для drop/recreate схемы), `search_path=sandbox` | нет прав | `CONNECT` |
| `PUBLIC` | нет прав | нет прав | нет прав (`REVOKE ALL ... FROM PUBLIC`) | нет `CONNECT` (`REVOKE ALL ... FROM PUBLIC`) |
| `postgres` (суперпользователь) | всё (bypass RLS/grants) | всё | только для init | всё |

`trellis_sandbox` получает `CREATE` ровно на уровне БД (не выше) — нужен
исключительно для `DROP SCHEMA sandbox CASCADE; CREATE SCHEMA sandbox;` при
сбросе песочницы (задача 008). Ничего сверх этого роли не выдано.

## env-переменные и порты

| Переменная | Где используется | Назначение |
|---|---|---|
| `POSTGRES_PASSWORD` | postgres | пароль суперпользователя `postgres` (только init) |
| `APP_DB_PASSWORD` | postgres (init), backend (`DATABASE_URL`) | пароль `trellis_app` |
| `SANDBOX_DB_PASSWORD` | postgres (init), backend (`SANDBOX_DATABASE_URL`) | пароль `trellis_sandbox` |
| `POSTGRES_PORT` (default `5433`) | postgres | хост-порт → 5432 в контейнере |
| `BACKEND_PORT` (default `3001`) | backend | хост-порт → 3001 в контейнере |
| `FRONTEND_PORT` (default `3000`) | frontend | хост-порт → 80 в контейнере |

Все публикации портов — `127.0.0.1:<host_port>:<container_port>`, наружу
(`0.0.0.0`) ничего не публикуется.

## Проверки прав — фактический вывод

Все команды выполнены через `docker exec` с `PGPASSWORD` из реального `.env`
(созданного локально из `.env.example`, не закоммичен).

```
=== 1. trellis_app: CREATE TABLE core.t ===
CREATE TABLE
INSERT 0 1
 id
----
  1
(1 row)

=== 2. trellis_sandbox: SELECT из core.t -> permission denied ===
ERROR:  permission denied for schema core
LINE 1: SELECT * FROM core.t;

=== 3. trellis_sandbox: DROP/CREATE SCHEMA sandbox -> works ===
DROP SCHEMA
CREATE SCHEMA

=== 4. trellis_app: CREATE TABLE sandbox.t -> permission denied ===
ERROR:  permission denied for schema sandbox
LINE 1: CREATE TABLE sandbox.t(id int);
```

Все 4 сценария из брифа воспроизведены буквально и ведут себя так, как
специфицировано.

## Проверка переживания данных

`docker compose down` (без `-v`) → `docker compose up -d postgres` → healthcheck
снова `healthy` → таблица, созданная в проверке 1, на месте:

```
=== data persisted after down/up (no -v) ===
 id
----
  1
(1 row)
```

После всех проверок стек убран: `docker compose down -v` (реальных данных ещё
нет, volume пересоздастся при следующем `up`).

## Верификация

- `docker compose config` — проходит без ошибок на весь стек (backend/frontend
  Dockerfile'ов ещё нет, `config` их не требует).
- `docker compose up -d postgres` — контейнер поднимается, healthcheck
  переходит в `healthy` (`pg_isready -U postgres -d trellis`).
- `bash .mvp/ci-mirror.sh` — код выхода `0` (в проекте пока нет `services/*`,
  поэтому lint/build/test у workspaces реально не запускаются — это ожидаемо
  на этом этапе плана, не относится к границе задачи 002).
- `git status` вне моей границы не тронут (`.mvp/plan.json` изменён не мной —
  это правка планировщика, актуальная ещё до старта этой задачи; список моих
  файлов ниже соответствует `git status` для `docker-compose.yml`,
  `docker/postgres/**`, `.env.example`).

## Интерфейсный дайджест

### Для задачи 005 (слой данных ядра, пул соединений backend)

- Строка подключения роли приложения (передаётся в контейнер backend как
  `DATABASE_URL`): `postgres://trellis_app:${APP_DB_PASSWORD}@postgres:5432/trellis`.
  Внутри compose-сети хост — `postgres` (имя сервиса), извне (с хоста) —
  `127.0.0.1:${POSTGRES_PORT:-5433}`.
- Строка подключения роли песочницы (`SANDBOX_DATABASE_URL`):
  `postgres://trellis_sandbox:${SANDBOX_DB_PASSWORD}@postgres:5432/trellis`.
- Схема ядра — `core`, `search_path` роли `trellis_app` уже выставлен на `core`
  (`ALTER ROLE ... SET search_path = core`) — миграции/запросы могут не
  квалифицировать имена схемой, но лучше квалифицировать явно для ясности.
- Схема песочницы — `sandbox`, аналогично `search_path` роли `trellis_sandbox`.
- `trellis_app` физически не имеет прав на `sandbox` (и наоборот) — на уровне
  БД это гарантия, а не соглашение в коде.
- Роли/схемы/права уже существуют при первом старте backend (init Postgres
  прогоняется при первом создании контейнера/volume); миграции схемы `core`
  задача 005 создаёт и прогоняет сама поверх готовой схемы `core`.
- `trellis_sandbox` имеет `GRANT CREATE ON DATABASE trellis` — единственное
  право за пределами своей схемы, зарезервировано под сброс песочницы (задача
  008: `DROP SCHEMA sandbox CASCADE; CREATE SCHEMA sandbox;` от имени самой
  sandbox-роли).

### Для задачи 018 (healthcheck'и, порядок готовности)

- Порядок зависимости: `postgres` → `backend` → `frontend`, каждый следующий
  стартует по `depends_on: condition: service_healthy` предыдущего — не по
  `sleep`/таймеру.
- `postgres`: `pg_isready -U postgres -d trellis`, `interval: 5s`,
  `timeout: 5s`, `retries: 5`, `start_period: 10s`.
- `backend`: healthcheck дергает `GET http://127.0.0.1:3001/health` изнутри
  контейнера через `node -e "require('http').get(...)"` (не `curl`/`wget` —
  они не гарантированы в `node:22-alpine`, `node` гарантирован всегда).
  Эндпоинт `/health` должен возвращать HTTP 200 — контракт для задачи 003.
  `interval: 10s`, `timeout: 5s`, `retries: 5`, `start_period: 10s`.
- `frontend`: healthcheck — `wget --spider http://127.0.0.1:80/` (ожидает HTTP
  200 на корне). **Допущение, которое обязана соблюсти задача 004**: финальный
  образ frontend — Alpine-based со статическим веб-сервером на порту `80`
  внутри контейнера, и в нём доступен `wget` (busybox, как в `nginx:alpine`).
  Если задача 004 выберет образ без `wget` (например, distroless) —
  healthcheck нужно будет поменять на другой инструмент, доступный в этом
  образе; сообщить мне или поменять самостоятельно в границах своей задачи
  (файл `docker-compose.yml` вне границы задачи 004 — потребуется явное
  согласование, если понадобится править именно `docker-compose.yml`, а не
  только Dockerfile).
  `interval: 10s`, `timeout: 5s`, `retries: 5`, `start_period: 10s`.
- Именованный volume `trellis_pgdata` — данные Postgres переживают
  `docker compose down`/`up` (без `-v`), проверено фактически (см. выше).

## Deferred decisions

- Healthcheck backend через `node -e` вместо `curl`/`wget` — обоснование: финальный
  образ backend строится по паттерну `node:22-alpine` из роли devops-engineer, где
  `curl` не установлен по умолчанию, а `node` гарантированно есть (это и есть рантайм
  контейнера); `node -e` не требует лишних системных пакетов в Dockerfile.
- Healthcheck frontend через `wget --spider` — trade-off: это допущение о
  содержимом образа задачи 004 (см. дайджест выше), альтернатива — `curl`
  (тоже не факт что будет) или добавление отдельного лёгкого HTTP-клиента в
  Dockerfile специально под healthcheck; выбрал `wget`, потому что это самый
  распространённый вариант для Alpine-based статических серверов (`nginx:alpine`,
  `httpd:alpine`, `caddy:alpine` — во всех есть busybox wget).
  Зафиксировано как контракт для задачи 004 в интерфейсном дайджесте выше.
- Внутренний порт frontend в контейнере — `80` (стандартный для
  nginx/веб-серверов), выбран мной, т.к. Dockerfile задачи 004 ещё не
  существует; задача 004 обязана слушать именно `80` внутри контейнера (см.
  бриф этой задачи и дайджест выше).
- Идемпотентность `01-roles.sql` через психл-идиому `\gexec` вместо
  `DO $$ ... IF NOT EXISTS ... $$` — обоснование: `:'var'`-подстановка psql не
  работает внутри dollar-quoted тела (см. секцию про найденный баг выше),
  `\gexec` даёт условный `CREATE ROLE` без этой проблемы, ценой чуть менее
  очевидного синтаксиса (компенсировано комментарием в самом файле).
- `02-schemas.sql` содержит defensive `REVOKE ALL ON SCHEMA core FROM
  trellis_sandbox` / `REVOKE ALL ON SCHEMA sandbox FROM trellis_app`, хотя
  Postgres и так не грантит новым схемам никаких прав `PUBLIC` по умолчанию
  (это не 1999 версия поведения `public`-схемы) — оставил по требованию брифа
  дословно: явная фиксация инварианта в коде читается лучше, чем полагание на
  умолчания движка, и защищает от будущего изменения поведения/ручного грант-а.
