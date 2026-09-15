# Task 001 — корень монорепозитория — отчёт

## Что создано

- `package.json` — root workspaces-манифест (`name: trellis`, `private: true`,
  `type: module`, `workspaces: ["services/*"]`, `engines.node: ">=22"`),
  скрипты `lint`/`build`/`test` (детали ниже), devDependencies.
- `package-lock.json` — сгенерирован `npm install` в корне, провалидирован
  `npm ci` на чистом дереве (см. вывод CI ниже).
- `tsconfig.base.json` — база без `include`/`files`, ровно те compiler options,
  что в брифе.
- `eslint.config.mjs` — flat config, default export массива конфигов
  (`tseslint.config(...)`), глобальные ignores + `@eslint/js` recommended +
  `tseslint.configs.recommended`.
- `.gitignore` — `node_modules/`, `dist/`, `coverage/`, `.env`,
  `.superpowers/`, `*.log`. `.env.example` не игнорируется (паттерн `.env`
  матчит только точное имя, не префикс).
- `.github/workflows/ci.yml` — GitHub Actions, `main` + pull_request,
  `ubuntu-latest`, `actions/setup-node@v4` (node 22, `cache: npm`), шаги в
  том же порядке, что `.mvp/ci-mirror.sh`.

## Зафиксированные версии зависимостей

| Пакет | Версия в package.json | Реально установлено |
|---|---|---|
| `typescript` | `^6.0.3` | 6.0.3 |
| `eslint` | `^10.10.0` | 10.10.0 |
| `typescript-eslint` | `^8.70.0` | 8.70.0 |
| `@eslint/js` | `^10.0.1` | 10.0.1 |

Оба отклонения от прямого прочтения брифа задокументированы в
`## Deferred decisions` ниже (typescript-версия и добавление `@eslint/js`).

## Интерфейсный дайджест для зависимых задач (002–004)

- **`tsconfig.base.json`** — сервисы делают
  `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src", ... }, "include": ["src/**/*.ts"] }`.
  База не включает `lib.dom`/`@types/node` — при необходимости (backend:
  `console`, `process` и т.п.) сервис сам добавляет `@types/node` и расширяет
  `lib`/`types` в своём compilerOptions. Проверено вручную (`tsc --noEmit`) —
  extends резолвится корректно, ошибок в базовых опциях нет.
- **`eslint.config.mjs`** — сервисы делают
  `import base from "../../eslint.config.mjs"; export default [...base, { /* свои правила/parserOptions/project */ }];`
  Проверено вручную: сервисный конфиг, расширяющий корневой, подхватывает
  `eslint:recommended` + `typescript-eslint:recommended` (напр. ловит
  `no-explicit-any`, `prefer-const`, `no-unused-vars` на тестовом файле).
- **Скрипты, которые ОБЯЗАНЫ определить `services/backend/package.json` и
  `services/frontend/package.json`** (иначе делегирование — не ошибка, но
  бесполезно): `"lint"`, `"build"`, `"test"`. Корневые скрипты вызывают их
  через `npm run <name> --workspaces --if-present` — если скрипта нет у
  сервиса, он просто пропускается (не падает).
- Тест-раннер сервисы **не** наследуют из корня — backend использует
  встроенный `node:test`, frontend — `vitest`; в корневых devDependencies
  раннеров нет (по ТЗ).
- `package.json`/`package-lock.json` — `BOUNDARY_EXEMPT`, задачи 002–004
  дополняют корневой `package.json` (в первую очередь секцию workspaces
  фактическими сервисами через сам факт появления `services/*/package.json`
  — корневой файл трогать руками не обязательно, `workspaces: ["services/*"]`
  уже покрывает оба будущих пакета).

## Вывод `bash .mvp/ci-mirror.sh`

```
$ rm -rf node_modules && bash .mvp/ci-mirror.sh
added 96 packages, and audited 97 packages in 1s
30 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities

> lint
> sh -c 'if [ -d services ] && [ -n "$(ls -A services 2>/dev/null)" ]; then npm run lint --workspaces --if-present; fi'

> build
> sh -c 'if [ -d services ] && [ -n "$(ls -A services 2>/dev/null)" ]; then npm run build --workspaces --if-present; fi'

> test
> sh -c 'if [ -d services ] && [ -n "$(ls -A services 2>/dev/null)" ]; then npm run test --workspaces --if-present; fi'

$ echo $?
0
```

