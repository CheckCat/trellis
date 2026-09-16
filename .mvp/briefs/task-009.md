## Task
- id: 009
- title: Реализовать выполнение практики: запуск пользовательского SQL в песочнице с передачей результата и ошибки Postgres как есть, прогон check-запроса с контрактом «одна строка, один boolean» и самоотметка для заданий без check.
- level: 5
- service: backend
- service_path: services/backend
- role: backend-implementer
- files: services/backend/src/practice/execute.ts, services/backend/src/practice/check.ts, services/backend/src/routes/practice.ts
- depends_on: 007, 008
- estimate_tokens: 18000
- status: pending
- complexity_class: novel-design

## Boundary
services/backend

## Interfaces from dependencies
### 007
# Task 007 — домен прогресса и его API — отчёт

## Что создано

- `services/backend/src/progress/model.ts` — типы и чистые правила домена:
  `LessonStatus`, `LessonCompletionMode`, `ProgressRecord`, `LessonProgress`,
  `ModuleProgress`, `OrphanedProgress`, `CourseProgressSummary`,
  `CourseProgressTree`, `findLesson(course, lessonId)`,
  `lessonCompletionMode(lesson)`, `gradeQuizAnswer(quiz, optionId)`.
- `services/backend/src/progress/reconcile.ts` —
  `reconcileCourseProgress(course, records): CourseProgressTree` (чистая,
  без I/O и без записи). Это и есть «согласование при обновлении курса».
- `services/backend/src/progress/repository.ts` —
  `createProgressRepository(pool: AppPool): ProgressRepository`
  (`listCourseProgress`, `listAllProgress`, `markLessonCompleted`), плюс
  `declare module "fastify" { progress: ProgressRepository }`.
- `services/backend/src/routes/progress.ts` — `GET /courses/:courseId/progress`,
  `POST /courses/:courseId/lessons/:lessonId/complete` + экспорт общих
  схем/хелперов для `quiz.ts`.
- `services/backend/src/routes/quiz.ts` —
  `POST /courses/:courseId/lessons/:lessonId/quiz/answer`.
- Тесты (`node:test`, co-located): `progress/model.test.ts` (7),
  `progress/reconcile.test.ts` (9), `progress/repository.test.ts` (4, против
  реального Postgres), `routes/progress.test.ts` (10), `routes/quiz.test.ts`
  (10) — 40 новых тестов.
- `services/backend/src/progress/testSupport.ts` — тестовые хелперы
  (in-memory `ProgressRepository`, синтетическая фикстура курса на все четыре
  режима зачёта, `withProgressApp`). Не `*.test.ts`, поэтому добавлен в
  `exclude` `tsconfig.json` (как `courses/testSupport.ts`/`db/testSupport.ts`);
  `tsconfig.test.json` его компилирует.

## Правки существующих файлов (всё внутри `services/backend`)

- `src/server.ts` — `BuildServerOptions.progress?: ProgressRepository`
  (точка подмены для тестов, симметрично `pool`/`registry`); декорируется
  `app.progress = options.progress ?? createProgressRepository(pool)`;
  регистрируются `progressRoutes` и `quizRoutes`.
- `tsconfig.json` — в `exclude` добавлен `src/progress/testSupport.ts`.
- `src/db/testSupport.ts` — новый третий аргумент
  `connectToDisposableTestDbOrSkip(t, reason, { exclusive: true })`:
  session-level advisory lock (ключ `84637202`, поллинг
  `pg_try_advisory_lock`, дедлайн 60с, освобождение через `t.after`) —
  «эта БД на время теста моя». **Зачем**: `node --test 'dist-test/**/*.test.js'`
  гоняет файлы параллельно, `db/migrate.test.ts` делает `DROP TABLE
  core.lesson_progress`, а `progress/repository.test.ts` в эту таблицу пишет —
  без сериализации это гонка, падающая как «relation does not exist» (баг
  тестового окружения, выглядящий как баг кода). Лок берётся на ОТДЕЛЬНОМ
  пуле, а не на клиенте возвращаемого пула: иначе `pool.end()` самого теста
  ждал бы release клиента, который происходит только после тела теста —
  дедлок.
- `src/db/migrate.test.ts` — три деструктивных теста берут этот лок
  (`{ exclusive: true }`). Ничего другого в файле не изменено.

## HTTP API — формы ответов (реальный вывод, живой Postgres)

