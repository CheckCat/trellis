# Task 019 — сквозной smoke-тест поднятого стека — отчёт

## Новые файлы

- **`tests/e2e/stack.test.ts`** — сценарий целиком. Один `test(...)` с 14
  упорядоченными подтестами (`node:test` + `node:assert/strict`, тот же
  стиль, что у backend'а). Ходит ТОЛЬКО по HTTP и только через nginx
  фронтенда (`${appUrl}/api/...`) — то есть проверяет цепочку
  nginx → backend → postgres → песочница целиком, а не модуль.
  Что утверждается по шагам:
  1. `GET /` отдаёт SPA (`<div id="root">`), `GET /api/health` → `{status:
     "ok", db: "ok"}`;
  2. `POST /api/courses/rescan` → `rejected: 0`, `scanFailed: false`;
     `GET /api/courses` содержит `pilot-sql@1.0.0`; в `GET
     /api/courses/pilot-sql` ровно 7 уроков;
  3. урок отдаётся с Markdown-контентом, но в СЫРОМ теле ответа нет
     `"correct"`/`"explanation"`/`"check"` (ответы курса не покидают
     backend);
  4. прогресс нового стека пуст (`completedLessons: 0`);
  5. ручная отметка урока → 200 + `completed`; ручная отметка
     квиз-урока → 409 `manual_completion_not_allowed`;
  6. квиз: неверный вариант → `correct: false`, урок не засчитан; верный →
     `correct: true`, урок засчитан;
  7. практика: песочница до первого запуска `active: false`, после запуска
     пользовательского SQL — `active: true` с `seedFiles:
     ["sandbox/seed.sql"]`, результат SELECT'а из seed-данных; задание без
     check закрывается самоотметкой;
  8. битый SQL → HTTP 200 с `ok: false` и кодом Postgres `42P01` (ошибка
     учебного SQL — не ошибка API);
  9. `select * from core.lesson_progress` из практики → `ok: false`, код
     `42501`: SQL пользователя идёт под ролью песочницы, схема ядра ему
     недоступна;
  10. практика с check: неподходящий запрос → `check.passed: false`, урок не
      засчитан; решение → `check.passed: true`, урок засчитан в режиме
      `practice`;
  11. сброс песочницы → данные снова как после seed (вставленной книги нет),
      прогресс при этом не тронут;
  12. `GET /api/progress/export` → `format: "trellis.progress"`,
      `formatVersion: 1`, разбираемый `exportedAt`, `installedVersion:
      "1.0.0"`, список уроков ровно равен пройденным;
  13. импорт того же файла → `applied: true`, `created: 0`, `unchanged: N`
      (идемпотентность);
  14. файл на сутки старше + один лишний зачёт → 409
      `import_older_than_local` и НИЧЕГО не записано; повтор с
      `?confirm=true` → 200, `created: 1`, урок виден в дереве курса как
      пройденный (это и есть round-trip: файл экспорта дочитан обратно и
      изменил реальный прогресс).

- **`tests/e2e/helpers/compose.ts`** — жизненный цикл стека.
  `export async function startStack(): Promise<StackHandle>`;
  `export interface StackHandle { appUrl: string; apiUrl: string;
  logs(): Promise<string>; stop(): Promise<void> }`.
  - изоляция: имя проекта `trellis-e2e` (никогда `trellis`), override-файл,
    эфемерные порты, свой том `trellis-e2e-pgdata`;
  - готовность — `docker compose up --wait` (healthcheck'и, не `sleep`;
    healthcheck фронтенда сам ходит в `/api/health` через nginx, так что
    зелёный `--wait` уже означает живую цепочку);
  - адрес узнаётся через `docker compose port frontend 80` — фиксированных
    портов нет;
  - teardown: `docker compose down --remove-orphans` + `docker volume rm`
    **по имени**. `down -v` не используется сознательно (см. Deferred
    decisions);
  - перед `up` всегда делается teardown — база на старте гарантированно
    пуста, поэтому шаг 4 может утверждать `completedLessons: 0`;
  - `TRELLIS_E2E_KEEP_STACK=1` оставляет стек поднятым для ручного разбора.

- **`tests/e2e/docker-compose.e2e.yml`** — override к корневому
  `docker-compose.yml`: эфемерные порты (`ports: !override`), одноразовый
  том. Образы, healthcheck'и, env и зависимости — те же, что в проде.

- **`tests/e2e/tsconfig.json`** — `extends ../../tsconfig.base.json`,
  `rootDir: "."`, `outDir: "dist"`, `types: ["node"]`.

## Изменения существующих файлов

- **`package.json` (корень, `BOUNDARY_EXEMPT`)**
  - `test:e2e` (+ `pretest:e2e`) — новая отдельная команда:
    `tsc -p tests/e2e/tsconfig.json` → `node --test
    'tests/e2e/dist/**/*.test.js'` (тот же приём, что backend'а
    `pretest`/`test`);
  - `build` → `... && tsc -p tests/e2e/tsconfig.json`;
  - `lint` → `... && eslint tests`;
  - devDependency `@types/node@^22.20.2` (нужен корневому `tsc` для
    `fetch`/`child_process`).
  - **`npm run test` не тронут**: сквозной тест НЕ входит ни в него, ни в
    `.mvp/ci-mirror.sh`, ни в `.github/workflows/ci.yml` — см. Deferred
    decisions. CI-файлы не менялись вообще.
- **`package-lock.json`** (`BOUNDARY_EXEMPT`) — одна строка: корневой
  devDependency `@types/node` (пакет уже был в дереве как зависимость
  backend'а), `npm install --package-lock-only`.
- **`CLAUDE.md`** — в «Команды» добавлен `npm run test:e2e` с пометкой, что
  он не входит в CI и требует Docker Compose ≥ 2.24.

## Как запускать

```bash
npm run test:e2e        # ~50 c на холодных образах, ~17 c на прогретых
```

Требуется Docker Compose ≥ 2.24 (тег `!override`). Без Docker тест НЕ
скипается, а падает с объяснением: зелёный прогон без стека ничего бы не
доказывал.

## Deferred decisions

- **Сквозной тест не добавлен в `npm run test`/CI.** Он собирает два образа
  и поднимает стек с Postgres; `.github/workflows/ci.yml` для этого не
  оборудован, а `.mvp/ci-mirror.sh` поднимает одноразовый Postgres совсем
  под другую задачу. Плюс жёсткий механизм ci-mirror'а: он падает, если
  `node --test` отчитался хоть об одном `skipped`, — то есть «скипаться без
  Docker» этот тест всё равно не мог бы. Компромисс против гниения: каталог
  компилируется корневым `npm run build` и линтится корневым `npm run lint`,
  так что несоответствие типов API поймает обычный CI, хотя сам сценарий там
  не бежит.
- **`tests/e2e` — не npm-workspace.** Workspace автоматически попал бы в
  `npm run test --workspaces`, то есть в CI (см. выше), и потребовал бы
  собственный `package.json`/lock-запись ради двух файлов. Корневой скрипт
  проще и делает ровно то, что нужно.
- **Teardown без `docker compose down -v`.** `-v` удаляет тома из
  объединённой модели проекта; сегодня `docker compose config` показывает
  там только `trellis-e2e-pgdata`, но одна неудачная правка override-файла
  превратила бы уборку после теста в удаление `trellis_pgdata` — боевого
  прогресса пользователя. Удаление по имени (`docker volume rm --force
  trellis-e2e-pgdata`) ошибиться так не может в принципе.
- **`ports: !override`, а `volumes:` — без тега.** Проверено через `docker
  compose config`: `ports` compose СКЛАДЫВАЕТ (без тега тестовый стек занял
  бы фиксированные 5433/3001/3000 и падал бы при уже поднятом рабочем
  стеке), а `volumes` сливает по target-пути — запись сама заменяет
  монтирование `/var/lib/postgresql/data`, оставляя bind-монтирования
  init-скриптов из базового файла на месте.
- **Один сценарий с упорядоченными подтестами, а не независимые тесты.**
  Состояние (прогресс, песочница) копится в одной живой базе; независимость
  достигалась бы пересозданием стека на каждый шаг — минуты на шаг без
  единого нового утверждения о продукте. Порядок сделан явным (подтесты
  внутри одного `test`), а не случайно вытекающим из порядка функций в
  файле.
- **Знание о пилотном курсе вынесено в одну константу `PILOT`.** Верный
  вариант квиза и решение практики нельзя получить из API (и не должно быть
  можно — это ответы к заданиям), поэтому они лежат в тесте. Это фикстура
  теста, не знание ядра: инвариант «ядро специальность-агностично»
  относится к backend/frontend, а тест содержимое `courses/` как раз
  проверяет. Всё остальное (структура модулей, счётчики, список уроков в
  файле экспорта) берётся из ответов API.
- **Тест ходит через nginx (`/api/...`), а не напрямую в backend.** Так
  ходит фронтенд; заодно бесплатно проверяется proxy-слой (и то, что SPA
  вообще отдаётся). Порт backend'а тоже опубликован — если понадобится
  сравнить «через nginx» и «напрямую», хендл легко расширить.
- **Не проверяется переживание прогрессом пересоздания контейнеров.**
  Ценный сценарий (именованный том), но бриф перечисляет четыре вещи, и
  каждая проверка тут стоит десятки секунд; оставлено как возможное
  расширение (`compose(["up", "-d", "--force-recreate", "postgres"])` —
  один вызов в helper'е).

## Верификация — реальный вывод

- `npm run test:e2e` → `# tests 15 / # pass 15 / # fail 0 / # skipped 0`,
  `duration_ms 16600` (прогретые образы; холодный прогон — 48 c). Первый
  прогон до этого упал на транзиентной сетевой ошибке докер-реестра
  (`failed to resolve source metadata for docker.io/docker/dockerfile:1 ...
  EOF`) — не связано с кодом, повтор прошёл.
- В ходе доводки тест поймал собственную ошибку ожидания (`summary` импорта
  содержит ещё и `courses`); исправлено на data-driven
  `courses: exported.body.courses.length`.
- `bash .mvp/ci-mirror.sh` → код `0`: backend `# tests 217 / # pass 217 /
  # fail 0 / # skipped 0`, frontend `Test Files 12 passed (12) / Tests 43
  passed (43)`; `npm run lint` (включая новый `eslint tests`) и `npm run
  build` (включая новый `tsc -p tests/e2e/tsconfig.json`) — чисто.
- После прогона: `docker ps -a --filter name=trellis` пусто, тома
  `trellis-e2e-pgdata` нет, сети проекта нет; `trellis_pgdata`
  (пользовательский) на месте и стеком теста не монтировался.

## Проверка границы

Граница задачи — корень (`.`). Изменено: `tests/**` (новое),
`package.json`, `package-lock.json` (`BOUNDARY_EXEMPT`), `CLAUDE.md`, плюс
этот отчёт. `.github/workflows/ci.yml`, `.mvp/ci-mirror.sh`,
`docker-compose.yml`, `services/**`, `courses/**` не тронуты.
`.mvp/ledger.md` (modified) и `.mvp/briefs/task-019.md` (untracked)
принадлежат пайплайну и существовали до старта задачи.
