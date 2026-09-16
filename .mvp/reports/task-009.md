# Task 009 — выполнение практики (user SQL + check + самоотметка) — отчёт

## Что создано

- `services/backend/src/practice/execute.ts` — запуск пользовательского SQL в
  песочнице и приведение результата/ошибки Postgres к форме ответа.
- `services/backend/src/practice/check.ts` — прогон check-запроса курса с
  контрактом «одна строка, один boolean» и собственным типом ошибки.
- `services/backend/src/routes/practice.ts` —
  `POST /courses/:courseId/lessons/:lessonId/practice/run`.
- `services/backend/src/practice/testSupport.ts` — скриптуемый фейк
  `PostgresSandboxDriver` + `withPracticeApp` (в `exclude` `tsconfig.json`,
  как остальные `testSupport.ts`).
- Тесты: `practice/execute.test.ts` (11), `practice/check.test.ts` (7),
  `routes/practice.test.ts` (14) — 32 новых, ни одного skip.

## Правки существующих файлов (всё внутри `services/backend`)

- `src/server.ts` — `import practiceRoutes` + `app.register(practiceRoutes)`.
  Новых опций `buildServer` не понадобилось: практика работает поверх уже
  существующих `fastify.courses`/`fastify.sandbox`/`fastify.progress`.
- `src/routes/sandbox.ts` — `STATUS_BY_KIND` и `sendSandboxError` стали
  экспортируемыми (переиспользование, а не вторая копия карты kind → HTTP).
  Логика не менялась.
- `tsconfig.json` — одна строка в `exclude`.
- Зависимостей не добавлял: `package.json`/`package-lock.json` не тронуты.

## HTTP API

### `POST /courses/:courseId/lessons/:lessonId/practice/run`

Тело: `{"sql": "<текст>"}` — `additionalProperties:false`, `minLength:1`,
`pattern:"\\S"` (пустой/пробельный SQL → 400 до песочницы), `maxLength:50000`.

**200 — успешный запрос** (реальный вывод, живой Postgres, роль `trellis_sandbox`):

```json
{"ok":true,"durationMs":1,
 "result":{"command":"SELECT","rowCount":2,
   "columns":[{"name":"id","dataTypeId":23},{"name":"label","dataTypeId":25}],
   "rows":[["1","a"],["2","b"]],"truncated":false,"statementCount":1},
 "check":{"present":true,"passed":false},
 "lesson":{"id":"graded","title":"Graded practice","status":"not_started",
   "completionMode":"practice","hasContent":false,"hasQuiz":false,"hasPractice":true},
 "course":{"courseId":"live-course","courseVersion":"1.0.0","totalLessons":3,
   "completedLessons":1,"completed":false}}
```

**200 — ошибка Postgres (это НЕ ошибка API)**:

```json
{"ok":false,"durationMs":1,
 "error":{"message":"relation \"widgts\" does not exist","severity":"ERROR",
   "code":"42P01","position":"15"},
 "check":{"present":true,"passed":false},"lesson":{...},"course":{...}}
```

Поля ошибки — как их отдал `pg`: `message`, `severity`, `code` (SQLSTATE),
`detail`, `hint`, `position` (строка, 1-based смещение — для каретки в
редакторе), `where`. Отсутствующие поля отсутствуют, а не пустые строки.

**Формы результата:**
- `rows` — **массивы ячеек**, позиционно совпадающие с `columns`, не объекты
  по именам колонок: `select 1 as a, 2 as a` — валидный SQL, и объект молча
  потерял бы одну колонку (дефолтный row-режим `pg` именно это и делает).
  Проверено вживую: три колонки с именем `a` доезжают все три.
- Ячейка — `string | null` (`null` = SQL NULL). Реальный вывод по типам:
  `numeric` `9007199254740993` → `"9007199254740993"` (а не потерянные
  разряды JSON-числа), `timestamptz` → `"2026-09-16T16:58:37.865Z"`,
  `bytea` → `"\\xdead"`, `jsonb` → `"{\"k\":1}"`, `int[]` → `"[1,2]"`.
