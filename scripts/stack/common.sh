#!/bin/sh
# Общая часть лаунчеров Trellis (macOS / Linux).
#
# Здесь лежит всё, что одинаково у start.sh, rebuild.sh и down.sh: разговор
# с пользователем, проверка Docker и .env, поднятие стека с восстановлением
# после обрыва связи, ожидание healthcheck'ов и разбор причин отказа.
# Команды сверху остаются короткими и читаются как сценарий: видно, из каких
# шагов состоит «запустить», «пересобрать» и «остановить», и ничем другим
# они не отличаются.
#
# Файл подключается через `.` (source), исполнять его напрямую бессмысленно.
#
# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/stack/common.ps1 (и наоборот). Держать
# одну реализацию не выходит: лаунчер работает до того, как поднято хоть
# что-то, и не может полагаться ни на что, кроме того, что уже стоит в
# системе, — а это PowerShell на Windows и sh на всём остальном. Требовать
# ради самого лаунчера ещё и Node нельзя: пользователю ставится только
# Docker Desktop (сама платформа Node не требует — он внутри образов).
# Чтобы расхождение не прошло тихо, значения, которые обязаны совпадать,
# сверяет тест scripts/stack-parity.test.mjs.
#
# POSIX sh, без bash-измов: на macOS /bin/sh — это bash 3.2 в POSIX-режиме,
# на Alpine — busybox ash, и скрипт должен одинаково работать в обоих.

# --- Настройки ожиданий ----------------------------------------------------
# Щедрые, но конечные: лучше через N минут честно сказать «не дождался, вот
# журнал», чем висеть бесконечно.
DOCKER_START_TIMEOUT_SECONDS=180
POSTGRES_TIMEOUT_SECONDS=120
BACKEND_TIMEOUT_SECONDS=240
FRONTEND_TIMEOUT_SECONDS=120

DOCKER_DESKTOP_URL='https://www.docker.com/products/docker-desktop/'

# Том с данными платформы (имя задано в docker-compose.yml). Единственное
# место во всём проекте, где прогресс ученика переживает перезапуск, —
# поэтому упоминается явно везде, где речь о его судьбе.
DATA_VOLUME='trellis_pgdata'

# Как пользователь зовёт лаунчеры на этой системе. Подставляется в
# подсказки: путь, который человек видит в тексте ошибки, должен быть тем,
# который он может набрать.
START_COMMAND='./scripts/stack/start.sh'
REBUILD_COMMAND='./scripts/stack/rebuild.sh'
DOWN_COMMAND='./scripts/stack/down.sh'

# Становится 1, как только docker compose up отработал: от этого зависит,
# уместна ли в сообщении об ошибке подсказка про журналы контейнеров.
STACK_STARTED=0

# Сколько шагов в текущей команде. Выставляется вызывающим скриптом до
# первого write_step — у запуска, пересборки и остановки их разное число.
TOTAL_STEPS=0

# Привести пароли ролей к .env (ключ --sync-passwords). Разбор аргументов —
# на стороне команды, здесь только значение по умолчанию.
SYNC_PASSWORDS=0

# --- Вывод -----------------------------------------------------------------
# Цвет только если stdout — терминал: в файле или в пайпе escape-коды лишь
# мешают читать.
if [ -t 1 ]; then
    C_GREEN=$(printf '\033[32m'); C_CYAN=$(printf '\033[36m')
    C_YELLOW=$(printf '\033[33m'); C_RED=$(printf '\033[31m')
    C_GRAY=$(printf '\033[90m'); C_OFF=$(printf '\033[0m')
else
    C_GREEN=''; C_CYAN=''; C_YELLOW=''; C_RED=''; C_GRAY=''; C_OFF=''
fi

write_banner() {
    printf '\n'
    printf '  %sTrellis — %s%s\n' "$C_GREEN" "$1" "$C_OFF"
    printf '  Всё работает на этом компьютере, наружу ничего не отправляется.\n'
    printf '\n'
}

