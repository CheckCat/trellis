# Task 003 — скелет backend на Fastify — отчёт

## Что создано

- `services/backend/package.json` — `@trellis/backend`, `private: true`,
  `type: module`, скрипты `build`/`test`/`lint`/`start`/`dev` (дословно как в
  брифе, `dev` — `node --watch --experimental-strip-types src/server.ts`, без
  доп. зависимости). Зависимости: `fastify` (dependency), `@types/node`
  (devDependency) — установлены через `npm install ... -w @trellis/backend` из
  корня, обновили корневой `package-lock.json` (`BOUNDARY_EXEMPT`).
- `services/backend/tsconfig.json` — `extends: "../../tsconfig.base.json"`,
  `rootDir: "src"`, `outDir: "dist"`, `include: ["src"]`, плюс
  `exclude: ["src/**/*.test.ts"]` (тесты не попадают в `dist`) и 4
  compiler-опции, объясняющие себя комментарием в файле (см. Deferred
  decisions — `allowImportingTsExtensions`/`rewriteRelativeImportExtensions`/
  `erasableSyntaxOnly`/`verbatimModuleSyntax`), `types: ["node"]`.
- `services/backend/eslint.config.mjs` — `import base from "../../eslint.config.mjs"; export default [...base];`
  Без `parserOptions.project` — обоснование в самом файле и в Deferred
  decisions.
- `services/backend/src/config.ts` — единственное место чтения `process.env`.
  Экспортирует `interface AppConfig` (readonly `host`, `port`, `databaseUrl`,
  `sandboxDatabaseUrl`, `coursesDir`) и `parseConfig(env = process.env): AppConfig`
  — чистая функция, дефолты `HOST=127.0.0.1`/`PORT=3001`/`COURSES_DIR=/courses`,
  `DATABASE_URL`/`SANDBOX_DATABASE_URL` обязательны (непустая строка), `PORT`
  валидируется как целое 1–65535. Бросает `Error` с внятным сообщением
  (включает имя переменной) при отсутствии/невалидности. Возвращает
  `Object.freeze(...)`.
- `services/backend/src/routes/health.ts` — Fastify-плагин, `GET /health` →
  `200 { "status": "ok" }`, с response-схемой (plain JSON Schema, без TypeBox —
  зависимость не добавлялась).
- `services/backend/src/server.ts` — `buildServer(): FastifyInstance` (логгер
  включён, регистрирует `healthRoutes`, listen не вызывает) + отдельная точка
  входа, которая слушает только когда файл выполняется напрямую (guard через
  `import.meta.url === pathToFileURL(process.argv[1]).href`), там же
  `parseConfig()` вызывается один раз.
- `services/backend/src/config.test.ts`, `services/backend/src/routes/health.test.ts` —
  `node:test` (co-located с реализацией — обоснование ниже).
- `services/backend/Dockerfile` — multi-stage (`builder`/`runtime`, оба
  `node:22-alpine`), контекст — корень репозитория, буквально по пунктам
  брифа (builder: копирует корневые манифесты + `services/backend/package.json`,
  `npm ci`, копирует исходники, `npm run build -w @trellis/backend`; runtime:
  `NODE_ENV=production`, `npm ci --omit=dev`, копирует только `dist` из
  builder-стадии, `EXPOSE 3001`, `CMD ["node", "dist/server.js"]` из
  `WORKDIR /app/services/backend`). Образ не собирался (нет сетевого доступа
  к registry в этой песочнице, и по брифу не требуется) — проверено
  `docker compose config` (парсится без ошибок, ссылки на Dockerfile/context
  корректны) и вручную построчным ревью синтаксиса.
- `.dockerignore` (корень, не существовал) — `node_modules`, `dist`, `.git`,
  `.env`, ровно как в брифе.

## Версии зависимостей

| Пакет | package.json | Реально установлено |
|---|---|---|
| `fastify` | `^5.12.4` | 5.12.4 (последний мажор на момент установки) |
| `@types/node` | `^22.20.2` (devDependency) | 22.20.2 — сознательно закреплён на мажоре `22`, совпадающем с рантаймом (`node:22-alpine`, `engines.node: ">=22"`), а не на `latest` dist-tag (`^26.x`, который `npm install` подставляет по умолчанию для новых major-веток Node) |

`typescript`/`eslint`/`typescript-eslint` — не добавлялись в `services/backend/package.json`, используются hoisted из корневых devDependencies (workspaces), как и было зафиксировано в отчёте задачи 001.

