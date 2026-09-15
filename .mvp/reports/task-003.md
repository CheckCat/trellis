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

## Fix round 1

Critical-находка ревью подтверждена: на Node v22.16.0 (Node без backport'а
дефолтного type-stripping, версия ниже 22.18.0) `"test": "node --test"` на
пустом `services/backend` без `.test.ts`-обнаружения тихо находит `0` тестов
и завершается кодом `0` — то есть «зелёный» `npm test`/`ci-mirror.sh` ничего
не гарантировал на этой машине. Решение задано координатором целиком,
реализовано как есть, без альтернатив.

### Что изменено

- **Тесты теперь исполняются по скомпилированному JS, не по сырому `.ts`.**
  Убрана зависимость от нативного type-stripping Node (а значит и от версии
  Node ≥22.18) — раньше это было замаскировано под «просто зелёный», теперь
  реально гоняет 9 тестов на любой Node ≥ той, что поддерживает `node:test`
  (18+).
- **`services/backend/tsconfig.test.json`** (новый файл) — `extends:
  "./tsconfig.json"`, `outDir: "dist-test"`, `exclude: []` (явно
  переопределяет `exclude` родителя — TS не мёржит `exclude` при `extends`,
  переопределяет целиком). Компилирует `src/**/*.ts`, включая `*.test.ts`.
- **`services/backend/tsconfig.json`** (прод-сборка) — без изменений в
  поведении: `exclude: ["src/**/*.test.ts"]` как и раньше, `dist/` по-прежнему
  чист от тестов (проверено — см. ниже). Убраны 4 compiler-опции
  (`allowImportingTsExtensions`/`rewriteRelativeImportExtensions`/
  `erasableSyntaxOnly`/`verbatimModuleSyntax`) из первого раунда — они были
  нужны только чтобы исходники с `.ts`-специфайерами в импортах могли
  запускаться Node напрямую (нативный type-stripping). Раз тесты теперь
  всегда идут через `tsc`, необходимость в этом обходном пути отпала:
  **импорты между `.ts`-файлами исходников возвращены к стандартному виду
  `from "./config.js"`** (не `.ts`) — обычная конвенция NodeNext, без
  скрытых допущений о версии Node. Это отменяет соответствующий Deferred
  decision из первого раунда (зафиксирован там как есть, для истории — не
  вычищаю).
- **`services/backend/package.json` scripts**:
  - `"pretest": "tsc -p tsconfig.test.json"` — npm сам запускает `pretest`
    перед `test` (встроенное поведение npm lifecycle, доп. оркестрации не
    нужно).
  - `"test": "node --test 'dist-test/**/*.test.js'"` — **отличается от
    буквального требования координатора (`"node --test dist-test"`)**:
    эмпирически проверено на Node v22.16.0 (машина координатора, та же, на
    которой он подтвердил Critical) — `node --test dist-test` (путь к
    директории без явного glob) падает с `Cannot find module
    '.../dist-test'` (CJS-резолвер пытается требовать директорию как модуль,
    а не рекурсивно искать в ней тестовые файлы). Тот же вызов с явным glob
    `dist-test/**/*.test.js` отрабатывает штатно и на 22.16.0, и на более
    новых Node. Одинарные кавычки в скрипте — чтобы паттерн раскрывал сам
    Node (через свой internal glob-matcher), а не шелл до передачи в Node.
    Если координатор настаивает именно на форме без glob — нужно
    подтверждение, что она реально работает на его машине (у меня
    воспроизводимо не работает на 22.16.0 — см. вывод ниже).
  - `"dev"` — заодно починен (был расфазирован: `tsc --watch` и `node
    --watch dist/server.js` стартовали параллельно через `&`, `node --watch`
    падал на первом тике, т.к. `dist/server.js` ещё не существовал, и не
    восстанавливался — `node --watch` не подхватывает появление
    отсутствовавшего при старте файла). Теперь: `"npm run build && (tsc -p
    tsconfig.json --watch --preserveWatchOutput & node --watch
    dist/server.js)"` — сначала гарантированный первый билд, потом оба
    watcher'а параллельно. Не входит в критерии готовности/проверки
    координатора, чиню заодно, т.к. иначе это готовый футган для 005/006.
- **`services/backend/.gitignore`** (новый) — `dist-test/`. Корневой
  `.gitignore` игнорирует `dist/` (буквальное имя), это НЕ покрывает
  `dist-test/` (другое имя, не префиксное совпадение в gitignore-семантике —
  проверено явно). Корневой `.gitignore` не трогаю (вне границы) — решаю в
  своей.