write_step()   { printf '\n  %s[%s/%s] %s%s\n' "$C_CYAN" "$1" "$TOTAL_STEPS" "$2" "$C_OFF"; }
write_detail() { printf '      %s\n' "$1"; }
write_ok()     { printf '      %s%s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
write_note()   { printf '      %s%s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }
write_raw()    { printf '      %s| %s%s\n' "$C_GRAY" "$1" "$C_OFF"; }

# Единственный путь выхода с ошибкой: заголовок проблемы + конкретные шаги.
# Контейнеры намеренно НЕ останавливаются — по ним можно смотреть журналы,
# а интерфейс (если поднялся) сам покажет своё состояние.
# Подсказки приходят построчно на stdin: в sh нет массивов, а единственная
# альтернатива — "$@" — уже занята аргументами самого скрипта.
stop_with_problem() {
    printf '\n  %sНе получилось: %s%s\n\n' "$C_RED" "$1" "$C_OFF"
    while IFS= read -r hint; do
        printf '      %s%s%s\n' "$C_YELLOW" "$hint" "$C_OFF"
    done
    # Подсказка про журналы имеет смысл только если контейнеры реально
    # запущены: на ошибке «нет Docker» или «не заполнен .env» она бы только
    # сбивала с толку.
    if [ "$STACK_STARTED" = "1" ]; then
        printf '\n'
        printf '      Что успело подняться — не тронуто: посмотреть состояние и журналы можно\n'
        printf '      командами docker compose ps и docker compose logs, а остановить всё: %s\n' "$DOWN_COMMAND"
    fi
    printf '\n'
    exit 1
}

# --- Запуск внешних команд -------------------------------------------------

# Вывод docker кладётся в файл, а не в переменную: его разбирают на предмет
# известных причин отказа, и он же печатается пользователю. DOCKER_OUTPUT
# переиспользуется — каждый вызов перезаписывает файл.
DOCKER_OUTPUT=$(mktemp)
trap 'rm -f "$DOCKER_OUTPUT"' EXIT INT TERM

# Возвращает код возврата docker; вывод — в $DOCKER_OUTPUT. Со вторым
# аргументом `stream` дополнительно печатает вывод по мере поступления
# (сборка образов идёт минуты — молчать в это время нельзя).
invoke_docker() {
    _stream=$1
    shift
    # `|| true` и явный разбор кода: `set -e` не должен прерывать скрипт на
    # неудачном docker — код возврата мы разбираем сами и превращаем в
    # человекочитаемое объяснение.
    if [ "$_stream" = "stream" ]; then
        set +e
        docker "$@" >"$DOCKER_OUTPUT" 2>&1 &
        _docker_pid=$!
        tail -f -n +1 "$DOCKER_OUTPUT" 2>/dev/null &
        _tail_pid=$!
        wait "$_docker_pid"
        _code=$?
        kill "$_tail_pid" 2>/dev/null
        wait "$_tail_pid" 2>/dev/null
        set -e
    else
        set +e
        docker "$@" >"$DOCKER_OUTPUT" 2>&1
        _code=$?
        set -e
    fi
    return "$_code"
}

docker_output() { cat "$DOCKER_OUTPUT"; }

test_docker_daemon() {
    invoke_docker quiet info --format '{{.ServerVersion}}'
}

# --- .env ------------------------------------------------------------------

# Пароль попадает в строку подключения вида
# postgres://trellis_app:<пароль>@postgres:5432/trellis, поэтому алфавит —
# только буквы и цифры: '@', ':', '/', '#', '?' в пароле ломают разбор URL
# ещё до того, как дело дойдёт до самой базы.
new_random_password() {
    LC_ALL=C tr -dc 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' \
        < /dev/urandom 2>/dev/null | dd bs=1 count=28 2>/dev/null
}

# Создаёт .env из .env.example, подставляя случайные пароли. Смысл: у
# пользователя-неразработчика не должно быть шага «открой файл и придумай
# три пароля», а пароли из примера (change-me-...) не должны становиться
# фактическими паролями базы.
new_env_file_from_example() {
    _example=$1
    _target=$2
    : > "$_target"
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            POSTGRES_PASSWORD=*|APP_DB_PASSWORD=*|SANDBOX_DB_PASSWORD=*)
                printf '%s=%s\n' "${line%%=*}" "$(new_random_password)" >> "$_target"
                ;;
            *)
                printf '%s\n' "$line" >> "$_target"
                ;;
        esac
    done < "$_example"
}