## Интерфейсный дайджест для задач 005 и 006

- **`buildServer(): FastifyInstance`** (`services/backend/src/server.ts`) —
  создаёт Fastify-инстанс с `logger: true`, регистрирует текущие core-плагины
  (сейчас только `healthRoutes`), НЕ вызывает `listen()`. Задачи 005/006
  добавляют свои плагины тем же паттерном: `app.register(yourPlugin)` внутри
  `buildServer()`, до `return app;`. Импорт модуля безопасен — не поднимает
  сервер и не требует переменных окружения (см. ниже про `config.ts`).
- **Точка входа** — блок `if (isMainModule) { const config = parseConfig(); ... app.listen(...) }`
  в конце `server.ts`, выполняется только при `node dist/server.js` /
  `npm start` / `npm run dev`, никогда при импорте `buildServer`.
- **`services/backend/src/config.ts`** экспортирует:
  - `interface AppConfig { readonly host: string; readonly port: number; readonly databaseUrl: string; readonly sandboxDatabaseUrl: string; readonly coursesDir: string; }`
  - `parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig` — чистая
    функция, нет eager-синглтона на уровне модуля (см. Deferred decisions —
    почему). Если 005/006 нужен объект конфига в рантайме (например, для
    пула соединений или пути к `courses/`), вызывайте `parseConfig()` там,
    где реально нужно (например, в своём plugin-файле при регистрации, или
    один раз в `server.ts` и передавайте как аргумент/decorator своим
    плагинам) — паттерн на ваше усмотрение, `parseConfig()` идемпотентна и
    дешёвая.
  - Для тестов: `parseConfig({ ...validEnv, ЧТО_ПОДМЕНЯЕТЕ: "..." })` —
    substitute-объект, реальный `process.env` не трогается.
- **Паттерн теста через `app.inject()`** (см.
  `services/backend/src/routes/health.test.ts`):
  ```ts
  import { buildServer } from "../server.ts";

  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    // response.statusCode, response.json(), ...
  } finally {
    await app.close();
  }
  ```
  Реального сокета не открывается.
- **Импорты между .ts-файлами исходников — расширение `.ts`, не `.js`**
  (`from "./config.ts"`, не `from "./config.js"`) — это НЕ опечатка, это
  обязательный паттерн проекта начиная с этой задачи. См. Deferred decisions
  и комментарий в `services/backend/tsconfig.json` — иначе `npm test`
  (native `node --test` на .ts-файлах) не резолвит импорты.
- **Расположение тестов** — co-located `*.test.ts` рядом с реализацией
  (`src/config.test.ts`, `src/routes/health.test.ts`), не в отдельном `test/`
  — иначе они выпадают из `tsconfig.json`'s `include: ["src"]`, что ломает
  либо `tsc`-типизацию, либо lint (см. Deferred decisions). Если 005/006
  заведут интеграционные тесты потяжелее (с реальным Postgres) — тот же
  принцип: держите их внутри `src/`, либо явно расширьте `include` в
  `tsconfig.json` и продумайте, чтобы `exclude` для `dist` не потерял
  строгость (тесты не должны попадать в собранный образ).
- **`DATABASE_URL`/`SANDBOX_DATABASE_URL`** — в этой задаче только читаются
  и валидируются (непустая строка), никакого подключения к Postgres.
  Формат — см. отчёт задачи 002 (`postgres://trellis_app:...@postgres:5432/trellis`
  и `postgres://trellis_sandbox:...@postgres:5432/trellis` внутри
  compose-сети, `search_path` ролей уже выставлен на `core`/`sandbox`
  соответственно).
- **`COURSES_DIR`** — дефолт `/courses`, в compose примонтирован
  `./courses:/courses:ro` — только чтение внутри контейнера.

## Вывод команд

Локальная нода в этой песочнице (`22.16.0`, дефолтный `nvm use`) НЕ включает
TypeScript type-stripping по умолчанию (backport в `22.18.0`, см. Deferred
decisions) — поэтому все команды ниже прогнаны под `nvm use v22.19.0`
(также доступна в этой песочнице), что соответствует реальным целевым средам
(`actions/setup-node@v4` c `node-version: 22` тянет самый свежий `22.x`;
`node:22-alpine` в Dockerfile — тоже последний `22.x` на момент сборки).

### `npm run build -w @trellis/backend`

```
> build
> tsc -p tsconfig.json
```