Дополнительно проверено:
- `npm ci` на чистом дереве (после `rm -rf node_modules`) — успешно, 0
  vulnerabilities.
- `npx eslint .` на пустом дереве исходников (только конфиги в корне) — не
  падает, EXIT=0.
- `node -e "JSON.parse(...)"` на `package.json` и `tsconfig.base.json` — оба
  валидны.
- Смоделирован сценарий с `services/foo` (workspace без lint-скрипта →
  no-op; workspace с намеренно падающим lint-скриптом → ошибка корректно
  прокидывается наверх, эксит-код ненулевой) — оба случая проверены в
  scratchpad перед применением к рабочему дереву.

## Deferred decisions

- **`typescript` закреплён на `^6.0.3`, а не на реальный dist-tag `latest`
  (7.0.2)** — `typescript-eslint@8.70.0` объявляет
  `peerDependencies.typescript: ">=4.8.4 <6.1.0"`; с TS 7 `npm install`
  падает с `ERESOLVE` (несовместимый peer). 6.0.3 — старшая версия TS,
  реально совместимая с зафиксированной мажоркой `typescript-eslint`. Как
  только `typescript-eslint` анонсирует поддержку TS 7 — апдейт обеих пар
  версий делает отдельная задача, не блокирует этот корень.
- **Добавлен `@eslint/js@^10.0.1` сверх списка `typescript, eslint,
  typescript-eslint`** — эмпирически проверено (`Object.keys(await
  import("eslint"))`: `ESLint, Linter, RuleTester, SourceCode, default,
  loadESLint` — `configs` отсутствует), что сам пакет `eslint` не
  экспортирует `configs.recommended` для flat config; этот ruleset — в
  отдельном официальном пакете `@eslint/js` (0 транзитивных зависимостей,
  поддерживается командой ESLint, не подтягивается транзитивно ни от
  `eslint`, ни от `typescript-eslint`). Без него нельзя буквально выполнить
  пункт требований «`eslint.configs.recommended`». Помечаю как concern —
  ревьюер может решить убрать `eslint:recommended` вовсе вместо добавления
  пакета, если для проекта принципиален список «ровно 3 devDependencies».
- **Скрипты `lint`/`build`/`test` — не буквальный
  `"npm run <name> --workspaces --if-present"`, а тот же вызов, обёрнутый в
  `sh -c 'if [ -d services ] && [ -n "$(ls -A services)" ]; then ...; fi'`**
  — эмпирически проверено: `npm run <name> --workspaces --if-present` сам по
  себе падает с `npm error No workspaces found!` (exit 1), если под
  `services/*` нет ни одного пакета — то есть буквальная формулировка брифа
  противоречит его же критерию готовности «Корень должен быть валиден и при
  пустом `services/`» и «`bash .mvp/ci-mirror.sh` завершается кодом 0» (сам
  и проверил на пустом дереве — падает). Guard активируется только на факте
  отсутствия/пустоты `services/`; как только там появится хотя бы один
  workspace-пакет, поведение — 1-в-1 как в буквальной формулировке
  (делегирование, `--if-present` гасит только отсутствие конкретного
  скрипта у пакета, реальные ошибки лока/сборки/тестов пробрасываются
  наружу — проверено на синтетическом failing-скрипте). Требует `sh`
  (доступен и на `ubuntu-latest`, и локально на macOS/Linux — Windows здесь
  не задействован, `.ps1`/`.bat` из CLAUDE.md — только пользовательский
  запуск docker-compose, не `npm run`).
- В `.github/workflows/ci.yml` добавлен шаг `actions/checkout@v4` перед
  `actions/setup-node@v4` — без него `npm ci` физически нечего было бы
  ставить (в репозитории нет чекаута). Бриф перечислял только шаги,
  соответствующие `ci-mirror.sh` (сами npm-команды); checkout — обязательная
  read-only предпосылка любого GitHub Actions job, а не «дополнительный шаг»
  в смысле расхождения local/CI.