# Значение ключа из .env. Кавычки по краям снимаются — docker compose их
# тоже снимает, и проверки ниже должны смотреть на то же значение, что
# получит compose.
get_env_value() {
    _key=$1
    _file=$2
    _value=$(sed -n "s/^[[:space:]]*${_key}[[:space:]]*=//p" "$_file" | head -n 1)
    _value=$(printf '%s' "$_value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    case "$_value" in
        \"*\") _value=$(printf '%s' "$_value" | sed 's/^"//; s/"$//') ;;
        \'*\') _value=$(printf '%s' "$_value" | sed "s/^'//; s/'$//") ;;
    esac
    printf '%s' "$_value"
}

# --- Ожидание готовности сервисов ------------------------------------------

get_service_container_id() {
    invoke_docker quiet compose ps -q "$1" || return 0
    docker_output | sed '/^[[:space:]]*$/d' | head -n 1
}

# Состояние берём из docker inspect, а не из `docker compose ps --format
# json`: формат вывода compose менялся между версиями (массив против
# JSON-строк), а шаблон inspect стабилен.
get_service_state() {
    invoke_docker quiet inspect -f \
        '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' \
        "$1" || return 1
    docker_output | sed '/^[[:space:]]*$/d' | head -n 1
}

# Ядро пишет журнал в JSON, и одна его строка — это экран текста со стеком
# вызовов. Целиком такое вываливать человеку, который просто хотел запустить
# платформу, бессмысленно: причина всегда в начале строки, а полный журнал
# доступен отдельной командой (она названа в подсказках ниже по тексту).
SERVICE_LOGS=''
show_service_logs() {
    _service=$1
    printf '\n'
    write_detail "Ниже — технические подробности (последние строки журнала '$_service')."
    write_detail 'Читать их необязательно: понятное объяснение будет сразу после них.'
    invoke_docker quiet compose logs --no-color --tail 25 "$_service" || true
    SERVICE_LOGS=$(docker_output)
    printf '%s\n' "$SERVICE_LOGS" | cut -c1-300 | while IFS= read -r line; do
        write_raw "$line"
    done
    printf '\n'
}

show_failure_diagnosis() {
    _service=$1
    _title=$2
    _reason=$3

    show_service_logs "$_service"

    case "$_reason" in
        restart-loop) _what="$_title не запускается: контейнер падает и перезапускается по кругу" ;;
        exited)       _what="$_title остановилось сразу после запуска" ;;
        *)            _what="$_title не стало готовым за отведённое время" ;;
    esac

    if [ "$_service" = "postgres" ]; then
        if printf '%s' "$SERVICE_LOGS" | grep -qE 'APP_DB_PASSWORD|SANDBOX_DB_PASSWORD'; then
            stop_with_problem "$_what" <<'HINTS'
В файле .env не заполнены пароли базы — база отказалась создавать роли.
Открой .env и задай непустые POSTGRES_PASSWORD, APP_DB_PASSWORD, SANDBOX_DB_PASSWORD.
HINTS
        elif printf '%s' "$SERVICE_LOGS" | grep -qE 'database files are incompatible|incompatible version'; then
            stop_with_problem "$_what" <<HINTS
Сохранённые данные созданы другой версией Postgres.
Это чинится только удалением данных: $DOWN_COMMAND --with-data (весь прогресс будет потерян).
HINTS
        else
            stop_with_problem "$_what" <<'HINTS'
Причина — в строках журнала выше.
Полный журнал: docker compose logs postgres
HINTS
        fi
    elif [ "$_service" = "backend" ]; then
        if printf '%s' "$SERVICE_LOGS" | grep -qE 'password authentication failed'; then
            stop_with_problem "$_what" <<HINTS
Ядро не может войти в базу: пароль в .env не совпадает с паролем роли внутри базы.
Так бывает, если пароль в .env поменяли ПОСЛЕ первого запуска: база запоминает пароли
один раз, при самом первом старте, и сама по себе их больше не перечитывает.

Починить без потери прогресса:  $START_COMMAND --sync-passwords
(эта команда приводит пароли ролей в базе к тем, что сейчас в .env)

Интерфейс при этом, скорее всего, открывается, но показывает «Связи с ядром нет» —
настоящая причина не там, а в журнале выше.
HINTS
        elif printf '%s' "$SERVICE_LOGS" | grep -qE 'ECONNREFUSED|getaddrinfo|ENOTFOUND|connection refused'; then
            stop_with_problem "$_what" <<'HINTS'
Ядро не достучалось до базы по сети Docker.
Обычно помогает повторный запуск скрипта; если нет — docker compose logs postgres

Интерфейс при этом, скорее всего, открывается, но показывает «Связи с ядром нет» —
настоящая причина не там, а в журнале выше.
HINTS
        elif printf '%s' "$SERVICE_LOGS" | grep -qE 'migration|migrate|миграц'; then
            stop_with_problem "$_what" <<HINTS
Ядро не смогло применить миграции базы и поэтому не стартует (и не стартует по кругу).
Строки журнала выше называют конкретную миграцию и ошибку.
Если база была изменена вручную — верните её в исходное состояние или, как крайняя
мера, $DOWN_COMMAND --with-data (весь прогресс будет потерян).

