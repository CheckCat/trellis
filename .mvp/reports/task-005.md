# Task 005 — слой данных ядра: пул, миграции, lifecycle — отчёт

## Что создано

- `services/backend/src/db/pool.ts` — `createPool(databaseUrl, options?)` →
  `AppPool` (`query`, `connect`, `withTransaction`, `end`), под ролью
  приложения (`DATABASE_URL`), `SANDBOX_DATABASE_URL` не читается нигде в
  этом модуле. Лимиты: `max: 10`, `connectionTimeoutMillis: 5000`,
  `idleTimeoutMillis: 30000`. `pool.on('error', ...)` подписан всегда (иначе
  фоновая ошибка на простаивающем клиенте роняет весь процесс необработанным
  `'error'`-событием) — прокидывается наружу через `options.onError`, без
  `console.*`. `connect()` оборачивает ошибку установления соединения в
  понятное сообщение с редактированным паролем (`redactPassword`,
  `describeConnectionError`) — `query()` НЕ оборачивается (иначе реальные
  query-ошибки — синтаксис, constraint violation — маскировались бы под
  «не могу достучаться до Postgres»). Модуль декларирует
  `fastify.db: AppPool` через `declare module "fastify"`.
- `services/backend/migrations/001_progress.sql` — `core.lesson_progress`
  и `core.schema_migrations` дословно по модели из брифа (текст ниже).
- `services/backend/src/db/migrate.ts` — `runMigrations(pool, dir?)`:
  читает `migrations/*.sql` в лексикографическом порядке (относительно
  местоположения самого модуля — работает одинаково из `dist/db/`,
  `dist-test/db/` и `src/db/`, все три на одном уровне вложенности под
  `services/backend/`), применяет непринятые по одной в отдельной
  транзакции (`BEGIN`/выполнение файла/`INSERT INTO
  core.schema_migrations`/`COMMIT`, `ROLLBACK` при ошибке файла), под
  `pg_advisory_lock` на весь прогон (сессионный, ключ — фиксированная
  константа `84637201`, снимается явно `pg_advisory_unlock` в `finally`,
  клиент возвращается в пул). Bootstrap-случай (таблицы
  `schema_migrations` ещё нет вообще) обрабатывается через проверку
  `information_schema.tables`. Запись в `schema_migrations` без
  соответствующего файла — явная ошибка, не тихий пропуск.
- `services/backend/src/lifecycle.ts` — `registerShutdown(app, options?)` →
  `{ shutdown(exitCode?) }`. Вешает `process.on('SIGINT'|'SIGTERM', ...)` и
  `process.on('beforeExit', ...)`, все ведут к одному `shutdown()`,
  идемпотентному (второй/параллельный вызов не переисполняет
  `app.close()`, а ждёт первый). Пул НЕ закрывается здесь напрямую — только
  через `app.close()` → `onClose`-хуки (хук пула — в `server.ts`).
  `options.exit`/`options.signals`/`options.installBeforeExit` — точки
  подмены для тестов (не трогают реальные `process`-листенеры).
- `services/backend/src/routes/health.ts` (расширён) — `GET /health`
  выполняет `fastify.db.query("select 1")`; успех → `200
  {"status":"ok","db":"ok"}`; ошибка → лог `request.log.error` +
  `503 {"status":"degraded","db":"down"}`. Схемы ответа на оба кода.
- `services/backend/src/server.ts` (расширён) — `buildServer(options?:
  { pool?, databaseUrl? })`: пул берётся из `options.pool` (тесты) либо
  создаётся из `options.databaseUrl ?? parseConfig().databaseUrl`;
  декорируется как `app.db`; `onClose`-хук закрывает пул. Main-module блок:
  `parseConfig()` → `buildServer({ databaseUrl })` →
  `registerShutdown(app)` → `runMigrations(app.db)` → `app.listen(...)`;
  ошибка на любом шаге ловится и уходит в `shutdownController.shutdown(1)`
  (тот же идемпотентный путь, что и у сигналов).
- Тесты (`node:test`, co-located, по паттерну task-003):
  `src/db/pool.test.ts`, `src/db/migrate.test.ts`, `src/lifecycle.test.ts`,
  переписанный `src/routes/health.test.ts` (фейковый `AppPool` через
  `buildServer({ pool })`, реальная БД не нужна).
