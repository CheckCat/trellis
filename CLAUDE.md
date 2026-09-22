# Trellis

Локальный конструктор учебных курсов: ядро (прогресс, квизы, песочницы, импорт/экспорт) + курсы как валидируемые контент-пакеты. Всё работает на машине пользователя, наружу ничего не отправляется. Полный brief — `docs/product/`, инварианты — `.mvp/invariants.md`.

## Стек

- backend: Fastify (Node.js, TypeScript) — `services/backend`
- frontend: React SPA + CodeMirror (SQL-редактор практики) — `services/frontend`
- db: PostgreSQL (именованный volume; песочница практики — отдельная схема/роль в том же инстансе)
- deploy: docker-compose, только `localhost`; пользовательские команды живут в `scripts/stack/` — `start`, `rebuild` (пересборка без кеша), `down` (остановка); у каждой три файла: `.ps1` (Windows), `.sh` (macOS/Linux) и `.bat` для двойного щелчка. Кроссплатформенный диспетчер — `scripts/stack/stack.mjs` (`npm start`, `npm run stack:rebuild`, `npm run stack:down`)
- layout: npm workspaces в корне; root-скрипты гоняют все workspace-пакеты

## Команды

CI = local, единственный источник — `.mvp/ci-mirror.sh`:

```bash
npm ci                          # по package-lock.json, никогда npm install
npm run lint --if-present
npm run build --if-present
npm run capabilities:check --if-present   # docs/contracts/capabilities.json не отстал от capabilities.ts
npm run test --if-present
```

Реестр возможностей движка перегенерируется командой:

```bash
npm run capabilities:write      # -> docs/contracts/capabilities.json (коммитится)
```

Проверка плана курса (`courses/<id>/skills.yaml` против манифеста и реестра; стек и БД не нужны):

```bash
npm run course:lint -- courses/pilot-sql
```

Управление стеком (диспетчер сам выбирает лаунчер по системе):

```bash
npm start                          # поднять; = ./scripts/stack/start.sh
npm run stack:rebuild              # пересобрать образы без кеша и поднять; данные сохраняются
npm run stack:down                 # остановить и удалить контейнеры; данные сохраняются
npm run stack:down -- --with-data  # то же плюс удалить том trellis_pgdata (спросит подтверждение)
```

Напрямую стек поднимается и через `docker compose up`.

Реализаций лаунчера две и это осознанно: скрипт запуска работает до того, как поднято хоть что-то, и не может полагаться ни на что, кроме встроенного в систему (PowerShell на Windows, sh на остальных). Node ради него требовать нельзя — пользователю ставится только Docker Desktop, платформе Node не нужен (он внутри образов). Общая часть обеих — `scripts/stack/common.sh` и `scripts/stack/common.ps1`; сами команды поверх неё короткие и читаются как список шагов. Правишь одну — правь и вторую; совпадение таймаутов, состава и заголовков шагов каждой команды, имён сервисов, ключей `.env` и запрета на `down -v` сторожит `scripts/stack-parity.test.mjs` в обычном `npm test`.

Прогресс ученика живёт только в томе `trellis_pgdata`, копии его нет. Поэтому `down -v` в лаунчерах запрещён совсем (это проверяет паритет-тест): удаление данных — отдельное действие с явным ключом `--with-data`/`-WithData` и подтверждением словом.

Сквозной smoke-тест собранного стека — отдельной командой, в `npm run test` и в CI он не входит (поднимает docker-compose-стек, нужен Docker Compose >= 2.24):

```bash
npm run test:e2e                # tests/e2e/stack.test.ts; типы и линт этого каталога проверяет общий lint/build
```

## Правила

- Ядро не знает о конкретном курсе: никакого хардкода названий/структуры курса в коде; курс — данные из `courses/` (manifest.yaml + Markdown), валидируемые по схеме до показа.
- Прогресс привязан к стабильным id модулей/уроков (не индексам/названиям); формат прогресса и формат курса — разные сущности.
- SQL пользователя, seed- и check-запросы курса выполняются только от sandbox-роли (права ограничены схемой песочницы). Роль приложения для этого не используется никогда.
- У практики есть тип: `practice.type: sql` (по умолчанию, если поле не указано) — задание в песочнице курса; `practice.type: answer` — задание сделано снаружи (Excel, BI), ученик вписывает результат. Поля чужого типа не игнорируются, а отклоняются валидацией.
- Зачёт практики — только декларативные механики ядра. Для `sql`: `check` (одна строка, один boolean — состояние базы) и `expected` (сравнение результата ученика с эталонным запросом; `ordered` — важен ли порядок строк); механики независимы, заданы обе — нужны обе, нет ни одной — самоотметка. Для `answer`: сверка `fields[].expected` (`kind: number` с `tolerance`, `kind: text` — trim + без учёта регистра), зачёт при всех верных. Код-грейдер в составе курса запрещён.
- Эталоны ответов (`check`, `expected`, `fields[].expected`, верный вариант квиза) никогда не покидают backend: клиенту уходит только вердикт.
- Механика практики или тип песочницы существует, только если зарегистрирована в `services/backend/src/capabilities.ts` — единственный источник истины. Из него выводятся доменные типы, с ним сверяются enum'ы `manifest.schema.json`, он экспортируется в `docs/contracts/capabilities.json` (`npm run capabilities:write`, проверяется в CI через `npm run capabilities:check`) и отдаётся по `GET /capabilities`. Добавление механики = новый модуль + запись в реестре, без правок `routes/practice/index.ts` и `sandbox/provisioner.ts`.
- Backend слушает только 127.0.0.1; внешних сервисов нет.
- Данные Postgres — только в именованном volume; healthcheck обязателен, ожидание готовности — через healthcheck, не `sleep`.
- Frontend ходит только в HTTP API backend — к Postgres напрямую никогда.
- Экспорт прогресса — версионированный app-level JSON (не pg_dump); метка времени и id/версии курсов внутри файла.
- Скрипт запуска не открывает браузер: печатает готовый адрес; сообщения человекочитаемые, «как инсталлер».