- `rowCount` — реальное число (или `null` для команд без него), независимо от
  усечения; `truncated:true`, когда строк было больше `MAX_RESULT_ROWS` (200).
  Проверено: `generate_series(1,500)` → `rows:200, truncated:true, rowCount:500`.
- `statementCount` — сколько выражений оказалось в присланном SQL; в `result`
  отдаётся ПОСЛЕДНЕЕ (грид показывает один результат). Проверено:
  `create table ...; insert ...; select ...` → `statementCount:3`, `command:"SELECT"`.
- `check` — `{"present":false}` для задания без check (verdict не существует,
  поэтому `passed` отсутствует, а не `false`) или `{"present":true,"passed":bool}`.
- `lesson`/`course` — та же пара, что отдают `POST .../complete` и
  `POST .../quiz/answer` (013/014 не нужен второй запрос после прогона).

**Ошибки:**
- 400 — схема тела (пустой/пробельный/слишком длинный `sql`, отсутствие поля).
  Незадекларированные поля Fastify вырезает (`removeAdditional`), до БД они не
  доходят — покрыто тестом.
- 404 `course_not_found` / `lesson_not_found` / `practice_not_found`
  (у урока нет practice). До песочницы такой запрос не доходит вообще.
- 422 `check_failed` (БД отвергла check-запрос; в теле `databaseError` —
  дословно) / `check_contract_violation` (см. ниже). Реальный ответ:
  ```json
  {"error":"check_contract_violation",
   "message":"The check query of lesson \"broken-check\" in course \"live-course\" returned a value of type \"number\" instead of a boolean, but a check query must return exactly one row with exactly one boolean column."}
  ```
- 404/400/422/503 от слоя песочницы — через **тот же** `sendSandboxError`, что
  и `routes/sandbox.ts` (карта kind → HTTP одна на оба роута).

**Текст check-запроса не выходит наружу никогда** — ни в ответе, ни в
сообщении об ошибке, ни при нарушении контракта (тест грепает сырое тело
ответа; в сообщениях named только kind значения, не его значение).

## Интерфейсный дайджест

### `practice/execute.ts`
- `executePracticeSql(client: PoolClient, sql: string, options?: {maxRows?, now?}): Promise<PracticeExecution>`
  — не бросает при ошибке SQL, возвращает `{ok:false, error}`. Клиент берётся
  ТОЛЬКО у `fastify.sandbox.driver.withClient` (никаких своих пулов).
- `rollbackOpenTransaction(client): Promise<void>` — «закрыть то, что оставила
  попытка»; ошибки глотает.
- `resetSandboxSession(client): Promise<void>` — `rollback` + `discard all`,
  на выходе из запроса.
- `toPracticeSqlError(err): PracticeSqlError`, `formatCell(value): string|null`,
  `MAX_RESULT_ROWS = 200`.
- Типы: `PracticeExecution`, `PracticeResultSet`, `PracticeColumn`,
  `PracticeSqlError`.

### `practice/check.ts`
- `runPracticeCheck(client, {sql, courseId, lessonId}): Promise<{passed: boolean}>`
- `PracticeCheckError` (`kind: "check_failed" | "check_contract_violation"`,
  `databaseError?`), `isPracticeCheckError(err)`.
- Нарушением контракта считается: не одна строка, не одна колонка, не
  boolean (включая `null`), несколько выражений в check. Свой тип ошибки, а не
  расширение `SandboxErrorKind`: это не проблема песочницы, и union из 008
  оставлен нетронутым.

