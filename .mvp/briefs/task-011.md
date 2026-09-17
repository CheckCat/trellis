## Task
- id: 011
- title: Собрать каркас SPA: роутинг, типизированный HTTP-клиент к API backend, общий layout и минималистичная тема в мягких зелёных тонах.
- level: 6
- service: frontend
- service_path: services/frontend
- role: frontend-implementer
- files: services/frontend/src/App.tsx, services/frontend/src/routes.tsx, services/frontend/src/api/client.ts, services/frontend/src/api/types.ts, services/frontend/src/ui/theme.css, services/frontend/src/ui/Layout.tsx
- depends_on: 004, 007
- estimate_tokens: 16000
- status: pending
- complexity_class: follow-pattern

## Boundary
services/frontend

## Interfaces from dependencies
### 004
# Task 004 — скелет frontend (React SPA на Vite) — отчёт

## Что создано

- `services/frontend/package.json` — `@trellis/frontend`, `private: true`,
  `type: module`, скрипты `dev`/`build`/`preview`/`lint`/`test` дословно как
  в брифе. Зависимости — ровно список из брифа, ничего сверх.
- `services/frontend/tsconfig.json` — `extends: "../../tsconfig.base.json"`,
  `jsx: react-jsx`, `lib: [ES2023, DOM, DOM.Iterable]`, `types: [vite/client]`,
  `noEmit: true`, `include: ["src"]`, плюс переопределение `module: ESNext` /
  `moduleResolution: bundler` (обоснование — Deferred decisions).
- `services/frontend/eslint.config.mjs` — `[...base, {...}]` (паттерн
  задачи 001), добавляет только browser-глобалы (`window`, `document`,
  `fetch`, `console`, `AbortController`) для `src/**/*.{ts,tsx}`. Никаких
  новых eslint-плагинов (react-hooks/react-refresh) — не входят в
  зафиксированный список зависимостей брифа, см. Deferred decisions.
- `services/frontend/vite.config.ts` — плагин `@vitejs/plugin-react`,
  `server.port = 3000`, `server.host = '127.0.0.1'`, dev-proxy `/api` →
  `http://127.0.0.1:3001` (адрес переопределяется `VITE_BACKEND_ORIGIN`),
  проксирование срезает префикс `/api` (`rewrite`), `test.environment =
  jsdom`.
- `services/frontend/index.html` — заголовок `Trellis`, монтирует
  `src/main.tsx`.
- `services/frontend/src/main.tsx` — точка входа, `createRoot` +
  `StrictMode`.
- `services/frontend/src/App.tsx` — состояние связи с ядром: `loading` →
  `connected`/`disconnected` по результату `GET /api/health` (относительный
  путь, `fetch` напрямую — без TanStack Query, см. Deferred decisions).
  Индикатор — точка (`status-dot`) + текст с `role="status"
  aria-live="polite"`.
- `services/frontend/src/index.css` — палитра в CSS-переменных (мягкие
  зелёные тона: `--color-accent: #3f8858`, `--color-bg: #f3f8f4` и т.д.),
  один центрированный «пустой экран» (`app-shell` + `status-card`), без
  полноценного layout.
- `services/frontend/src/App.test.tsx` — vitest + RTL: loading-состояние,
  успешный `/api/health` → «связь есть», сетевая ошибка (error path) и
  HTTP 500 (edge case) → «связи нет». 4 теста, все проходят.
- `services/frontend/Dockerfile` — multi-stage, контекст — корень репо:
  builder `node:22-alpine` (`npm ci` по корневым манифестам +
  `services/frontend/package.json`, `npm run build -w @trellis/frontend`),
  runtime `nginx:alpine`, копирует `dist` → `/usr/share/nginx/html` и
  `nginx.conf` → `/etc/nginx/conf.d/default.conf`, `EXPOSE 80`.
- `services/frontend/nginx.conf` — SPA-fallback (`try_files $uri
  /index.html`), `location /api/ { proxy_pass http://backend:3001/; }` (тот
  же приём среза префикса, что и в dev-proxy — trailing slash с обеих
  сторон).
- `services/frontend/.gitignore` — `tsconfig.tsbuildinfo` (артефакт `tsc -b`,
  корневой `.gitignore` этого имени не знает; паттерн аналогичен
  `services/backend/.gitignore` из задачи 003).
- `package.json`/`package-lock.json` (корень) — обновлены `npm install ... -w
  @trellis/frontend` (BOUNDARY_EXEMPT, ожидаемо).

## Версии зависимостей

