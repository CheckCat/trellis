## Task
- id: 014
- title: Реализовать UI квиза: выбор варианта, подсветка неверного с объяснением, неограниченные попытки и визуальное подтверждение верного ответа.
- level: 7
- service: frontend
- service_path: services/frontend
- role: frontend-implementer
- files: services/frontend/src/features/quiz/QuizView.tsx, services/frontend/src/features/quiz/AnswerOption.tsx, services/frontend/src/features/quiz/useQuiz.ts
- depends_on: 011
- estimate_tokens: 14000
- status: pending
- complexity_class: follow-pattern

## Boundary
services/frontend

## Interfaces from dependencies
### 011
# Task 011 — каркас SPA (роутинг, типизированный HTTP-клиент, layout, тема) — отчёт

## Что создано

- `services/frontend/src/api/types.ts` — типы ответов backend API, дословно
  повторяющие JSON Schema `services/backend/src/routes/{health,courses}.ts`:
  `HealthResponse`, `CourseSummary`, `CoursesListResponse`,
  `CourseLessonSummary`, `CourseModuleSummary`, `CourseDetailResponse`,
  `ApiErrorResponse`.
- `services/frontend/src/api/client.ts` — единственная точка `fetch` в
  приложении:
  - `ApiError extends Error` — `status: number`, `body: unknown`, `message`
    берётся из `body.message`, если тело — `ApiErrorResponse`.
  - `apiFetch<T>(path, init?)` (не экспортируется) — всегда
    `fetch("/api" + path, ...)` (тот же относительный контракт, что
    зафиксирован в отчёте задачи 004: срез `/api` — на dev-proxy и на
    nginx, клиент об этом не знает).
  - Экспорт `api = { getHealth(), listCourses(), getCourse(courseId) }` —
    типизированные обёртки. **Расширяемый паттерн**: 013–016, которым
    понадобятся progress/quiz/practice/transfer-эндпоинты, добавляют свои
    методы сюда же, а не делают отдельные `fetch` в компонентах.
- `services/frontend/src/ui/theme.css` — палитра (`:root { --color-* }`),
  перенесена без изменений значений из `src/index.css` задачи 004 (те же
  10 токенов, тот же интерфейсный контракт, что описан в её отчёте).
- `services/frontend/src/index.css` — теперь: `@import "./ui/theme.css";` +
  резеты + структурные классы шелла (`app-shell`, `app-header`,
  `app-title`, `app-content`), статус-индикатор (`status-row`,
  `status-dot(--connected|--disconnected)`, `status-label` — те же имена,
  что были в задаче 004, переиспользованы), и универсальные классы списков
  карточек (`card-list`, `card-list-item`), заголовка страницы
  (`page-heading`) и второстепенного текста (`muted-note`). Новые страницы
  (013+) могут переиспользовать `card-list`/`page-heading`/`muted-note`
  вместо изобретения своих классов на глаз.
- `services/frontend/src/ui/Layout.tsx`:
  - `export function HealthIndicator()` — health-check через
    `useQuery({ queryKey: ["health"], queryFn: api.getHealth, staleTime:
    Infinity, retry: false })`; заменяет `useEffect+fetch` из задачи 004
    (её же deferred decision прямо просил это сделать, как только появится
    query-библиотека). Экспортирован отдельно — тестируется без роутера.
  - `export function Layout()` — `<div className="app-shell"><header
    className="app-header"><Link to="/">Trellis</Link>
    <HealthIndicator/></header><main className="app-content"><Outlet
    /></main></div>`. Это `component` корневого роута — каждая страница
    получает общий header бесплатно.
