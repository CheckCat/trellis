# Task 001 — корень монорепозитория

## Task

Настроить корень монорепозитория Trellis: npm workspaces, общий TypeScript- и
ESLint-конфиг, `.gitignore` и GitHub Actions CI, зеркалящий `.mvp/ci-mirror.sh`.

Сервисов (`services/backend`, `services/frontend`) ещё НЕ существует — их создадут
задачи 003/004. Корень должен быть валиден и при пустом `services/`.

### Требования (значения — дословно)

1. **`package.json` (корень)**
   - `"name": "trellis"`, `"private": true`, `"type": "module"`
   - `"workspaces": ["services/*"]`
   - `"engines": { "node": ">=22" }`
   - scripts — ровно делегирование в workspaces, чтобы корень не падал при пустом
     `services/`:
     - `"lint": "npm run lint --workspaces --if-present"`
     - `"build": "npm run build --workspaces --if-present"`
     - `"test": "npm run test --workspaces --if-present"`
   - devDependencies: `typescript`, `eslint`, `typescript-eslint` (актуальные
     мажорные версии; ESLint 9 flat config)
   - **Сгенерируй `package-lock.json`** (`npm install` один раз в корне, затем
     проверь, что `npm ci` проходит). В образах и CI — только `npm ci`.

2. **`tsconfig.base.json`** — база, которую сервисы будут `extends`:
   - `"strict": true`, `"target": "ES2023"`, `"lib": ["ES2023"]`,
     `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`,
     `"esModuleInterop": true`, `"forceConsistentCasingInFileNames": true`,
     `"skipLibCheck": true`, `"noUncheckedIndexedAccess": true`,
     `"noImplicitOverride": true`, `"sourceMap": true`, `"declaration": false`
   - без `include`/`files` — это только база

3. **`eslint.config.mjs`** — flat config, экспорт по умолчанию массива конфигов,
   пригодный для переиспользования сервисами (`services/*/eslint.config.mjs`
   будет импортировать его и добавлять своё):
   - `eslint.configs.recommended` + `tseslint.configs.recommended`
   - глобальные ignores: `**/dist/**`, `**/node_modules/**`, `**/coverage/**`

4. **`.gitignore`**: `node_modules/`, `dist/`, `coverage/`, `.env`,
   `.superpowers/`, `*.log`. Файл `.env.example` (появится в 002) игнорироваться
   не должен.

5. **`.github/workflows/ci.yml`** — GitHub Actions, ветки `main` + pull_request,
   `ubuntu-latest`, `actions/setup-node@v4` с Node 22 и `cache: npm`. Шаги —
   **буквально те же команды и в том же порядке**, что в `.mvp/ci-mirror.sh`:
   `npm ci` → `npm run lint --if-present` → `npm run build --if-present` →
   `npm run test --if-present`. Никаких дополнительных шагов, никакого
   «почти того же самого».

### Готов когда

- `npm ci` в чистом дереве проходит
- `bash .mvp/ci-mirror.sh` завершается кодом 0
- `npx tsc --noEmit -p tsconfig.base.json` не требуется (база без include) —
  вместо этого убедись, что JSON валиден
- `npx eslint .` не падает на пустом дереве исходников (проверь; если падает
  из-за отсутствия файлов — это ожидаемо только при прямом вызове, скрипт
  `npm run lint` такого вызова делать не должен)

## Boundary

`.` — корень репозитория. Разрешено создавать/менять только перечисленные выше
файлы (+ `package-lock.json`) и свой отчёт `.mvp/reports/task-001.md`.
НЕ создавай `services/**`, `docker-compose.yml`, `docker/**` — это задачи 002–004.
Не трогай `docs/**`, `.mvp/plan.json`, `.mvp/invariants.md`, `CLAUDE.md`.

## Interfaces from dependencies

Зависимостей нет — это первая задача плана.

## Общий контракт проекта (соблюдать)

- Node 22, TypeScript ESM (`NodeNext`), strict.
- Сервисы: `services/backend`, `services/frontend` (появятся позже, конфиг корня
  обязан их подхватить без правок).
- Тест-раннер backend — встроенный `node:test`, frontend — vitest. В корне
  никакого раннера не ставим.

## Project invariants

Полный список — `.mvp/invariants.md`. Релевантное здесь:

- Всё локально: наружу ничего не публикуется и не отправляется.
- Ядро специальность-агностично: никакого хардкода конкретного курса.
- `BOUNDARY_EXEMPT: package.json, package-lock.json` — корневой lockfile будут
  дополнять задачи сервисов, это ожидаемо.