| Пакет | package.json | Реально установлено |
|---|---|---|
| `react` | `^19.3.0` | 19.3.0 |
| `react-dom` | `^19.3.0` | 19.3.0 |
| `vite` | `^8.3.0` | 8.3.0 |
| `@vitejs/plugin-react` | `^6.1.1` | 6.1.1 |
| `typescript` | `^6.0.3` | 6.0.3 (закреплён на том же мажоре, что и корень — см. Deferred decisions) |
| `@types/react` | `^19.3.0` | 19.3.0 |
| `@types/react-dom` | `^19.3.0` | 19.3.0 |
| `vitest` | `^5.0.1` | 5.0.1 |
| `jsdom` | `^30.0.1` | 30.0.1 |
| `@testing-library/react` | `^16.3.3` | 16.3.3 |

`npm ls ... -w @trellis/frontend` — дерево без дублей, все версии
дедуплицированы (одна копия `react`/`typescript`/`vite` на всё дерево).

## Интерфейсный дайджест для задач 011–016

- **Точка входа / структура** — `src/main.tsx` монтирует `App` из
  `src/App.tsx` в `#root` (см. `index.html`). Роутер (011) встраивается
  вокруг/внутри `App` — сам `App` сейчас не экспортирует ничего, кроме
  React-компонента, свободен для превращения в layout-обёртку с `<Outlet
  />` (React Router 7) или root route (TanStack Router).
- **Палитра** — `src/index.css`, блок `:root { --color-* }`. Токены:
  `--color-bg`, `--color-surface`, `--color-border`, `--color-text`,
  `--color-text-muted`, `--color-accent`, `--color-accent-soft`,
  `--color-status-ok`, `--color-status-error`, `--color-status-pending`.
  Полноценный layout (011) может добавлять свои классы/токены поверх, но
  переиспользуйте эти переменные вместо новых зелёных оттенков «на глаз».
- **Как ходить в API** — `fetch("/api/<path>")`, всегда относительный путь с
  префиксом `/api`. Префикс срезается на обеих средах: dev — `vite.config.ts`
  `server.proxy['/api'].rewrite`, прод — `nginx.conf` `location /api/`
  (`proxy_pass http://backend:3001/` с trailing slash). То есть код
  фронтенда всегда обращается к бэкенду по его собственным путям
  (`/api/health` → бэкендный `/health`), НЕ дублируйте `/api` в бэкендных
  роутах. Когда 015 заведёт типизированный HTTP-клиент — этот контракт
  (относительный `/api`-префикс, срез на прокси) не меняется, клиент просто
  оборачивает тот же `fetch`.
- **Паттерн теста** — vitest + RTL, БЕЗ `globals: true` в
  `vite.config.ts`'s `test` (хуки/`expect`/`vi` — явный импорт из
  `"vitest"`), БЕЗ `@testing-library/jest-dom` (не в списке зависимостей
  брифа) — ассерты через `.textContent` + `toContain(...)`, не
  `toHaveTextContent`. Сеть мокается через `vi.stubGlobal("fetch", vi.fn(...))`
  + `vi.unstubAllGlobals()` в `afterEach`; RTL `cleanup()` — тоже вручную в
  `afterEach` (авто-cleanup RTL требует глобальных хуков теста, которых нет).
  См. `src/App.test.tsx` как образец.
- **Dockerfile/nginx** — если 011–016 добавят зависимости
  (роутер/CodeMirror/HTTP-клиент), Dockerfile трогать не нужно: builder уже
  ставит `npm ci` по корневому lockfile и `npm run build -w
  @trellis/frontend`, любые новые зависимости в `services/frontend/package.json`
  подхватятся автоматически.

## Вывод команд

### `npm run build -w @trellis/frontend`

```
> build
> tsc -b && vite build

vite v8.3.0 building client environment for production...
transforming...
✓ 16 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-cX2Q4vq5.css    1.20 kB │ gzip:  0.53 kB
dist/assets/index-eTiJ54up.js   220.59 kB │ gzip: 69.09 kB
✓ built in 68ms
```

### `npm test -w @trellis/frontend`