- `services/backend/package.json` — добавлены зависимости `pg` (^8.23.0) и
  `@types/pg` (^8.23.1, devDependency), через `npm install ... -w
  @trellis/backend` из корня (root `package-lock.json` обновлён —
  `BOUNDARY_EXEMPT` по `.mvp/invariants.md`).

## Схема БД, как она легла (проверено на реальном Postgres)

```
                        Table "core.lesson_progress"
     Column     |           Type           | Collation | Nullable | Default
----------------+--------------------------+-----------+----------+---------
 course_id      | text                     |           | not null |
 lesson_id      | text                     |           | not null |
 status         | text                     |           | not null |
 course_version | text                     |           |          |
 completed_at   | timestamp with time zone |           | not null | now()
 updated_at     | timestamp with time zone |           | not null | now()
Indexes: "lesson_progress_pkey" PRIMARY KEY, btree (course_id, lesson_id)
Check constraints: "lesson_progress_status_check" CHECK (status = 'completed'::text)

                     Table "core.schema_migrations"
   Column   |           Type           | Collation | Nullable | Default
------------+--------------------------+-----------+----------+---------
 version    | text                     |           | not null |
 applied_at | timestamp with time zone |           | not null | now()
Indexes: "schema_migrations_pkey" PRIMARY KEY, btree (version)
```

## Поведение миграций (проверено фактически)

- Первый старт на чистом volume: `core.schema_migrations` не существует →
  трактуется как «ничего не применено» → `001_progress.sql` выполняется в
  транзакции → `insert into core.schema_migrations (version) values
  ('001_progress')` в той же транзакции → `COMMIT`.
- Второй/N-й старт: `select version from core.schema_migrations` → уже
  содержит `001_progress` → файл пропускается, никаких изменений/дублей.
  Подтверждено реальным запуском процесса дважды подряд (см. «Проверки»
  ниже) — после второго старта в таблице ровно 1 строка.
- Advisory lock: сессионный `pg_advisory_lock($1)` берётся на клиенте,
  полученном через `pool.connect()`, снимается `pg_advisory_unlock($1)` в
  `finally`, клиент release'ится в внешнем `finally`. Тест
  `concurrent runMigrations calls ... serialize via the advisory lock`
  гоняет два параллельных `runMigrations(pool)` на чистых таблицах и
  проверяет, что в `schema_migrations` осталась ровно одна строка (без
  этого лока второй вызов упал бы на PK-конфликте при параллельной
  вставке).
- Несовпадение файла и записи: если в `core.schema_migrations` есть версия,
  для которой нет файла в `migrations/`, `runMigrations` бросает ошибку с
  именем этой версии и путём директории, не продолжая молча.

## Lifecycle — как проверено

- `SIGTERM` во время нормальной работы: `EXIT_CODE=0`, после выхода
  `select count(*) from pg_stat_activity where usename='trellis_app'` = 0
  (ни одного висящего соединения).
- `SIGTERM` при недоступной БД (Postgres остановлен, но процесс backend
  жив): тоже `EXIT_CODE=0` — `pool.end()` не подвешивает закрытие даже
  когда сервер не может достучаться до БД.
- Повторный сигнал / повторный ручной вызов `shutdown()` не переисполняет
  `app.close()` — покрыто тестом (`shutdown() closes the app exactly once,
  even when called multiple times`).

## Интерфейсный дайджест для задач 007/008/010

- **Получить пул**: не создавайте свой — используйте decorator
  `fastify.db` (тип `AppPool`, из `services/backend/src/db/pool.ts`),
  доступен в любом плагине, зарегистрированном после `buildServer()`
  создал его (т.е. везде, куда попадает `app` из `buildServer()`).
- **Как писать запросы**:
  - Простой запрос: `await fastify.db.query<RowType>("select ... where id = $1", [id])`
    → `QueryResult<RowType>` (стандартный `pg`, `.rows`, `.rowCount`).
  - Многошаговая операция с атомарностью: `await fastify.db.withTransaction(async (client) => { ... })`
    — `client` это `pg.PoolClient`, `BEGIN`/`COMMIT` уже сделаны обёрткой,
    `ROLLBACK` при любом throw, `client.release()` гарантирован в `finally`.
    Внутри `fn` используйте `client.query(...)`, не `fastify.db.query(...)`
    (иначе выйдете из транзакции на отдельное соединение).
  - `fastify.db.connect()` — только если нужен один клиент на несколько
    отдельных выражений вне BEGIN/COMMIT (как в `migrate.ts` для advisory
    lock). Не забывайте `client.release()`.
