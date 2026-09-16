## Task
- id: 007
- title: Реализовать домен прогресса и его API: дерево курса со статусами, отметка «пройдено» вручную и по верному ответу квиза, привязка к стабильным id и согласование прогресса при обновлении курса.
- level: 4
- service: backend
- service_path: services/backend
- role: backend-implementer
- files: services/backend/src/progress/model.ts, services/backend/src/progress/repository.ts, services/backend/src/progress/reconcile.ts, services/backend/src/routes/progress.ts, services/backend/src/routes/quiz.ts
- depends_on: 005, 006
- estimate_tokens: 20000
- status: pending
- complexity_class: novel-design

## Boundary
services/backend

## Interfaces from dependencies
### 005
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

### 006
# Task 006 — формат контент-пакета и загрузчик курсов — отчёт

## Что создано

- `services/backend/src/courses/manifest.schema.json` — JSON Schema
  (draft 2020-12) для `manifest.yaml`, дословно по формату из брифа
  (`additionalProperties: false` везде, `modules` min 1, `quiz.options` min
  2). Полный текст — см. секцию «Схема манифеста» ниже.
- `services/backend/src/courses/types.ts` — общие доменные типы: `Course`,
  `CourseModule`, `CourseLesson`, `CourseQuiz(Option)`, `CoursePractice`,
  `CourseSandbox`, `ValidationError`, `ValidationResult`, плюс
  промежуточные `ValidatedManifest`/`ValidatedModule`/`ValidatedLesson`
  (см. «Интерфейсный дайджест»).
- `services/backend/src/courses/validate.ts` — `validateManifest(manifestSource: unknown, packageDir: string): ValidationResult`:
  структурная проверка через `ajv` (`Ajv2020`, `allErrors: true, strict:
  true`, схема компилируется один раз при загрузке модуля) + семантические
  проверки кодом (уникальность id модулей/уроков/вариантов/песочниц на
  нужных уровнях, ровно один `correct: true`, `explanation` у неверных
  вариантов, разрешение `practice.sandbox`, непустота урока, безопасность
  путей `content`/`seed[]` с проверкой существования). Никогда не бросает —
  дискриминированный результат `{ok:true, manifest} | {ok:false, errors}`.
- `services/backend/src/courses/loader.ts` — `loadCoursePackage(packageDir)`
  (читает `manifest.yaml`, парсит YAML, зовёт `validateManifest`, при успехе
  читает Markdown уроков в `content`) и `scanCoursesDir(coursesDir)`
  (сканирует immediate-поддиректории, сортирует по имени для детерминизма,
  грузит каждую; отсутствие `coursesDir` → `{courses:[], rejected:[]}`, не
  исключение).
- `services/backend/src/courses/registry.ts` — `createCourseRegistry(coursesDir, logger?)`:
  синхронное первичное сканирование внутри самой фабричной функции (до её
  возврата — API готово с первого запроса), `list()`/`get()`/
  `listRejected()`/`rescan()`; дедупликация id между директориями
  («первая по алфавиту директория побеждает, не последняя отсканированная»
  — детерминировано, покрыто тестом). `declare module "fastify" { courses:
  CourseRegistry }` в этом же файле (тот же паттерн, что `fastify.db` в
  `db/pool.ts`).