Интерфейс при этом, скорее всего, открывается, но показывает «Связи с ядром нет» —
настоящая причина не там, а в журнале выше.
HINTS
        else
            stop_with_problem "$_what" <<'HINTS'
Причина — в строках журнала выше.
Полный журнал: docker compose logs backend

Интерфейс при этом, скорее всего, открывается, но показывает «Связи с ядром нет» —
настоящая причина не там, а в журнале выше.
HINTS
        fi
    elif [ "$_service" = "frontend" ]; then
        stop_with_problem "$_what" <<'HINTS'
Интерфейс считается готовым только когда через него отвечает ядро (проверка идёт на /api/health).
Если ядро выше отчиталось как готовое, а это — нет, посмотри: docker compose logs frontend
HINTS
    else
        stop_with_problem "$_what" <<'HINTS'
Причина — в строках журнала выше.
HINTS
    fi
}

# Возвращает управление, если сервис стал healthy; иначе печатает журнал и
# объясняет причину — разную для разных сервисов, потому что «не поднялось»
# у базы, у ядра и у интерфейса означает совершенно разные вещи.
wait_service_healthy() {
    _service=$1
    _title=$2
    _timeout=$3

    _container_id=$(get_service_container_id "$_service")
    if [ -z "$_container_id" ]; then
        stop_with_problem "контейнер '$_service' не создан" <<'HINTS'
Похоже, docker compose up отработал не полностью.
Посмотри, что он написал выше, и запусти скрипт ещё раз.
HINTS
    fi

    _started=$(date +%s)
    _last_report=$_started
    while true; do
        if _state=$(get_service_state "$_container_id"); then
            _health=$(printf '%s' "$_state" | cut -d'|' -f2)
            _status=$(printf '%s' "$_state" | cut -d'|' -f1)
            _restarts=$(printf '%s' "$_state" | cut -d'|' -f3)
            if [ "$_health" = "healthy" ]; then
                write_ok "$_title — готово."
                return 0
            fi
            # Контейнер, который упал и перезапускается по кругу, здоровым
            # не станет никогда: ждать до конца таймаута бессмысленно,
            # объясняем сразу.
            if [ "${_restarts:-0}" -ge 3 ] 2>/dev/null; then
                show_failure_diagnosis "$_service" "$_title" restart-loop
            fi
            if [ "$_status" = "exited" ] || [ "$_status" = "dead" ]; then
                show_failure_diagnosis "$_service" "$_title" exited
            fi
        fi

        _now=$(date +%s)
        _elapsed=$((_now - _started))
        if [ "$_elapsed" -ge "$_timeout" ]; then
            show_failure_diagnosis "$_service" "$_title" timeout
        fi
        if [ $((_now - _last_report)) -ge 10 ]; then
            write_detail "$_title — ещё не готово, жду (прошло $_elapsed сек из $_timeout)..."
            _last_report=$_now
        fi
        sleep 2
    done
}

# --- Смена паролей ролей ---------------------------------------------------

to_sql_literal() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

# Приводит пароли ролей в базе к тем, что записаны в .env. Работает изнутри
# контейнера через unix-сокет, где официальный образ Postgres доверяет
# суперпользователю без пароля — поэтому механизм работает даже тогда,
# когда в .env лежит уже неверный POSTGRES_PASSWORD. SQL передаётся в
# stdin, а не аргументом командной строки: пароль не должен светиться в
# списке процессов.
invoke_password_sync() {
    _app=$(to_sql_literal "$(get_env_value APP_DB_PASSWORD "$ENV_PATH")")
    _sandbox=$(to_sql_literal "$(get_env_value SANDBOX_DB_PASSWORD "$ENV_PATH")")
    _super=$(to_sql_literal "$(get_env_value POSTGRES_PASSWORD "$ENV_PATH")")

    set +e
    printf 'ALTER ROLE trellis_app WITH PASSWORD %s;\nALTER ROLE trellis_sandbox WITH PASSWORD %s;\nALTER ROLE postgres WITH PASSWORD %s;\n' \
        "$_app" "$_sandbox" "$_super" |
        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d trellis >"$DOCKER_OUTPUT" 2>&1
    _code=$?
    set -e
    if [ "$_code" -ne 0 ]; then
        docker_output | while IFS= read -r line; do write_raw "$line"; done
        stop_with_problem 'не удалось обновить пароли ролей в базе' <<'HINTS'
База запущена, но команда смены паролей завершилась ошибкой (вывод выше).
Проверь, что в .env заданы непустые APP_DB_PASSWORD и SANDBOX_DB_PASSWORD.
HINTS
    fi
}

