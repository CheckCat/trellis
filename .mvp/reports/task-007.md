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
