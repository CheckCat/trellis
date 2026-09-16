# task-005 — Dockerfile fix (backend migrations not shipped to runtime image)

## Что изменено

`services/backend/Dockerfile`, две правки:

1. **Основной фикс (в границе задачи).** Runtime stage теперь копирует
   `services/backend/migrations` из builder-стадии рядом с `dist/`:

   ```dockerfile
   COPY --from=builder /app/services/backend/dist services/backend/dist
   COPY --from=builder /app/services/backend/migrations services/backend/migrations
   ```

2. **Побочный фикс, вскрытый первой же реальной сборкой (см. п.3 ниже).**
   Builder stage не копировал корневой `tsconfig.base.json`, а
   `services/backend/tsconfig.json` его `extends`-ит (`"../../tsconfig.base.json"`,
   т.е. `/app/tsconfig.base.json` в образе) — сборка падала на `tsc` с
   `TS5083: Cannot read file '/app/tsconfig.base.json'`, ещё до моего изменения
   (это не связано с миграциями, чисто отсутствующий COPY). Добавлена строка
   `COPY tsconfig.base.json ./` в builder stage перед копированием исходников
   backend. Больше в проекте общих tsconfig нет (проверено — `tsconfig.base.json`
   единственный в корне).

Ничего другого в Dockerfile не менял. `.dockerignore` (корневой и
`services/backend/.dockerignore`, которого не существует) трогать не
понадобилось — миграции не подпадают под исключения корневого
`.dockerignore` (`node_modules`, `dist`, `.git`, `.env`).

## Почему путь разрешается именно так

`services/backend/src/db/migrate.ts`:

```ts
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);
```

Это `import.meta.url`-путь **относительно скомпилированного файла**, не cwd
и не переменная окружения. В builder stage TS компилирует `src/db/migrate.ts`
в `dist/db/migrate.js` (`outDir: dist`, `rootDir: src` — см.
`services/backend/tsconfig.json`). В runtime-образе `dist/` копируется в
`/app/services/backend/dist`, то есть скомпилированный файл лежит в
`/app/services/backend/dist/db/migrate.js`. `../../` от `dist/db` — это
`/app/services/backend`, плюс `migrations` → `/app/services/backend/migrations`.
Значит каталог миграций должен лежать **рядом с `dist/`**, на один уровень
внутри `services/backend/`, а не внутри `dist/` и не где-либо ещё
(WORKDIR рантайм-стадии — `/app/services/backend`, что совпадает).

Комментарий в самом `migrate.ts` (строки 31–34) это прямо фиксирует:
«migrate.js/migrate.ts always ends up exactly two directories below
services/backend ... so this resolves to services/backend/migrations in
every one of those layouts» — то есть контракт пути к миграциям
зафиксирован backend-implementer'ом как инвариант, я его не менял, только
обеспечил, чтобы Dockerfile ему соответствовал.

## Проверки (реально выполненные, не на глаз)

### 1. Сборка образа

```
docker build -f services/backend/Dockerfile -t trellis-backend-verify .
```

— до фикса tsconfig падала на `tsc -p tsconfig.json` (`TS5083`). После
добавления `COPY tsconfig.base.json ./` — собралась успешно, все шаги
`DONE`, финальный `exporting to image ... naming to
docker.io/library/trellis-backend-verify:latest done`.

### 2. Содержимое образа

```
$ docker run --rm trellis-backend-verify sh -c "pwd && ls -la"
/app/services/backend
drwxr-xr-x dist
drwxr-xr-x migrations
-rw-r--r-- package.json

$ docker run --rm trellis-backend-verify ls -la /app/services/backend/migrations
-rw-r--r-- 001_progress.sql

$ docker run --rm trellis-backend-verify sh -c \
    "ls -la \$(node -e \"console.log(require('path').resolve('/app/services/backend/dist/db','../../migrations'))\")"
resolved: /app/services/backend/migrations
-rw-r--r-- 001_progress.sql
```

Путь, который реально вычисляет `DEFAULT_MIGRATIONS_DIR` в рантайме
(`dist/db` → `../../migrations`), разрешается в каталог, где файл
`001_progress.sql` фактически присутствует.

### 3. Полный стек + healthcheck

```
cp .env.example .env   # пароли заменены на непустые тестовые значения
docker compose up -d postgres backend
```

- `trellis-postgres-1` → `Healthy` (штатный healthcheck `pg_isready`).
- `trellis-backend-1` → `Healthy` через ~несколько секунд (healthcheck
  `GET /health` из compose).
- Логи backend: `Server listening at http://127.0.0.1:3001` /
  `http://172.31.0.3:3001`, затем успешный `GET /health` → `200`.
- `curl http://127.0.0.1:3001/health` с хоста → `{"status":"ok","db":"ok"}`,
  `HTTP 200`.
- Прямая проверка в БД, что миграция реально применилась:
  ```
  docker exec trellis-postgres-1 psql -U postgres -d trellis \
    -c "select version from core.schema_migrations;"
   version
  --------------
   001_progress
  ```

Это подтверждает исходную гипотезу задачи: без фикса `runMigrations()`
упал бы с ENOENT на пустом/отсутствующем каталоге миграций при первом же
`docker compose up`.

## Уборка после проверки

- `docker compose down -v` — контейнеры, сеть и volume `trellis_pgdata`
  удалены.
- `.env` удалён (`rm -f .env`) — подтверждено `ls .env` → No such file.
- `trellis-backend-verify` образ удалён (`docker image rm`).
- Дополнительно удалён образ `trellis-backend:latest`, который
  `docker compose up` собрал сам под именем проекта (не запрашивался явно
  в брифе, но это тоже верификационный побочный артефакт — оставлять его
  не было смысла).