- `services/frontend/src/routes.tsx` — дерево роутов на `@tanstack/react-router`
  (code-based API, без file-based роутинга и без vite-плагина — ничего
  дополнительно генерировать не нужно):
  - `rootRoute` (`component: Layout`)
  - `indexRoute` (`path: "/"`, `component: CoursesIndexPage`) — список
    курсов через `useQuery(["courses"], api.listCourses)`, каждая карточка
    — `<Link to="/courses/$courseId" params={{courseId}}>`.
  - `courseRoute` (`path: "/courses/$courseId"`, `component:
    CourseDetailPage`) — `courseRoute.useParams()` → `courseId`,
    `useQuery(["course", courseId], () => api.getCourse(courseId))`,
    рендерит заголовок/описание курса и список модулей (только названия и
    число уроков — интерактивная навигация по урокам/статусам/markdown/
    отметка «пройдено» осознанно НЕ реализована здесь, это задача 013).
  - `NotFoundPage` — подключён как `defaultNotFoundComponent`.
  - `export function createAppRouter(history?: RouterHistory)` — фабрика
    (а не единственный синглтон), чтобы тесты могли передать
    `createMemoryHistory(...)` вместо реального browser history.
    `export const router = createAppRouter()` — то, что использует
    `App.tsx`.
  - `declare module "@tanstack/react-router" { interface Register { router:
    typeof router } }` — регистрирует типы роутов глобально (`Link`'s
    `to`/`params` и `useParams()` проверяются типом везде в приложении).
- `services/frontend/src/App.tsx` — теперь тонкая обёртка:
  `QueryClientProvider` (один `new QueryClient()` вне компонента) +
  `RouterProvider router={router}`. Никакой собственной бизнес-логики
  больше не несёт (в отличие от версии задачи 004, которая сама делала
  health-check) — App.tsx свободен для 013+ без риска конфликта.
- `services/frontend/src/App.test.tsx` — переписан: интеграционный тест
  роутинга (не health-check, тот переехал в `Layout.test.tsx`). 4 теста:
  переход home → course detail по клику на `Link` (happy path,
  `@testing-library/user-event`), 404 для неизвестного маршрута (edge
  case), ошибка сети/500 на списке курсов (error path), 404 от backend на
  конкретный `courseId` (edge case).
- `services/frontend/src/ui/Layout.test.tsx` — 4 теста `HealthIndicator`
  (loading / connected / сетевая ошибка / degraded-503), тот же паттерн
  моков, что был в задаче 004 (`vi.stubGlobal("fetch", ...)`,
  `vi.unstubAllGlobals()`/`cleanup()` вручную в `afterEach`, без
  `@testing-library/jest-dom` — ассерты через `.textContent` +
  `toContain(...)`).

## Новые зависимости (`services/frontend/package.json`)

| Пакет | Версия | Назначение |
|---|---|---|
| `@tanstack/react-router` | `^1.170.38` | типизированный роутинг (code-based API, без плагина) |
| `@tanstack/react-query` | `^5.103.1` | серверное состояние (замена `useEffect+fetch` из задачи 004) |
| `@testing-library/user-event` (dev) | `^14.6.7` | `userEvent` вместо `fireEvent` в тестах роутинга (роль явно требует) |

Установлены через `npm install ... -w @trellis/frontend` — `package.json`/
`package-lock.json` в корне обновлены (`BOUNDARY_EXEMPT`, ожидаемо).
`Dockerfile`/`nginx.conf` трогать не понадобилось (builder уже ставит
`npm ci` по корневому lockfile — см. интерфейсный дайджест задачи 004).

## Интерфейсный дайджест для задач 013–016

- **Типизированный клиент**: импортируйте `import { api } from
  "../api/client"` (или `./api/client` в зависимости от глубины), методы —
  `api.getHealth()`, `api.listCourses()`, `api.getCourse(courseId)`.
  Добавляя свой эндпоинт — новый метод в объект `api` этого же файла, не
  отдельный `fetch` в компоненте. Ошибки — `ApiError` (`status`, `body`,
  `message`); `body` типизируйте через `instanceof ApiError` + сужение по
  ожидаемой форме `ApiErrorResponse` (`error`/`message`) при необходимости
  различать код ошибки (`course_not_found` и т.п. — см. отчёты задач
  006/007).
