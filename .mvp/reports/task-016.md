# Task 016 — UI переноса прогресса (экспорт/импорт) — отчёт

## Что создано

- `services/frontend/src/features/transfer/TransferPage.tsx` — страница
  `/transfer`: секция «Экспорт» (кнопка «Скачать файл прогресса») + секция
  «Импорт» (рендерит `ImportDialog`).
  - `exportFileName(exportedAt)` — воспроизводит алгоритм backend'а
    `progressExportFileName` (`services/backend/src/transfer/format.ts`)
    байт-в-байт: `.replace(/\.\d+Z$/, "Z").replace(/:/g, "-")`, чтобы имя
    файла не зависело от заголовка `content-disposition` (клиент на `fetch`
    его не видит/не использует — так и задумано в отчёте задачи 010:
    «a fetch-based client (task 016) ignores it and names its own
    download»).
  - `downloadFile(file)` — `Blob` → `URL.createObjectURL` → временный
    `<a download>` → `.click()` → `remove()` → `URL.revokeObjectURL`.
  - `useMutation({ mutationFn: api.exportProgress, onSuccess: downloadFile })`
    — состояние `isPending`/`isError` рендерится тем же паттерном, что и
    остальные мутации в проекте (`ApiError` → `.message`, иначе дженерик
    текст).
- `services/frontend/src/features/transfer/ImportDialog.tsx` — выбор файла
  (`<input type="file" accept="application/json,.json">`) → чтение через
  `File.text()` + `JSON.parse` (клиентская проверка — только «это вообще
  JSON-объект»; вся содержательная валидация — на сервере,
  `parseProgressExport`, единственный источник истины) → `POST
  /progress/import`.
  - Три исхода, различаются по `ApiError.status`:
    - **200** (`importMutation.isSuccess`) — счётчики
      (`created`/`earlierCompletions`/`unchanged`) + список
      `coursesNotInstalled`, если есть.
    - **409** (`import_older_than_local`, файл старше локального прогресса
      И реально что-то изменил бы) — текст предупреждения
      (`error.message`, ровно то, что прислал backend) + тот же блок
      счётчиков (preview) + кнопка «Импортировать всё равно» (повторяет
      запрос с `confirm: true`, используя `importMutation.variables.file` —
      TanStack Query v5 не очищает `variables` при переходе в `error`,
      только при следующем `mutate()`/`reset()`) + «Отмена»
      (`importMutation.reset()`, возврат к выбору файла).
    - **400** (`invalid_export_file`/`unsupported_export_version`) —
      `error.message` + список `problems` (по одной фразе на проблему, как
      прислал сервер).
    - Любая другая ошибка (сеть, 5xx) — общий текст «Не удалось
      импортировать файл...».
  - На успех (в том числе после подтверждённого stale-импорта) —
    `queryClient.invalidateQueries({ queryKey: ["courseProgress"] })` без
    привязки к конкретному `courseId` (импорт мог затронуть любое число
    курсов) — тот же паттерн префиксного инвалидирования, что уже
    использует `useQuiz`/`usePractice`/`LessonView`.

## Изменения существующих файлов

- `services/frontend/src/api/types.ts` — добавлены типы, зеркалящие
  `services/backend/src/transfer/{format,import}.ts` и
  `routes/transfer.ts`'s JSON Schemas: `ExportedLessonProgress`,
  `ExportedCourseProgress`, `ProgressExportFile`, `ImportCourseSummary`,
  `ImportTotals`, `ImportResult` (тело 200 и 409, `applied` их различает),
  `ImportStaleWarning` (`ImportResult & {error: "import_older_than_local";
  message: string}` — форма 409), `ImportRejection` (форма 400: `error`,
  `message`, `problems: string[]`).
