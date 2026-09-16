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
  создаётся из `options.databaseUrl`; декорируется как `app.db`. **С fix
  round 1**: требуется ровно один из `pool`/`databaseUrl` (без обоих —
  явная ошибка, никакого неявного `parseConfig()`), и `onClose`-хук
  закрывает пул только если его создал сам `buildServer` (владение, не
  просто идемпотентность — см. Fix round 1). Main-module блок:
  `parseConfig()` → `buildServer({ databaseUrl })` →
  `registerShutdown(app)` → `runMigrations(app.db, { logger })` →
  `app.listen(...)`; ошибка на любом шаге ловится и уходит в
  `shutdownController.shutdown(1)` (тот же идемпотентный путь, что и у
  сигналов).
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
  аргументов). **Поправка (fix round 1): нужно передать ровно один из
  `pool`/`databaseUrl` — `buildServer()` без аргументов теперь бросает
  ошибку** (`"buildServer requires either options.pool ... or
  options.databaseUrl ... it does not fall back to parseConfig() itself"`),
  он больше НЕ падает внутрь `parseConfig()`. В тестах передавайте
  `{ pool: fakePool }` — реальная БД не нужна, паттерн см.
  `routes/health.test.ts`. В проде (main-module блок `server.ts`)
  используется `buildServer({ databaseUrl: config.databaseUrl })`.
  **Владение пулом**: пул, переданный через `options.pool`, `buildServer`
  НЕ закрывает на `app.close()` — это ответственность того, кто его создал
  (см. `AppPool#end`'s JSDoc и fix round 1 ниже); пул, созданный самим
  `buildServer` из `databaseUrl`, закрывается им же автоматически.

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
- **Concern (снято, RESOLVED в fix round 1): `services/backend/Dockerfile`
  не копировал `migrations/` в runtime-образ** — на момент первой сдачи
  копировал только `dist/`. С тех пор `devops-engineer` поправил
  `Dockerfile` отдельным коммитом (`fix(docker): образы обоих сервисов не
  собирались вовсе`) — теперь копирует и `tsconfig.base.json` (без него
  `tsc` падал с TS5083 в обоих образах), и
  `services/backend/migrations`, образ реально собирается и стек
  поднимается целиком. Не мой файл — не трогал.
- **`core._test_rollback_scratch`/`core._test_commit_scratch` —
  скретч-таблицы тестов создаются/дропаются прямо в `core`** (единственная
  доступная роли `trellis_app` схема) вместо выделенной тестовой схемы —
  `trellis_app` не имеет прав создавать схемы, только объекты внутри
  `core`/`sandbox` по своим правам (см. отчёт задачи 002); поэтому это
  единственный вариант без выхода за права роли. Таблицы дропаются в
  `finally` каждого теста — не остаются в БД между прогонами.
- **(Пересмотрено в fix round 1, см. ниже) Тест миграций напрямую `DROP
  TABLE core.lesson_progress / core.schema_migrations`** — исходное
  обоснование («единственная задача, владеющая этими таблицами») отвечало
  про владение схемой, но не про сохранность данных: `DATABASE_URL`
  разработчика указывает на рабочий инстанс в именованном volume, и
  `DROP TABLE` там при `npm test` стирает реальный прогресс пользователя.
  Исправлено: см. `## Fix round 1` — теперь `TRELLIS_TEST_DATABASE_URL`.

## Fix round 1

Ревью подтвердило архитектуру (lifecycle/ресурсы, advisory-lock, «миграции
до listen»), но нашло 3 находки класса Important + 4 мелочи. Все 7 закрыты
(аргументов не менять код не нашлось — по факту все находки корректны).

### Important 1 — `AppPool.end()` не идемпотентен + `buildServer({pool})` закрывал чужой пул

`pool.ts`: убран неверный JSDoc «Idempotent per pg's own contract»
(`pg-pool` на второй `end()` реально реджектит с `Called end on pool more
than once` — это проверено). `createPool` теперь хранит флаг `ended` в
замыкании — второй `pool.end()` на одном и том же `AppPool` — no-op.

`server.ts`: главное — владение, не только идемпотентность.
`buildServer({ pool })` больше НЕ вешает `onClose`-хук на закрытие
инъектированного пула (`ownsPool = options.pool === undefined`); закрывается
только пул, который `buildServer` создал сам из `databaseUrl`. Проверено
скриптом `node` на реальном пуле (`postgres://trellis_app:...@127.0.0.1:5433/trellis`):

```
app1 /health before any close: 200 {"status":"ok","db":"ok"}
app1 closed
app2 /health after app1.close(): 200 {"status":"ok","db":"ok"}
app2 closed
pool.end() #1 ok
pool.end() #2 (idempotent) ok
```

`app2` (второй `buildServer({ pool })` на том же общем пуле) продолжает
отвечать 200 ПОСЛЕ того, как `app1.close()` отработал — пул пережил закрытие
чужого владельца. `pool.end()` вызван дважды подряд без реджекта.

### Important 2 — тесты миграций дропали таблицы по `DATABASE_URL`

`migrate.test.ts` переписан: разрушительные тесты (`DROP TABLE
core.lesson_progress/core.schema_migrations`, мутации
`core.schema_migrations`) читают ТОЛЬКО `TRELLIS_TEST_DATABASE_URL`, не
`DATABASE_URL`. Без неё — `t.skip` с причиной. Добавлена защита от дурака:
если имя БД в `TRELLIS_TEST_DATABASE_URL` не оканчивается на `_test` —
`throw` (не skip — молчаливый skip замаскировал бы опасную настройку;
throw останавливает прогон громко ДО того, как что-либо тронуто в БД).
`pool.test.ts` НЕ трогал: его тесты создают/дропают только собственные
скретч-таблицы (`core._test_rollback_scratch`/`_commit_scratch`), никогда
`core.lesson_progress`/`core.schema_migrations` — это не подпадает под
находку (никакого риска потери прогресса), поэтому там `DATABASE_URL`
оставлен как и было. Если ревьюер хочет унификации — не возражаю, но счёл
это over-engineering для файла, который и так ничего не разрушает.

Проверено вживую (пароли реальные, стек поднят):
1. `TRELLIS_TEST_DATABASE_URL` не задан → все 3 деструктивных теста `# SKIP`
   с причиной, остальные 17 проходят как обычно (см. вывод ниже).
2. `TRELLIS_TEST_DATABASE_URL` указывает на `trellis` (не оканчивается на
   `_test`) → все 3 деструктивных теста падают (`not ok`) с сообщением
   `Refusing to run destructive migration tests against database "trellis"`
   — тест-ран красный, а не тихо зелёный, БД не тронута.
3. `TRELLIS_TEST_DATABASE_URL` указывает на отдельную `trellis_test`
   (создана вручную для проверки: `CREATE DATABASE trellis_test OWNER
   trellis_app`, `CREATE SCHEMA core AUTHORIZATION trellis_app` — только
   для верификации, удалена после) → 20/20 зелёных, ничего в рабочей
   `trellis` не тронуто.

### Important 3 — вторичная ошибка (ROLLBACK/unlock) подменяет настоящую причину

`pool.ts` (`withTransaction`) и `migrate.ts` (`applyPendingMigrations`,
`runMigrations`): `ROLLBACK` и `pg_advisory_unlock` теперь в собственном
`try/catch`. Если cleanup сам падает (например, соединение уже оборвано),
эта вторичная ошибка НЕ подменяет исходную — исходная (`err`/причина сбоя
миграции) всегда пробрасывается дальше; в `migrate.ts` вторичная ошибка
дополнительно логируется через `logger.warn` (не теряется молча).

### Мелочи

1. **`server.ts:36` fallback на `parseConfig()` убран.** `buildServer()` без
   `pool`/`databaseUrl` теперь бросает явную ошибку («requires either
   options.pool ... or options.databaseUrl ... it does not fall back to
   parseConfig() itself»), не тянет `SANDBOX_DATABASE_URL` транзитивно.
2. **Отчёт (этот файл) поправлен** — секция «Интерфейсный дайджест»,
   параграф про `buildServer` (см. правку выше по тексту: убрано «без
   аргументов тоже сработает», добавлено про обязательность одного из
   `pool`/`databaseUrl` и про владение пулом).
3. **`migrate.ts` больше не безмолвен.** Добавлен `MigrationLogger`
   (`info`/`warn`, no-op по умолчанию; `server.ts` подключает `app.log`).
   Логирует `Applying migration "NNN"...` на каждую применяемую миграцию,
   `Applied N migration(s).` в конце, `Database schema is up to date — no
   pending migrations.` когда нечего применять. Ограничение ожидания лока:
   `pg_advisory_lock` заменён на поллинг `pg_try_advisory_lock` (интервал
   200мс, дедлайн 30с) — при занятом локе логирует `Waiting for the
   migrations lock...` один раз, при истечении дедлайна — явная ошибка с
   таймаутом, вместо бесконечного молчаливого зависания.
4. **`pool.ts` `connectionTimeoutMillis` — `5000` → `2000`**, чтобы наш
   503 успевал доехать раньше, чем backend-healthcheck'а `timeout: 5s` в
   `docker-compose.yml` (иначе при «молчащем» Postgres Docker увидел бы
   свой generic timeout-фейл раньше нашего осмысленного ответа).

### Проверки — реальный вывод

**`npm test -w @trellis/backend` без БД (`DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL` не заданы):**
```
# tests 20
# pass 15
# fail 0
# skipped 5
```
Пропуски — с причинами (`DATABASE_URL is not set...` для `pool.test.ts`,
`TRELLIS_TEST_DATABASE_URL is not set...` для `migrate.test.ts`).

**С поднятой БД, `TRELLIS_TEST_DATABASE_URL` НЕ задан** (защита работает):
3 деструктивных теста — `# SKIP`, остальные 17 — `ok`, 0 `fail`.

**С поднятой БД, `TRELLIS_TEST_DATABASE_URL` указывает на БД БЕЗ суффикса `_test`:**
```
not ok 7 - runMigrations applies 001_progress from a clean core schema and is idempotent on repeat
not ok 8 - runMigrations refuses to continue when an applied version's file is missing (error path)
not ok 9 - concurrent runMigrations calls on the same DB serialize via the advisory lock (edge case)
```
(Остальные 17 — `ok`.) Ошибка: `Refusing to run destructive migration tests
against database "trellis": TRELLIS_TEST_DATABASE_URL must point at a
database whose name ends with "_test"`. `trellis.core.lesson_progress` не
тронута (проверено — тест падает до первого `DROP TABLE`).

**С поднятой БД, `TRELLIS_TEST_DATABASE_URL` = отдельная `trellis_test`:**
```
# tests 20
# pass 20
# fail 0
# skipped 0
```

**Продовый прогон миграций с реальным логгером (`node dist/server.js`, БД очищена вручную перед стартом):**
```
{"level":30,...,"msg":"Applying migration \"001_progress\"..."}
{"level":30,...,"msg":"Applied 1 migration(s)."}
{"level":30,...,"msg":"Server listening at http://127.0.0.1:3098"}
```
Второй старт той же БД (уже применено):
```
{"level":30,...,"msg":"Database schema is up to date — no pending migrations."}
{"level":30,...,"msg":"Server listening at http://127.0.0.1:3098"}
```
`/health` → `200 {"status":"ok","db":"ok"}` в обоих случаях, `SIGTERM` →
`EXIT_CODE=0`, `core.schema_migrations` — 1 строка после обоих стартов.

**`npm run build -w @trellis/backend`**: `tsc -p tsconfig.json`, код `0`.

**`bash .mvp/ci-mirror.sh`** (с чистого дерева, `rm -rf node_modules
services/backend/dist services/backend/dist-test`): код `0` — `npm ci` →
lint (backend + frontend) → build (backend `tsc`, frontend `tsc -b && vite
build`) → test (backend 20/20 с 5 SKIP без БД/`TRELLIS_TEST_DATABASE_URL`,
frontend 4/4 vitest).

**`eslint .`** (прямой вызов, см. примечание в исходном отчёте про
rtk-прокси): код `0`, без замечаний.

**Уборка**: `DROP DATABASE trellis_test` (тестовая БД, созданная только для
верификации Important 2), `docker compose down -v`, `.env` удалён,
`docker ps -a --filter name=trellis` — пусто.

### Deferred decisions (fix round 1)

- **`pool.test.ts` НЕ переведён на `TRELLIS_TEST_DATABASE_URL`** — его
  тесты трогают только собственные одноразовые скретч-таблицы
  (`core._test_rollback_scratch`/`_commit_scratch`), никогда
  `core.lesson_progress`/`core.schema_migrations`; риска потери прогресса
  нет, поэтому оставлен на `DATABASE_URL` как более простой путь для
  тестов, которым реальный «деструктив» не нужен. Открыт к пересмотру, если
  ревьюер хочет единообразия по всем файлам данных.
- **Отказ (не skip) при `TRELLIS_TEST_DATABASE_URL` без суффикса `_test`** —
  сознательно throw, а не `t.skip`: неверно настроенная переменная — это
  ошибка конфигурации разработчика, которая должна остановить прогон
  красным, а не потеряться в списке пропущенных тестов, которые «и так не
  проблема».
- **`LOCK_ACQUIRE_TIMEOUT_MS = 30_000`, `LOCK_POLL_INTERVAL_MS = 200`** —
  константы, не конфигурируемые через env (YAGNI на этом этапе — реальный
  прогон миграций занимает миллисекунды, конкуренция за лок — редкий
  краевой случай зависшего инстанса, не что-то, что нужно тюнить в проде
  сейчас).