### `GET /courses/:courseId/progress` → 200

```json
{"courseId":"progress-fixture","courseVersion":"1.0.0","title":"Progress fixture course",
 "totalLessons":4,"completedLessons":2,"completed":false,
 "modules":[{"id":"first-module","title":"First module","totalLessons":2,"completedLessons":2,"completed":true,
   "lessons":[{"id":"text-lesson","title":"Text lesson","status":"completed","completionMode":"manual",
     "hasContent":true,"hasQuiz":false,"hasPractice":false,"completedAt":"2026-09-16T15:53:24.885Z"},
    {"id":"quiz-lesson","title":"Quiz lesson","status":"not_started","completionMode":"quiz",
     "hasContent":false,"hasQuiz":true,"hasPractice":false}]}],
 "orphanedLessons":[],"recordedVersions":[]}
```

- `status` — `"completed" | "not_started"` (третьего нет: «не начат» — это
  отсутствие строки в БД).
- `completedAt` присутствует только у завершённых.
- `completionMode` — `"manual" | "quiz" | "practice"`, вычисляется из
  контента урока (см. ниже), нужен фронту (013/014/015), чтобы знать, какую
  кнопку рисовать.
- `orphanedLessons: [{lessonId, completedAt, courseVersion?}]` — прогресс по
  урокам, которых в текущей версии курса нет (не учитывается в счётчиках, из
  БД НЕ удаляется).
- `recordedVersions: string[]` — версии курса, записанные в строках прогресса
  и отличающиеся от установленной; чисто диагностика, ни на что не влияет.
- 404 `{"error":"course_not_found","message":...}` для неизвестного/
  отклонённого курса.

### `POST /courses/:courseId/lessons/:lessonId/complete` → 200

```json
{"lesson":{"id":"text-lesson","title":"Text lesson","status":"completed","completionMode":"manual",
  "hasContent":true,"hasQuiz":false,"hasPractice":false,"completedAt":"2026-09-16T15:53:24.885Z"},
 "course":{"courseId":"progress-fixture","courseVersion":"1.0.0","totalLessons":4,
  "completedLessons":1,"completed":false}}
```

Тела запроса нет. Идемпотентен: повторный вызов не двигает `completedAt`.
Ошибки:
- 404 `course_not_found` / `lesson_not_found`;
- **409 `manual_completion_not_allowed`** — если у урока есть квиз или
  practice **с** `check`:
  `{"error":"manual_completion_not_allowed","message":"Lesson \"quiz-lesson\" is completed by answering its quiz correctly, not by marking it done."}`
  (текст `check`-запроса в сообщении не цитируется — проверено тестом).

### `POST /courses/:courseId/lessons/:lessonId/quiz/answer` → 200

Тело запроса: `{"optionId": "<id варианта>"}` (`additionalProperties: false`,
`minLength: 1`; лишние поля Fastify вырезает своим `removeAdditional`, а не
отклоняет — покрыто отдельным тестом «не действуют и не эхоятся»).

```json
// неверный ответ — ничего не записано, объяснение только выбранного варианта
{"correct":false,"lesson":{"id":"quiz-lesson",...,"status":"not_started"},
 "course":{...,"completedLessons":1,"completed":false},
 "explanation":"That option confuses two different things."}

// верный ответ — урок зачтён
{"correct":true,"lesson":{"id":"quiz-lesson",...,"status":"completed","completedAt":"2026-09-16T15:53:24.894Z"},
 "course":{...,"completedLessons":2,"completed":false}}
```

- Попытки не ограничены, история попыток не хранится (неверный ответ не пишет
  в БД ничего).
- Верный ответ после уже зачтённого урока не двигает `completedAt`; неверный
  ответ после зачёта НЕ снимает зачёт (`status` остаётся `completed`).
- Никогда не раскрывается, какой вариант верный: ни id верного варианта, ни
  его текст, ни чужие `explanation` в ответе не появляются (проверяется
  грепом по сырому телу ответа, не только по форме).
- Ошибки: 400 `unknown_option` (id не из этого квиза — именно 400, а не
  «неверный ответ»: иначе клиент мог бы перебором пространства id узнать
  верный), 400 от схемы тела, 404 `course_not_found` / `lesson_not_found` /
  `quiz_not_found` (у урока нет квиза).

## Правила домена (то, что должны знать 009/010/012/013/014)

