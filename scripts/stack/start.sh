#!/bin/sh
# Запуск локальной платформы Trellis (macOS / Linux).
#
# Сценарий целиком виден ниже: проверить Docker, проверить .env, поднять
# стек, дождаться готовности, назвать адрес. Всё, из чего эти шаги сделаны,
# лежит в common.sh — общей части запуска, пересборки и остановки.
#
# Порт scripts/stack/start.ps1 шаг в шаг: те же шаги, те же таймауты, те же
# проверки и те же объяснения. Отличается ровно одним — способом поднять
# Docker, если он установлен, но не запущен (на macOS это `open -a Docker`,
# на Linux docker обычно уже служба).
#
# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/stack/start.ps1 (и наоборот); почему
# реализации две и что сторожит их совпадение — см. common.sh.

set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

# --- Разбор аргументов -----------------------------------------------------

for arg in "$@"; do
    case "$arg" in
        --sync-passwords) SYNC_PASSWORDS=1 ;;
        -h|--help)
            printf 'Использование: %s [--sync-passwords]\n\n' "$0"
            printf '  --sync-passwords  привести пароли ролей Postgres к тем, что сейчас в .env.\n'
            printf '                    Нужно, если пароль в .env поменяли ПОСЛЕ первого запуска.\n\n'
            printf 'Соседние команды: %s (пересобрать с нуля), %s (остановить).\n' \
                "$REBUILD_COMMAND" "$DOWN_COMMAND"
            exit 0
            ;;
        *)
            printf 'Неизвестный аргумент: %s (см. --help)\n' "$arg" >&2
            exit 2
            ;;
    esac
done

# --- Сценарий --------------------------------------------------------------

TOTAL_STEPS=5

write_banner 'локальная платформа обучения'
stack_init

write_step 1 'Проверяю Docker'
ensure_docker_installed
ensure_docker_running

write_step 2 'Проверяю настройки (файл .env)'
ensure_env

write_step 3 'Собираю и запускаю платформу'
write_detail 'Первый запуск дольше остальных: образы собираются с нуля, это несколько минут.'
write_detail 'Ниже — вывод Docker, его можно не читать.'
printf '\n'
remember_volume_state
compose_up_with_recovery build

write_step 4 'Жду, пока платформа будет готова'
wait_for_stack

write_step 5 'Готово'
print_ready

exit 0
