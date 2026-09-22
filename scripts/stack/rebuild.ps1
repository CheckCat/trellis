#Requires -Version 5.1
<#
.SYNOPSIS
    Пересборка локальной платформы Trellis с нуля (Windows).

.DESCRIPTION
    Для чего эта команда существует отдельно от start.ps1. Обычный запуск
    собирает образы с кешем слоёв: это быстро и в большинстве случаев
    верно. Но после `git pull` кеш иногда оказывается умнее, чем надо, —
    слой с `npm ci` переиспользуется, потому что Docker не видит причины
    его пересобирать, и пользователь получает старые зависимости при новом
    коде. Разбираться, когда именно так вышло, обычному человеку не по
    силам; «пересобери всё начисто» — команда, которая чинит это без
    разбирательств.

    Данные НЕ трогаются: том trellis_pgdata переживает пересборку,
    миграции ядра накатятся на существующую базу, прогресс остаётся.
    Удаление данных — отдельная команда с подтверждением
    (.\scripts\stack\down.ps1 -WithData).

.PARAMETER SyncPasswords
    То же, что у start.ps1: привести пароли ролей Postgres к тем, что
    сейчас записаны в .env.

.EXAMPLE
    .\scripts\stack\rebuild.ps1
#>
[CmdletBinding()]
param(
    [switch]$SyncPasswords
)

# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/stack/rebuild.sh (и наоборот); почему
# реализации две и что сторожит их совпадение — см. common.ps1.

. (Join-Path $PSScriptRoot 'common.ps1')

# --- Сценарий --------------------------------------------------------------

$script:TotalSteps = 7

Write-Banner -Subtitle 'пересборка платформы с нуля'
Initialize-Stack -ScriptRoot $PSScriptRoot

Write-Step -Number 1 -Text 'Проверяю Docker'
Assert-DockerInstalled
Start-DockerEngine

Write-Step -Number 2 -Text 'Проверяю настройки (файл .env)'
Assert-EnvFile

Write-Step -Number 3 -Text 'Останавливаю текущие контейнеры'
Write-Detail "Данные не трогаю: том $DataVolume остаётся на месте, прогресс сохранится."
Write-Host ''
# Остановить надо ДО сборки, а не после: иначе новые образы соберутся, а
# работать будет всё ещё старый контейнер до самого `up`, и пользователь
# минуты сборки смотрел бы на живую старую версию, думая, что она новая.
Invoke-ComposeDown
Write-Host ''
Write-Ok 'Старые контейнеры остановлены и удалены.'

Write-Step -Number 4 -Text 'Собираю образы заново, без кеша'
Write-Detail 'Это дольше обычного запуска: все слои собираются с нуля, обычно несколько минут.'
Write-Detail 'Ниже — вывод Docker, его можно не читать.'
Write-Host ''
Save-VolumeState
Invoke-ComposeBuildNoCache

Write-Step -Number 5 -Text 'Запускаю платформу'
Write-Host ''
# Без -Build: образы только что собраны начисто шагом выше, повторная
# сборка ничего бы не изменила и стоила бы ещё одного прохода по слоям.
Invoke-ComposeUp

Write-Step -Number 6 -Text 'Жду, пока платформа будет готова'
Wait-ForStack -SyncPasswords:$SyncPasswords

Write-Step -Number 7 -Text 'Готово'
Show-ReadyMessage

exit 0