Без ошибок, `dist/{config,server}.js(+.map)`, `dist/routes/health.js(+.map)` —
тестовые файлы (`*.test.ts`) в `dist` не попадают (см. `tsconfig.json`
`exclude`).

### `npm test -w @trellis/backend`

```
TAP version 13
...
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

9/9 зелёных: 6 на `parseConfig` (дефолты, override из окружения, отсутствие
`DATABASE_URL`, пустой `SANDBOX_DATABASE_URL`, невалидный `PORT`,
неизменяемость объекта) + 3 на `/health` (200 + тело, edge case — не-GET на
тот же путь, error path — незарегистрированный маршрут → 404).

### `bash .mvp/ci-mirror.sh`

Прогнано дважды: обычный запуск и с чистого дерева (`rm -rf node_modules
services/backend/dist` перед прогоном) — оба раза код выхода `0`
(`npm ci` → `lint` → `build` → `test`, все шаги зелёные).

### `npm run lint -w @trellis/backend`

`ESLint: No issues found` (код выхода `0`).

## Deferred decisions

- **`services/backend/src/config.ts` не экспортирует eager-синглтон
  `config`, только тип `AppConfig` + функцию `parseConfig`** — буквальное
  прочтение брифа ("экспорт — типизированный неизменяемый объект конфига +
  функция разбора") предполагает top-level `export const config =
  parseConfig(process.env)`. Проверено эмпирически: такой синглтон делает
  ЛЮБОЙ импорт `config.ts` (в т.ч. из `config.test.ts`, который просто хочет
  протестировать саму функцию `parseConfig`) выполняющим реальный парсинг
  `process.env` при загрузке модуля — падает с `Missing required environment
  variable: DATABASE_URL`, если в процессе `node --test` эта переменная не
  выставлена, а `"test": "node --test"` закреплён в брифе дословно (нельзя
  добавить env в сам скрипт). Это ломает готовность («npm test зелёный») по
  конструкции. Решение: `parseConfig` — чистая функция без побочных
  эффектов на уровне модуля; «типизированный неизменяемый объект» — то, что
  она возвращает при вызове (frozen, типизирован как `AppConfig`), вызывается
  один раз в точке входа `server.ts`. Ревьюер может потребовать буквальный
  синглтон обратно — тогда придётся либо подсовывать test-процессу реальные
  `DATABASE_URL`/`SANDBOX_DATABASE_URL` через окружение снаружи скрипта
  (вне `package.json`), либо явно согласовать другое.
- **Относительные импорты между `.ts`-файлами исходников пишутся с
  расширением `.ts` (`from "./config.ts"`), а не `.js`** — стандартная
  конвенция NodeNext (`.js`-специфайер в `.ts`-источнике, `tsc` резолвит его
  как есть) ломается для второго требуемого способа запуска: `node --test`
  на .ts-файлах напрямую (без `tsc`) резолвит импорты буквально и НЕ
  переписывает `.js` → `.ts` (подтверждено официальной документацией
  Node — `nodejs.org/api/typescript.html`: «file extensions are mandatory»,
  никакого fallback-резолва). Компромисс — компиляторные опции TS 5.7+
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (в
  `tsconfig.json`, с комментарием-обоснованием на месте): исходники пишут
  `.ts`-специфайер, `tsc` при сборке сам переписывает его на `.js` в `dist`
  (проверено — `dist/server.js` импортирует `./config.js`, не `./config.ts`),
  а `node --test` резолвит `.ts`-специфайер напрямую на соседний `.ts`-файл.
  Добавлены заодно `erasableSyntaxOnly` (страхует от TS-синтаксиса, который
  native type-stripping не умеет стереть — enum/namespace/parameter
  properties, ничего из этого сейчас не используется) и
  `verbatimModuleSyntax` (требует явного `type` на type-only импортах — уже
  так и было написано в `health.ts`/`server.ts`).
- **`*.test.ts` co-located в `src/`, не в отдельном `test/`** — роль
  backend-implementer рекомендует `test/` для интеграционных тестов
  (`app.inject()` подпадает под это определение). Технический конфликт:
  бриф пунктом 2 фиксирует `tsconfig.json` `include: ["src"]` буквально —
  файлы вне `src/` не входят в TS-проект. `services/backend/eslint.config.mjs`
  изначально пытался включить `parserOptions.project: "./tsconfig.json"` для
  type-aware линтинга — с файлами вне `include` (включая сам
  `eslint.config.mjs` и `*.test.ts`, если бы они лежали в `test/` ИЛИ были
  исключены как сейчас через `tsconfig.json`'s `exclude`) парсер падает
  (`"parserOptions.project" ... file was not found in any of the provided
  project(s)`), потому что `@typescript-eslint/parser` требует, чтобы
  линтуемый файл входил в переданный tsconfig. Решение в два шага: (1)
  тесты — co-located в `src/`, чтобы физически быть кандидатами на включение
  куда угодно без отдельного tsconfig; (2) `services/backend/eslint.config.mjs`
  в итоге вообще убрал `parserOptions.project` — он не нужен, потому что
  корневой `eslint.config.mjs` (задача 001) подключает только
  `tseslint.configs.recommended` (синтаксические правила), не
  `recommendedTypeChecked` — т.е. type-aware линтинг сейчас нигде не
  используется, а `parserOptions.project` без reason на type-checked
  правила — чистый источник хрупкости без выгоды. Если 005/006 захотят
  type-checked правила — понадобится либо отдельный `tsconfig.eslint.json`
  (широкий `include`, включающий тесты и сам eslint-конфиг), либо
  `projectService: true` вместо `project` — не делал этого сейчас, т.к. вне
  скоупа задачи 003 и не нужно для текущих правил.
- **Локальный `node` в песочнице (`22.16.0`) не резолвит `.test.ts`
  файлы дефолтным `node --test` вообще** (0 найденных тестов — тихий
  вакуумный «зелёный», не ошибка) — type-stripping без флага появился в
  `22.18.0` (бэкпорт), подтверждено официальным блог-постом Node.js.
  Реальные целевые окружения (`actions/setup-node@v4` с `node-version: "22"` в
  CI, `node:22-alpine` в Dockerfile — оба тянут актуальный `22.x` на момент
  использования, точно новее `22.18.0` на 2026-09) не подвержены этому. Для
  верификации в этой задаче переключался на `nvm use v22.19.0` (уже стоит в
  песочнице) — так `npm test -w @trellis/backend` реально гоняет 9 тестов,
  а не отчитывается «зелёным» вхолостую. Не меняю `"test": "node --test"` в
  `package.json` (буквальное требование брифа, и оно корректно для реальных
  окружений) — но ревьюеру стоит знать, что локальная проверка этим же
  скриптом под дефолтным `node` этой песочницы дала бы ложно-зелёный
  результат без единого реально выполненного теста.
- **`@types/node` закреплён на `^22.20.2` (мажор `22`), а не на dist-tag
  `latest` (`npm install -D @types/node` без версии подставил `^26.6.0`)** —
  `@types/node` мажор-версии теперь следуют номерам версий Node.js;
  рантайм — `node:22-alpine`/`engines.node: ">=22"`, поэтому явно указал
  `@types/node@22` при установке.
- **Response-схема `/health` — plain JSON Schema, без TypeBox** — бриф
  ограничивает зависимости ровно `fastify` («ничего лишнего на будущее»);
  добавлять `@sinclair/typebox` ради одного простого маршрута без параметров
  избыточно на этом этапе. Задачи 005/006, если параметры/тела запросов
  усложнятся, вольны завести TypeBox в своей части — граница это позволяет.
- **`fastify-plugin` не добавлен как зависимость** — роль
  backend-implementer рекомендует оборачивать каждый плагин в
  `fastify-plugin`, чтобы пробить инкапсуляцию для decorator'ов, видимых
  выше по дереву регистрации. `healthRoutes` сейчас ничего не декорирует и
  ничего не должно быть видно родителю — оборачивать не в чём смысл, а
  бриф явно ограничивает зависимости одной `fastify`. Если 005/006
  понадобятся decorator'ы, видимые всему дереву (например, decorator пула
  соединений БД) — им придётся либо явно добавить `fastify-plugin`
  (небольшая, официально поддерживаемая fastify-org библиотека), либо
  использовать `fastify.register` с опцией `{ prefix: undefined }`... на
  их усмотрение, вне скоупа этой задачи.
- **Образ не собирался физически** (нет сети до Docker Hub в этой
  песочнице + по брифу не требуется) — синтаксис Dockerfile проверен
  построчным ревью и `docker compose config` (парсит `docker-compose.yml`
  целиком без ошибок, ссылки на `context`/`dockerfile` корректны). Полная
  проверка сборки — задача 018 (интеграционный запуск стека) или ручная
  проверка ревьюером при наличии сети.