- **Как оформить новую миграцию**: файл
  `services/backend/migrations/NNN_description.sql`, `NNN` на единицу
  больше текущего максимума, с ведущими нулями (`002_...`, не `2_...` —
  иначе лексикографическая сортировка разойдётся с числовой при переходе
  через `009`→`010`). SQL-тело — по возможности `if not exists`/`if
  exists` guards как вторая линия защиты (основная — таблица
  `schema_migrations`, она не даёт повторно применить файл). Не
  редактируйте уже применённый файл задним числом — раз применённый файл
  это history, а не source для рефакторинга; для изменений — новый файл.
  `runMigrations()` подхватывает файл автоматически при следующем старте,
  ничего регистрировать вручную не нужно.
- **`AppPool` API**: `query`, `connect`, `withTransaction`, `end` — этого
  достаточно для 007 (домен прогресса) и 010; для 008 (песочница) это НЕ
  переиспользуется — там отдельный пул под `trellis_sandbox` с той же
  формой API (`createPool` можно переиспользовать буквально, просто с
  другой `databaseUrl`, если понадобится тот же интерфейс).
- **`buildServer(options?: { pool?: AppPool; databaseUrl?: string })`** —
  сигнатура изменилась относительно task-003 (там был `buildServer()` без
  аргументов). В тестах передавайте `{ pool: fakePool }` — реальная БД и
  `DATABASE_URL` не нужны, паттерн см. `routes/health.test.ts`. В проде
  (main-module блок `server.ts`) достаточно `buildServer()`
  (без аргументов тоже сработает — внутри упадёт на `parseConfig()`, если
  `DATABASE_URL` не задан).

## Проверки — реальный вывод

### `npm test -w @trellis/backend` БЕЗ поднятой БД

```
# tests 20
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 5
# todo 0
```

5 тестов, требующих реальный Postgres, пропущены с внятной причиной,
например:
```
ok 7 - runMigrations applies 001_progress from a clean core schema and is idempotent on repeat # SKIP DATABASE_URL is not set — skipping test that requires a live Postgres
```
Итого исполнено 15 реальных тестов (не "0 tests, exit 0") + 5 явных SKIP —
не ложный зелёный.

### `npm test -w @trellis/backend` С поднятой БД (`DATABASE_URL` выставлен)

```
# tests 20
# pass 20
# fail 0
# skipped 0
```
Все 20/20, включая 5 ранее пропущенных (миграции идемпотентны, rollback
`withTransaction`, конкурентный прогон миграций сериализуется, `/health`
200/503 с реальным db-check).

### Проверка со стеком Postgres (`cp .env.example .env` + свои пароли, `docker compose up -d postgres`)

- Первый старт `node dist/server.js`:
  ```
  {"level":30,...,"msg":"Server listening at http://127.0.0.1:3098"}
  ```
  `curl /health` → `HTTP_STATUS=200`, `{"status":"ok","db":"ok"}`.
  `core.schema_migrations` → 1 строка (`001_progress`).
- `SIGTERM` первому процессу → `EXIT_CODE=0`.
- Второй старт того же `node dist/server.js` (та же БД, миграции уже
  применены) → не падает, `/health` снова `200 {"status":"ok","db":"ok"}`,
  `core.schema_migrations` — по-прежнему ровно 1 строка (не 2). Активных
  соединений роли `trellis_app` в `pg_stat_activity` = 1 (сам процесс);
  после `SIGTERM` → 0.
- Третий запуск: сервер жив, `docker compose stop postgres` →
  `curl /health` → `HTTP_STATUS=503`, `{"status":"degraded","db":"down"}`.
  `SIGTERM` этому процессу (БД всё ещё недоступна) → `EXIT_CODE=0` (пул
  закрывается без зависания даже при недоступной БД).
- Уборка: `docker compose down -v`, `.env` удалён.