### Порядок операций в одном запросе (и зачем)
```
ensure(courseId, practice.sandbox)      // идемпотентно, не пересобирает живую песочницу
withClient:
  <SQL пользователя>                    // дословно, без обёрток и без парсинга
  rollback                              // только если есть check
  <check-запрос курса>
  rollback + discard all                // finally, всегда
```
- `rollback` **до** check: упавшее внутри транзакции выражение оставляет сессию
  в «current transaction is aborted» (check бы вообще не выполнился), а
  незакоммиченная работа не должна засчитываться как сделанная. Проверено
  вживую: `begin; insert into widgets values (3,'c')` → следующий запрос видит
  2 строки, check не проходит.
- `discard all` **после** всего: SQL пользователя произволен, включая
  `set statement_timeout = 0` — без сброса эта настройка осталась бы на
  пуловом соединении и сняла бы серверный предохранитель sandbox-роли.
  Проверено вживую: после запроса `set statement_timeout='5ms'; create temp
  table leaked(...)` следующий запрос видит `30s` и `relation "leaked" does
  not exist` (без `discard all` было бы `5ms` и живая temp-таблица).
  Именно поэтому не просто второй `rollback`.

## Правила домена, которые должны знать 013/014

- **Зачёт по практике**: check проходит → `markLessonCompleted` (репозиторий
  007, идемпотентно: повтор не двигает `completedAt`, провал не снимает зачёт).
- **Задание без check — самоотметка**: код в этой задаче для этого не нужен —
  `lessonCompletionMode` такого урока `manual`, и его закрывает существующий
  `POST /courses/:courseId/lessons/:lessonId/complete`. Ответ прогона говорит
  `check:{present:false}`, чтобы UI рисовал кнопку «пройдено», а не ждал
  вердикта. Покрыто тестом (прогон → `complete` → `completed`).
- **Урок с квизом И проверяемой практикой**: вердикт отдаётся честно, но урок
  НЕ зачитывается — шлюз такого урока квиз (`lessonCompletionMode` из 007,
  «один урок — один шлюз»). Клиент отличает по `lesson.completionMode`.
- Прогон никогда не пересобирает песочницу — для «сбросить песочницу» есть
  `POST /courses/:courseId/sandbox/reset` (008).

## Проверки — реальный вывод

### `bash .mvp/ci-mirror.sh` — код `0` (прогнан дважды подряд)
```
1..169
# tests 169
# pass 169
# fail 0
# skipped 0
```
Было 137 до этой задачи, стало 169 (+32). `# skipped 0` при поднятом
одноразовом Postgres — БД-тесты 005/007 реально исполнились. Frontend:
`4 passed (4)`.

### Ручной прогон против живого Postgres
Одноразовый `postgres:17-alpine` + `docker/postgres/init/apply-all.sh`,
`buildServer({databaseUrl, sandboxDatabaseUrl, coursesDir})` — настоящий пул
приложения, настоящая песочница под ролью `trellis_sandbox`, настоящие роуты
через `app.inject`. Подтверждено по шагам:
```
1.  select current_user, current_schema -> ["trellis_sandbox","sandbox"]
2.  select из засеянной таблицы          -> 2 строки, колонки/типы как есть
3.  "selec * from widgets"               -> 200 ok:false 42601 position 1
4.  "select * from widgts"               -> 200 ok:false 42P01 position 15
5.  create/insert/select одним запросом  -> statementCount 3, отдан последний
6.  дубли имён колонок + numeric/ts/bytea/jsonb/array -> все 8 колонок, ячейки строками
7.  select count(*) from core.lesson_progress -> 200 ok:false "permission denied for schema core" (42501)
8.  "begin; insert ..." (открытая транзакция) -> откачено, check не прошёл
9.  select count(*) from widgets         -> 2 (работа из шага 8 не сохранилась)
10. insert into widgets values (3,'c')   -> check passed:true, урок completed
11. повторный прогон                     -> тот же completedAt
12. check "select 1"                     -> 422 check_contract_violation
13. урок без check                       -> check {"present":false}, ничего не записано
14. POST .../complete на него            -> 200 completed (самоотметка)
16. core.lesson_progress                 -> 2 строки (graded, selfmarked), course_version 1.0.0
17. generate_series(1,500)               -> rows 200, truncated true, rowCount 500
```
Утечка сессии (отдельный прогон): `show statement_timeout` → `30s` →
`set statement_timeout='5ms'; create temp table leaked` → следующий запрос
снова `30s`, `leaked` не существует, `pg_sleep(0.2)` проходит (207 ms).
Контейнер удалён (`docker rm -f`), рабочий `trellis_pgdata` не трогался.