- `services/backend/src/routes/courses.ts` — 4 HTTP-эндпоинта (см. ниже),
  plain JSON Schema на каждом (без TypeBox — тот же выбор, что и `/health`,
  см. task-003's Deferred decisions), явный маппинг domain→public с явным
  комментарием про то, почему `correct`/`explanation` стрипаются у ВСЕХ
  вариантов квиза, не только у правильного.
- `services/backend/src/courses/testSupport.ts` — общий тестовый хелпер
  (temp-директории, запись фикстурных пакетов курса, валидный
  manifest.yaml-шаблон). Не тестовый файл сам по себе (не матчит
  `*.test.ts`), поэтому явно добавлен в `exclude` `tsconfig.json`, чтобы не
  попасть в прод-образ; `tsconfig.test.json` включает его как обычно
  (`exclude: []`).
- Тесты (`node:test`, co-located): `courses/validate.test.ts` (10),
  `courses/loader.test.ts` (5), `courses/registry.test.ts` (5),
  `routes/courses.test.ts` (7) — итого 27 новых тестов, все синтетические
  фикстуры, ни одного названия реального курса.
- Правки существующих файлов внутри границы:
  - `services/backend/src/config.ts` — `DEFAULT_COURSES_DIR` стал
    экспортируемой константой (было приватным `const` в модуле) — одна
    точка правды для дефолта, `server.ts`'s `buildServer` использует ту же
    константу.
  - `services/backend/src/server.ts` — `BuildServerOptions` расширен
    `registry?`/`coursesDir?` (симметрично `pool?`/`databaseUrl?`, но без
    обязательности — у курсов есть безопасный дефолт); `buildServer`
    декорирует `app.courses`, регистрирует `coursesRoutes`; main-module блок
    передаёт `coursesDir: config.coursesDir`.
  - `services/backend/tsconfig.json` — `resolveJsonModule: true` (нужно для
    `import manifestSchema from "./manifest.schema.json" with { type:
    "json" }`) + `exclude` дополнен `courses/testSupport.ts`.
  - `services/backend/package.json` / корневой `package-lock.json` —
    добавлена **`ajv@^8.20.0`** и **`yaml@^2.9.1`** как прямые зависимости
    `@trellis/backend` (`ajv-formats` был установлен, но не использовался —
    не оставлен, см. Deferred decisions).

## Схема манифеста (эталон для задачи 017)

Итоговый `manifest.schema.json` — правила ровно как в брифе:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://trellis.local/schemas/manifest.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "version", "title", "modules"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,63}$" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$" },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "sandboxes": { "type": "array", "items": { "$ref": "#/$defs/sandbox" } },
    "modules": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/module" } }
  },
  "$defs": {
    "sandbox": {
      "type": "object", "additionalProperties": false, "required": ["id", "type"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": { "type": "string", "enum": ["postgres"] },
        "seed": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    },
    "module": {
      "type": "object", "additionalProperties": false, "required": ["id", "title", "lessons"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "title": { "type": "string", "minLength": 1 },
        "lessons": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/lesson" } }
      }
    },
    "lesson": {
      "type": "object", "additionalProperties": false, "required": ["id", "title"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "title": { "type": "string", "minLength": 1 },
        "content": { "type": "string", "minLength": 1 },
        "quiz": { "$ref": "#/$defs/quiz" },
        "practice": { "$ref": "#/$defs/practice" }
      }
    },
    "quiz": {
      "type": "object", "additionalProperties": false, "required": ["question", "options"],
      "properties": {
        "question": { "type": "string", "minLength": 1 },
        "options": { "type": "array", "minItems": 2, "items": { "$ref": "#/$defs/quizOption" } }
      }
    },
    "quizOption": {
      "type": "object", "additionalProperties": false, "required": ["id", "text"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "text": { "type": "string", "minLength": 1 },
        "correct": { "type": "boolean" },
        "explanation": { "type": "string", "minLength": 1 }
      }
    },
    "practice": {
      "type": "object", "additionalProperties": false, "required": ["sandbox", "prompt"],
      "properties": {
        "sandbox": { "type": "string", "minLength": 1 },
        "prompt": { "type": "string", "minLength": 1 },
        "check": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

Примечание для 017: только у **курса** id есть заданный regex
(`^[a-z0-9][a-z0-9-]{1,63}$`, минимум 2 символа); id модуля/урока/песочницы/
варианта квиза — просто непустая строка (брифом regex для них не задан, а
пример манифеста использует однобуквенные id вариантов "a"/"b", что с
courseId-паттерном не прошло бы). `version` проверяется по semver-подобному
regex (Defer&Continue — брифом не был явно потребован regex, но "semver,
строка" разумно интерпретировать как проверяемый формат).

## Правила валидации (полный список, с сообщениями)

Структурные (ajv, JSON Schema) — сообщение всегда включает путь в стиле
`modules[1].lessons[0].quiz.options`:
- отсутствует обязательное поле → `Missing required property "<name>".`
- неизвестное поле → `Unexpected property "<name>" — additional properties are not allowed here.`
- прочие несовпадения типа/паттерна/длины → штатное сообщение ajv
  (`err.message`, например `must match pattern "..."`).

Семантические (код, `validate.ts`):
- дубль id песочницы → `Duplicate sandbox id "<id>" — sandbox ids must be unique within a course.` (`sandboxes[i].id`)
- дубль id модуля → `Duplicate module id "<id>" — module ids must be unique within a course.` (`modules[i].id`)
- дубль id урока (глобально по курсу, не по модулю) → `Duplicate lesson id "<id>" — lesson ids must be unique across the whole course, not just within a module.` (`modules[i].lessons[j].id`)
- дубль id варианта квиза → `Duplicate quiz option id "<id>" — option ids must be unique within a quiz.` (`....quiz.options[k].id`)
- не ровно один `correct: true` → `Quiz must have exactly one option with correct: true, found <n>.` (`....quiz.options`)
- у неверного варианта нет `explanation` → `Incorrect quiz option "<id>" is missing "explanation" — every incorrect option must explain why it's wrong.` (`....quiz.options[k].explanation`)
- `practice.sandbox` не объявлен → `practice.sandbox "<id>" does not reference a declared sandboxes[].id.` (`....practice.sandbox`)
- урок без content/quiz/practice → `Lesson "<id>" has none of content/quiz/practice — a lesson must carry at least one.` (путь — сам урок)
- путь абсолютный → `Path "<p>" must be relative to the package directory, not absolute.`
- путь содержит `..` → `Path "<p>" is not allowed to contain ".." (must stay inside the package directory).`
- путь резолвится вне пакета (в т.ч. через симлинк, проверено `realpathSync` с обеих сторон) → `Path "<p>" resolves outside the package directory (possibly via a symlink).`
- путь не существует → `Path "<p>" does not point to an existing file.`
- путь существует, но не файл → `Path "<p>" does not point to a regular file.`

## Загрузчик и реестр

- `loadCoursePackage`: нет `manifest.yaml` → `Cannot read "manifest.yaml": <ENOENT message>`; невалидный YAML → `"manifest.yaml" is not valid YAML: <parser message>`; иначе — `validateManifest` + чтение Markdown.
- `scanCoursesDir(coursesDir)`: нет директории → `{courses:[], rejected:[]}` (не ошибка); поддиректории сканируются в алфавитном порядке (детерминизм для дедупликации на уровне реестра).
- `createCourseRegistry(coursesDir, logger?)`: сканирует **синхронно внутри себя, до возврата** — `list()`/`get()` валидны сразу; дубль id курса между двумя директориями → **первая по алфавиту побеждает**, остальные — в `listRejected()` с сообщением `Duplicate course id "<id>" — already used by package directory "<dir>" (directories are scanned in alphabetical order; the first one to claim an id keeps it, later ones are rejected — not "last scanned wins").`; `logger.warn(...)` вызывается для каждого отклонённого пакета при каждом скане (включая первичный).

## HTTP API — формы ответов (реальный вывод `app.inject()`)

**`GET /courses`** → `200`, массив (без обёртки в объект — выбор,
задокументирован в Deferred decisions):
```json
[{"id":"good-course","version":"1.0.0","title":"Fixture course","description":"A synthetic course used only by backend tests."}]
```

**`GET /courses/:courseId`** → `200`:
```json
{
  "id": "good-course", "version": "1.0.0", "title": "Fixture course",
  "description": "A synthetic course used only by backend tests.",
  "modules": [{"id":"intro","title":"Intro module","lessons":[
    {"id":"first-lesson","title":"First lesson","hasContent":true,"hasQuiz":true,"hasPractice":true}
  ]}]
}
```
Неизвестный/отклонённый (rejected) courseId → `404`:
```json
{"error":"course_not_found","message":"Course \"broken-course\" was not found."}
```
(rejected-курс ведёт себя идентично неизвестному id — он никогда не попадает в реестр `courses`, только в `listRejected()`.)

**`GET /courses/:courseId/lessons/:lessonId`** → `200`:
```json
{
  "id": "first-lesson", "title": "First lesson",
  "content": "# First lesson\n\nHello.",
  "quiz": {"question":"2 + 2 = ?","options":[{"id":"a","text":"4"},{"id":"b","text":"5"}]},
  "practice": {"sandbox":"main","prompt":"Do the thing."}
}
```
Ни `correct`, ни `explanation` не присутствуют ни у одного варианта (не
только у правильного — иначе "у кого нет explanation" сам по себе выдал бы
ответ, см. комментарий в `routes/courses.ts`), `practice.check` отсутствует
целиком. Неизвестный courseId/lessonId → `404` с `{"error":"course_not_found"|"lesson_not_found","message":"..."}`.

**`POST /courses/rescan`** → `200`:
```json
{"accepted":1,"rejected":1,"rejectedCourses":[{"dir":"broken-course","errors":[{"path":"modules[0].lessons[0].practice.sandbox","message":"practice.sandbox \"nonexistent\" does not reference a declared sandboxes[].id."}]}]}
```
(причина отклонения видна и в API-ответе, и в логах — `fastify.log.warn` на каждый отклонённый пакет.)

## Интерфейсный дайджест для задач 007/009/011/013

- **Получить реестр**: `fastify.courses` (тип `CourseRegistry`, decorator в
  `server.ts`, доступен в любом плагине, зарегистрированном после
  `buildServer()` его создал — везде, куда попадает `app`).
- **`CourseRegistry` API**:
  - `list(): CourseSummary[]` — только валидные курсы, `{id, version,
    title, description?}`.
  - `get(courseId: string): Course | undefined` — полный загруженный курс
    (модули с уроками, markdown уже прочитан в `content`) или `undefined`
    (неизвестный ИЛИ отклонённый id — reject-курсы никогда сюда не
    попадают).
  - `listRejected(): RegistryRejectedCourse[]` — `{dir, courseId?, errors:
    ValidationError[]}` для отладки/показа причины.
  - `rescan(): { accepted: number; rejected: number }` — единственный
    способ (пере)загрузить курсы; нет вотчера файловой системы.
- **`Course` (из `courses/types.ts`)**: `id, version, title, description?,
  dir` (абсолютный путь к директории пакета — 009 резолвит
  `sandboxes[].seed[]` через `path.join(course.dir, seedRelPath)`),
  `sandboxes: CourseSandbox[]` (`{id, type: "postgres", seed: string[]}` —
  относительные пути, уже провалидированы на существование и безопасность,
  **не читаны**), `modules: CourseModule[]`.
- **`CourseModule`**: `{id, title, lessons: CourseLesson[]}`.
- **`CourseLesson`**: `{id, title, content?: string (markdown-текст, уже
  прочитан, как есть), quiz?: CourseQuiz, practice?: CoursePractice}`.
  Ровно одно из `content`/`quiz`/`practice` гарантированно присутствует
  (валидация это требует).
- **`CourseQuiz`**: `{question, options: CourseQuizOption[]}`,
  `CourseQuizOption`: `{id, text, correct: boolean (ВСЕГДА присутствует,
  даже если в манифесте `correct` был не указан — нормализовано в
  `false`), explanation?}`. Ровно один `option.correct === true`
  гарантирован.
- **`CoursePractice`**: `{sandbox: string (id из course.sandboxes,
  гарантированно существует), prompt: string, check?: string}` — 009
  исполняет `check` **от sandbox-роли**, ядро (эта задача) его не
  выполняет и никогда не отдаёт наружу через HTTP.
- **Стабильность id**: `course.id`, `module.id`, `lesson.id`,
  `sandbox.id`, `quizOption.id` уникальны на положенном уровне (курс:
  глобально в реестре; модуль/урок: в пределах курса, урок — **глобально
  по курсу**, не по модулю; sandbox/option — в пределах курса/квиза
  соответственно) — задача 007 может смело использовать `(courseId,
  lessonId)` как ключ прогресса.
- **Прогресс (007)**: не создавайте свой реестр курсов — берите `fastify.courses.get(courseId)`, проверяйте `lesson.id` через модули так же, как `routes/courses.ts`'s `findLesson` (простой линейный поиск по `course.modules[].lessons[]` — не оптимизировано под O(1), для типичного размера курса не проблема; если 007/009 нужен частый lookup по lessonId, стоит завести Map на своей стороне, не менять контракт `Course`).
- **`buildServer(options?)`** — расширен: `registry?: CourseRegistry` /
  `coursesDir?: string` (симметрично `pool?`/`databaseUrl?`, но
  **опционально** — дефолт `DEFAULT_COURSES_DIR` из `config.ts`, отсутствие
  директории не ошибка). В тестах используйте `buildServer({ pool:
  fakePool, registry: createCourseRegistry(tempDir) })` — см. паттерн в
  `routes/courses.test.ts`.

## Проверки — реальный вывод

### `npm test -w @trellis/backend` (без поднятой БД, чистое дерево)

```
1..47
# tests 47
# suites 0
# pass 42
# fail 0
# cancelled 0
# skipped 5
# todo 0
```
5 skip — тесты задачи 005, требующие живой Postgres (`DATABASE_URL`/
`TRELLIS_TEST_DATABASE_URL` не заданы), с явными причинами в TAP-выводе, не
тихий пропуск. Новых 27 тестов (10 validate + 5 loader + 5 registry + 7
routes/courses) — все выполнены и зелёные, входят в эти 42 pass.

### `npm run build -w @trellis/backend`

Код `0`, без предупреждений. `dist/courses/manifest.schema.json` физически
скопирован рядом с `dist/courses/validate.js` (проверено `find dist -name
"*.json"`) — `resolveJsonModule` + `import ... with { type: "json" }`
заставляет `tsc` копировать референсируемый JSON в outDir, проверено
дополнительно отдельным scratch-экспериментом до применения в реальном коде.

### `bash .mvp/ci-mirror.sh` (с полностью чистого дерева: `rm -rf node_modules services/backend/dist services/backend/dist-test services/frontend/dist services/frontend/node_modules`)

`npm ci` → lint (backend + frontend, оба чисто) → build (оба) → test
(backend 47/47 запущено, 42 pass + 5 skip; frontend 4/4 vitest) — код `0`.

### `npm run lint -w @trellis/backend`

`eslint .` — без вывода, код `0` (чисто).

### Ручной прогон API (`app.inject()`, `buildServer({ pool: fakePool,
registry: createCourseRegistry(tempDir) })`, фикстура: один валидный курс +
один битый с `practice.sandbox`, указывающим на необъявленную песочницу)

См. точный JSON-вывод во всех четырёх формах ответа в разделе «HTTP API»
выше — снят реальным одноразовым скриптом, не придуман. Подтверждено:
`GET /courses` показывает только валидный курс; `GET /courses/broken-course`
→ `404`; `POST /courses/rescan` показывает причину отклонения и в JSON, и
(отдельно проверено по логам) через `fastify.log.warn`; `GET
/courses/good-course/lessons/first-lesson` не содержит `correct`,
`explanation` ни у одного варианта, и не содержит `check`/SQL-текст check-а
вообще — тест `routes/courses.test.ts` дополнительно грепает сырой текст
ответа на отсутствие подстрок `"correct"`/`"explanation"`/`"check"`/`"select
count"`, а не только сравнивает JSON-форму.

## Deferred decisions

- **`GET /courses` возвращает голый JSON-массив, не `{ courses: [...] }`** —
  бриф не специфицирует обёртку; выбран самый простой вариант. Если
  какой-то будущей задаче понадобится пагинация/метаданные коллекции —
  придётся сделать breaking change (добавить обёртку), но на MVP-масштабе
  курсов (единицы, не тысячи) это не проблема сейчас.
- **`version` в схеме проверяется regex-ом semver-подобного вида** — бриф
  явно требует regex только для `id` курса; для `version` сказано просто
  "semver, строка". Добавил простой паттерн (`\d+\.\d+\.\d+(-pre)?(+build)?`)
  как разумную интерпретацию "semver" — не полноценный SemVer BNF, но ловит
  явные опечатки типа `version: 1.0` или `version: latest`.
- **id модуля/урока/песочницы/варианта квиза — только `minLength: 1`, без
  regex** — брифом задан явный regex только для id курса; пример манифеста
  использует однобуквенные id вариантов квиза (`a`/`b`), которые не прошли
  бы courseId-паттерн (минимум 2 символа). Не стал изобретать отдельный
  паттерн для остальных уровней id, раз брифом не потребован.
- **`ajv-formats` установлен, затем удалён** — брифом упомянут как "при
  необходимости"; поскольку схема не использует ключевое слово `format`
  нигде (id/version проверяются через `pattern`, не `format`), зависимость
  осталась бы неиспользуемой мёртвым весом — убрал.
- **`import { Ajv2020 } from "ajv/dist/2020.js"` (именованный импорт), а не
  `import Ajv2020 from "ajv/dist/2020.js"` (дефолтный)** — эмпирически
  обнаружено: у `ajv` в `package.json` нет `"type": "module"`, поэтому под
  `moduleResolution: NodeNext` этот under-`/dist` файл типизируется как
  CommonJS-модуль, и `import Ajv2020 from "..."` резолвится в тип
  *namespace* модуля целиком (`typeof import(...)`, без construct
  signature — `TS2351`), а не в его `.default`. Именованный импорт
  (`{ Ajv2020 }`, класс экспортирован и как named export в `.d.ts`)
  обходит эту проблему. Runtime-семантика идентична в обоих случаях
  (проверено отдельным скриптом — `require(...)` и `require(...).default`
  оба указывают на тот же класс из-за `module.exports = exports =
  Ajv2020;` трюка в скомпилированном ajv).
- **`courses/testSupport.ts` — отдельный не-`.test.ts` файл с общими
  тестовыми хелперами**, явно добавлен в `exclude` `tsconfig.json` (прод),
  включён в `tsconfig.test.json` (`exclude: []`). Обоснование: 4 тестовых
  файла (`validate.test.ts`, `loader.test.ts`, `registry.test.ts`,
  `routes/courses.test.ts`) реально дублировали бы логику "создать temp
  директорию, записать туда manifest.yaml + файлы" — это SRP>DRY случай
  дублирования логики, не структуры, поэтому вынес в один файл вместо
  копипасты по всем четырём.
- **`resolveSafePath` требует существования файла как часть той же
  проверки, что и path-safety** (не отдельным шагом) — брифом оба
  требования перечислены в одном пункте ("не выходят за пределы... и
  указывают на существующие файлы"), реализовал как единую функцию с
  одним набором сообщений об ошибке на путь, а не два прохода.
- **Порядок валидации: если структурная (ajv) проверка не прошла — семантические
  проверки не запускаются вообще** (ранний `return`), а не собираются
  вместе в один список ошибок. Обоснование: семантические проверки
  предполагают, что форма манифеста уже корректна (например,
  `raw.modules[i].lessons` — это массив, а не `undefined`) — без этого
  предположения код упал бы с TypeError вместо осмысленной ошибки
  валидации. Требование брифа "все ошибки собираются списком, а не первая и
  до свидания" выполнено **внутри** каждой из двух фаз (ajv:
  `allErrors: true`; семантика: ни один `return` при первой находке,
  собираем всё через общий массив `errors`) — просто фазы не смешиваются
  между собой.

## Fix round 1

Ревью подтвердило секретность ответов (прямая атака на `toLessonResponse` —
подмена, чтобы эмитил `correct`/`explanation`/`check`, — не пробила схему
ответа с `additionalProperties: false`) и защиту путей (симлинки на файл и
директорию, `..\..\`, сбегающий `seed[]`, дубль id урока между модулями).
Найдено 1 Critical, 2 Important, 3 мелочи — все закрыты.

### Critical 1 — нечитаемый файл урока ронял старт приложения

`loader.ts`: чтение `lesson.contentPath` теперь в `try/catch`; ошибка чтения
(включая TOCTOU-окно между тем, что `validate.ts` подтвердил существование
файла, и фактическим чтением — права могли измениться) собирается в
`ValidationError` с путём `modules[i].lessons[j].content` и приводит к
`{ ok: false, errors }` для пакета целиком (все такие ошибки по уроку
собираются, не первая-и-до-свидания), а не к необработанному throw.
Doc-comment функции теперь соответствует реальности ("Never throws").
Тест: `loader.test.ts` — `chmod 000` на файл урока после валидации →
`loadCoursePackage` возвращает `{ok:false}` с ожидаемым путём/сообщением, не
бросает; тест сам детектирует, если процесс исполняется от root (permissions
не работают), и делает `t.skip(...)` с причиной вместо ложного зелёного.

### Important 2 — id модуля/урока не был ограничен по символам

`manifest.schema.json`: добавлен `pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"`
только для `$defs/module.id` и `$defs/lesson.id` (не для `quizOption.id`/
`sandbox.id` — они не появляются в URL, пример из брифа с `a`/`b` продолжает
проходить, покрыто отдельным regression-тестом). Заодно закрывает пробелы-
как-id и `.`/`..` как id (первый символ класса не включает пробел/точку).
Тесты (`validate.test.ts`, +5): id со слэшем отклоняется, id из пробелов
отклоняется, id `.` и `..` отклоняются, регресс-тест на однобуквенные id
вариантов квиза (`a`/`b`) по-прежнему проходит.

### Important 3 — «курсов нет» распознавалось только по ENOENT

`registry.ts`: вызов `scanCoursesDir(coursesDir)` внутри `rescan()` обёрнут
в `try/catch`. На любой другой ошибке чтения директории (`EACCES`,
`ENOTDIR` — `COURSES_DIR` оказалась файлом, и т.п.) — читаемое
`logger.warn(...)` вместо необработанного throw с голым стеком; предыдущее
состояние реестра (`courses`/`rejected`) остаётся как есть (на самом первом
скане при старте — это пустой список, т.е. приложение стартует с 0 курсов и
предупреждением в логе, не падает). `loader.ts`'s `scanCoursesDir` не
трогал — по-прежнему специально ловит только `ENOENT` как «курсов нет»,
остальное пробрасывает; перехват шире `createCourseRegistry`, что и было
одним из предложенных ревью вариантов.
Тест: `registry.test.ts` — `COURSES_DIR`, указывающая на обычный файл →
`createCourseRegistry(...)` не бросает, `list()` пустой, ровно одно
`logger.warn` с именем пути, сообщение не похоже на голый stack trace
(явная проверка регэкспом на отсутствие паттерна `at ... (`).

### Мелочи

4. **Двойное логирование отклонённых пакетов** — `routes/courses.ts`'s
   `POST /courses/rescan` больше не логирует сам (было: цикл `fastify.log.warn`
   по `rejectedCourses` после каждого rescan) — `registry.ts`'s `rescan()`
   уже логирует ровно один раз на каждый отклонённый пакет при каждом скане
   (включая инициированный через `POST /courses/rescan`). Хендлер теперь
   только формирует HTTP-ответ.
5. **Ранний `return` после структурных ошибок ajv теперь явно проговорён в
   самом payload'е**, не только в комментарии: к списку структурных ошибок
   добавляется финальная запись `{ path: "", message: "Structural errors
   must be fixed first — semantic checks (...) were not run against this
   manifest." }` — автор курса, чинящий опечатку, не будет считать список
   ошибок исчерпывающим.
6. **`title`/`question`/`prompt` из одних пробелов больше не проходят** —
   добавлен `"pattern": "\\S"` (хотя бы один непробельный символ) рядом с
   `minLength: 1` для: `title` курса, `module.title`, `lesson.title`,
   `quiz.question`, `practice.prompt`. `description`/`quizOption.text` не
   трогал — не были названы находкой явно. Тест: `validate.test.ts` — курс
   с `title: "   "` отклоняется.

### Решение координатора по Deferred decision (форма `GET /courses`)

Применено буквально: `GET /courses` теперь возвращает `{ "courses": [...] }`,
не голый массив (`routes/courses.ts`, схема `coursesListResponseSchema`
обновлена в объект с `required: ["courses"]`, `additionalProperties: false`).
Все use-сайты в `routes/courses.test.ts` обновлены на новую форму. Два других
Deferred decision (semver-подобный regex, именованный импорт `{ Ajv2020 }`)
оставлены как есть по прямому указанию координатора.

### Обновлённая эталонная схема манифеста (для задачи 017)

Изменения относительно версии в исходном отчёте — только эти два места (весь
остальной текст схемы выше по файлу актуален):

```json
"module": {
  ...
  "properties": {
    "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
    "title": { "type": "string", "minLength": 1, "pattern": "\\S" },
    ...
  }
},
"lesson": {
  ...
  "properties": {
    "id": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
    "title": { "type": "string", "minLength": 1, "pattern": "\\S" },
    "content": { "type": "string", "minLength": 1 },
    ...
  }
}
```
Плюс `"pattern": "\\S"` рядом с `minLength: 1` у корневого `title`,
`quiz.question`, `practice.prompt` (курс-level `title` тоже). `quizOption.id`/
`sandbox.id` — без изменений (`minLength: 1` only) — однобуквенные id из
примера в брифе (`a`/`b`) по-прежнему валидны. Module/lesson id теперь не
могут содержать `/`, пробелы, быть `.`/`..` — задача 017 должна использовать
только `[A-Za-z0-9._-]`, начиная с буквы/цифры, до 64 символов.

### Обновлённые формы ответов эндпоинтов

Единственное изменение: **`GET /courses`** теперь `200 { "courses": [...] }`
вместо голого массива. `GET /courses/:courseId`, `GET
/courses/:courseId/lessons/:lessonId`, `POST /courses/rescan` — без
изменений формы (см. примеры в исходном отчёте выше, они по-прежнему
актуальны — перепроверено тем же ручным `app.inject()`-скриптом после всех
фиксов).

### Проверки — реальный вывод

**`npm test -w @trellis/backend`** (без поднятой БД, после всех фиксов):
```
1..54
# tests 54
# suites 0
# pass 49
# fail 0
# cancelled 0
# skipped 5
# todo 0
```
Было 47 (42 pass/5 skip) → стало 54 (49 pass/5 skip): +7 новых тестов
(3 в `loader.test.ts`→было 5 стало 6: +1 unreadable-content; 5 новых в
`validate.test.ts`: id-со-слэшем, id-из-пробелов, id `.`/`..`, regression на
`a`/`b`, title-из-пробелов; 1 новый в `registry.test.ts`: `COURSES_DIR` —
файл). Все явно нацелены на находки этого раунда — не «тесты ради числа».
5 skip — те же, что и раньше, DB-зависимые тесты задачи 005 (`DATABASE_URL`/
`TRELLIS_TEST_DATABASE_URL` не заданы), не связаны с этой задачей.

**`npm run build -w @trellis/backend`**: код `0`.

**`bash .mvp/ci-mirror.sh`** (с чистого дерева: `rm -rf node_modules
services/backend/dist services/backend/dist-test services/frontend/dist
services/frontend/node_modules`): код `0` — `npm ci` → lint (backend+frontend,
чисто) → build (оба) → test (backend 54/54 исполнено, 49 pass + 5 skip;
frontend 4/4 vitest).

**`npm run lint -w @trellis/backend`**: без вывода, код `0`.

**Ручная проверка нового payload'а** (`validateManifest` напрямую, манифест
с опечаткой И дублирующимся полем): подтверждён финальный элемент
`{path: "", message: "Structural errors must be fixed first..."}` в списке
ошибок — см. пример вывода выше в этом разделе (продублирован при живой
проверке после фикса, точный JSON приведён).

### Git status после фикс-раунда (в границе)

```
 M services/backend/src/courses/loader.test.ts
 M services/backend/src/courses/loader.ts
 M services/backend/src/courses/manifest.schema.json
 M services/backend/src/courses/registry.test.ts
 M services/backend/src/courses/registry.ts
 M services/backend/src/courses/validate.test.ts
 M services/backend/src/courses/validate.ts
 M services/backend/src/routes/courses.test.ts
 M services/backend/src/routes/courses.ts
```
Ничего вне `services/backend/**` не тронуто.

### Deferred decisions (fix round 1)

- **При ошибке скана (`Important 3`) реестр сохраняет ПРЕДЫДУЩЕЕ состояние**,
  а не сбрасывает в пусто — на первичном скане при старте предыдущего
  состояния нет (пусто и так), но на explicit `rescan()` transient-ошибка
  чтения директории не должна стирать ранее валидные курсы. Если ревьюер
  сочтёт, что "сбрасывать в пусто" честнее ("данные соответствуют реальному
  состоянию диска") — открыт к пересмотру, но посчитал потерю ранее рабочих
  курсов из-за преходящей ошибки чтения худшим UX для локального
  инсталлятор-стиля приложения.
- **`description`/`quizOption.text` не получили `pattern: "\\S"`** — находка
  явно называла `title`/`question`/`prompt`; не расширял произвольно.

## Fix round 2

Единственная находка: сохранение предыдущего состояния реестра при провале
скана (сознательное решение из round 1, подтверждённое координатором) делало
сам факт провала невидимым для HTTP-клиента — `POST /courses/rescan` на
`chmod 000`-нутой `COURSES_DIR` отдавал `200 {"accepted":1,"rejected":0,
"rejectedCourses":[]}`, неотличимое от честного успешного пересканирования,
нашедшего тот же курс. Единственный след был в серверном логе, который
пользователь локального однопользовательского приложения никогда не увидит.

### Что изменено

- **`RescanResult`** (`courses/registry.ts`) — два новых поля:
  `readonly scanFailed: boolean` (всегда присутствует, `true`/`false`, не
  опционально — чтобы отсутствие поля нельзя было спутать с `false`) и
  `readonly scanError?: string` (только при `scanFailed: true`). Doc-comment
  явно проговаривает: при `scanFailed: true` значения `accepted`/`rejected`
  описывают ПРЕДЫДУЩЕЕ состояние, не результат этого скана — тем самым и в
  README-стиле комментария, и в самой структуре типа зафиксировано различие
  «ничего нового не нашли» vs «скан не смог даже прочитать директорию».
- **`rescan()`** (`courses/registry.ts`) — ветка `catch` теперь строит
  человекочитаемое сообщение через новую `describeScanFailure(coursesDir,
  err)` и возвращает `{ accepted: courses.size, rejected: rejected.length,
  scanFailed: true, scanError }` вместо прежнего `{ accepted, rejected }`
  без разметки. Успешная ветка возвращает `scanFailed: false` явно.
- **`describeScanFailure`** (новая приватная функция, `courses/registry.ts`) —
  installer-стиль, без errno/стека:
  - `EACCES`/`EPERM` → `The courses folder ("<dir>") could not be read — check that this app has permission to read it.`
  - `ENOTDIR` → `"<dir>" is not a folder — check that the courses location points at a directory, not a file.`
  - иначе (fallback) → `The courses folder ("<dir>") could not be scanned: <err.message>.`
  Проверено тестом на отсутствие паттернов `EACCES|ENOTDIR|errno|at\s+\S+\s*\(`
  в реальном сообщении.
- **`routes/courses.ts`** — `POST /courses/rescan` теперь прокидывает
  `scanFailed`/`scanError` из `RescanResult` в тело ответа; схема
  `rescanResponseSchema` дополнена `scanFailed: { type: "boolean" }`
  (добавлено в `required`, чтобы поле не могло молча пропасть — схема с
  `additionalProperties: false` иначе просто вырезала бы недекларированное
  поле, что и было бы тихим провалом фикса) и `scanError: { type: "string"
  }` (опционально).
- Логирование (`logger.warn`) при провале скана не изменилось по сути
  (текст чуть подрихтован под общую фразу `describeScanFailure`), это по-
  прежнему server-side канал; фикс именно в том, что теперь то же самое
  сообщение долетает и до HTTP-клиента через `scanError`.

### Обновлённая форма ответа `POST /courses/rescan`

```json
// успешный скан (включая "ничего не изменилось")
{"accepted": 1, "rejected": 0, "rejectedCourses": [], "scanFailed": false}

// провалившийся скан — COURSES_DIR не читается
{
  "accepted": 1, "rejected": 0, "rejectedCourses": [],
  "scanFailed": true,
  "scanError": "The courses folder (\"/courses\") could not be read — check that this app has permission to read it."
}
```
`accepted`/`rejected` во втором случае — это снимок ДО попытки скана
(«ничего не поменялось»), не результат нового скана; клиент обязан сначала
проверить `scanFailed`.

### Тесты (новые, +2 к прошлому раунду)

- `courses/registry.test.ts` — `rescan() on a coursesDir that turns
  unreadable reports scanFailed with a reason...`: один курс успешно
  загружен → `chmod 000` на саму `coursesDir` → `rescan()` возвращает
  `scanFailed: true`, `scanError` — непустая строка без errno/стек-паттернов,
  `accepted`/`rejected` равны предыдущему состоянию (1/0), и
  `registry.list()`/`registry.get(...)` по-прежнему показывают ранее
  загруженный курс. Тест сам детектирует запуск от root (permissions не
  работают) и делает `t.skip(...)` вместо ложного зелёного — тем же
  паттерном, что и unreadable-lesson-content тест из round 1.
- `routes/courses.test.ts` — HTTP-версия того же сценария
  (`POST /courses/rescan on an unreadable COURSES_DIR reports scanFailed...`):
  воспроизводит ровно то, что нашёл ревьюер — курс загружен, `chmod 000` на
  `coursesDir`, `POST /courses/rescan` → `200` с `scanFailed: true` и
  читаемым `scanError`, `accepted`/`rejected` равны предыдущему состоянию, и
  `GET /courses` после этого по-прежнему показывает ранее загруженный курс.
  Также добавлена проверка `scanFailed === false`/`scanError === undefined`
  в уже существующий тест на честный успешный rescan (регрессия на «в
  обычном случае поле есть и оно `false`»).

### Проверки — реальный вывод

**`npm test -w @trellis/backend`** (без поднятой БД):
```
1..56
# tests 56
# suites 0
# pass 51
# fail 0
# cancelled 0
# skipped 5
# todo 0
```
Было 54 (49 pass/5 skip) → стало 56 (51 pass/5 skip): +2 теста, оба нацелены
на эту находку, оба реально исполнены (не skip — процесс в этой песочнице не
root, permissions реально проверены).

**`npm run build -w @trellis/backend`**: код `0`.

**`bash .mvp/ci-mirror.sh`** (с чистого дерева: `rm -rf node_modules
services/backend/dist services/backend/dist-test services/frontend/dist
services/frontend/node_modules`): код `0` — `npm ci` → lint (чисто) → build
→ test (backend 56/56 исполнено, 51 pass + 5 skip; frontend 4/4 vitest).

**`npm run lint -w @trellis/backend`**: без вывода, код `0`.

**Ручное воспроизведение ровно сценария ревьюера** (`app.inject()`,
одноразовый скрипт): честный успешный rescan →
`200 {"accepted":1,"rejected":0,"rejectedCourses":[],"scanFailed":false}`;
затем `chmod 000` на `coursesDir`, тот же `POST /courses/rescan` →
`200 {"accepted":1,"rejected":0,"rejectedCourses":[],"scanFailed":true,
"scanError":"The courses folder (\"...\") could not be read — check that
this app has permission to read it."}` — счётчики те же (как и задумано —
это предыдущее состояние), но теперь есть однозначный машиночитаемый
признак и человекочитаемая причина; `GET /courses` сразу после этого
по-прежнему отдаёт ранее загруженный курс.

### Git status после фикс-раунда 2 (в границе)

```
 M services/backend/src/courses/registry.test.ts
 M services/backend/src/courses/registry.ts
 M services/backend/src/routes/courses.test.ts
 M services/backend/src/routes/courses.ts
```
Ничего вне `services/backend/**` не тронуто.

### Deferred decisions (fix round 2)

- **Имена полей `scanFailed`/`scanError`** — координатор явно оставил имена
  на моё усмотрение при условии «признак обязан быть машиночитаемым»;
  выбрал буквальные, без сокращений, по аналогии с уже существующими
  `accepted`/`rejected`/`rejectedCourses` в том же объекте.
- **`scanFailed` — обязательное поле (`required`) со значением `boolean`,
  а не опциональный флаг, который есть только при провале** — сознательно:
  опциональность «поле есть только когда true» создала бы ту же двусмысленность
  (отсутствие поля можно спутать со старым форматом ответа/багом сериализации),
  которую фиксит весь раунд. `scanError`, наоборот, опционален — ему
  действительно нечего сказать при успехе.

## Project invariants
# Project invariants — Trellis

## Architectural invariants

- Ядро специальность-агностично: код backend/frontend не содержит знаний о конкретном курсе. Курс — данные (контент-пакет в `courses/`: manifest.yaml + Markdown-уроки), проходящие валидацию по схеме до показа пользователю. Хардкод названий модулей/уроков курса в коде запрещён.
- Развязка контента и прогресса: формат курса и формат прогресса — разные сущности с чёткой границей. Прогресс привязан к стабильным id модулей/уроков, никогда к индексам или названиям.
- Песочница практики — интерфейс с реализациями; Postgres — лишь одна из них. Именование и структура кода не должны требовать переписывания первой реализации при появлении второй.
- Postgres-песочница: отдельная схема + роль с правами только на эту схему. Seed- и check-запросы курса, как и запросы пользователя, выполняются от sandbox-роли — никогда от роли приложения или суперпользователя.
- Контракт check-запроса зачёта: возвращает одну строку с одним boolean-значением. Никакой другой логики зачёта («грейдера») в ядре.
- Всё локально: backend слушает только 127.0.0.1, наружу порты не публикуются; никаких внешних сервисов и отправки данных наружу.
- Данные прогресса — только в Postgres с именованным volume; пересоздание контейнеров не должно терять данные.
- Frontend работает с данными только через HTTP API backend; прямых подключений frontend к Postgres нет.

## Service boundaries

- backend: services/backend
- frontend: services/frontend
- postgres (инфраструктура, без кода): docker-compose.yml + docker/postgres/

## Forbidden edges

FORBIDDEN_EDGE: frontend --> postgres
FORBIDDEN_EDGE: frontend --> sandbox
BOUNDARY_EXEMPT: package.json
BOUNDARY_EXEMPT: package-lock.json

