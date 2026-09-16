# Task 008 — песочница практики (интерфейс + Postgres-реализация) — отчёт

## Что создано

- `services/backend/src/sandbox/types.ts` — интерфейс песочницы, без единого
  упоминания SQL/пула/схемы: `SandboxType`, `SandboxSeedFile`, `SandboxSpec`,
  `SandboxState`, `SandboxDriver`, `SandboxProvisioner<TDriver>`,
  `SandboxError`/`SandboxErrorKind`/`isSandboxError`.
- `services/backend/src/sandbox/postgres-sandbox.ts` — реализация:
  `createPostgresSandboxDriver(sandboxDatabaseUrl, options?)`,
  `createPostgresSandboxDriverFromPool(pool, options?)` (тестовый шов),
  `createUnconfiguredPostgresSandboxDriver(reason?)`, `DEFAULT_SANDBOX_SCHEMA`.
- `services/backend/src/sandbox/provisioner.ts` —
  `createSandboxProvisioner({ courses, driver, now? })`: резолв курса →
  песочницы → seed-файлов (с повторной проверкой путей), единый слот
  состояния, сериализация операций. Здесь же `declare module "fastify"` →
  `fastify.sandbox`.
- `services/backend/src/routes/sandbox.ts` — `GET /courses/:courseId/sandbox`,
  `POST /courses/:courseId/sandbox/reset`.
- `services/backend/src/sandbox/testSupport.ts` — `createRecordingPool(...)`
  (пишущий фейк `AppPool` с настоящими BEGIN/COMMIT/ROLLBACK),
  `createSandboxFixture(...)`, `fixtureFilePath(...)`, фикстурные константы.
  Добавлен в `exclude` `tsconfig.json` (как остальные `testSupport.ts`).
- Тесты: `sandbox/postgres-sandbox.test.ts` (10), `sandbox/provisioner.test.ts`
  (11), `routes/sandbox.test.ts` (11) — 32 новых, все исполняются, ни одного
  skip.
- Правки существующих файлов в границе: `src/server.ts` (опции
  `sandbox?`/`sandboxDatabaseUrl?`, декоратор `app.sandbox`, `onClose`,
  регистрация `sandboxRoutes`, прокидывание `config.sandboxDatabaseUrl` в
  main-module блоке), `tsconfig.json` (одна строка в `exclude`).
  **Зависимостей не добавлял** — `package.json`/`package-lock.json` не тронуты.

## Интерфейсный дайджест для задачи 009 (и далее)

- **Точка входа — `fastify.sandbox`** (тип
  `SandboxProvisioner<PostgresSandboxDriver>`). Свой пул/драйвер не создавать.
- **Перед запуском пользовательского SQL**:
  `const state = await fastify.sandbox.ensure(courseId, practice.sandbox);`
  — идемпотентно: если песочница этого курса уже живая, ничего не
  пересоздаётся (иначе сброс на каждый запрос стирал бы таблицы пользователя
  посреди урока). Переключение на другой курс — полная пересборка.
- **Выполнение SQL** (это примитив, на котором 009 строит `execute.ts`/`check.ts`):
  - `fastify.sandbox.driver.query<T>(text, params?)` → `QueryResult<T>` из `pg`,
    **ошибки проходят насквозь как есть** (никакой обёртки: `err.code`,
    `err.position`, `LINE n:` сохраняются — их и надо показать пользователю);
  - `fastify.sandbox.driver.withClient(fn)` → один клиент на несколько
    выражений (например «прогнать пользовательский SQL, затем check, затем
    откатить»), `release()` гарантирован в `finally`.
  - Оба идут по пулу под ролью `trellis_sandbox` с `search_path = sandbox`
    (проверено вживую: `current_user=trellis_sandbox`,
    `current_schema=sandbox`).
- **Сигнатуры**:
  - `ensure(courseId: string, sandboxId?: string): Promise<SandboxState>`
  - `reset(courseId: string, sandboxId?: string): Promise<SandboxState>` —
    всегда полная пересборка;
  - `status(courseId?: string): SandboxState | undefined` — синхронный;
    с `courseId` отвечает «жива ли песочница ИМЕННО этого курса» (чужая живая
    песочница даёт `undefined`);
  - `close(): Promise<void>` — зовётся из `onClose` сервера, руками не нужно.
  - `SandboxState = { courseId, sandboxId, type: "postgres", seedFiles:
    string[] (пакет-относительные пути, в порядке применения), readyAt: ISO }`.
