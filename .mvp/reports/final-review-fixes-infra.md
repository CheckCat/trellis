# Final review fixes — infra half (docker-compose, Dockerfiles, nginx, CI)

Все пункты финального ревью (Critical + Important 1–5 + мелочи), закреплённые
за инфраструктурной границей, исправлены одним заходом. Каждый пункт ниже —
что изменено, почему именно так, и реальный вывод проверки (не «должно
работать», а «запустил и увидел»).

## Critical — nginx кеширует IP backend навсегда

**Файл:** `services/frontend/nginx.conf`.

Фикс — ровно как предложил ревьюер:
```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
...
location /api/ {
    set $upstream backend;
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://$upstream:3001;
    ...
}
```
`resolver 127.0.0.11` — это Docker embedded DNS, доступный внутри любого
контейнера на пользовательской сети (`trellis_default`). Переменная в
`proxy_pass` заставляет nginx резолвить `backend` заново на каждый запрос
(с кэшем не дольше `valid=10s`), а не один раз при старте воркера. Побочный
эффект переменной в `proxy_pass` — nginx перестаёт сам обрезать префикс
`/api/` (это поведение работает только для литерального URL), поэтому явный
`rewrite ^/api/(.*)$ /$1 break;` возвращает прежнее поведение
(`GET /api/health` → `GET /health` на бэкенде), это проверено ниже.

Также по просьбе ревьюера — `docker-compose.yml`, healthcheck frontend
`/` → `/api/health` (см. отдельный блок в правках compose ниже): «зелёный»
теперь значит «API реально достижим через nginx», а не «nginx жив».

### Реальное воспроизведение бага и фикса

1. Поднял полный стек (`postgres`+`backend`+`frontend`), все `healthy`.
2. Освободил IP `172.31.0.3` у backend (`docker compose rm -f backend`),
   занял его временным `alpine`-контейнером на той же сети, чтобы
   гарантировать, что пересозданный backend получит **другой** IP (иначе
   Docker мог бы выдать тот же адрес обратно и тест ничего бы не доказывал).
3. Поднял backend заново — получил `172.31.0.5` (было `172.31.0.3`).
4. **Без перезапуска frontend** (`StartedAt` контейнера frontend не
   менялся):
   ```
   curl http://127.0.0.1:3000/api/health
   {"status":"ok","db":"ok"}
   HTTP 200
   ```
   Повторил 4 раза с интервалом 4с (покрывает окно больше `valid=10s`) —
   стабильно `200` каждый раз.
5. `docker compose ps` — весь стек `healthy`, включая frontend по новому
   healthcheck (`/api/health`).

До фикса (в исходном отчёте ревьюера) тот же сценарий давал `502` на
`/api/health` бесконечно, пока не перезапускали frontend вручную — сейчас
не воспроизводится.

## Important 1 — CI не гоняет БД-тесты

**Файлы:** `.github/workflows/ci.yml`, `.mvp/ci-mirror.sh`.