```
> test
> vitest run

 RUN  v5.0.1 /Users/vadim/Documents/Pet/trellis/services/frontend

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

4/4 реально исполненных теста (loading, успешный health-чек, сетевая
ошибка — error path, HTTP 500 — edge case). `jsdom@30.0.1` печатает
`EBADENGINE`-предупреждение на локальном Node v22.16.0 (пакет требует
`^22.22.2`/`^24.15.0`/`>=26`) — это warning, не блокирует установку и не
ломает исполнение: тесты реально запускаются и проходят (vitest использует
свой собственный движок поверх esbuild/vite, а не нативный Node
type-stripping, в отличие от backend'а — см. ниже в Deferred decisions).

### `bash .mvp/ci-mirror.sh`

Полный прогон с чистого дерева (`npm ci` → `lint` → `build` → `test` по
всем workspaces): exit code `0`. Backend — 9/9 тестов зелёных (как и в
задаче 003), frontend — 4/4 зелёных, lint и build у обоих workspaces без
ошибок.

### `docker compose config`

Проходит без ошибок на весь стек, включая `frontend` (Dockerfile теперь
существует). Образ не собирался физически (сборка долгая, по инструкции
координатора не требуется) — синтаксис Dockerfile/nginx.conf проверен
построчным ревью и успешным `tsc -b && vite build` локально (тот же шаг,
что выполняет builder-стадия).

## Deferred decisions

- **`tsconfig.json` переопределяет `module: ESNext` / `moduleResolution:
  bundler` поверх базового `NodeNext`/`NodeNext`** — база (задача 001)
  настроена под Node-рантайм бэкенда (`services/backend`), где относительные
  импорты между `.ts`-файлами должны резолвиться так, как их резолвит
  реальный Node/`tsc`-compiled output. Frontend никогда не исполняется
  Node'ом напрямую — Vite (esbuild/rollup) сам резолвит и бандлит модули, и
  `moduleResolution: bundler` (официальный режим TS 5+ именно под
  Vite/webpack/esbuild) — идиоматичный выбор, который снимает необходимость
  писать искусственные `.ts`/`.js`-специфайеры в импортах (то, через что
  backend уже проходил в задаче 003 и в итоге отказался). Бриф прямо не
  запрещал это переопределение (перечислял только обязательные поля), только
  просил «не дублировать базу без необходимости» — здесь необходимость
  прямая: без него `tsc -b` требует расширений на относительных импортах
  React-компонентов, что противоречит стандартной практике Vite.
- **`useEffect` + `fetch` напрямую в `App.tsx`, без TanStack Query** —
  формально это anti-pattern из роли (`useEffect(() => fetch(...), [])`
  запрещён явно). Осознанное отступление: бриф этой задачи фиксирует список
  зависимостей дословно и явно исключает HTTP-клиент/query-библиотеку
  («ничего сверх этого... придут в своих задачах 011, 015»), значит
  `@tanstack/react-query` физически недоступен в этой границе. `App.tsx`
  сейчас — единственный компонент, единственный fetch, `AbortController` на
  unmount — минимально приемлемая замена на время, пока это скелет, а не
  готовый UI прохождения курса. Задачи 011/015, заводя себе HTTP-клиент и
  query-библиотеку, должны заменить этот `useEffect` на `useQuery`.
- **eslint.config.mjs без `eslint-plugin-react-hooks`/`eslint-plugin-react-refresh`,
  browser-глобалы прописаны вручную (без пакета `globals`)** — все три
  пакета отсутствуют в зафиксированном брифом списке зависимостей
  («ничего сверх этого»). Вместо пакета `globals` — точечный список
  реально используемых identifiers (`window`, `document`, `fetch`,
  `console`, `AbortController`) в `languageOptions.globals` для
  `src/**/*.{ts,tsx}`. Если 011+ заведут `eslint-plugin-react-hooks` — это
  их решение и их зависимость, эта задача сознательно её не добавляет.
- **Тесты без `@testing-library/jest-dom`** — не в списке зависимостей
  брифа. Ассерты на текст статуса — через `element.textContent` +
  `toContain(...)`, RTL `cleanup()` и `vi.unstubAllGlobals()` — вручную в
  `afterEach` (без `globals: true` в vitest-конфиге — тоже не требовалось
  брифом, оставлено явным во избежание неявных глобалов теста, раз
  дополнительных договорённостей по этому пункту не было).
- **`services/frontend/.gitignore` с `tsconfig.tsbuildinfo`** — `tsc -b`
  (используется в `build`-скрипте по требованию брифа) всегда пишет
  incremental build-info файл рядом с tsconfig, даже при `noEmit: true`.
  Корневой `.gitignore` не знает этого имени и вне моей границы —
  локальный `.gitignore` (паттерн, уже использованный `services/backend` в
  задаче 003 для `dist-test/`) решает то же самое без выхода за границу.
- **`process.env.VITE_BACKEND_ORIGIN` в `vite.config.ts` вместо жёстко
  зашитого `http://127.0.0.1:3001`** — сам файл исполняется Vite в Node на
  машине разработчика (не в браузере, не в контейнере), поэтому это не
  нарушает правило «никаких абсолютных адресов backend в коде» (которое
  относится к коду, исполняемому в браузере/контейнере, т.е. `src/**`) —
  позволяет разработчику указать другой порт backend без правки файла;
  дефолт совпадает с контрактом задачи 003 (`127.0.0.1:3001`).

## Проверка границы

`git status --porcelain` вне `services/frontend/**`,
`package.json`/`package-lock.json` (корень) не показывает никаких изменений
от этой задачи (`.mvp/plan.json`, `.mvp/telemetry/events.jsonl`,
`.mvp/briefs/task-005.md`, `.mvp/briefs/task-006.md` — не мои правки,
принадлежат планировщику, существовали до старта этой задачи).

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

