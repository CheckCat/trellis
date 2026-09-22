#Requires -Version 5.1
<#
.SYNOPSIS
    Запуск локальной платформы Trellis (Windows).

.DESCRIPTION
    Единая точка входа для пользователя: проверяет и при необходимости
    запускает Docker Desktop, поднимает docker-compose стек, дожидается
    готовности базы, ядра и интерфейса и печатает адрес, по которому
    открывается платформа. Браузер НЕ открывается автоматически (так
    решено осознанно: см. docs/product/technical-solutions.md, Q-013).

    Сценарий целиком виден ниже; всё, из чего эти шаги сделаны, лежит в
    common.ps1 — общей части запуска, пересборки и остановки.

    Скрипт отказоустойчив по замыслу: на каждом шаге либо понятное
    сообщение о том, что происходит, либо понятное объяснение, что именно
    сломалось и что с этим делать. Тихого зависания быть не должно.

.PARAMETER SyncPasswords
    Привести пароли ролей Postgres в базе к тем, что сейчас записаны в
    .env. Нужно ровно в одном случае: пароль в .env поменяли ПОСЛЕ первого
    запуска, и ядро (backend) больше не может подключиться к базе. Обычный
    запуск пароли не трогает. Подробности — docs/run.md.

.EXAMPLE
    .\scripts\stack\start.ps1

.EXAMPLE
    .\scripts\stack\start.ps1 -SyncPasswords
#>
[CmdletBinding()]
param(
    [switch]$SyncPasswords
)

# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/stack/start.sh (и наоборот); почему
# реализации две и что сторожит их совпадение — см. common.ps1.

. (Join-Path $PSScriptRoot 'common.ps1')

# --- Сценарий --------------------------------------------------------------

$script:TotalSteps = 5

Write-Banner -Subtitle 'локальная платформа обучения'
Initialize-Stack -ScriptRoot $PSScriptRoot

Write-Step -Number 1 -Text 'Проверяю Docker'
Assert-DockerInstalled
Start-DockerEngine

Write-Step -Number 2 -Text 'Проверяю настройки (файл .env)'
Assert-EnvFile

Write-Step -Number 3 -Text 'Собираю и запускаю платформу'
Write-Detail 'Первый запуск дольше остальных: образы собираются с нуля, это несколько минут.'
Write-Detail 'Ниже — вывод Docker, его можно не читать.'
Write-Host ''
Save-VolumeState
Invoke-ComposeUp -Build

Write-Step -Number 4 -Text 'Жду, пока платформа будет готова'
Wait-ForStack -SyncPasswords:$SyncPasswords

Write-Step -Number 5 -Text 'Готово'
Show-ReadyMessage

exit 0