- **Роуты**: `src/routes.tsx` экспортирует `router` (используется в
  `App.tsx`) и `createAppRouter(history?)` (для тестов). Текущее дерево:
  `/` (список курсов) и `/courses/$courseId` (детали курса — сейчас только
  название/описание/список модулей). Задаче 013 нужно **расширить** это
  дерево дочерним роутом урока, например `/courses/$courseId/lessons/$lessonId`,
  через `createRoute({ getParentRoute: () => courseRoute, path:
  "/lessons/$lessonId", component: LessonPage })` и добавить его в
  `courseRoute` или в `rootRoute.addChildren([...])` (courseRoute сейчас не
  имеет `addChildren` — если 013 делает урок дочерним для courseRoute,
  нужно переписать `courseRoute` на `.addChildren([lessonRoute])` и
  подключить получившееся дерево в `routeTree`, а не плодить параллельный
  плоский роут). Также стоит заменить текущий статичный список модулей в
  `CourseDetailPage` на настоящую интерактивную навигацию — это и есть
  задача 013, `CourseDetailPage` можно смело переписывать целиком.
  `courseRoute.useParams()` — образец получения `$courseId` типобезопасно;
  так же можно навесить `.useParams()` на новый `lessonRoute`.
- **Layout**: `<Layout>` — общий header на каждой странице, ничего менять
  не нужно, если только не требуется добавить туда что-то новое (например,
  кнопку «домой»/breadcrumbs) — делать это в `Layout.tsx`, не дублировать
  header в отдельных страницах.
- **Тема**: токены — `src/ui/theme.css`, тот же набор
  (`--color-bg/surface/border/text/text-muted/accent/accent-soft/status-*`),
  без изменений. Общие CSS-классы для карточек/списков/заголовков — в
  `src/index.css` (`card-list`, `card-list-item`, `page-heading`,
  `muted-note`) — переиспользуйте вместо новых классов, если подходит по
  смыслу; специфичные для страницы стили — в самой странице/компоненте.
- **Тестовый паттерн для страниц с роутингом**: смотрите
  `App.test.tsx` — `createAppRouter(createMemoryHistory({ initialEntries:
  [...] }))` + `QueryClientProvider` (с `retry: false` в
  `defaultOptions.queries`) + `RouterProvider`; клик по ссылке —
  `@testing-library/user-event` (`userEvent.setup()` + `await
  user.click(...)`), не `fireEvent`. Для компонентов без роутинг-контекста
  (как `HealthIndicator`) — смотрите `Layout.test.tsx`, там роутер вообще
  не нужен.

## Deferred decisions

- **TanStack Router (code-based API), а не React Router 7.** Роль явно
  предпочитает TanStack Router; React Router 7 — fallback. Код-based API
  (без file-based роутинга/vite-плагина) выбран, чтобы не тянуть
  `@tanstack/router-plugin` и codegen ради двух роутов — минимально
  необходимый способ получить типизированные `to`/`params`.
- **`@tanstack/react-query` добавлен в этой задаче**, хотя явно не назван
  в списке файлов брифа. Обоснование: (1) роль прямо запрещает
  `useEffect(() => fetch(...), [])` для серверного состояния как
  anti-pattern; (2) отчёт задачи 004 сам зафиксировал это как временное
  отступление, дословно указав, что задачи 011/015 должны завести
  query-библиотеку и заменить `useEffect` в `App.tsx`. Не добавить её
  сейчас значило бы или продолжать anti-pattern в `HealthIndicator`, или
  переложить решение на 013+ без явного повода — задача 011 и есть тот
  повод.
- **`@testing-library/user-event` добавлен** — та же логика: роль явно
  предпочитает `userEvent` вместо `fireEvent`, а тест на переход по
  ссылке — первое место в проекте, где реально нужен клик, а не просто
  рендер.
- **`CourseDetailPage` показывает только заголовок/описание и список
  названий модулей (без уроков/статусов/markdown/кнопки «пройдено»)** —
  сознательно минимально: полная навигация по курсу — предмет задачи 013.
  Цель этой реализации — доказать, что маршрут `$courseId`, типизированный
  клиент и layout работают вместе на реальных данных, не предвосхищать
  013's UI.
- **`courseRoute` без дочерних роутов** — 013 либо добавит
  `courseRoute.addChildren([lessonRoute])` и подключит обновлённое дерево,
  либо (если решит иначе организовать урок — например, отдельным top-level
  путём) сама выберет форму; текущее дерево не проектирует вперёд то, чего
  ещё нет данных обосновать.
- **`Link`'s accessible name в домашней странице включает описание
  курса** (`<h3>{title}</h3><p>{description}</p>` внутри одного `<a>`) —
  тест ищет `getByRole("link", { name: /Course One/ })` регулярным
  выражением (частичное совпадение), а не точным текстом — устойчиво к
  тому, что 013 может изменить разметку карточки, не ломая семантику
  «это ссылка на курс с таким названием».