- **Ключ прогресса — `(courseId, lessonId)`**, стабильные id из манифеста.
  Ни индексы, ни названия нигде не участвуют. `course_version` пишется, но
  это только provenance — по нему ничего не матчится и ничего не
  инвалидируется.
- **Режим зачёта урока** (`lessonCompletionMode`): есть `quiz` → `"quiz"`;
  иначе есть `practice.check` → `"practice"`; иначе → `"manual"`. То есть
  «задание без check — самоотметка» (инвариант проекта) выполняется буквально.
  Урок одновременно с квизом и с проверяемой практикой → `"quiz"` (один урок —
  один шлюз; задокументировано в `model.ts`).
- **Согласование при обновлении курса** (`reconcileCourseProgress`):
  совпал id → остаётся `completed` (даже если поменялись название урока,
  модуль, порядок и версия курса); id появился → `not_started`; id исчез →
  строка не удаляется, попадает в `orphanedLessons` и не считается в
  счётчиках (вернётся в счёт, если урок вернётся). Сброса прогресса нет
  нигде.
- **Курс пройден** = все уроки, которые сейчас есть в курсе, пройдены
  (orphaned не учитываются).
- Строки чужого курса, случайно попавшие в `records`, отбрасываются
  (reconcile не доверяет вызывающему).

## Интерфейсный дайджест

- **Репозиторий**: `fastify.progress` (тип `ProgressRepository`, decorator в
  `server.ts`). Свой инстанс не создавайте.
  - `listCourseProgress(courseId): Promise<ProgressRecord[]>` — строки одного
    курса, старые первыми (`completed_at, lesson_id`). Неизвестный курс → `[]`.
  - `listAllProgress(): Promise<ProgressRecord[]>` — все строки, порядок
    `(course_id, lesson_id)` (стабильный — под экспорт задачи 010).
  - `markLessonCompleted({courseId, lessonId, courseVersion?}): Promise<ProgressRecord>` —
    upsert; **`completed_at` при повторе не двигается**, обновляются
    `course_version`/`updated_at`. Именно это вызывает задача 009 после
    успешного `check` (свою запись в `core.lesson_progress` не изобретайте).
  - Операции «снять зачёт»/`delete` намеренно нет. Задаче 010 (импорт)
    понадобится свой метод записи — добавляйте его сюда, в `repository.ts`, а
    не в `transfer/`.
- **`ProgressRecord`**: `{courseId, lessonId, status: "completed",
  courseVersion?: string, completedAt: string (ISO), updatedAt: string}` —
  `Date` и `null` заканчиваются на границе репозитория.
- **Дерево**: `reconcileCourseProgress(course, records)` из
  `progress/reconcile.ts` — чистая функция, годится и для экспортных/отчётных
  сценариев без HTTP.
- **Новой миграции нет**: `core.lesson_progress` из `001_progress.sql`
  хватило как есть (`status` всегда `'completed'`, режим зачёта не хранится —
  он выводится из контента курса, а контент и прогресс по инварианту разные
  сущности).