### `npm run build -w @trellis/backend`

```
> build
> tsc -p tsconfig.json
```
Код `0`, без предупреждений.

### `bash .mvp/ci-mirror.sh`

Прогнано с чистого дерева (`rm -rf node_modules services/backend/dist
services/backend/dist-test`) — код `0`: `npm ci` → lint (backend +
frontend) → build (backend `tsc`, frontend `tsc -b && vite build`) → test
(backend 20/20 с 5 SKIP без БД, frontend 4/4 vitest).

### `npm run lint -w @trellis/backend` (через прямой вызов `eslint .`, т.к. npm-обёртка в этой песочнице отдаёт непарсящийся вывод из-за rtk-прокси — сам ESLint отработал штатно)

Код `0`, без замечаний.

## Deferred decisions

- **`AppPool` включает `connect()` в публичном интерфейсе, а не только
  `query`/`withTransaction`** — бриф говорит буквально "тонкая обёртка
  query/withTransaction", но `migrate.ts` необходим клиент, живущий через
  несколько отдельных SQL-команд вне одной BEGIN/COMMIT-транзакции
  (`pg_advisory_lock` → N миграций каждая в своей транзакции →
  `pg_advisory_unlock`, всё на одной сессии). `withTransaction` для этого
  не годится (обернул бы всё одним BEGIN/COMMIT, что сломало бы «каждая
  миграция в своей транзакции» и откат одной миграции откатил бы
  предыдущие уже закоммиченные). `connect()` — минимальное расширение,
  остаётся тонкой обёрткой над `pg.Pool#connect`, не ORM.
- **Ошибка соединения оборачивается в понятное сообщение только на
  `connect()`, не на `query()`** — обоснование в комментарии в `pool.ts`:
  `query()` может завершиться ошибкой уже после успешного соединения
  (синтаксис, constraint violation, и т.п.), и заворачивание её в «не могу
  подключиться к Postgres» было бы вводящим в заблуждение. `connect()` —
  единственная точка, где ЛЮБАЯ ошибка гарантированно является ошибкой
  установления соединения.
- **`buildServer()` меняет сигнатуру** (task-003: без аргументов → сейчас
  `buildServer(options?: { pool?, databaseUrl? })`) — неизбежно: `/health`
  теперь зависит от пула, тестам нужен способ подставить фейковый пул без
  реальной БД. Задокументировано в интерфейсном дайджесте выше как
  контракт для 006/007/008/010 (действует паттерн `buildApp(overrides)` из
  роли backend-implementer).
- **Concern: `services/backend/Dockerfile` не копирует `migrations/` в
  runtime-образ** (копирует только `dist/`, см. `COPY --from=builder
  /app/services/backend/dist ...`). В реальном контейнере
  `runMigrations()` упадёт с ENOENT на несуществующей директории. Не
  чиню сам: `Dockerfile` — зона `devops-engineer` (роль backend-implementer
  явно исключает Dockerfile/CI/compose), и `BOUNDARY` этой задачи явно не
  включает право его трогать. Не блокирует текущие критерии готовности
  (все проверки выше — через `docker compose up -d postgres` + локальный
  `node dist/server.js`, не через полный образ backend). Нужно поднять
  отдельно: строка `COPY services/backend/migrations
  services/backend/migrations` в runtime-стадии `Dockerfile` (или
  скопировать раньше, в builder-стадию, без разницы — миграции не
  компилируются).
- **`core._test_rollback_scratch`/`core._test_commit_scratch` —
  скретч-таблицы тестов создаются/дропаются прямо в `core`** (единственная
  доступная роли `trellis_app` схема) вместо выделенной тестовой схемы —
  `trellis_app` не имеет прав создавать схемы, только объекты внутри
  `core`/`sandbox` по своим правам (см. отчёт задачи 002); поэтому это
  единственный вариант без выхода за права роли. Таблицы дропаются в
  `finally` каждого теста — не остаются в БД между прогонами.
- **Тест миграций напрямую `DROP TABLE core.lesson_progress /
  core.schema_migrations`** перед проверкой применения "с нуля" — приемлемо
  только потому что это единственная задача, владеющая этими двумя
  таблицами (007 их только читает/пишет строки, не меняет DDL); тест не
  трогает ничего, чем не владеет.
