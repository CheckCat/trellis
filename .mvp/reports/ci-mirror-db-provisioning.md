# ci-mirror.sh: собственный disposable Postgres + единый init-скрипт

Долг, припаркованный после финального ревью: `ci-mirror.sh` гонял те же
npm-команды, что и CI, но без БД — 5 тестов слоя данных (применение
миграций, идемпотентность, отказ при рассинхроне каталога, advisory-lock
сериализация, commit/rollback транзакций) исполнялись только в CI, никогда
локально. Зелёный `ci-mirror.sh` перестал предсказывать зелёный CI ровно
там, где это важнее всего — задача 007 будет писать именно в этот слой.

## Что изменено

### 1. `docker/postgres/init/apply-all.sh` (новый файл)

Единый источник правды «какие `.sql`-файлы и в каком порядке» для всех
трёх потребителей:
```sh
sql_dir="${1:?usage: apply-all.sh <sql_dir>}"
for f in "$sql_dir"/*.sql; do
  psql -v ON_ERROR_STOP=1 \
    -v app_password="${APP_DB_PASSWORD:?...}" \
    -v sandbox_password="${SANDBOX_DB_PASSWORD:?...}" \
    -f "$f"
done
```
Никакой connection-логики внутри — скрипт полагается на стандартные
`PG*`-переменные окружения (`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE`), которые `psql` читает сам. Это и позволяет трём вызывающим
с тремя разными способами подключения (unix-сокет внутри контейнера / TCP
до CI-сервиса / `docker exec` в одноразовый контейнер) использовать один и
тот же файл без веток `if`. Порядок — лексикографический глоб `*.sql`
(совпадает с zero-padded NN-префиксами файлов). Помечен исполняемым
(`chmod +x`, `755`, как и `00-init.sh`).

Лежит в `docker/postgres/init/` — то есть автоматически попадает и в
`/sql:ro`-mount реального docker-compose стека (тот том уже монтирует всю
директорию целиком), и подхватывается как обычный файл в CI/ci-mirror.sh
через путь в репозитории. Не исполняется автоматически entrypoint'ом
Postgres (в `/docker-entrypoint-initdb.d` смонтирован только `00-init.sh`,
как и раньше).

### 2. `docker/postgres/init/00-init.sh`

Раньше вручную звал `psql -f /sql/01-roles.sql` и `-f /sql/02-schemas.sql`.
Теперь:
```sh
export PGUSER="$POSTGRES_USER"
export PGDATABASE="$POSTGRES_DB"
sh /sql/apply-all.sh /sql
```
Валидация `APP_DB_PASSWORD`/`SANDBOX_DB_PASSWORD` (обязательные, с понятным
сообщением) не тронута — она осталась строго тем же кодом, что и раньше.

### 3. `.github/workflows/ci.yml`