- **`buildServer(options?)`** расширен полем `progress?: ProgressRepository`
  (тесты подменяют репозиторий и не трогают Postgres вообще; см.
  `progress/testSupport.ts`'s `withProgressApp`).
- **Тестовая БД**: если ваш тест пишет в `core.lesson_progress` или
  рассчитывает на её существование — берите
  `connectToDisposableTestDbOrSkip(t, reason, { exclusive: true })`, иначе
  словите гонку с `migrate.test.ts`.

## Проверки — реальный вывод

### `bash .mvp/ci-mirror.sh` (полный, с одноразовым Postgres)

Код `0`. Тестовый блок:
```
1..102
# tests 102
# suites 0
# pass 102
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
`# skipped 0` при поднятой БД — то есть 4 DB-теста репозитория реально
исполнились против Postgres (скипни они — ci-mirror сам бы упал по своей
проверке на skip'ы). Frontend: `4 passed (4)` vitest. Прогон повторён дважды
подряд, оба раза `EXIT=0`.

### `npm test -w @trellis/backend` без БД

Мои 40 тестов: 36 выполнено, 4 (репозиторий) — `# SKIP` с причиной
(`TRELLIS_TEST_DATABASE_URL is not set — skipping progress repository test ...`).

### Ручной прогон против живого Postgres (`buildServer({ databaseUrl })`, реальный пул + реальный репозиторий + реальные роуты, `app.inject`)

Одноразовый контейнер `postgres:17-alpine` с тем же
`docker/postgres/init/apply-all.sh`, роль `trellis_app`. Проверено по шагам
(вывод — в разделе «HTTP API» выше, он снят именно отсюда):
`GET /progress` (пусто) → `POST complete` → `POST complete` повторно
(`completedAt` тот же) → `POST complete` на квиз-урок (`409`) → неверный
ответ квиза (`correct:false`, в БД ничего) → верный ответ (`correct:true`,
урок зачтён) → `GET /progress` (2 из 4, первый модуль `completed:true`).
Финальная выборка из таблицы:
```json
[{"course_id":"progress-fixture","lesson_id":"quiz-lesson","status":"completed",
  "course_version":"1.0.0","untouched":true},
 {"course_id":"progress-fixture","lesson_id":"text-lesson","status":"completed",
  "course_version":"1.0.0","untouched":false}]
```
`untouched` = `completed_at = updated_at`: у `text-lesson` (его отмечали
дважды) `updated_at` сдвинулся, а `completed_at` — нет. Контейнер удалён
(`docker rm -f`), рабочий `trellis_pgdata` не трогался вообще.

### Сборка/линт

`npx tsc -p tsconfig.json` и `-p tsconfig.test.json` — без ошибок.
`dist/progress/` содержит только `model.js`/`reconcile.js`/`repository.js`
(+ .map): `testSupport.ts` и `*.test.ts` в прод-образ не попадают.
Линт — в составе ci-mirror, код `0`.

### Границы

`git status` после работы — изменения только под `services/backend/**`
(+ этот отчёт). Корневые `package.json`/`package-lock.json` не потребовались:
новых зависимостей нет.

## Deferred decisions

- **Ручная отметка запрещена (409) для уроков с квизом и с проверяемой
  практикой.** Прямое чтение `docs/product/business-logic.md` («текстовый урок
  проходится явной отметкой «пройдено», урок с квизом — верным ответом») и
  инварианта про check. Альтернатива («разрешить самоотметку всегда») сделала
  бы квиз и check декоративными. Если координатор решит, что пользователь
  локального приложения вправе «пропустить» квиз — снимается удалением одной
  ветки в `routes/progress.ts` (тест на 409 при этом станет тестом на 200).
- **Урок с квизом И с `practice.check` зачитывается квизом** (`quiz` > `practice`
  в `lessonCompletionMode`). Брифом такой случай не описан; выбран
  детерминированный приоритет вместо «любой из двух», чтобы не заводить в
  модели прогресса составной статус («квиз сдан, практика нет») — истории и
  частичных статусов в продуктовой модели нет.
- **Никакой новой миграции.** Режим зачёта (`manual`/`quiz`/`practice`) НЕ
  хранится в БД: он целиком выводится из контента курса, а контент может
  измениться под уже записанным прогрессом. Хранить его значило бы завести в
  таблице прогресса копию содержимого курса — прямо против инварианта о
  разделении форматов.
- **Ответ на квиз не создаёт «попытку» ни в каком виде** — ни счётчика, ни
  `last_answer`. Продуктовая модель: попытки не ограничены, история не
  хранится. Поэтому неверный ответ — чисто вычислительная операция (0 записей
  в БД), и это проверяется тестом, а не только комментарием.
- **`GET /progress` (сводка по всем курсам) не сделан** — задача 013 ходит в
  конкретный курс, а «всё сразу» нужно экспорту (задача 010), у которого для
  этого есть `listAllProgress()`. Добавить эндпоинт позже дешевле, чем
  поддерживать лишнюю форму ответа сейчас.
- **`orphanedLessons`/`recordedVersions` отдаются наружу, хотя фронт может их
  не рисовать** — это единственный канал, по которому пользователь локального
  приложения может узнать, что часть его прогресса относится к уроками,
  которых в обновлённом курсе больше нет (в логи он не смотрит). Та же логика,
  что у `scanFailed`/`scanError` в задаче 006 (fix round 2).
- **Формат ответа обеих write-операций — `{lesson, course}`, а не полное
  дерево** — фронту после отметки нужны статус этого урока и счётчики курса;
  полное дерево на каждый клик было бы лишним трафиком, а «ничего не вернуть»
  заставило бы делать второй запрос.
- **`status` в `ProgressRecord` типизирован как литерал `"completed"`**, и
  репозиторий бросает ошибку, если из БД пришло что-то иное. Сейчас это
  гарантирует CHECK-constraint; проверка нужна на случай, если constraint
  когда-нибудь расширят — иначе тип молча начнёт врать.

## Fix round 1 (review findings)

Обе находки — **fixed**.

### bug — `services/backend/src/progress/repository.ts:85` (`set course_version = excluded.course_version,`)

**Разобрался**: прочитал `markLessonCompleted` целиком и `model.ts` (строка
60: `` undefined ``for rows written before a version was known``, то есть
`undefined` документирован только для строк, у которых версия никогда не
была известна, а не как значение, в которое более поздний вызов может
регрессировать уже известную версию). Проверил обоих текущих вызывающих
(`routes/progress.ts:71-75`, `routes/quiz.ts:75-79`) — оба сейчас всегда
передают `courseVersion: course.version` из установленного курса, где
`version` — обязательное поле манифеста (не пусто). Но `courseVersion` в
`MarkLessonCompletedInput` явно опционален и в репозитории (`ProgressRepository`)
описан как часть публичного API — это не гипотетический путь: SQL буквально
писал `courseVersion ?? null` в `course_version` при КАЖДОМ upsert, включая
повторный вызов без версии поверх строки, где версия уже была записана.
Ни один существующий тест эту комбинацию («сначала с версией, потом без»)
не проверял (`repository.test.ts` тестировал только «версия неизвестна с
самого начала», строки 86-93) — баг реален и ровно такой, как описан.

**Исправлено**: `on conflict ... do update set course_version = excluded.course_version`
заменено на
`course_version = coalesce(excluded.course_version, core.lesson_progress.course_version)`
— повторный вызов без известной версии больше не затирает ранее
записанную. Добавлен регрессионный тест
`repository.test.ts`: `"markLessonCompleted keeps a previously recorded
courseVersion when a repeat call doesn't know it (regression)"` — пишет
версию `"1.0.0"`, затем вызывает `markLessonCompleted` без `courseVersion` и
проверяет, что `courseVersion` в ответе остаётся `"1.0.0"`, а `completedAt`
не двигается.

`bash .mvp/ci-mirror.sh` → код `0` (включая новый тест против реального
disposable Postgres, без скипа).

### minor — `services/backend/src/progress/reconcile.ts:105` (`].sort();`)

**Разобрался**: `course.version`/`ProgressRecord.courseVersion` документированы
и в схеме (`manifest.schema.json:15-19`, `"description": "Semver string."`,
паттерн `^\d+\.\d+\.\d+(-...)?(\+...)?$`) как semver-строки. Дефолтный
`Array.prototype.sort()` сравнивает как строки: `"0.10.0" < "0.9.0"`
лексикографически (символ `'1'` < `'9'`), что не соответствует semver-порядку.
Существующий тест (`reconcile.test.ts:205-215`, версии `"0.8.0"`/`"0.9.0"`)
случайно совпадает с лексикографическим порядком и не ловит это — находка
подтверждена.

**Исправлено**: добавлена `compareVersions(a, b)` — парсит
`major.minor.patch[-pre][+build]`, сравнивает `major`/`minor`/`patch`
числово, игнорирует build-метаданные, pre-release версия сортируется перед
релизом той же тройки (правило semver), при непарсящейся строке — плоское
сравнение строк (поле диагностическое, не должно падать). `recordedVersions`
теперь `.sort(compareVersions)`. Добавлен регрессионный тест
`reconcile.test.ts`: `"reconcile sorts recorded versions by semver
precedence, not lexicographically (regression)"` — версии `"0.10.0"`,
`"0.9.0"`, `"0.2.0"` дают ожидаемый порядок `["0.2.0", "0.9.0", "0.10.0"]`
(лексикографический сорт дал бы `["0.10.0", "0.2.0", "0.9.0"]`).

`bash .mvp/ci-mirror.sh` → код `0`.

### Итог

`bash .mvp/ci-mirror.sh` прогнан после обеих правок вместе, дважды подряд —
оба раза код `0`. Backend: 104 теста (было 102 в отчёте выше — тот прогон
уже отражал часть переиндексации; сейчас `# tests 104 / # pass 104 / # fail
0`), frontend: 4 passed. Изменения только внутри `services/backend/**`
(`progress/repository.ts`, `progress/reconcile.ts`,
`progress/repository.test.ts`, `progress/reconcile.test.ts`) + этот отчёт.

### 008
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