`ci.yml`: добавлен `services: postgres: image: postgres:17-alpine` (health
check `pg_isready`), и шаг `Set up CI database roles and schemas`, который
прогоняет **те же самые** `docker/postgres/init/01-roles.sql` и
`02-schemas.sql`, что и `00-init.sh` в docker-compose (единый источник
правды, никакого дублирования SQL). Тестовая БД — `trellis_test`
(disposable, живёт только время job'а), `DATABASE_URL` и
`TRELLIS_TEST_DATABASE_URL` указывают на неё же (в CI нет «настоящей»
дев-базы, которую нужно защищать от разрушительных тестов — в отличие от
локальной машины разработчика, где это два разных инстанса, см.
docstring в `migrate.test.ts`/`pool.test.ts`).

Нюанс: `02-schemas.sql` содержит нежёстко захардкоженный
`GRANT CREATE ON DATABASE trellis TO trellis_sandbox` (имя БД не
параметризовано — совпадает с `POSTGRES_DB: trellis` в проде). Я не стал
менять этот SQL-файл (это увеличило бы диффф и меняло бы поведение прод-
скрипта без необходимости) — вместо этого шаг CI создаёт пустую
служебную БД `trellis` исключительно для того, чтобы этот `GRANT`
разрешился; никто в неё больше не подключается. Явно закомментировано в
`ci.yml`.

`.mvp/ci-mirror.sh`: сама последовательность npm-команд (`ci` → `lint`
→ `build` → `test`) осталась той же, в том же порядке — это единственный
контракт этого файла, и он не нарушен. Добавлен только комментарий,
документирующий асимметрию: локально нет эфемерного Postgres-сервиса,
поэтому БД-тесты по-прежнему скипаются с тем же сообщением, что и раньше
(это не регрессия — так было и до этой правки), плюс инструкция, как
получить то же покрытие локально.

### Проверка

- `.mvp/ci-mirror.sh` без `DATABASE_URL`/`TRELLIS_TEST_DATABASE_URL` —
  прогнан в изолированном git worktree поверх `HEAD` (см. методичку в
  разделе «Как проверялось» ниже, почему worktree, а не текущее дерево):
  ```
  EXIT: 0
  # tests 56
  # pass 51
  # fail 0
  # skipped 5
  ```
  Скипы — ровно те же 5 БД-тестов, с тем же обоснованием, что и раньше
  (`DATABASE_URL is not set` / `TRELLIS_TEST_DATABASE_URL is not set`).
  Зелёный прогон без переменных подтверждён.
- Сам `ci.yml` не прогонялся через `act`/реальный GitHub Actions runner
  (недоступен в этом окружении) — валидирован построчно и логикой: те же
  `psql`-вызовы, что делает `00-init.sh`, с теми же аргументами (`-v
  app_password=`, `-v sandbox_password=`), против localhost:5432 сервиса,
  который GH Actions публикует на хост-раннере через `ports: - 5432:5432`
  (документированный паттерн GH Actions для service containers). `psql`
  предполагается предустановленным в `ubuntu-latest` (стандартно для
  GitHub-hosted раннеров) — если это когда-то перестанет быть так, шаг
  упадёт явно и громко (`ON_ERROR_STOP=1` везде), а не тихо разъедет
  локальный/CI прогон.

## Important 2 — `.dockerignore` не покрывал вложенные `node_modules`/`dist`

**Файл:** `.dockerignore` (корневой).

Было: `node_modules`, `dist` без `**/` — матчат только корень контекста
сборки. Стало: `**/node_modules`, `**/dist`, `**/dist-test`,
`**/*.tsbuildinfo`, плюс `.superpowers`, `.mvp`, `docs` (не нужны ни
одному образу, зря раздувают контекст).

### Реальное воспроизведение (не гипотеза, а измеренный эффект)

Положил маркер-файлы на хосте:
`services/backend/node_modules/ajv/MARKER_FROM_HOST_NODE_MODULES` и
`services/backend/dist/MARKER_FROM_HOST_DIST` (в реальном рабочем дереве
на диске уже были и настоящий вложенный `node_modules` с `ajv`, и `dist` —
ровно то, что описал ревьюер).

- Собрал `services/backend/Dockerfile` (`--target builder`) со **старым**
  `.dockerignore` (без `**/`): оба маркера **обнаружены** внутри образа
  (`LEAKED: node_modules marker present`, `LEAKED: dist marker present`).
- Собрал тот же таргет с **новым** `.dockerignore`: оба маркера
  **отсутствуют** (`CLEAN`).

Маркеры и временные образы убраны после теста
(`rm` на хосте, `docker image rm`).

Отдельно стоит зафиксировать находку по пути: то, что `services/backend/
node_modules/{ajv,fast-uri,json-schema-traverse}` присутствует в
финальном builder-образе — это **не** утечка хоста, а легитимный результат
`RUN npm ci` внутри самого образа (npm workspaces решил не хоистить эти
три пакета в корневой `node_modules`, а положить рядом с потребляющим их
воркспейсом — обычное поведение npm при конфликте версий/дедупликации).
Это подтверждено отдельным прогоном: `RUN npm ci` в builder-стадии
создаёт этот путь ещё **до** `COPY services/backend services/backend`
(то есть до того, как .dockerignore вообще может повлиять на этот
конкретный путь). Значит воспроизводимость сборки тут не под угрозой сама
по себе — под угрозой было именно смешение с хостовым состоянием при
последующем `COPY`, что и показал маркер-тест выше.

### Пересборка обоих образов после правки

```
docker build -f services/backend/Dockerfile -t trellis-backend-verify .
# ... naming to docker.io/library/trellis-backend-verify:latest done

docker build -f services/frontend/Dockerfile -t trellis-frontend-verify .
# ... naming to docker.io/library/trellis-frontend-verify:latest done
```
Оба собрались без ошибок.

## Important 3 — ложный комментарий про идемпотентность паролей

**Файл:** `docker/postgres/init/01-roles.sql`.

Комментарий переписан на правду: `ALTER ROLE ... PASSWORD` не даёт
идемпотентность на переприменение в рантайме, потому что
`/docker-entrypoint-initdb.d` официального образа Postgres выполняется
**только** на пустом volume — сменить пароль в `.env` после первого
запуска и рассчитывать, что он подхватится, нельзя (это доедет только
через `docker compose down -v`, то есть с потерей данных). Смысл `ALTER`
здесь — не «переприменение на живом стенде», а согласованность между
веткой «роль только что создана» (`CREATE ROLE`) и веткой «роль почему-то
уже была» (например, ручной повторный прогон файла против того же
volume), обе ветки должны кончаться одним и тем же паролем.

Задачу «пользователь сменил пароль и получил кирпич» **не решаю** — по
явной инструкции координатора это вход для будущей задачи 018 (ротация
паролей), здесь только честная документация существующего поведения.

**Файл:** `.env.example` — добавлено заметное предупреждение в стиле
инсталлера прямо над секцией паролей: пароли фиксируются при первом
запуске, менять их после — путь к бесконечному рестарту backend с потерей
доступа к volume (см. дословный текст в файле).

### Реальное воспроизведение (холодный старт со сломанным паролем)

1. Полный `docker compose down -v` (чистый volume), `docker compose up -d
   postgres` — дождался `healthy` (роль `trellis_app` создана с паролем
   `verify_app_pass_1` из `.env`).
2. Поменял `APP_DB_PASSWORD` в `.env` на заведомо неверное значение (не
   трогая volume) — именно сценарий «сменил пароль в `.env` после первого
   запуска».
3. `docker compose up -d backend frontend`.
4. Backend лог:
   ```
   password authentication failed for user "trellis_app"
   ```
   контейнер уходит в `Restarting (1)` бесконечно (как и предсказывал
   ревьюер) — единственный выход из этого состояния возвращением к
   рабочему паролю в `.env` или `down -v`, что и подтверждает переписанный
   комментарий в `01-roles.sql`.

Это же воспроизведение по совместительству — проверка Important 4 (см.
ниже), потому что оба пункта используют один и тот же сломанный стенд.

## Important 4 — фронт не стартует, если backend нездоров

**Файл:** `docker-compose.yml` — `frontend.depends_on.backend.condition`:
`service_healthy` → `service_started`. Порядок запуска (`postgres` →
`backend` → `frontend`) сохраняется, но frontend больше не блокируется
здоровьем backend.

### Проверка (продолжение сценария Important 3 выше — backend навсегда
`Restarting` из-за неверного пароля)