- **`sandboxId` не угадывать**: если курс объявил ровно одну песочницу, аргумент
  можно опустить; если несколько — опущенный id даёт `SandboxError` kind
  `ambiguous_sandbox`. В 009 он всегда известен: `lesson.practice.sandbox`.
- **Ошибки**: всё, что бросает слой песочницы, — `SandboxError` с полями
  `kind`, `message`, опциональными `seedFile`, `databaseError`.
  `isSandboxError(err)` — сужение типа. Карта kind → HTTP (уже реализована в
  `routes/sandbox.ts`, 009 может переиспользовать ту же): `course_not_found`
  404, `sandbox_not_found` 404, `ambiguous_sandbox` 400, `seed_unreadable` 422,
  `seed_failed` 422, `unavailable` 503.
- **Второй драйвер** (не-Postgres) реализует `SandboxDriver` (`type`,
  `provision(spec)`, `close()`) — провижионер, роуты и всё, что написано
  против `SandboxProvisioner`, не меняются; меняется только
  `declare module "fastify"` (станет union) и то, что лезет в `.driver`.

## HTTP API — реальный вывод (живой Postgres, роль `trellis_sandbox`)

**`GET /courses/:courseId/sandbox`** → `200`:
```json
{"active":false}
```
```json
{"active":true,"courseId":"live-course","sandboxId":"main","type":"postgres",
 "seedFiles":["sandbox/01-schema.sql","sandbox/02-data.sql"],
 "readyAt":"2026-09-16T16:26:09.074Z"}
```
Неизвестный курс → `404 {"error":"course_not_found","message":"Course \"nope\" was not found."}`.

**`POST /courses/:courseId/sandbox/reset`** (тело необязательно; при
нескольких объявленных песочницах — `{"sandboxId":"..."}`) → `200` с той же
формой, что и `GET` выше (`active: true`).

Ошибки (реальные ответы):
```json
422 {"error":"seed_failed",
     "message":"Seed file \"sandbox/02-data.sql\" of course \"live-course\" failed: column \"nope\" of relation \"widgets\" does not exist",
     "seedFile":"sandbox/02-data.sql",
     "databaseError":"column \"nope\" of relation \"widgets\" does not exist"}
503 {"error":"unavailable",
     "message":"Could not reach postgres://trellis_sandbox:***@127.0.0.1:1/trellis: connect ECONNREFUSED 127.0.0.1:1. Check that SANDBOX_DATABASE_URL is correct and Postgres is running and reachable."}
```
Пароль в сообщении отредактирован (`redactPassword`), и названа именно
`SANDBOX_DATABASE_URL`, а не `DATABASE_URL` (у `db/pool.ts` своя обёртка с
подсказкой про `DATABASE_URL` — она бы вводила в заблуждение, поэтому
разворачивается `err.cause` и текст пишется свой; есть тест на отсутствие
«голого» `DATABASE_URL` в сообщении).

Ответы **никогда не содержат текст seed-SQL** — только пакет-относительные
пути (`sandbox/01-schema.sql`), не абсолютные пути хоста (тест грепает сырое
тело ответа на `create table`).

## Что именно делает пересборка (SQL, дословно)

Один транзакционный блок на весь ребилд:
```
BEGIN
set local search_path to "sandbox"
drop schema if exists "sandbox" cascade
create schema "sandbox"
<текст seed-файла 1 целиком>
<текст seed-файла 2 целиком>
COMMIT
```
- **Атомарно**: DDL в Postgres транзакционен, поэтому упавший на третьем
  операторе seed откатывает всё — «наполовину собранной» песочницы не бывает
  (проверено вживую: после провала прежнее содержимое осталось, 2 строки).
- **Seed исполняется файлом целиком**, не режется по `;` — разрезание
  регэкспом ломается на dollar-quoted телах функций и `;` внутри строк.
- **`set local`** — только на эту транзакцию, не протекает в следующего
  пользователя пулового соединения; гарантирует, что неквалифицированные
  имена в seed'ах падают в схему песочницы независимо от настроек роли.
- **Имя схемы** (`sandbox`) — единственный идентификатор, который нельзя
  передать параметром: валидируется по `^[a-z_][a-z0-9_]*$` и квотируется
  (есть тест, что `sandbox"; drop schema core cascade; --` отвергается ещё на
  конструировании драйвера).