# --- Шаги, из которых собраны команды --------------------------------------

# Корень проекта: скрипты лежат в scripts/stack/, а docker compose ищет
# docker-compose.yml и .env в текущем каталоге. Команду можно звать откуда
# угодно, в том числе двойным щелчком.
stack_init() {
    SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
    PROJECT_DIR=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)

    if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
        stop_with_problem "в корне проекта нет docker-compose.yml" <<HINTS
Скрипт должен лежать в папке scripts/stack/ проекта Trellis, в корне которого есть docker-compose.yml.
Сейчас корнем считается: $PROJECT_DIR
HINTS
    fi
    cd "$PROJECT_DIR"

    ENV_PATH="$PROJECT_DIR/.env"
    ENV_EXAMPLE_PATH="$PROJECT_DIR/.env.example"
}

# Docker установлен и умеет compose v2. Про «запущен ли демон» — отдельно:
# остановке контейнеров незапущенный Docker не мешает (останавливать нечего),
# а запуску мешает.
ensure_docker_installed() {
    if ! command -v docker >/dev/null 2>&1; then
        stop_with_problem 'Docker не установлен (или не виден этой консоли)' <<HINTS
Trellis работает в контейнерах — без Docker Desktop платформу не запустить.
Установи Docker Desktop: $DOCKER_DESKTOP_URL
После установки запусти Docker и повтори запуск этого скрипта.
HINTS
    fi

    if ! invoke_docker quiet compose version --short; then
        stop_with_problem 'установленный Docker не умеет "docker compose"' <<HINTS
Нужен Docker Compose v2 — он входит в состав современного Docker Desktop.
Обнови Docker Desktop: $DOCKER_DESKTOP_URL
HINTS
    fi
}

# Демон Docker отвечает; на macOS — при необходимости поднимаем Docker
# Desktop сами и ждём его.
ensure_docker_running() {
    if test_docker_daemon; then
        write_ok 'Docker запущен.'
        return 0
    fi

    if [ "$(uname -s)" = "Darwin" ] && [ -d /Applications/Docker.app ]; then
        write_detail 'Docker Desktop не запущен — пробую запустить его сам.'
        if ! open -a Docker 2>/dev/null; then
            stop_with_problem 'не удалось запустить Docker Desktop' <<'HINTS'
macOS не дала запустить /Applications/Docker.app
Запусти Docker Desktop вручную и повтори запуск скрипта.
HINTS
        fi
        write_detail 'Жду, пока Docker Desktop будет готов (это может занять пару минут)...'
        _wait_started=$(date +%s)
        _last_report=$_wait_started
        while ! test_docker_daemon; do
            _now=$(date +%s)
            _elapsed=$((_now - _wait_started))
            if [ "$_elapsed" -ge "$DOCKER_START_TIMEOUT_SECONDS" ]; then
                stop_with_problem "Docker Desktop не поднялся за $DOCKER_START_TIMEOUT_SECONDS сек" <<'HINTS'
Открой Docker Desktop и посмотри, что он пишет: чаще всего он просит
завершить первоначальную настройку или перезапустить себя.
Когда в Docker Desktop появится статус «Engine running» — запусти скрипт снова.
HINTS
            fi
            if [ $((_now - _last_report)) -ge 15 ]; then
                write_detail "всё ещё жду Docker Desktop (прошло $_elapsed сек из $DOCKER_START_TIMEOUT_SECONDS)..."
                _last_report=$_now
            fi
            sleep 3
        done
        write_ok 'Docker Desktop готов.'
        return 0
    fi

    stop_with_problem 'Docker установлен, но не запущен' <<'HINTS'
Запусти Docker (Docker Desktop или службу docker) и повтори запуск скрипта.
На Linux это обычно: sudo systemctl start docker
HINTS
}