```
docker compose ps
trellis-backend-1    ...  Restarting (1) 2 seconds ago
trellis-frontend-1   ...  Up 17 seconds (health: starting)
trellis-postgres-1   ...  Up 23 seconds (healthy)

curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/
HTTP 200

curl http://127.0.0.1:3000/api/health
502 Bad Gateway   # ожидаемо: backend реально недоступен, а не подделка
```
До фикса это состояние давало `dependency failed to start: container
trellis-backend-1 is unhealthy`, frontend оставался в `Created`, а
`curl :3000/` — `Connection refused`. Сейчас frontend поднимается и
честно отвечает на `/` (страница/бандл задачи 004 получает шанс
отрисоваться и увидеть недоступность API сама, через свой собственный
`fetch` на `/api/*`, а не через отказ TCP-соединения на уровне браузера).

## Important 5 — нет timeout'ов у sandbox-роли

**Файл:** `docker/postgres/init/02-schemas.sql`:
```sql
ALTER ROLE trellis_sandbox SET statement_timeout = '30s';
ALTER ROLE trellis_sandbox SET idle_in_transaction_session_timeout = '60s';
```
`trellis_app` не ограничен — по прямой инструкции координатора (миграции
могут быть долгими).

Обоснование величин (порядок, не точная наука): 30s для statement_timeout
— заведомо больше, чем должен занимать легитимный запрос практики на
учебных (маленьких) seed-данных курса, но достаточно мало, чтобы
`pg_sleep(1e9)`/декартово произведение не держали соединение пула
неограниченно. 60s для idle-in-transaction — достаточно, чтобы не обрывать
нормальную «думательную паузу» пользователя внутри явной транзакции
(переключился на вкладку с документацией, читает объяснение к
упражнению), но достаточно мало, чтобы закрытая вкладка/упавший браузер не
держали слот пула вечно.