## Проверено вживую (одноразовый Postgres 17 + `docker/postgres/init/apply-all.sh`, роль `trellis_sandbox`)

```
1. ensure() -> {"courseId":"live-course","sandboxId":"main","type":"postgres","seedFiles":["sandbox/01-schema.sql","sandbox/02-data.sql"],"readyAt":"..."}
   rows seeded: [{"id":1,"label":"a"},{"id":2,"label":"b"}]
   objects in schema sandbox: [{"table_name":"labels","table_type":"VIEW"},{"table_name":"widgets","table_type":"BASE TABLE"}]
   schema owner: [{"owner":"trellis_sandbox"}]
   current_user / search_path: [{"current_user":"trellis_sandbox","current_schema":"sandbox"}]
2. ensure() again -> (тот же readyAt) user table survived: {"alive":true}
3. reset() -> (новый readyAt) after: {"widgets":2,"scratch_gone":true}
4. "select count(*) from core.lesson_progress" -> permission denied for schema core
4. "create table core.evil (x int)"            -> permission denied for schema core
4. "drop schema core cascade"                  -> must be owner of schema core
5. broken seed -> kind=seed_failed seedFile=sandbox/02-data.sql
   databaseError: "column \"nope\" of relation \"widgets\" does not exist"
   status() after the failed reset: undefined
   sandbox contents after rollback (previous state intact): [{"widgets":2}]
```
То есть фактически подтверждено: seed'ы применяются от sandbox-роли, схема
принадлежит ей, изоляция от `core` работает в обе стороны (чтение, запись,
DROP), `ensure` не трогает живую песочницу, `reset` возвращает стартовое
состояние курса и сносит то, что пользователь насоздавал, а упавший seed
откатывается и не оставляет ложного «готово».

## Проверки — реальный вывод

- **`bash .mvp/ci-mirror.sh`** — код `0`:
  `npm ci` → lint (backend+frontend) → build → test
  ```
  # tests 136
  # pass 136
  # fail 0
  # skipped 0
  ```
  (Было 104 теста до этой задачи, стало 136: +32. Skip'ов ноль — одноразовый
  Postgres от ci-mirror поднимается, и все БД-тесты задач 005/007 реально
  исполняются.)
- **`npm test -w @trellis/backend` без БД**: 136 тестов, 126 pass, 0 fail,
  10 skip — те же 10 БД-зависимых тестов 005/007, что и до этой задачи; все
  32 новых теста песочницы исполняются без Postgres.
- **`npm run build -w @trellis/backend`**: код `0`.
- **`eslint .` в `services/backend`**: `No issues found`, код `0`.

## Deferred decisions

- **Одна живая песочница на весь процесс, не по песочнице на курс.** Физически
  песочница — одна схема в одном инстансе Postgres
  (`docs/product/technical-solutions.md`), поэтому «песочница курса B» и
  «песочница курса A» — это одна и та же схема с разным содержимым. Состояние
  сделано явным единственным слотом: `status(courseId)` честно отвечает
  `undefined` для курса, чьи данные только что снесли под другой курс, вместо
  того чтобы делать вид, что у каждого курса своя.
- **Состояние — только в памяти процесса.** После рестарта ничего не считается
  живым и первый `ensure()` пересоберёт песочницу из seed'ов. Для песочницы
  это правильный ответ по определению (её содержимое одноразовое); прогресс
  пользователя живёт в `core` под ролью приложения и здесь не затрагивается.