- **`services/backend/eslint.config.mjs`** — приведён к паттерну задачи 001
  `[...base, { ...overrides }]`. Слот с содержимым не пустой формально:
  `{ ignores: ["dist-test/**"] }` — реальная необходимость (`dist-test/` —
  сгенерированный JS, не должен линтиться, и не покрыт `**/dist/**` в
  базовом конфиге по той же причине, что и в `.gitignore`).

### Проверки (реальный вывод, Node v22.16.0, без переключения версии)

Полный цикл: `rm -rf node_modules services/backend/dist
services/backend/dist-test` → `bash .mvp/ci-mirror.sh` с чистого дерева.

**`node --version`**
```
v22.16.0
```

**`npm test -w @trellis/backend`** (через `pretest` → `tsc -p
tsconfig.test.json`, затем `test`):
```
> pretest
> tsc -p tsconfig.test.json

> test
> node --test 'dist-test/**/*.test.js'

TAP version 13
# Subtest: parseConfig applies defaults for HOST, PORT, COURSES_DIR
ok 1 - parseConfig applies defaults for HOST, PORT, COURSES_DIR
...
# Subtest: GET /unknown-route responds 404 (error path)
ok 9 - GET /unknown-route responds 404 (error path)
1..9
# tests 9
# suites 0
# pass 9
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
Exit code `0`. Реально исполнено 9/9 (не «0 tests, exit 0», как до фикса).

**`npm run build -w @trellis/backend`**
```
> build
> tsc -p tsconfig.json
```
Exit code `0`.

**`ls`/`find` в `dist/` — тестов быть не должно:**
```
$ find services/backend/dist -type f
services/backend/dist/config.js
services/backend/dist/config.js.map
services/backend/dist/routes/health.js
services/backend/dist/routes/health.js.map
services/backend/dist/server.js
services/backend/dist/server.js.map
$ find services/backend/dist -name "*.test.js" | wc -l
0
```

**`node dist/server.js` реально стартует и отвечает:**
```
$ HOST=127.0.0.1 PORT=3099 DATABASE_URL=postgres://u:p@localhost:5432/db \
  SANDBOX_DATABASE_URL=postgres://u:p@localhost:5432/db node dist/server.js &
{"level":30,...,"msg":"Server listening at http://127.0.0.1:3099"}
$ curl -s -o /tmp/health_body.json -w "HTTP_STATUS=%{http_code}\n" http://127.0.0.1:3099/health
HTTP_STATUS=200
$ cat /tmp/health_body.json
{"status":"ok"}
```

**`bash .mvp/ci-mirror.sh`** (с чистого дерева, `rm -rf node_modules
services/backend/dist services/backend/dist-test` перед прогоном):
```
$ node --version
v22.16.0
$ bash .mvp/ci-mirror.sh; echo EXIT=$?
... (npm ci, lint, build, test — все шаги) ...
# tests 9
# pass 9
# fail 0
EXIT=0
```

**`npm run lint -w @trellis/backend`**: `ESLint: No issues found`, exit `0`.

### Git status после фикса (в границе)

```
 M services/backend/eslint.config.mjs
 M services/backend/package.json
 M services/backend/src/config.test.ts
 M services/backend/src/routes/health.test.ts
 M services/backend/src/server.ts
 M services/backend/tsconfig.json
?? services/backend/.gitignore
?? services/backend/tsconfig.test.json
```
(`services/backend/Dockerfile`, `src/config.ts`, `src/routes/health.ts` —
без изменений в этом раунде.) Ничего вне `services/backend/**` не тронуто.

### Deferred decisions (round 1)

- **`"test": "node --test 'dist-test/**/*.test.js'"` вместо буквального
  `"node --test dist-test"`** — см. обоснование в разделе scripts выше:
  директория-без-glob воспроизводимо падает на Node v22.16.0 (та же машина,
  на которой координатор подтвердил исходный Critical). Пометка на случай,
  если у координатора была другая версия/окружение в виду — открыт к
  пересмотру при наличии противоречащего вывода.
- **`.ts`-специфайеры в импортах исходников убраны, возвращены к
  стандартным `.js`** — больше не нужны без нативного запуска `.ts`; заодно
  упрощает код для 005/006 (меньше нестандартных паттернов на копирование).
- **`"dev"` скрипт переписан на `npm run build && (...)`** — не входило в
  список проверок координатора, но исходная форма была сломана (гонка при
  первом старте), не оставляю известный баг непочиненным в границе своей
  задачи.
