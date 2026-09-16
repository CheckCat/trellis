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