Шаг `Set up CI database roles and schemas` раньше вручную перечислял
`01-roles.sql`/`02-schemas.sql`. Теперь:
```yaml
env:
  PGHOST: localhost
  PGPORT: 5432
  PGUSER: postgres
  PGPASSWORD: postgres
  APP_DB_PASSWORD: ci-app-role-password
  SANDBOX_DB_PASSWORD: ci-sandbox-role-password
run: |
  psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE trellis;"
  PGDATABASE=trellis_test sh docker/postgres/init/apply-all.sh docker/postgres/init
```
Throwaway `CREATE DATABASE trellis` (нужна только для того, чтобы
разрешился хардкоженный `GRANT ... ON DATABASE trellis` внутри
`02-schemas.sql`, matching prod's `POSTGRES_DB`) — сохранена, как и раньше
(отдельная от `apply-all.sh` забота, не часть переносимой SQL-логики).

Теперь новый `docker/postgres/init/003-что-то.sql` подхватывается
одинаково всеми тремя вызывающими без правки самих `ci.yml`/`ci-mirror.sh`
— именно то, что было обещано комментарием «single source of truth», но не
соблюдалось до этой правки (`ci.yml` раньше вручную перечислял файлы,
`00-init.sh` — тоже).

### 4. `.mvp/ci-mirror.sh` (полностью переписан)

Теперь перед npm-командами:
1. Проверяет `command -v docker`. Нет Docker → печатает
   `"ci-mirror.sh: Docker не найден, тесты слоя данных будут пропущены (5
   тестов в services/backend/src/db/*.test.ts сами себя скипнут с
   указанием причины — миграции, advisory-lock, транзакции)."` и идёт
   дальше обычным прогоном (без `DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL`
   → тесты сами скипаются тем же путём, что и раньше).
2. Есть Docker → поднимает одноразовый контейнер:
   - Имя: `trellis-ci-mirror-postgres` (фиксированное, никогда не
     `postgres` — тот принадлежит `docker-compose.yml` и не трогается).
   - Порт: `-p 127.0.0.1::5432` — Docker сам назначает свободный порт,
     никогда не `5433` (порт реального стека). Порт вычитывается через
     `docker port <container> 5432/tcp`.
   - Volume: нет именованного тома вообще (`--rm`, анонимный слой данных
     удаляется вместе с контейнером) — `trellis_pgdata` физически не может
     быть задет, скрипт даже не знает о его существовании.
   - `docker/postgres/init` монтируется в контейнер как `/sql:ro` — тот же
     приём, что в реальном compose-стеке, поэтому `apply-all.sh`
     запускается через `docker exec` без необходимости иметь `psql` на
     хосте разработчика.
3. Ждёт готовности через `pg_isready` в цикле (до 30 попыток по 1с,
   громкий таймаут-эксит при неудаче) — не `sleep N`.
4. Прогоняет `apply-all.sh` (через `docker exec`) — тот же файл, что и CI,
   что и реальный `00-init.sh`.
5. Экспортирует `DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL`, обе — на
   `trellis_test` в одноразовом контейнере (то же обоснование, что уже
   было у CI: здесь нет «настоящей» дев-базы, которую нужно защищать).
6. `trap cleanup_ci_mirror_db EXIT INT TERM` — контейнер (`docker stop`,
   `--rm` доделывает удаление) гарантированно останавливается на любом
   выходе: успех, `set -e` из-за упавшего теста/команды, или сигнал.

npm-последовательность (`ci` → `lint` → `build` → `test`) не изменилась ни
буквой, ни порядком — всё так же совпадает с `ci.yml`. Шапка файла
переписана: старый комментарий про «одну намеренную асимметрию» снят,
теперь честно описывает, что асимметрии больше нет (кроме поведения при
отсутствии Docker, которое явно объявлено и не молчаливое).

## Проверки (реальный вывод, не «должно работать»)

### `bash .mvp/ci-mirror.sh` на машине с Docker → 62 теста, 0 skipped

```
ci-mirror.sh: starting disposable test Postgres (trellis-ci-mirror-postgres)...
ci-mirror.sh: waiting for it to accept connections...
ci-mirror.sh: applying docker/postgres/init/*.sql (docker/postgres/init/apply-all.sh — same script CI and the docker-compose stack use)...
CREATE DATABASE
apply-all.sh: applying /sql/01-roles.sql
CREATE ROLE
CREATE ROLE
ALTER ROLE
ALTER ROLE
apply-all.sh: applying /sql/02-schemas.sql
...
ci-mirror.sh: disposable test Postgres ready on 127.0.0.1:59483 (db trellis_test).
...
# tests 62
# pass 62
# fail 0
# skipped 0
...
ci-mirror.sh: stopping disposable test Postgres (trellis-ci-mirror-postgres)...
EXIT: 0
```
Контейнер после — `docker ps -a | grep trellis-ci-mirror` пусто.

### Тот же прогон при поднятом рабочем стеке — рабочие данные целы

1. `cp .env.example .env` (пароли заполнены), `docker compose up -d
   postgres backend` — холодный старт на свежем `trellis_pgdata`, новый
   `00-init.sh` (через `apply-all.sh`) отработал без проблем:
   ```
   /usr/local/bin/docker-entrypoint.sh: running /docker-entrypoint-initdb.d/00-init.sh
   00-init.sh: роли и схемы созданы (trellis_app/core, trellis_sandbox/sandbox)
   ```
   `backend` — `healthy` (значит и миграции 001_progress тоже прошли).
2. Положил маркерную строку до прогона:
   ```sql
   insert into core.lesson_progress (course_id, lesson_id, status)
   values ('probe-course', 'probe-lesson', 'completed');
   ```
   Подтвердил `select` → строка на месте.
3. `bash .mvp/ci-mirror.sh` при поднятом стеке (`postgres` на `127.0.0.1:
   5433`, `backend` на `:3001`) → `EXIT: 0`, `62 tests / 62 pass / 0
   skipped` — то же самое, что и без стека.
4. После прогона:
   - `docker compose ps` — `trellis-backend-1`/`trellis-postgres-1`
     по-прежнему `healthy`, **не пересозданы**
     (`StartedAt` контейнера `postgres` не изменился между шагом 1 и
     проверкой после).
   - `select course_id, lesson_id, status from core.lesson_progress;` →
     строка `probe-course | probe-lesson | completed` всё ещё там.
   - `curl http://127.0.0.1:3001/health` → `{"status":"ok","db":"ok"}`.
   - `trellis-ci-mirror-postgres` — чист, не остался.

### Прогон с намеренно падающим тестом → контейнер всё равно удалён

Тестовые файлы и код сервисов не трогал (вне границы). Вместо этого сделал
временную копию `ci-mirror.sh` в scratchpad с последней строкой, заменённой
на `false` (симуляция «тесты упали» — проверяется именно инфраструктурный
механизм `trap`, а не содержимое тестов):
```
ci-mirror-fail-test.sh: simulating a failing test suite
ci-mirror.sh: stopping disposable test Postgres (trellis-ci-mirror-postgres)...
EXIT: 1
```
Контейнер после — чист (`docker ps -a | grep trellis-ci-mirror` → пусто).

### Эмуляция Ctrl-C (SIGINT) → контейнер всё равно удалён

Прямой `kill -INT <pid>` фонового `bash ci-mirror.sh &` в этом инструменте
ничего не делает: фоновые задания non-interactive shell'а наследуют
`SIG_IGN` для `SIGINT`/`SIGQUIT` (классическое поведение job control —
чтобы Ctrl-C в терминале не убивал задания в фоне), и это наследуется даже
через `setsid`/`exec` (игнорируемая диспозиция сигнала переживает `exec`).
Чтобы получить условия, эквивалентные настоящему Ctrl-C в терминале (где
шелл — foreground process group, `SIGINT` не игнорируется), запустил
скрипт через обёртку, которая явно ставит `SIGINT`/`SIGTERM` в `SIG_DFL`
перед `exec`:
```python
os.setsid()
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGTERM, signal.SIG_DFL)
os.execvp('bash', ['bash', '.mvp/ci-mirror.sh'])
```
Дождался (поллингом, не `sleep`), пока `trellis-ci-mirror-postgres`
реально появится в `docker ps`, отправил `SIGINT` всей группе процессов
(`kill -INT -$PGID`):
```
container observed running after 2s
sending SIGINT to process group ...
script exited
wait exit code: 130
ci-mirror.sh: stopping disposable test Postgres (trellis-ci-mirror-postgres)...
=== container status after Ctrl-C ===
clean: container removed after Ctrl-C
```
`130` — стандартный код завершения по `SIGINT` (128+2), подтверждает, что
скрипт действительно был прерван сигналом, а не завершился штатно.

### CI-рецепт не разъехался

Прогнал новый общий шаг ровно так, как его вызывает `ci.yml` (`PGHOST=
localhost`, host-`psql`, throwaway `CREATE DATABASE trellis` +
`PGDATABASE=trellis_test sh docker/postgres/init/apply-all.sh
docker/postgres/init`) против одноразового контейнера с портом,
проброшенным на хост как в GH Actions `services:`:
```
CREATE DATABASE
apply-all.sh: applying docker/postgres/init/01-roles.sql
...
apply-all.sh: applying docker/postgres/init/02-schemas.sql
...
EXIT: 0
     rolname
-----------------
 trellis_app
 trellis_sandbox
(2 rows)

 nspname
---------
 core
 sandbox
(2 rows)
```
Роли и схемы созданы корректно тем же путём, каким их создаёт `ci.yml`.

### Финальная уборка

- `docker compose down -v`, `.env` удалён (`ls .env` → No such file).
- Проверочный контейнер `ci-recipe-check-postgres` (для проверки
  CI-рецепта) удалён вручную.
- Все запущенные в ходе проверок `trellis-ci-mirror-postgres` уже
  самоликвидировались через `--rm` + `docker stop` в trap.
- Обнаруженный по ходу побочный артефакт — образ `trellis-backend:latest`,
  который `docker compose up` собрал сам во время cold-start теста —
  удалён (`docker image rm trellis-backend`).
- Финально: `docker images/ps -a/volume ls | grep trellis` — пусто.
- `git status --short` — только файлы в границе:
  `.github/workflows/ci.yml` (M), `.mvp/ci-mirror.sh` (M),
  `docker/postgres/init/00-init.sh` (M), `docker/postgres/init/apply-all.sh`
  (новый) + этот report-файл.

## Deferred decisions

- Пароли одноразового контейнера (`ci-mirror-postgres-password`,
  `ci-mirror-app-role-password`, `ci-mirror-sandbox-role-password`) —
  простые литералы в скрипте, не секреты: контейнер существует только на
  время прогона на машине разработчика, порт — `127.0.0.1`-only,
  сетевой доступ снаружи исключён так же, как и у CI-инстанса.
- Имя контейнера фиксированное (`trellis-ci-mirror-postgres`), не
  параллелизуется — если понадобится параллельный запуск нескольких
  `ci-mirror.sh` на одной машине, потребуется PID/random-suffix в имени;
  не делал этого сейчас (YAGNI), но `docker rm -f` в начале скрипта
  подчищает контейнер-сироту от прежнего аварийно прерванного запуска,
  так что повторные последовательные прогоны не ломаются.
- `apply-all.sh` требует `APP_DB_PASSWORD`/`SANDBOX_DB_PASSWORD` даже для
  файлов, которые их не используют (`02-schemas.sql`) — единообразие
  важнее точечной оптимизации; будущий `03-*.sql`, которому эти переменные
  не нужны, просто не будет на них ссылаться, а их обязательность в
  `apply-all.sh` не мешает.