### Проверка
```sql
select rolname, rolconfig from pg_roles where rolname in ('trellis_sandbox','trellis_app');

     rolname     |                                      rolconfig
-----------------+---------------------------------------------------------------------------------------
 trellis_app     | {search_path=core}
 trellis_sandbox | {search_path=sandbox,statement_timeout=30s,idle_in_transaction_session_timeout=60s}
```
Значения реально применились на свежем volume (первичная инициализация).

## Мелочи

- **Логи без ротации.** `docker-compose.yml` — секция `logging: {driver:
  json-file, options: {max-size: "10m", max-file: "3"}}` добавлена всем
  трём сервисам (`postgres`, `backend`, `frontend`). Верхняя граница
  30 МБ на сервис вместо неограниченного роста.
- **Backend работал от root.** `services/backend/Dockerfile` — `USER
  node` перед финальным `WORKDIR`/`CMD` (node:22-alpine несёт готового
  непривилегированного пользователя `node`, uid 1000 — используется он,
  без создания нового). Проверено: `docker run --rm trellis-backend-
  verify sh -c "whoami && id"` → `node`, `uid=1000(node)`.
- **Нет security-заголовков у nginx.** `services/frontend/nginx.conf` —
  добавлены `Content-Security-Policy`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (детали и
  реальная browser-проверка — в разделе Critical выше, так как это тот же
  файл и та же серия правок). CSP явно ограничен тем, что реально
  собирает Vite (`script-src 'self'`, `style-src 'self'`, никакого
  `unsafe-inline` — проверено, что приложение в чистом виде не использует
  ни inline `<script>`, ни inline `style=` атрибуты).
- **`courses/` не в репозитории.** Создан `courses/.gitkeep` — каталог
  теперь появляется при `git clone`, а не только неявно через
  `docker compose up`'s volume mount.
- **Мёртвая `sh -c` обёртка в корневом `package.json`.** Упрощено:
  ```json
  "lint": "npm run lint --workspaces --if-present",
  "build": "npm run build --workspaces --if-present",
  "test": "npm run test --workspaces --if-present"
  ```
  Условие `[ -d services ] && [ -n "$(ls -A services)" ]` было мёртвым с
  задачи 003 (сервисы существуют с тех пор) и без пользы делало скрипты
  зависимыми от POSIX shell. `bash .mvp/ci-mirror.sh` после этой правки
  по-прежнему `0` (см. раздел «Как проверялось»).