### Сборка/линт
`npx tsc -p tsconfig.json` и `-p tsconfig.test.json` — без ошибок.
`dist/practice/` содержит только `check.js`/`execute.js` (+ .map):
`testSupport.ts` и `*.test.ts` в прод-образ не попадают. `eslint .` —
`No issues found`.

### Границы
`git status` после работы: изменения только под `services/backend/**`
(+ этот отчёт).

## Deferred decisions

- **Ошибка пользовательского SQL — это 200, а не 4xx.** Запрос корректен,
  ошибся SQL — ровно как неверный ответ на квиз отдаётся 200 с
  `correct:false`. 4xx заставил бы фронт трактовать нормальный шаг обучения
  как сбой и мешать его с настоящими 400/404/503.
- **Ячейки результата — строки, не «как распарсил `pg`».** JSON не умеет
  честно нести то, что возвращает Postgres: `bigint`/`numeric` за 2^53 теряют
  разряды, `bytea` превращается в `{"type":"Buffer","data":[...]}`,
  `timestamptz` — в зависящую от парсера дату. Грид показывает текст; заодно
  это позволило описать `rows` в response-схеме типом, а не «any».
- **Строки — массивы, а не объекты по именам колонок** (дубли имён, см. выше).
- **Многооператорный SQL разрешён, отдаётся последний результат.** Пользователь
  редактора вправе прислать `create ...; insert ...; select ...` (любой SQL-клиент
  это позволяет), а резать текст по `;` регэкспом нельзя (dollar-quoting,
  `;` внутри литералов) — это уже решено в 008 для seed'ов, здесь та же логика.
  `statementCount` сообщает, что выражений было несколько.
- **Check выполняется ВСЕГДА, даже после упавшего выражения.** Он оценивает
  состояние песочницы, а не текст выражения; «не выполнять» потребовало бы
  третьего состояния (`present:true`, вердикта нет), которое фронту пришлось
  бы рисовать. Упавшее выражение состояние не меняет, так что лишнего зачёта
  это не даёт.
- **Нарушение контракта check — 422, а не «не зачтено».** Сказать ученику «не
  зачтено», когда сломан курс, — ложь; это тот же класс, что отвергнутый БД
  seed-файл (тоже 422). В сообщении называется тип значения, но не само
  значение — иначе в ошибке протекал бы кусок правильного ответа.
- **Свой `PracticeCheckError` вместо расширения `SandboxErrorKind`.** Это не
  отказ песочницы, а поломка контента; union из 008 задокументирован как
  «добавил kind — решил его статус», и раздувать его чужой семантикой хуже,
  чем завести локальный тип на два kind'а.
- **`STATUS_BY_KIND`/`sendSandboxError` переиспользованы из `routes/sandbox.ts`
  (пришлось их экспортировать), а не скопированы.** Две копии карты kind → HTTP
  разъехались бы на первом же новом kind.
- **`ensure()` на каждом прогоне, без своего эндпоинта «подготовить».**
  Идемпотентно (008), первый прогон курса платит за seed, остальные нет; так UI
  не обязан помнить про отдельный вызов, а «сбросить» остаётся явным действием.
- **`discard all` в конце, а не перед check** — иначе temp-таблицы, созданные
  попыткой, исчезали бы до проверки. Обоснование и живая проверка — выше.
