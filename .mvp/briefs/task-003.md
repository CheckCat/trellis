# Task 003 — скелет backend на Fastify

## Task

Поднять скелет backend'а Trellis: конфиг из окружения, bind на 127.0.0.1 по
умолчанию, эндпоинт `/health`, Dockerfile. Это фундамент, на который лягут слой
данных (005) и реестр курсов (006) — бизнес-логики здесь нет.

### Требования (значения — дословно)

1. **`services/backend/package.json`**
   - `"name": "@trellis/backend"`, `"private": true`, `"type": "module"`
   - scripts: `"build": "tsc -p tsconfig.json"`, `"test": "node --test"`,
     `"lint": "eslint ."`, `"start": "node dist/server.js"`,
     `"dev"` — на твоё усмотрение (`tsx`/`node --watch`), зависимость не
     обязательна
   - зависимость: `fastify` (последний мажор). Ничего лишнего «на будущее».
   - зависимости ставь так, чтобы обновился корневой `package-lock.json`
     (`npm install <pkg> -w @trellis/backend` из корня) — это ожидаемо и
     границу не нарушает (`BOUNDARY_EXEMPT` в инвариантах)

2. **`services/backend/tsconfig.json`** — `extends: "../../tsconfig.base.json"`,
   `rootDir: "src"`, `outDir: "dist"`, `include: ["src"]`.

3. **`services/backend/eslint.config.mjs`** — импортирует корневой
   `eslint.config.mjs` и добавляет своё (см. отчёт задачи 001 — там
   зафиксировано, как именно переиспользуется корневой конфиг).

4. **`services/backend/src/config.ts`** — единственное место чтения `process.env`:
   - `HOST` (дефолт `127.0.0.1`), `PORT` (дефолт `3001`)
   - `DATABASE_URL`, `SANDBOX_DATABASE_URL` — строки подключения ролей
     приложения и песочницы; на этом этапе они читаются и валидируются как
     «задана непустая строка», но никто к БД не подключается (это задача 005)
   - `COURSES_DIR` (дефолт `/courses`)
   - Экспорт — типизированный неизменяемый объект конфига + функция разбора,
     которую можно вызвать в тесте с подставленным окружением. Отсутствие
     обязательной переменной — внятная ошибка при старте, не `undefined` где-то
     глубже.

5. **`services/backend/src/routes/health.ts`** — Fastify-плагин с `GET /health`,
   отвечает `200` и JSON `{ "status": "ok" }`. Проверок БД здесь нет (БД ещё не
   подключена); когда появится слой данных, задача 005 расширит ответ.

6. **`services/backend/src/server.ts`** — сборка приложения и запуск:
   - экспортируемая функция `buildServer()` (или `buildApp()`), возвращающая
     сконфигурированный Fastify-инстанс с зарегистрированными плагинами — она
     нужна тестам и задачам 005/006, которые будут довешивать свои плагины
   - отдельная точка входа, которая слушает `host`/`port` из конфига. Импорт
     модуля не должен сам по себе поднимать сервер.
   - логгер Fastify включён

7. **`services/backend/Dockerfile`** — multi-stage, контекст сборки — **корень
   репозитория** (так настроен compose в задаче 002):
   - builder: `node:22-alpine`, копирование корневых `package.json`,
     `package-lock.json` и `services/backend/package.json`, `npm ci`, копирование
     исходников, `npm run build -w @trellis/backend`
   - runtime: `node:22-alpine`, `NODE_ENV=production`, только prod-зависимости
     (`npm ci --omit=dev`), `dist`, `EXPOSE 3001`, `CMD ["node", "dist/server.js"]`
   - `.dockerignore` (в корне — он для контекста сборки; если его создала задача
     001, дополни, не переписывай): `node_modules`, `dist`, `.git`, `.env`
   - Образ не собираем как часть готовности (docker-сборка долгая); корректность
     проверяется задачей 018 и вручную. Но синтаксис держи рабочим.

8. **Тесты** (`node:test`, внутри границы): `/health` отвечает 200 и ожидаемым
   телом (через `app.inject()`, без реального listen); разбор конфига —
   дефолты, переопределение из окружения, внятная ошибка при отсутствии
   обязательной переменной.

### Готов когда

- `npm run build -w @trellis/backend` проходит
- `npm test -w @trellis/backend` зелёный
- `bash .mvp/ci-mirror.sh` завершается кодом 0
- `git status` не показывает изменений вне `services/backend/**`,
  корневых `package.json`/`package-lock.json`, `.dockerignore` и твоего отчёта

## Boundary

`services/backend` (+ корневые `package.json`/`package-lock.json` для установки
зависимостей, `.dockerignore`, отчёт `.mvp/reports/task-003.md`).
НЕ трогай `services/frontend/**`, `docker-compose.yml`, `docker/**`,
`tsconfig.base.json`, корневой `eslint.config.mjs`, `.github/**`.

## Interfaces from dependencies

Задача 001 (корень монорепозитория) — см. `.mvp/reports/task-001.md`:
корневой `tsconfig.base.json`, корневой flat-config ESLint, workspaces
`services/*`, набор корневых скриптов.

## Общий контракт проекта (соблюдать)

- Node 22, TypeScript ESM (`NodeNext`), strict.
- Backend внутри контейнера слушает `0.0.0.0:3001` (значение `HOST` приходит из
  compose), вне контейнера дефолт — `127.0.0.1`. Не хардкодь ни то, ни другое:
  читай из конфига.
- Порт backend — `3001`, эндпоинт здоровья — ровно `/health` (на него завязан
  healthcheck compose и скрипт запуска 018).
- Тест-раннер backend — встроенный `node:test`, без jest/vitest.
- Имена подключений: `DATABASE_URL` — роль `trellis_app`,
  `SANDBOX_DATABASE_URL` — роль `trellis_sandbox`.

## Project invariants

Полный список — `.mvp/invariants.md`. Критичное здесь:

- Ядро специальность-агностично: никакого знания о конкретном курсе в коде.
- Backend слушает только localhost; наружу порты не публикуются, внешних
  сервисов нет.
- Frontend ходит в backend только по HTTP API; прямых подключений к Postgres нет.
- Песочница — отдельная роль/схема: строку `SANDBOX_DATABASE_URL` нельзя
  использовать для запросов ядра (и наоборот). Здесь они только читаются.