# .env существует и заполнен так, что стек поднимется. Побочно выставляет
# FRONTEND_PORT и BACKEND_PORT — они нужны и в сообщении об ошибке «порт
# занят», и в финальном адресе.
ensure_env() {
    if [ ! -f "$ENV_PATH" ]; then
        if [ ! -f "$ENV_EXAMPLE_PATH" ]; then
            stop_with_problem 'нет ни .env, ни .env.example' <<'HINTS'
Похоже, папка проекта скопирована не полностью — скачай её заново.
HINTS
        fi
        write_detail 'Файла .env нет — создаю его из .env.example и придумываю пароли базы за тебя.'
        new_env_file_from_example "$ENV_EXAMPLE_PATH" "$ENV_PATH"
        write_ok 'Создан файл .env со случайными паролями.'
        write_note 'Эти пароли база запомнит при первом запуске. Менять их потом можно только'
        write_note "вместе с ключом $START_COMMAND --sync-passwords — см. docs/run.md."
    fi

    MISSING_KEYS=''
    BAD_KEYS=''
    for key in POSTGRES_PASSWORD APP_DB_PASSWORD SANDBOX_DB_PASSWORD; do
        value=$(get_env_value "$key" "$ENV_PATH")
        if [ -z "$value" ]; then
            MISSING_KEYS="${MISSING_KEYS:+$MISSING_KEYS, }$key"
        # Пароли уезжают в строку подключения postgres://... — символы, у которых
        # в URL особый смысл, ломают подключение ядра раньше, чем дело дойдёт до
        # самой базы. Лучше сказать об этом здесь, чем разбирать потом невнятную
        # ошибку в журнале.
        elif printf '%s' "$value" | grep -qv '^[A-Za-z0-9._~-]\{1,\}$'; then
            BAD_KEYS="${BAD_KEYS:+$BAD_KEYS, }$key"
        fi
    done

    if [ -n "$MISSING_KEYS" ]; then
        stop_with_problem "в файле .env не заполнены: $MISSING_KEYS" <<HINTS
Открой файл $ENV_PATH и впиши непустые значения для перечисленных строк.
Это пароли внутренней базы данных на этом же компьютере — подойдут любые,
из латинских букв и цифр.
HINTS
    fi

    if [ -n "$BAD_KEYS" ]; then
        stop_with_problem "пароли в .env содержат неподходящие символы: $BAD_KEYS" <<HINTS
В паролях можно использовать латинские буквы, цифры и знаки . _ ~ -
Любые другие символы — например, @ : / ? # % или пробел — ломают подключение к базе.
Поправь файл $ENV_PATH и запусти скрипт ещё раз.
HINTS
    fi

    FRONTEND_PORT=$(get_env_value FRONTEND_PORT "$ENV_PATH"); : "${FRONTEND_PORT:=3000}"
    BACKEND_PORT=$(get_env_value BACKEND_PORT "$ENV_PATH"); : "${BACKEND_PORT:=3001}"
    write_ok 'Настройки на месте.'
}

# Сборка тянет базовые образы с Docker Hub, и обрыв связи с ним — самая
# частая случайная неудача.
# `: EOF`, а не просто `EOF`: так выглядит настоящий обрыв связи с реестром,
# тогда как голое слово EOF встречается и в других ошибках вроде
# «unexpected EOF» в разборе файла — их сюда затягивать не надо.
TRANSIENT_NETWORK_PATTERN='failed to do request|registry-1\.docker\.io|dial tcp|no such host|TLS handshake|i/o timeout|: EOF'

# Проверять надо ДО up: если тома с данными базы ещё нет, он будет создан
# ЭТИМ запуском, и init-скрипт постгреса заведёт роли с паролями из ТЕКУЩЕГО
# .env — то есть пароли гарантированно совпадут и без --sync-passwords.
# После up том уже будет существовать всегда, поэтому проверить можно
# только сейчас.
VOLUME_EXISTED_BEFORE_UP=0
remember_volume_state() {
    VOLUME_EXISTED_BEFORE_UP=0
    if invoke_docker quiet volume inspect "$DATA_VOLUME"; then
        VOLUME_EXISTED_BEFORE_UP=1
    fi
}

# Общий разбор неудачного docker compose up/build: одни и те же причины и
# одни и те же объяснения, откуда бы ни пришёл отказ.
explain_compose_failure() {
    if docker_output | grep -qE 'port is already allocated|address already in use|Ports are not available|bind: '; then
        stop_with_problem 'нужный порт уже занят другой программой' <<HINTS
Какая-то программа на этом компьютере уже слушает порт, нужный Trellis.
Открой файл $ENV_PATH и поменяй FRONTEND_PORT (сейчас $FRONTEND_PORT),
BACKEND_PORT (сейчас $BACKEND_PORT) или POSTGRES_PORT на свободные значения,
затем запусти скрипт ещё раз. Точный порт назван в выводе Docker выше.
HINTS
    elif docker_output | grep -qE 'Cannot connect to the Docker daemon|docker daemon is not running'; then
        stop_with_problem 'Docker перестал отвечать во время запуска' <<'HINTS'
Убедись, что Docker Desktop запущен («Engine running»), и повтори запуск.
HINTS
    elif docker_output | grep -qE "$TRANSIENT_NETWORK_PATTERN"; then
        stop_with_problem 'Docker не смог скачать нужные образы из интернета' <<'HINTS'
Первая сборка (и первая после обновления проекта) требует интернета: Docker
скачивает базовые образы с hub.docker.com.
Проверь подключение к интернету; если выходишь через корпоративный прокси или VPN —
настрой его в Docker Desktop (Settings → Resources → Proxies) и повтори запуск.
HINTS
    else
        stop_with_problem 'Docker не смог собрать или запустить контейнеры' <<'HINTS'
Причина — в выводе Docker выше (последние строки обычно самые важные).
Если там говорится о нехватке места — освободи место на диске и повтори.
HINTS
    fi
}