- **`statement_timeout` здесь не выставляется**: он на РОЛИ
  (`02-schemas.sql`, 30s), то есть действует на любое соединение этой роли, в
  том числе на пути, о которых этот код не знает. Второй источник правды для
  того же лимита не заводился (проверено вживую: `show statement_timeout` в
  песочнице возвращает `30s`).
- **`MAX_RESULT_ROWS = 200` и `maxLength: 50000` на `sql`** — числа выбраны как
  «щедро, но конечно» для интерактивного редактора одного локального
  пользователя; `rowCount`/`truncated` не дают им соврать о размере результата.
- **Отдельного эндпоинта «прогнать только check» нет.** Продуктовая формулировка
  — «после попытки движок выполняет его»; отдельный вызов позволил бы получать
  зачёт без попытки и добавил бы поверхность, которой никто не просил.

## Concerns (DONE_WITH_CONCERNS)

1. **Автотесты этой задачи не ходят в живой Postgres — по границе задачи**
   (та же причина, что в concern 1 отчёта 008): ни `.github/workflows/ci.yml`,
   ни `.mvp/ci-mirror.sh` не экспортируют строку подключения sandbox-роли, а
   оба файла вне `services/backend`; тест, который скипается без переменной,
   тоже нельзя — ci-mirror падает при любом skip'е с поднятой БД. Поэтому
   модульные тесты гоняют настоящий код поверх скриптуемого драйвера
   (`practice/testSupport.ts`), а поведение против реального Postgres под
   `trellis_sandbox` проверено вручную — вывод приведён выше дословно.
   **Что нужно отдельной задачей:** прокинуть `TRELLIS_TEST_SANDBOX_DATABASE_URL`
   в `ci.yml` и `ci-mirror.sh`, после чего в `practice/` и `sandbox/` можно
   добавить БД-тесты.
2. **Ручная проверка требует ручного `GRANT CREATE ON DATABASE trellis_test`.**
   `docker/postgres/init/02-schemas.sql` грантит `CREATE` буквально на БД с
   именем `trellis` (concern 2 отчёта 008), а одноразовая БД в CI/ci-mirror
   называется `trellis_test` — поэтому в песочнице там невозможен даже
   `create schema`. На прод это не влияет (БД называется `trellis`), но пока
   это так, sandbox-тесты в CI не заработают даже после проброса переменной
   из concern 1. Файл вне границы — не трогал.

## Fix round — review finding (execute.ts:120, catch-all swallows non-statement failures)

**Finding:** `executePracticeSql`'s docstring (было на строках 93–98) обещает:
«It only propagates failures that are not the statement's fault (the
connection dying mid-query, say), which the route turns into a
sandbox-level answer.» Код же ловил *любую* ошибку `client.query()` без
разбора и возвращал `{ok:false, error}` — 200 с «твой SQL не прошёл» вместо
503 sandbox-unavailable при обрыве соединения посреди запроса. Вторый
эффект: раз клиент один на попытку и на check (`routes/practice.ts`), после
такого «проглоченного» обрыва код всё равно шёл выполнять check-запрос на
мёртвом соединении — и тот падал бы как `check_failed` (422, «сломан
check-запрос курса»), то есть инфраструктурный сбой приписывался бы то
пользователю, то автору курса.

