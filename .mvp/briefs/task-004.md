# Task 004 — скелет frontend (React SPA на Vite)

## Task

Поднять скелет frontend'а Trellis: React SPA на Vite + TypeScript, dev-proxy на
API backend, Dockerfile с отдачей статики. UI прохождения курса делают задачи
011–016 — здесь только каркас, который стартует и доказуемо ходит в backend.

### Требования (значения — дословно)

1. **`services/frontend/package.json`**
   - `"name": "@trellis/frontend"`, `"private": true`, `"type": "module"`
   - scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`,
     `"preview": "vite preview"`, `"lint": "eslint ."`,
     `"test": "vitest run"`
   - зависимости: `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`,
     `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `jsdom`,
     `@testing-library/react`. Ничего сверх этого — CodeMirror, роутер и
     HTTP-клиент придут в своих задачах (011, 015).
   - ставь зависимости из корня (`npm install <pkg> -w @trellis/frontend`),
     корневой `package-lock.json` обновится — это ожидаемо (`BOUNDARY_EXEMPT`)

2. **`services/frontend/tsconfig.json`** — `extends: "../../tsconfig.base.json"`,
   плюс то, что нужно React+Vite: `"jsx": "react-jsx"`, `"lib"` с `"DOM"`,
   `"types": ["vite/client"]`, `"noEmit": true`, `include: ["src"]`.
   Базу не дублируй — переопределяй только необходимое.

3. **`services/frontend/eslint.config.mjs`** — импортирует корневой
   `eslint.config.mjs` и добавляет своё (как именно — см. отчёт задачи 001).

4. **`services/frontend/vite.config.ts`**
   - плагин React
   - dev-сервер: `server.port = 3000`, `server.host = '127.0.0.1'`
   - **dev-proxy**: `server.proxy['/api'] → http://127.0.0.1:3001` (адрес
     backend'а переопределяем переменной окружения, дефолт — этот)
   - `test` (vitest): окружение `jsdom`

5. **`services/frontend/index.html`** + **`src/main.tsx`** + минимальный
   `src/App.tsx`:
   - заголовок страницы — `Trellis`
   - App показывает состояние связи с backend: запрос `GET /api/health`
     (через dev-proxy / относительный путь — **никогда** абсолютный
     `http://localhost:3001`, иначе в контейнере сломается) и человекочитаемый
     текст «связь с ядром есть / нет», плюс состояние загрузки
   - Базовая тема — минималистичная, мягкие зелёные тона (полноценный layout —
     задача 011; здесь достаточно css-переменных палитры и чистого фона)

6. **`services/frontend/Dockerfile`** — multi-stage, контекст сборки — **корень
   репозитория** (так настроен compose в задаче 002):
   - builder: `node:22-alpine`, корневые `package.json`/`package-lock.json` +
     `services/frontend/package.json`, `npm ci`, исходники,
     `npm run build -w @trellis/frontend`
   - runtime: `nginx:alpine`, статика из `dist` в `/usr/share/nginx/html`,
     слушает **порт 80** (compose публикует его как `127.0.0.1:3000:80`)
   - конфиг nginx внутри образа: SPA-fallback (`try_files $uri /index.html`) и
     **проксирование `/api/` на `http://backend:3001/`** — в проде dev-proxy
     Vite не работает, а frontend обязан ходить в backend только по HTTP API
   - Образ собирать не требуется (docker-сборка долгая), но синтаксис держи
     рабочим

7. **Тесты** (vitest + Testing Library, внутри границы): App показывает
   состояние загрузки, затем «связь есть» при успешном `/api/health` и
   «связи нет» при ошибке (fetch мокается).

### Готов когда

- `npm run build -w @trellis/frontend` проходит
- `npm test -w @trellis/frontend` зелёный
- `bash .mvp/ci-mirror.sh` завершается кодом 0
- `git status` не показывает изменений вне `services/frontend/**`, корневых
  `package.json`/`package-lock.json` и твоего отчёта

## Boundary

`services/frontend` (+ корневые `package.json`/`package-lock.json`, отчёт
`.mvp/reports/task-004.md`).
НЕ трогай `services/backend/**`, `docker-compose.yml`, `docker/**`,
`tsconfig.base.json`, корневой `eslint.config.mjs`, `.github/**`.

## Interfaces from dependencies

Задача 001 (корень монорепозитория) — см. `.mvp/reports/task-001.md`.
Backend (задача 003) пишется параллельно; тебе от него нужен только контракт:
`GET /health` → `200 {"status":"ok"}`, порт `3001`. Через прокси со стороны
frontend это `GET /api/health` (префикс `/api` снимается прокси).

## Общий контракт проекта (соблюдать)

- Node 22, TypeScript ESM, strict.
- Порты: frontend dev — `3000` на `127.0.0.1`; в контейнере nginx — `80`,
  публикуется как `127.0.0.1:3000:80`.
- Frontend обращается к API **только относительными путями** с префиксом `/api`.
- Тест-раннер frontend — vitest (jsdom).
- Палитра — мягкие зелёные тона, минимализм.

## Project invariants

Полный список — `.mvp/invariants.md`. Критичное здесь:

- `FORBIDDEN_EDGE: frontend --> postgres` и `frontend --> sandbox`: никаких
  драйверов БД и строк подключения во frontend — только HTTP API backend.
- Ядро специальность-агностично: никакого хардкода конкретного курса в UI.
- Всё локально: никаких внешних CDN, шрифтов и аналитики — сборка обязана
  работать без интернета у пользователя.
