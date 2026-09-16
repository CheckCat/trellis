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