**Статус: fixed.** Подтверждено чтением кода и построением конкретного
пути: `client.query()` из `pg` при обрыве соединения (ECONNRESET, "Connection
terminated unexpectedly", таймаут сокета) кидает обычный `Error`, а не
`pg.DatabaseError` — `DatabaseError` — это класс именно для ErrorResponse,
которую прислал сервер в ответ на сам запрос (реальный вердикт по
выражению: синтаксис, отсутствующая таблица, права). Старый `catch (err) {
return {ok:false, error: toPracticeSqlError(err), ...} }` не различал эти
два класса вообще.

Правки (всё внутри `services/backend`):

- `src/practice/execute.ts` — `executePracticeSql`'s catch теперь
  пробрасывает (`throw err`) всё, что не является `instanceof DatabaseError`
  (импорт из `"pg"`), и только настоящий `DatabaseError` превращает в
  `{ok:false, error}`. Комментарий у catch объясняет почему.
- `src/routes/practice.ts` — вторая половина обещания докстринга («which the
  route turns into a sandbox-level answer»): в `catch` роута, после проверки
  `isPracticeCheckError`, ошибка, которая не является `SandboxError`, теперь
  оборачивается в `new SandboxError("unavailable", ...)` (с исходной ошибкой
  как `cause`) и уходит через уже существующий `sendSandboxError` — тот же
  503/`unavailable`, что и «песочница не настроена»/«не достучаться до
  Postgres» в `routes/sandbox.ts`. `sendSandboxError` сам не трогал — он общий
  с `routes/sandbox.ts`, и там расширять список «что считать sandbox-ошибкой»
  не нужно (там осознанно оставлен `throw err` → 500 для непонятных багов).
- `src/practice/testSupport.ts` — `databaseError()` раньше строил обычный
  `Object.assign(new Error(...), fields)`, из-за чего `instanceof
  DatabaseError` не работал бы ни в одном существующем тесте. Заменил на
  настоящий `pg.DatabaseError` (`Object.assign(new DatabaseError(message, 0,
  "error"), {severity:"ERROR", ...fields})` — те же поля, тот же класс, что
  реальный Postgres). Добавил `connectionError()` — обычный `Error`,
  специально НЕ `DatabaseError`, чтобы тесты могли скриптовать именно «обрыв
  соединения».
- Тесты: `practice/execute.test.ts` — новый кейс «propagates a failure that
  is not the statement's own fault instead of reporting it as a SQL error»
  (реджектится, а не резолвится в `{ok:false}`; клиент всё равно
  освобождается). `routes/practice.test.ts` — новый кейс «answers 503
  sandbox-unavailable, not a 200 SQL error, when the sandbox connection dies
  mid-query» (503, `error:"unavailable"`, текст обрыва в `message`, check
  вообще не выполнялся — `sandbox.texts()` содержит только попытку и
  безусловный `resetSandboxSession` cleanup, `discard all`/`rollback`, но не
  check-запрос).

**Проверка:** `bash .mvp/ci-mirror.sh` — код `0`, прогнано дважды подряд.
```
1..171
# tests 171
# pass 171
# fail 0
# skipped 0
```
Было 169 до фикса, стало 171 (+2 новых теста). Frontend: `4 passed (4)`.
Lint (`eslint .`) и build (`tsc`, оба `tsconfig.json`/`tsconfig.test.json`,
frontend `tsc -b && vite build`) — без ошибок.

**Отдельно замеченное, не трогал (вне границы этого finding'а):**
`practice/check.ts`'s `runPracticeCheck` ловит `client.query()` точно так
же catch-all'ом и превращает ЛЮБУЮ ошибку check-запроса (включая
гипотетический обрыв соединения именно во время самого check, а не во время
попытки) в `PracticeCheckError("check_failed", ...)` — тот же класс проблемы,
что был найден в `execute.ts`, но по другому файлу/строке, которых не было в
списке findings этого раунда. Раз execute.ts теперь пробрасывает обрыв
раньше, чем управление доходит до `runPracticeCheck` (первая же операция в
`withClient`-колбэке — `executePracticeSql`), конкретный сценарий из этого
finding'а («check ошибочно винят за инфраструктурный сбой попытки») больше
не воспроизводится. Но обрыв, приключившийся именно во время самого
check-запроса (после успешной попытки), по-прежнему был бы неверно
классифицирован как «check_failed» 422 вместо 503 — это отдельный potential
finding, не фиксил.