- `services/frontend/src/api/client.ts` — два новых метода в `api`:
  - `exportProgress(): Promise<ProgressExportFile>` — `GET /progress/export`.
  - `importProgress(file, options?: {confirm?: boolean}):
    Promise<ImportResult>` — `POST /progress/import[?confirm=true]`, тело —
    сам файл (`JSON.stringify(file)`), без обёртки. На 409/400 бросает
    `ApiError` как всегда (`apiFetch` бросает на любой non-2xx) — вызывающая
    сторона узнаёт исход по `error.status`, тело — по `error.body` (типы
    выше).
- `services/frontend/src/routes.tsx` — новый top-level роут `transferRoute`
  (`path: "/transfer"`, `component: TransferPage`), добавлен в
  `rootRoute.addChildren([indexRoute, courseRoute, lessonRoute,
  transferRoute])`.
- `services/frontend/src/ui/Layout.tsx` — в хедере, рядом с заголовком,
  добавлен постоянный `<nav className="app-nav"><Link
  to="/transfer">Перенос прогресса</Link></nav>` — единственная точка входа
  на страницу переноса, видна на каждой странице приложения (страница
  переноса иначе была бы недостижима из UI).
- `services/frontend/src/index.css` — новые классы: `.app-nav` (хедер),
  `.transfer-section` (карточка секции экспорта/импорта, тот же визуальный
  язык что `.practice-view`), `.import-file-label`, `.import-summary`,
  `.import-warning` (акцент `--color-status-pending`, как «требует
  решения»), `.import-rejection` (акцент `--color-status-error`). Кнопки
  внутри переиспользуют существующие `.mark-done-button` /
  `.reset-sandbox-button` — новых классов кнопок не заводилось.

## Интерфейсный дайджест

- `api.exportProgress()` / `api.importProgress(file, {confirm})` — единая
  точка входа для transfer-эндпоинтов, как и весь остальной API-клиент
  (`api/client.ts`'s doc comment: «add methods here rather than calling
  `fetch` directly from a component»).
- Типы `ProgressExportFile`/`ImportResult`/`ImportStaleWarning`/
  `ImportRejection` в `api/types.ts` — при появлении новой задачи, которой
  нужно показать/разобрать файл прогресса (например, отдельный
  предпросмотр без реального импорта), эти типы уже есть, дублировать не
  нужно.
- Маршрут: `/transfer` (top-level, соседний с `/` и `/courses/$courseId`,
  не вложен никуда). Ссылка на него — в `Layout`'а хедере, не на
  `CoursesIndexPage` — так что доступна с любой страницы.

## Проверки — реальный вывод

### `npx tsc -b` / `npx eslint .` (в `services/frontend`)

Без ошибок и замечаний.

### `npx vitest run` (в `services/frontend`)

`Test Files 12 passed (12)` / `Tests 43 passed (43)` — из них 6 новых
(`TransferPage.test.tsx`: happy path скачивания с проверкой точного имени
файла + error path; `ImportDialog.test.tsx`: happy path импорта +
инвалидация кэша, edge case — нечитаемый JSON без обращения к сети, error
path — 409-предупреждение → подтверждение → успех + повторная инвалидация,
400-отклонение со списком `problems`).

Находка в процессе написания тестов: `@testing-library/user-event`'s
`upload()` фильтрует файлы по атрибуту `accept` инпута (как это делает
реальный OS file picker) — тест на «файл не JSON» первоначально давал
`.txt`/`text/plain`, который `user-event` тихо отбрасывал (событие `change`
не долетало до компонента вовсе), из-за чего первая попытка теста зависала
на `waitFor`. Исправлено: тестовый файл — `.json`/`application/json` с
невалидным содержимым внутри.

### `npm run build -w @trellis/frontend`

`tsc -b && vite build` — `0`, `349 modules transformed`. Предупреждение
vite про размер чанка (`> 500 kB`) — существовало до этой задачи
(SqlEditor/CodeMirror), не расследовалось (вне границы задачи).

### `bash .mvp/ci-mirror.sh`

Код `0` (первый прогон упал на старте одноразового Postgres — транзиентная
проблема поднятия контейнера, не связана с этой задачей; повторный прогон
— чисто). Backend: `# tests 217 / # pass 217 / # fail 0`. Frontend: `Test
Files 12 passed (12)` / `Tests 43 passed (43)`.