- **Транзакционный ребилд (откат при падении seed'а) вместо «оставить как
  упало».** Плюс: не бывает полусобранной песочницы. Минус: после провала в
  схеме остаётся содержимое ПРЕДЫДУЩЕГО прогона (не пустота) — поэтому
  `status()` после провала возвращает `undefined`, а не «готово»: состояние
  честно неизвестно, следующий `ensure()` пересоберёт. Краевой случай:
  seed-файл с собственным `COMMIT`/`ROLLBACK` внутри разрывает эту гарантию —
  это ошибка автора курса, драйвер её не маскирует.
- **Сериализация операций — обычная очередь промисов в процессе, без
  advisory-lock в БД.** Продукт — один локальный backend-процесс; два
  параллельных `drop schema ... cascade` по одной схеме упирались бы в блокировки
  и в 30-секундный `statement_timeout` роли. Если когда-нибудь появится второй
  процесс, сюда добавляется advisory lock — интерфейс не меняется.
- **Seed-пути перепроверяются (`resolveSafePath`) непосредственно перед
  исполнением**, хотя `courses/validate.ts` уже проверял их при скане — как и
  просил отчёт задачи 006: скан может быть сколь угодно старым (вотчера ФС
  нет), файл мог быть удалён или подменён симлинком наружу пакета. Пакет-
  относительный путь считается от `fs.realpathSync(course.dir)`, а не от
  `course.dir`: в реестре seed-пути лежат realpath'нутыми, и на macOS
  (`/var` → `/private/var`) наивный `path.relative` дал бы `../../..` и
  зарубил бы каждый seed (покрыто тестом, фикстуры живут именно в `os.tmpdir()`).
- **`buildServer` без `sandboxDatabaseUrl` не падает, а получает
  «unconfigured»-драйвер**, у которого любая операция даёт `SandboxError`
  kind `unavailable` («...is not configured: SANDBOX_DATABASE_URL was not
  provided to buildServer()»), и роуты отвечают 503 с этой причиной.
  Альтернативы хуже: требовать URL везде — это правка десятка чужих тестов,
  которым песочница не нужна; не декорировать `app.sandbox` вовсе — это
  падение Fastify на отсутствующем декораторе вместо внятного ответа.
  В проде main-module блок всегда передаёт `config.sandboxDatabaseUrl`.
- **`SandboxProvisioner` параметризован драйвером (`<TDriver>`), а
  `declare module "fastify"` фиксирует `PostgresSandboxDriver`.** Так задача
  009 получает `fastify.sandbox.driver.query(...)` полностью типизированным, не
  прибегая к каст ам, а всё, что написано против голого
  `SandboxProvisioner`, остаётся реализация-агностичным. При появлении второго
  драйвера меняется только эта аугментация (станет union / сужение по
  `driver.type`).
- **Тело `POST .../reset` описано как `type: ["object", "null"]`.** Проверено
  эмпирически, а не предположено: Fastify отдаёт валидатору `null` для POST
  без тела, и без `"null"` в списке типов запрос без тела падал бы в
  `400 body must be object` — а клиент курса с одной песочницей обязан иметь
  право не передавать ничего. Заодно выяснено (и зафиксировано тестом), что
  ajv у Fastify работает с `removeAdditional: true`, то есть незадекларированное
  поле вырезается, а не даёт 400 — тест проверяет главное: подсунутый `sql` не
  доезжает до БД.
- **Ошибка `drop schema`/`create schema` классифицируется как `unavailable`,
  а не как отдельный kind.** Это всегда либо недоступность, либо
  рассогласование прав/владения схемой (т.е. проблема развёртывания, не
  контента курса) — отдельный kind не дал бы вызывающему ничего нового, а
  список kind'ов лучше держать коротким; сообщение при этом явно называет
  схему и подсказывает проверить `SANDBOX_DATABASE_URL`/владение.
- **`ensure()` не вызывается ни одним роутом этой задачи.** Публично выставлен
  только `reset` («сбросить песочницу») и статус; `ensure` — внутренний путь
  для 009 (первый запуск практики курса). Так «подключение курса» не
  превращается в отдельный эндпоинт, который UI обязан не забыть дёрнуть.

## Concerns (DONE_WITH_CONCERNS)

1. **Слой песочницы не покрыт автотестами против живого Postgres — по границе
   задачи.** Ни `.github/workflows/ci.yml`, ни `.mvp/ci-mirror.sh` не
   экспортируют в тест-ран строку подключения sandbox-роли (есть только
   `DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL` под `trellis_app`), а оба файла
   лежат вне `services/backend` — править их мне нельзя. Добавить тест,
   который скипается без такой переменной, тоже нельзя: ci-mirror.sh
   специально падает, если при поднятом Postgres хоть один тест ушёл в skip.
   Поэтому автотесты гоняют настоящий драйвер поверх пишущего фейка пула
   (проверяется точная последовательность операторов и транзакционность), а
   поведение против реального Postgres под ролью `trellis_sandbox` проверено
   вручную — вывод приведён выше дословно.
   **Что нужно сделать отдельной задачей (вне границы 008):** прокинуть
   `TRELLIS_TEST_SANDBOX_DATABASE_URL` (роль `trellis_sandbox`, БД с суффиксом
   `_test`) в `ci.yml` и `ci-mirror.sh` рядом с существующими переменными —
   после этого в `sandbox/` можно добавить БД-тесты по образцу
   `db/testSupport.ts`, и они не будут скипаться.
2. **`docker/postgres/init/02-schemas.sql` грантит `CREATE ON DATABASE trellis`
   буквально по имени БД.** Для этой задачи это ровно то, что нужно (без
   гранта `drop/create schema` невозможен), но означает, что песочница
   работает только в БД с именем `trellis`; в CI/ci-mirror эта БД создаётся
   пустышкой только чтобы GRANT резолвился. Файл вне границы — не трогал,
   фиксирую как известное ограничение окружения.

## Fix round — findings

### Finding 1 (minor): ветка `!ownsSandbox && sandboxDatabaseUrl !== undefined` без теста

**Файл:** `services/backend/src/server.ts:186`
**Цитата:**
```
if (!ownsSandbox && options.sandboxDatabaseUrl !== undefined) {
    app.log.warn(
```
**Summary:** ветка `buildServer`, где вызывающий передал одновременно и
`sandbox`, и `sandboxDatabaseUrl` (warn-and-ignore, `sandbox` побеждает),
достижима, но ни один тест её не исполнял.

**Статус: fixed.**

Проверка перед правкой (шаг 1 инструкции): прочитал код на месте — цитата
совпадает дословно, `summary` описывает её верно. Построил конкретный путь
вызова: любой код, который построит `buildServer({ sandbox, sandboxDatabaseUrl
})` одновременно (например, будущая задача, объединяющая тестовый шов с
реальным `SANDBOX_DATABASE_URL` по ошибке), попадёт в эту ветку. Погрёпал
`services/backend/src` на `sandboxDatabaseUrl` и на паттерн `sandbox:` рядом —
ни `routes/sandbox.test.ts`, ни `sandbox/*.test.ts`, ни где-либо ещё оба
поля не передавались в один вызов `buildServer`. Аналогичная по форме ветка
для `registry`/`coursesDir` (строки 163–167) и для `pool`/`databaseUrl`
(строки 134–136) тоже без прямого теста, но их в findings не просили —
трогать не стал (вне scope этого fix-раунда).

Финдинг не опровергнут — ветка реальна, путь конкретен, теста не было.
Добавил `services/backend/src/server.test.ts` (новый файл, не трогает
существующие тесты) с одним тестом:

`buildServer given both \`sandbox\` and \`sandboxDatabaseUrl\` keeps the
injected \`sandbox\` and never touches the URL (edge case)` — строит
`buildServer({ pool: <фейк, кидает при любом query>, registry, sandbox:
<реальный provisioner поверх recording-пула>, sandboxDatabaseUrl:
"postgres://ignored-because-sandbox-wins/db" })` и проверяет два факта:

1. `app.sandbox === injectedSandbox` (идентичность, а не только похожее
   поведение) — доказывает, что `sandboxDatabaseUrl` не использовался для
   постройки конкурирующего провижнера;
2. `POST /courses/:id/sandbox/reset` реально проходит через
   `injectedSandbox`/recording-пул (в `recording.statements` появляется
   `COMMIT`) — если бы регрессия когда-нибудь заставила эту ветку строить
   драйвер из URL вместо сохранения `sandbox`, запрос попытался бы
   подключиться по заведомо нерабочему `sandboxDatabaseUrl` и упал бы, а не
   прошёл.

Переиспользовал существующие тестовые хелперы (`sandbox/testSupport.ts`:
`createRecordingPool`, `createSandboxFixture`, `FIXTURE_COURSE_ID`;
`createPostgresSandboxDriverFromPool`, `createSandboxProvisioner`) — новых
фикстур не заводил.

**Верификация:**
```
bash .mvp/ci-mirror.sh
```
Полный прогон зелёный: `services/backend` — 137/137 (был 136 до этого
раунда, +1 новый тест, 0 skipped, одноразовый Postgres поднялся и БД-тесты
реально выполнились — ci-mirror.sh требует этого явно), `services/frontend`
— 4/4. Новый тест виден в TAP-выводе как `ok 137`.

**FILES:** `services/backend/src/server.test.ts` (новый).