## Как проверялось: изоляция от параллельного backend-агента

В процессе работы в этом же рабочем дереве параллельно и одновременно
редактировал код backend другой агент (по границе задачи — это ожидаемо и
не пересекается с моей). В несколько моментов это делало `services/
backend/src/**` временно несогласованным (например, TS-ошибка компиляции
теста в процессе их правки), из-за чего голый `bash .mvp/ci-mirror.sh` в
живом рабочем дереве кратковременно возвращал ненулевой код — **не из-за
моих изменений**.

Чтобы дать честный, воспроизводимый ответ на требование «`ci-mirror.sh`
= 0», не трогая и не блокируя параллельного агента, я:
1. Завёл временный `git worktree` от последнего коммита (`be620d0`).
2. Скопировал в него **только** файлы из моей границы (список сверен
   построчно с `git status`/`git diff --name-only` в основном дереве —
   ни одного файла сверх заявленного).
3. Прогнал `bash .mvp/ci-mirror.sh` там — `EXIT: 0`, `56 tests, 51 pass,
   0 fail, 5 skipped`.
4. Удалил worktree (`git worktree remove --force`).

Отдельно, после того как параллельный агент закончил, тот же прогон **в
реальном рабочем дереве** тоже дал `EXIT: 0` (`62 tests, 57 pass, 0 fail,
5 skipped` — больше тестов, потому что бэкенд-агент добавил свои).

## Итоговые проверки (сводка, все реально выполнены)

- Пересборка обоих образов после правки `.dockerignore` — оба собрались.
- Полный подъём стека (`postgres`+`backend`+`frontend`) — все `healthy`.
- **Critical repro:** `docker compose up -d --force-recreate backend`
  (с гарантированной сменой IP через временный «IP-hog» контейнер) →
  `curl :3000/api/health` → `200`, без перезапуска frontend.
- **Cold-start repro:** сломанный `APP_DB_PASSWORD` после первого
  запуска → backend бесконечно `Restarting`, frontend поднимается и
  отвечает `200` на `/`.
- CSP реальным браузером (chrome-devtools-mcp): `list_console_messages` —
  пусто (ни одного CSP violation), `list_network_requests` — все 5
  запросов (`/`, JS, CSS, `/api/health`, favicon) вернули `200`.
- `bash .mvp/ci-mirror.sh` = 0 (и в изолированном worktree только с моими
  изменениями, и в итоге в живом дереве после завершения параллельного
  агента).
- Уборка: `docker compose down -v`, `.env` удалён (`ls .env` → No such
  file), все проверочные образы удалены (`trellis-backend-verify`,
  `trellis-frontend-verify`, промежуточные `dockerignore-debug*`/
  `marker-test-*`/`trellis-backend-builder-verify*`, а также
  self-built `trellis-backend`/`trellis-frontend` от `docker compose
  up`), временный worktree удалён, контейнер `ip-hog` удалён. `docker
  images/ps -a/volume ls | grep trellis` — пусто.

## Deferred decisions

- CI-пароли (`ci-app-role-password`, `ci-sandbox-role-password`) — простые
  литералы прямо в `ci.yml`, не GitHub Secrets: это Postgres,
  живущий только в рамках одного job'а на изолированном раннере,
  недоступный снаружи — секретность тут не нужна, а секрет усложнил бы
  подхватывание значения одновременно в `env:` job'а (для тестов) и в
  `env:` шага (для psql) без дублирования логики генерации.
- Throwaway база `trellis` в CI (см. Important 1) вместо параметризации
  `02-schemas.sql` — минимальный по площади фикс, не меняющий поведение
  прод-скрипта ради нужд CI.
- `resolver ... ipv6=off` — на compose-сети IPv6 не используется
  (`docker network` по умолчанию only-IPv4), явное отключение убирает
  лишний AAAA-запрос на каждое разрешение имени.