## Проверка границы

`git status --porcelain` — изменения только под `services/frontend/**`
(перечислены выше) плюс этот отчёт. `.mvp/ledger.md` (modified) и
`.mvp/briefs/task-016.md` (untracked) существовали до старта этой задачи —
не мои правки, принадлежат планировщику/диспатчеру.

## Deferred decisions

- **`ImportDialog` — не буквальный HTML `<dialog>`/модальное окно**, а
  инлайн-секция с пошаговым состоянием (выбор файла → результат/
  предупреждение). В проекте нет прецедента модальных окон, и продукт не
  требует именно модальности — многошаговый флоу («выбрал файл → увидел
  предупреждение → подтвердил») естественно ложится на условный рендер по
  состоянию одного `useMutation`, без порталов/фокус-трапов, которые внесли
  бы сложность без запрошенной пользы (KISS).
- **Клиентская валидация файла минимальна** (это JSON, это объект) —
  сознательно: дублировать `parseProgressExport`'ю логику на фронте значило
  бы поддерживать два источника истины о том, что такое валидный файл
  прогресса; сервер и так возвращает все проблемы разом
  (`problems: string[]`), которые рендерятся как есть.
- **`importMutation.variables` используется как хранилище «последнего
  выбранного файла» для кнопки подтверждения**, а не отдельный `useState` —
  подтверждено чтением исходника `@tanstack/query-core`'s `Mutation`
  reducer: `variables` не очищается при переходе в `error`, только новым
  `mutate()`/`reset()`. Один источник правды вместо двух совпадающих
  (anti-pattern «prop drilling через дублирующий state», которого явно
  просили избегать).
- **Ссылка на `/transfer` — в хедере (`Layout`), не на странице списка
  курсов** — транзит прогресса не привязан к конкретному курсу
  (экспортирует/импортирует прогресс по всем курсам сразу), поэтому место
  в общем хедере, видимое с любой страницы, точнее отражает область
  действия функции, чем размещение на `CoursesIndexPage`.

## Fix — ревью-находки

### minor: `ImportDialog.tsx:141` — переиспользование `mark-done-button`/`reset-sandbox-button`

**fixed.** Подтверждено при чтении: кнопки подтверждения/отмены
stale-импорта действительно использовали классы `mark-done-button`
(зачёт урока, `LessonView.tsx`) и `reset-sandbox-button` (сброс песочницы,
`PracticeView.tsx`) — совпадение чисто визуальное (тот же акцентный/
контурный стиль кнопки), связи по смыслу с импортом файла нет; находка
верна.

Фикс — не переименование существующих классов (это задело бы
`LessonView.tsx`/`PracticeView.tsx`, вне области находки), а добавление
собственных семантических имён для transfer-фичи, которые делят CSS-тело с
исходными через групповой селектор (сама декларация стиля одна, DRY не
нарушается):

- `services/frontend/src/index.css` — `.mark-done-button` →
  `.mark-done-button, .import-confirm-button` (и её `:disabled`);
  `.reset-sandbox-button` → `.reset-sandbox-button, .import-cancel-button`
  (и её `:disabled`); `.import-warning .mark-done-button` →
  `.import-warning .import-confirm-button` (override отступа теперь тоже
  адресует новый класс, а не старый).
- `services/frontend/src/features/transfer/ImportDialog.tsx` — кнопки
  «Импортировать всё равно»/«Отмена» теперь используют
  `import-confirm-button`/`import-cancel-button` вместо
  `mark-done-button`/`reset-sandbox-button`.

Визуальный результат не изменился (то же CSS-тело через групповой
селектор); классы в `LessonView.tsx`/`PracticeView.tsx` не трогались.

`bash .mvp/ci-mirror.sh` → код `0`: backend `# tests 217 / # pass 217 /
# fail 0`; frontend `Test Files 12 passed (12)` / `Tests 43 passed (43)`.