# Пересборка образов начисто. Отдельный шаг, а не флаг `up`: у `docker
# compose up` нет --no-cache, а «пересобрать по текущей репе» — это ровно
# сборка без кеша, чтобы ни один слой не остался от прошлой версии кода.
compose_build_no_cache() {
    _code=0
    invoke_docker stream compose build --no-cache --pull || _code=$?

    if [ "$_code" -ne 0 ] && docker_output | grep -qE "$TRANSIENT_NETWORK_PATTERN"; then
        printf '\n'
        write_note 'Docker не смог получить данные из интернета. Пробую ещё раз (это бывает случайно)...'
        sleep 5
        _code=0
        invoke_docker stream compose build --no-cache --pull || _code=$?
    fi

    # Здесь, в отличие от обычного запуска, отката на «ранее собранное» нет
    # и быть не может: пересборку просят именно затем, чтобы старых образов
    # не осталось. Без интернета честнее отказать.
    if [ "$_code" -ne 0 ]; then
        explain_compose_failure
    fi
    printf '\n'
    write_ok 'Образы собраны заново.'
}

# Поднимает стек. Аргумент `build` — пересобрать изменившееся перед
# запуском (обычный старт), `nobuild` — запустить как есть (после явной
# пересборки без кеша: собирать второй раз нечего).
compose_up_with_recovery() {
    _mode=$1

    # Флаг ставим до запуска, а не после: если up упадёт на полпути, часть
    # контейнеров уже будет поднята — подсказка про журналы тогда уместна.
    STACK_STARTED=1

    # --build (а не просто up): иначе после обновления исходников Docker
    # молча оставил бы собранный ранее образ, и пользователь запускал бы
    # старую версию, не понимая, почему изменения не появились.
    #
    # Осознанно без --wait — но НЕ потому, что он что-то откатывает: это
    # проверено и оказалось неверным. При неготовности `up --wait` возвращает 1
    # и оставляет контейнеры жить, так что интерфейс поднялся бы и честно
    # показал «нет связи с ядром» в любом случае.
    #
    # Настоящая причина — в том, что --wait ждёт все сервисы разом и молчит до
    # самого конца, а этот скрипт обязан рассказывать, что происходит: первая
    # сборка идёт минуты, и «База данных — готово», «Ядро платформы — готово»
    # со счётчиком ожидания — ровно то, чем он отличается от голого compose.
    # Вдобавок у каждого сервиса свой таймаут и свой разбор причины отказа
    # (show_failure_diagnosis), а --wait сообщает только «application not healthy».
    UP_CODE=0
    if [ "$_mode" = "build" ]; then
        invoke_docker stream compose up -d --build || UP_CODE=$?
    else
        invoke_docker stream compose up -d || UP_CODE=$?
    fi

    if [ "$UP_CODE" -ne 0 ] && docker_output | grep -qE "$TRANSIENT_NETWORK_PATTERN"; then
        printf '\n'
        write_note 'Docker не смог получить данные из интернета. Пробую ещё раз (это бывает случайно)...'
        sleep 5
        UP_CODE=0
        if [ "$_mode" = "build" ]; then
            invoke_docker stream compose up -d --build || UP_CODE=$?
        else
            invoke_docker stream compose up -d || UP_CODE=$?
        fi
    fi

    # Сети нет и после повтора. Это ещё не повод отказать в запуске: сборка
    # обращается к реестру даже за базовым образом, который уже лежит на диске,
    # а обычный `up` — нет. Поэтому, если образы уже собраны прошлым запуском,
    # платформа отлично поднимется на них и без интернета.
    if [ "$_mode" = "build" ] && [ "$UP_CODE" -ne 0 ] && docker_output | grep -qE "$TRANSIENT_NETWORK_PATTERN"; then
        printf '\n'
        write_note 'Связи с интернетом нет — пробую запустить то, что было собрано раньше...'
        UP_CODE=0
        invoke_docker stream compose up -d || UP_CODE=$?
        if [ "$UP_CODE" -eq 0 ]; then
            printf '\n'
            write_note 'Запущена ранее собранная версия платформы (собрать заново не вышло: нет интернета).'
            write_note 'Если проект обновлялся, запусти скрипт ещё раз, когда интернет появится.'
        fi
    fi

    if [ "$UP_CODE" -ne 0 ]; then
        explain_compose_failure
    fi
    printf '\n'
    write_ok 'Контейнеры запущены.'
}

