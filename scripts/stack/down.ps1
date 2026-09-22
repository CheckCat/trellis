#Requires -Version 5.1
<#
.SYNOPSIS
    Остановка локальной платформы Trellis (Windows).

.DESCRIPTION
    По умолчанию удаляются только контейнеры и сеть — том с данными
    (trellis_pgdata) остаётся, и следующий запуск поднимет платформу ровно
    с тем же прогрессом. Это не осторожность ради осторожности: прогресс
    ученика живёт ТОЛЬКО в этом томе, копии его нигде нет, и команда
    «останови» не имеет права его стирать.

    Стереть данные можно, но только явно: -WithData, и только после того,
    как человек своими руками наберёт слово подтверждения.

.PARAMETER WithData
    Дополнительно удалить том trellis_pgdata. ВЕСЬ ПРОГРЕСС БУДЕТ ПОТЕРЯН,
    восстановить его неоткуда. Спрашивает подтверждение.

.PARAMETER Yes
    Не спрашивать подтверждение (для вызова из других скриптов).

.EXAMPLE
    .\scripts\stack\down.ps1

.EXAMPLE
    .\scripts\stack\down.ps1 -WithData
#>
[CmdletBinding()]
param(
    [switch]$WithData,
    [switch]$Yes
)

# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/stack/down.sh (и наоборот); почему
# реализации две и что сторожит их совпадение — см. common.ps1.

. (Join-Path $PSScriptRoot 'common.ps1')

# Есть ли кому подтвердить. Выясняется ДО первого действия: отказ на
# полпути (контейнеры уже сняты, данные — нет) хуже отказа сразу.
# Перенаправленный ввод означает, что Read-Host прочитает не решение
# человека, а то, что в него подали.
if ($WithData -and -not $Yes) {
    $inputRedirected = $false
    try { $inputRedirected = [Console]::IsInputRedirected } catch { }
    if ($inputRedirected) {
        Stop-WithProblem -Title 'некому подтвердить удаление данных' -Hints @(
            'Команда запущена без терминала, а удаление данных требует подтверждения.',
            'Если это скрипт и удаление действительно нужно — добавь ключ -Yes.',
            'Ничего не тронуто: платформа в том же состоянии, что и до команды.'
        )
    }
}

# Подтверждение набирается целым словом, а не «y/n»: на «y» палец попадает
# случайно, на «УДАЛИТЬ» — нет. Латинское DELETE принимается наравне с
# русским словом: в консоли без русской раскладки набрать его иначе нельзя.
function Confirm-DataRemoval {
    if ($Yes) {
        Write-Note 'Подтверждение пропущено ключом -Yes.'
        return
    }
    Write-Host ''
    Write-Host "      Будет удалён том $DataVolume — это весь прогресс всех курсов на этом компьютере." -ForegroundColor Yellow
    Write-Host '      Восстановить его будет неоткуда.' -ForegroundColor Yellow
    Write-Host ''
    $answer = Read-Host '      Чтобы подтвердить, набери УДАЛИТЬ (или DELETE) и нажми Enter'
    Write-Host ''
    if ($answer -ne 'УДАЛИТЬ' -and $answer -ne 'DELETE') {
        Write-Ok 'Данные не тронуты — удаление отменено.'
        Write-Host ''
        exit 0
    }
}

# --- Сценарий --------------------------------------------------------------

$script:TotalSteps = if ($WithData) { 3 } else { 2 }

Write-Banner -Subtitle 'остановка платформы'
Initialize-Stack -ScriptRoot $PSScriptRoot

Write-Step -Number 1 -Text 'Проверяю Docker'
Assert-DockerInstalled
# Незапущенный Docker останавливать нечего: контейнеры вместе с ним уже не
# работают. Поднимать его ради остановки — минуты ожидания ради ничего.
if (-not (Test-DockerDaemon)) {
    Write-Ok 'Docker не запущен — значит, и контейнеры Trellis не работают.'
    Write-Host ''
    Write-Detail 'Останавливать нечего. Данные платформы на месте.'
    Write-Host ''
    exit 0
}
Write-Ok 'Docker запущен.'

Write-Step -Number 2 -Text 'Останавливаю и удаляю контейнеры'
Write-Host ''
Invoke-ComposeDown
Write-Host ''
Write-Ok 'Контейнеры и сеть удалены.'

if ($WithData) {
    Write-Step -Number 3 -Text 'Удаляю данные платформы'
    Confirm-DataRemoval
    Remove-DataVolume
    Write-Host ''
    Write-Host '  Платформа остановлена, данные удалены.' -ForegroundColor Green
    Write-Host ''
    Write-Host "      Следующий запуск ($StartCommand) создаст базу заново, с нуля."
    Write-Host ''
} else {
    Write-Host ''
    Write-Host '  Платформа остановлена.' -ForegroundColor Green
    Write-Host ''
    Write-Host "      Данные сохранены в томе $DataVolume — прогресс никуда не делся."
    Write-Host ''
    Write-Host "      Запустить снова:         $StartCommand"
    Write-Host "      После обновления файлов: $RebuildCommand (пересборка с нуля)"
    Write-Host ''
}

exit 0