- `git status` после уборки: единственное изменение — `services/backend/Dockerfile`
  (modified). `.mvp/briefs/task-006.md` — untracked, не мой файл, не трогал.

## Дополнение: тот же дефект в `services/frontend/Dockerfile`

Координатор попросил проверить гипотезу, что второй сервис страдает тем же
классом бага (builder не копирует `tsconfig.base.json`, а
`services/frontend/tsconfig.json` его `extends`-ит). Не чинил вслепую —
сначала воспроизвёл сборкой.

### Воспроизведение (до фикса)

```
docker build -f services/frontend/Dockerfile -t trellis-frontend-verify .
```

Упало на том же месте, что и backend, ровно с той же ошибкой:

```
#15 [builder 7/7] RUN npm run build -w @trellis/frontend
> build
> tsc -b && vite build
error TS5083: Cannot read file '/app/tsconfig.base.json'.
npm error command sh -c tsc -b && vite build
ERROR: process "/bin/sh -c npm run build -w @trellis/frontend" did not complete successfully: exit code: 1
```

Гипотеза подтверждена фактической сборкой.

### Фикс

`services/frontend/Dockerfile`, builder stage — добавлена одна строка перед
копированием исходников, тем же паттерном, что в backend (единообразие
важнее локальной элегантности):

```dockerfile
COPY tsconfig.base.json ./
COPY services/frontend services/frontend
```

Больше ничего в Dockerfile/nginx.conf не менял — `.dockerignore` тоже не
трогал, репозиторный `.dockerignore` не исключает ничего нужного для
frontend-сборки.

### Проверка после фикса

Пересборка:

```
docker build -f services/frontend/Dockerfile -t trellis-frontend-verify .
```

— прошла полностью, включая `vite build`:

```
#16 [builder 8/8] RUN npm run build -w @trellis/frontend
> tsc -b && vite build
vite v8.3.0 building client environment for production...
✓ 16 modules transformed.
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-cX2Q4vq5.css    1.20 kB │ gzip:  0.53 kB
dist/assets/index-eTiJ54up.js   220.59 kB │ gzip: 69.09 kB
✓ built in 79ms
...
naming to docker.io/library/trellis-frontend-verify:latest done
```

Содержимое runtime-образа (`nginx:alpine`):

```
$ docker run --rm trellis-frontend-verify sh -c "ls -la /usr/share/nginx/html"
50x.html
assets/
index.html

$ docker run --rm trellis-frontend-verify cat /usr/share/nginx/html/index.html
<!doctype html>
...
<script type="module" crossorigin src="/assets/index-eTiJ54up.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-cX2Q4vq5.css">
...

$ docker run --rm trellis-frontend-verify cat /etc/nginx/conf.d/default.conf
# (полный кастомный конфиг с /api/ proxy_pass и SPA fallback — на месте,
#  не дефолтный nginx:alpine конфиг)
```

Собранная статика реально лежит по пути, который ждёт nginx
(`/usr/share/nginx/html/index.html` + `assets/`), конфиг на месте.

Отдельная проверка `docker run --rm trellis-frontend-verify nginx -t` вне
compose-сети падает с `host not found in upstream "backend"` — это не баг,
а ожидаемое следствие резолва `backend` через compose DNS (сервис
недоступен вне сети `trellis_default`). Проверено полным стеком ниже.

### Проверка полным стеком (postgres + backend + frontend)

```
cp .env.example .env   # пароли заменены на непустые тестовые значения
docker compose up -d postgres backend frontend
```

- `trellis-postgres-1` → `Healthy`.
- `trellis-backend-1` → `Healthy`.
- `trellis-frontend-1` → `Healthy` (healthcheck `wget --spider http://127.0.0.1:80/`),
  лог nginx показывает успешный `GET / HTTP/1.1" 200`.
- С хоста:
  ```
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/
  HTTP 200
  curl -s http://127.0.0.1:3000/api/health
  {"status":"ok","db":"ok"}
  ```
  — `/api/` proxy_pass до backend через compose-сеть работает, значит
  `nginx -t`-ошибка про `backend` upstream выше действительно была только
  артефактом изолированного `docker run` без сети, не реальным дефектом.

Других поломок в frontend-образе сборка не вскрыла.

### Уборка

- `docker compose down -v` — контейнеры/сеть/volume удалены.
- `.env` удалён, подтверждено `ls .env` → No such file.
- Удалены образы `trellis-frontend-verify`, а также `trellis-frontend:latest`
  и `trellis-backend:latest`, которые `docker compose up` собрал сам под
  именем проекта.
- `docker images | grep trellis` → пусто, `docker ps -a | grep trellis` →
  пусто, `docker volume ls | grep trellis` → пусто.
- `git status`: изменения только в `services/backend/Dockerfile` и
  `services/frontend/Dockerfile` (плюс этот report-файл и чужой untracked
  `.mvp/briefs/task-006.md`, не мой).

### Границы

`services/frontend/src`, `package.json`, `tsconfig.json` не трогал — корень
проблемы был исключительно в Dockerfile (отсутствующий COPY), не в
конфигурации/исходниках frontend, так что возврата frontend-implementer'у
не требуется.

## Deferred decisions

- Копирую `migrations/` командой `COPY --from=builder ...` (тем же паттерном,
  что и `dist/`), а не напрямую из контекста сборки (`COPY services/backend/migrations ...`).
  Обоснование: единообразие с уже существующей строкой и с тем, что builder
  stage уже гарантированно содержит актуальный `services/backend/migrations`
  (скопирован туда как часть `COPY services/backend services/backend`) — не
  вижу причины заводить второй источник копирования для той же директории.