# Останавливает и удаляет контейнеры и сеть проекта. Том с данными НЕ
# трогает: `down` без -v — единственная форма, которая не может случайно
# стереть прогресс. Удаление данных — отдельная функция ниже, с
# подтверждением.
compose_down() {
    _code=0
    invoke_docker stream compose down --remove-orphans || _code=$?
    if [ "$_code" -ne 0 ]; then
        docker_output | while IFS= read -r line; do write_raw "$line"; done
        stop_with_problem 'не удалось остановить контейнеры' <<'HINTS'
Причина — в выводе Docker выше.
Проверь, что Docker запущен, и повтори. Посмотреть, что осталось: docker compose ps
HINTS
    fi
}

# Удаляет том с данными платформы. Отдельно и только по явной просьбе:
# это единственное необратимое действие во всём лаунчере.
remove_data_volume() {
    if ! invoke_docker quiet volume inspect "$DATA_VOLUME"; then
        write_detail "Тома $DATA_VOLUME нет — удалять нечего."
        return 0
    fi
    if ! invoke_docker quiet volume rm "$DATA_VOLUME"; then
        docker_output | while IFS= read -r line; do write_raw "$line"; done
        stop_with_problem "не удалось удалить том $DATA_VOLUME" <<'HINTS'
Чаще всего это значит, что том ещё занят контейнером.
Проверь: docker ps -a, останови оставшиеся контейнеры и повтори.
HINTS
    fi
    write_ok 'Данные платформы удалены.'
}

# Ждём готовности всех трёх сервисов. Синхронизация паролей вклинивается
# между базой и ядром: ALTER ROLE выполняется в уже поднятой базе, но до
# того, как мы начнём ждать ядро — иначе ждать пришлось бы заведомо
# нерабочее ядро весь таймаут.
wait_for_stack() {
    wait_service_healthy postgres 'База данных' "$POSTGRES_TIMEOUT_SECONDS"

    if [ "$SYNC_PASSWORDS" = "1" ]; then
        if [ "$VOLUME_EXISTED_BEFORE_UP" = "0" ]; then
            # Том только что создан этим же запуском — база и так проинициализирована
            # текущими паролями из .env, ALTER ROLE и рестарт ядра ничего бы не
            # изменили и только заняли бы время.
            write_detail 'База создана только что этим же запуском — пароли и так из .env, синхронизация не нужна.'
        else
            write_detail 'Обновляю пароли ролей базы по файлу .env (как просили ключом --sync-passwords)...'
            invoke_password_sync
            write_ok 'Пароли ролей в базе приведены к .env.'
            if ! invoke_docker quiet compose restart backend; then
                docker_output | while IFS= read -r line; do write_raw "$line"; done
                stop_with_problem 'не удалось перезапустить ядро после смены паролей' <<'HINTS'
Попробуй запустить скрипт ещё раз уже без --sync-passwords.
HINTS
            fi
            write_detail 'Ядро перезапущено с новыми паролями.'
        fi
    fi

    wait_service_healthy backend 'Ядро платформы' "$BACKEND_TIMEOUT_SECONDS"
    wait_service_healthy frontend 'Интерфейс' "$FRONTEND_TIMEOUT_SECONDS"
}

# Финальный экран: адрес и что делать дальше. Браузер намеренно не
# открывается (docs/product/technical-solutions.md, Q-013).
print_ready() {
    printf '\n'
    printf '  %sTrellis запущен и готов к работе.%s\n\n' "$C_GREEN" "$C_OFF"
    printf '      %sОткрой в браузере:  http://localhost:%s%s\n\n' "$C_GREEN" "$FRONTEND_PORT" "$C_OFF"
    printf '      Браузер намеренно не открывается сам — скопируй адрес выше.\n'
    printf '      Платформа доступна только с этого компьютера.\n\n'
    printf '      Остановить:              %s (прогресс сохранится)\n' "$DOWN_COMMAND"
    printf '      Запустить снова:         %s\n' "$START_COMMAND"
    printf '      После обновления файлов: %s (пересборка с нуля)\n\n' "$REBUILD_COMMAND"
}