## Проверки — реальный вывод

### `npm run build -w @trellis/frontend`

```
> tsc -b && vite build
✓ 153 modules transformed.
dist/assets/index-7kiBZnCK.js   330.72 kB │ gzip: 104.97 kB
✓ built in 105ms
```

### `npx eslint .` (в `services/frontend`)

`ESLint: No issues found`

### `npx vitest run` (в `services/frontend`)

`Test Files  2 passed (2)` / `Tests  8 passed (8)` — `App.test.tsx` (4:
happy path перехода по ссылке, 404-роут, 500 на списке курсов, 404 на
конкретный курс) + `Layout.test.tsx` (4: loading/connected/error/503).
(`Not implemented: Window's scrollTo()` — безвредный jsdom-варнинг от
встроенного scroll-restoration роутера, не влияет на результат тестов.)

### `bash .mvp/ci-mirror.sh`

Прогнан трижды подряд (включая после финальной правки комментария) — код
`0` каждый раз. Backend: `# tests 210 / # pass 210 / # fail 0`. Frontend:
`Test Files 2 passed (2)` / `Tests 8 passed (8)`.

### `docker compose config`

Код `0` — весь стек, включая новые зависимости frontend (сборка образов не
запускалась — Dockerfile не менялся, `npm ci` по корневому lockfile
подхватит новые пакеты автоматически, как и в задаче 004).

## Проверка границы

`git status --porcelain` — изменения только под `services/frontend/**`
(`App.tsx`, `App.test.tsx`, `index.css`, новые `api/`, `ui/`, `routes.tsx`)
+ `package.json`/`package-lock.json` (корень, `BOUNDARY_EXEMPT`) + этот
отчёт. `.mvp/ledger.md` и `.mvp/briefs/task-011.md` — не мои правки,
существовали/менялись до старта этой задачи (принадлежат планировщику).

## Fix round (review findings)

- **fixed — `services/frontend/src/routes.tsx:83`, `CourseDetailPage`'s
  `isError` branch showed "course not found" for any query failure.**
  Confirmed: `apiFetch` (`api/client.ts`) throws `ApiError` for *every*
  non-2xx response — network failures surface as a rejected fetch, but any
  backend 5xx also becomes an `ApiError` with `status` ≥ 500 — while
  `GET /courses/:courseId`'s handler (`services/backend/src/routes/courses.ts`)
  only returns 404 with `error: "course_not_found"` for a genuinely missing
  course. The old code collapsed all of these into one "не найден" message,
  unlike `CoursesIndexPage`'s sibling branch which correctly shows a generic
  failure message for the same failure class. Fixed by narrowing: only
  `error instanceof ApiError && error.status === 404` shows the "not found"
  message; every other error now shows "Не удалось загрузить курс." (same
  wording pattern as `CoursesIndexPage`). Imported `ApiError` from
  `./api/client` (already exported there for exactly this purpose, per
  `client.ts`'s own doc comment). `bash .mvp/ci-mirror.sh` → exit 0 (backend
  210/210 tests pass, frontend 8/8 tests pass, lint/build clean).

- **fixed — `services/frontend/src/ui/Layout.tsx:28`, dead
  `data?.status !== "ok"` branch in `HealthIndicator`'s state calculation.**
  Confirmed by reading `services/backend/src/routes/health.ts`: the 200
  response schema requires `status: { enum: ["ok"] }` (only value possible
  on success) and the 503 path returns `status: "degraded"` with HTTP 503 —
  which makes `apiFetch` throw before `data` is ever assigned. So once
  `isPending` is false, `data` is either `undefined` (error path, already
  covered by `isError`) or `{ status: "ok" }` (success path) — the
  `data?.status !== "ok"` comparison can never independently flip the
  branch away from what `isError` alone already decided. Simplified to
  `isError ? "disconnected" : "connected"` and dropped the now-unused
  `data` destructure (ESLint's `no-unused-vars` caught this immediately,
  confirming it really was dead). Added a comment recording why the
  simpler form is correct, for future readers who might reflexively want to
  defend-in-depth around `data.status`. `bash .mvp/ci-mirror.sh` → exit 0.

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

