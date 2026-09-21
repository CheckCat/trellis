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

    Скрипт отказоустойчив по замыслу: на каждом шаге либо понятное
    сообщение о том, что происходит, либо понятное объяснение, что именно
    сломалось и что с этим делать. Тихого зависания быть не должно.

.PARAMETER SyncPasswords
    Привести пароли ролей Postgres в базе к тем, что сейчас записаны в
    .env. Нужно ровно в одном случае: пароль в .env поменяли ПОСЛЕ первого
    запуска, и ядро (backend) больше не может подключиться к базе. Обычный
    запуск пароли не трогает. Подробности — docs/run.md.

.EXAMPLE
    .\scripts\start.ps1

.EXAMPLE
    .\scripts\start.ps1 -SyncPasswords
#>
[CmdletBinding()]
param(
    [switch]$SyncPasswords
)

# ПРАВИШЬ ЗДЕСЬ — ПОПРАВЬ И В scripts/start.sh (и наоборот). Держать одну
# реализацию не выходит: скрипт работает до того, как поднято хоть что-то,
# и не может полагаться ни на что, кроме того, что уже стоит в системе, —
# а это PowerShell на Windows и sh на всём остальном. Требовать ради самого
# лаунчера ещё и Node нельзя: пользователю ставится только Docker Desktop
# (сама платформа Node не требует — он внутри образов).
# Чтобы расхождение не прошло тихо, значения, которые обязаны совпадать,
# сверяет тест scripts/launcher-parity.test.mjs.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# PowerShell 7.3+ по умолчанию превращает ненулевой код возврата внешней
# программы в терминирующую ошибку, когда $ErrorActionPreference = 'Stop'.
# Нам это мешает: код возврата docker мы разбираем сами и превращаем в
# человекочитаемое объяснение, а не в стек PowerShell. В PowerShell 5.1
# такой переменной нет — присваивание просто создаёт неиспользуемую.
$PSNativeCommandUseErrorActionPreference = $false

# Русский текст в консоли cmd.exe/PowerShell без этого превращается в
# кракозябры (консоль по умолчанию в OEM-кодировке, а файл — UTF-8).
# Сам файл сохранён с BOM — иначе Windows PowerShell 5.1 прочитал бы его
# в ANSI-кодировке системы и кракозябры были бы уже в самих строках.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

# --- Настройки ожиданий ----------------------------------------------------
# Щедрые, но конечные: лучше через N минут честно сказать «не дождался, вот
# журнал», чем висеть бесконечно.
$DockerStartTimeoutSeconds = 180
$PostgresTimeoutSeconds    = 120
$BackendTimeoutSeconds     = 240
$FrontendTimeoutSeconds    = 120

$DockerDesktopUrl = 'https://www.docker.com/products/docker-desktop/'

# Становится $true, как только docker compose up отработал: от этого
# зависит, уместна ли в сообщении об ошибке подсказка про журналы
# контейнеров.
$script:StackStarted = $false

# --- Вывод -----------------------------------------------------------------

function Write-Banner {
    Write-Host ''
    Write-Host '  Trellis — локальная платформа обучения' -ForegroundColor Green
    Write-Host '  Всё работает на этом компьютере, наружу ничего не отправляется.'
    Write-Host ''
}

function Write-Step {
    param([int]$Number, [int]$Total, [string]$Text)
    Write-Host ''
    Write-Host "  [$Number/$Total] $Text" -ForegroundColor Cyan
}

function Write-Detail {
    param([string]$Text)
    Write-Host "      $Text"
}

function Write-Ok {
    param([string]$Text)
    Write-Host "      $Text" -ForegroundColor Green
}

function Write-Note {
    param([string]$Text)
    Write-Host "      $Text" -ForegroundColor Yellow
}

function Write-Raw {
    param([string]$Text)
    Write-Host "      | $Text" -ForegroundColor DarkGray
}

# Единственный путь выхода с ошибкой: заголовок проблемы + конкретные шаги.
# Контейнеры намеренно НЕ останавливаются — по ним можно смотреть журналы,
# а интерфейс (если поднялся) сам покажет своё состояние.
function Stop-WithProblem {
    param([string]$Title, [string[]]$Hints)
    Write-Host ''
    Write-Host "  Не получилось: $Title" -ForegroundColor Red
    Write-Host ''
    foreach ($hint in $Hints) {
        Write-Host "      $hint" -ForegroundColor Yellow
    }
    # Подсказка про журналы имеет смысл только если контейнеры реально
    # запущены: на ошибке «нет Docker» или «не заполнен .env» она бы только
    # сбивала с толку.
    if ($script:StackStarted) {
        Write-Host ''
        # Формулировка не утверждает «контейнеры запущены»: на отказе ДО
        # старта (например, порт занят) docker compose успевает лишь создать
        # контейнер, но не запустить его — «оставлены запущенными» было бы
        # неточно именно в этом случае.
        Write-Host '      Что успело подняться — не тронуто: посмотреть состояние и журналы можно'
        Write-Host '      командами docker compose ps и docker compose logs, а остановить всё: docker compose down'
    }
    Write-Host ''
    exit 1
}

# --- Запуск внешних команд -------------------------------------------------

# Запускает docker и возвращает и код возврата, и вывод: код нужен, чтобы
# понять «получилось или нет», вывод — чтобы объяснить пользователю, ЧТО
# именно не получилось. -Stream дополнительно печатает вывод по мере
# поступления (сборка образов идёт минуты — молчать в это время нельзя).
function Invoke-Docker {
    param([string[]]$Arguments, [switch]$Stream)

    # Локально гасим Stop: в Windows PowerShell 5.1 вывод внешней программы
    # в stderr при 2>&1 и $ErrorActionPreference = 'Stop' сам по себе
    # становится терминирующей ошибкой (NativeCommandError), хотя команда
    # может завершиться успешно — docker пишет в stderr обычный прогресс.
    $ErrorActionPreference = 'Continue'

    $collected = New-Object System.Collections.Generic.List[string]
    & docker @Arguments 2>&1 | ForEach-Object {
        $line = [string]$_
        if ($Stream) { Write-Raw $line }
        $collected.Add($line) | Out-Null
    }
    $code = $LASTEXITCODE

    return [pscustomobject]@{
        ExitCode = $code
        Lines    = $collected.ToArray()
        Text     = ($collected.ToArray() -join "`n")
    }
}

function Test-DockerDaemon {
    $result = Invoke-Docker -Arguments @('info', '--format', '{{.ServerVersion}}')
    return ($result.ExitCode -eq 0)
}

# --- .env ------------------------------------------------------------------

# Пароль попадает в строку подключения вида
# postgres://trellis_app:<пароль>@postgres:5432/trellis, поэтому алфавит —
# только буквы и цифры: '@', ':', '/', '#', '?' в пароле ломают разбор URL
# ещё до того, как дело дойдёт до самой базы.
function New-RandomPassword {
    param([int]$Length = 28)

    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    # 256 не делится на 62 нацело: чтобы не было перекоса в сторону первых
    # символов алфавита, байты >= 248 отбрасываем и берём следующие.
    $limit = 256 - (256 % $alphabet.Length)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $chars = New-Object System.Text.StringBuilder
        $buffer = New-Object byte[] 1
        while ($chars.Length -lt $Length) {
            $rng.GetBytes($buffer)
            if ($buffer[0] -ge $limit) { continue }
            $chars.Append($alphabet[$buffer[0] % $alphabet.Length]) | Out-Null
        }
        return $chars.ToString()
    } finally {
        $rng.Dispose()
    }
}

function Read-EnvFile {
    param([string]$Path)

    $map = @{}
    foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { continue }
        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value[0]
            $last = $value[$value.Length - 1]
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $map[$key] = $value
    }
    return $map
}

function Get-EnvValue {
    param([hashtable]$Map, [string]$Key, [string]$Default = '')
    if ($Map.ContainsKey($Key) -and $Map[$Key].Length -gt 0) { return $Map[$Key] }
    return $Default
}

# Создаёт .env из .env.example, подставляя случайные пароли. Смысл: у
# пользователя-неразработчика не должно быть шага «открой файл и придумай
# три пароля», а пароли из примера (change-me-...) не должны становиться
# фактическими паролями базы.
function New-EnvFileFromExample {
    param([string]$ExamplePath, [string]$TargetPath)

    $passwordKeys = @('POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'SANDBOX_DB_PASSWORD')
    $lines = [System.IO.File]::ReadAllLines($ExamplePath)
    $output = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        $replaced = $false
        foreach ($key in $passwordKeys) {
            if ($line -match "^\s*$key\s*=") {
                $output.Add("$key=$(New-RandomPassword)") | Out-Null
                $replaced = $true
                break
            }
        }
        if (-not $replaced) { $output.Add($line) | Out-Null }
    }

    # Без BOM: docker compose читает .env побайтово, и BOM уехал бы в имя
    # первой переменной. Переводы строк — CRLF, чтобы файл нормально
    # открывался любым редактором Windows.
    $text = ($output.ToArray() -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($TargetPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# --- Ожидание готовности сервисов ------------------------------------------

function Get-ServiceContainerId {
    param([string]$Service)
    $result = Invoke-Docker -Arguments @('compose', 'ps', '-q', $Service)
    if ($result.ExitCode -ne 0) { return '' }
    foreach ($line in $result.Lines) {
        $id = $line.Trim()
        if ($id.Length -gt 0) { return $id }
    }
    return ''
}

# Состояние берём из docker inspect, а не из `docker compose ps --format
# json`: формат вывода compose менялся между версиями (массив против
# JSON-строк), а шаблон inspect стабилен.
function Get-ServiceState {
    param([string]$ContainerId)

    $format = '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}'
    $result = Invoke-Docker -Arguments @('inspect', '-f', $format, $ContainerId)
    if ($result.ExitCode -ne 0) { return $null }

    $line = ''
    foreach ($candidate in $result.Lines) {
        if ($candidate.Trim().Length -gt 0) { $line = $candidate.Trim(); break }
    }
    $parts = $line.Split('|')
    if ($parts.Length -lt 3) { return $null }

    $restarts = 0
    [void][int]::TryParse($parts[2], [ref]$restarts)
    return [pscustomobject]@{
        Status   = $parts[0]
        Health   = $parts[1]
        Restarts = $restarts
    }
}

function Show-ServiceLogs {
    param([string]$Service, [int]$Tail = 25)

    # Ядро пишет журнал в JSON, и одна его строка — это экран текста со
    # стеком вызовов. Целиком такое вываливать человеку, который просто
    # хотел запустить платформу, бессмысленно: причина всегда в начале
    # строки, а полный журнал доступен отдельной командой (она названа в
    # подсказках ниже по тексту).
    $maxLineLength = 300

    Write-Host ''
    Write-Detail "Ниже — технические подробности (последние строки журнала '$Service')."
    Write-Detail 'Читать их необязательно: понятное объяснение будет сразу после них.'
    $result = Invoke-Docker -Arguments @('compose', 'logs', '--no-color', '--tail', "$Tail", $Service)
    foreach ($line in $result.Lines) {
        if ($line.Length -gt $maxLineLength) {
            Write-Raw ($line.Substring(0, $maxLineLength) + ' …')
        } else {
            Write-Raw $line
        }
    }
    Write-Host ''
    return $result.Text
}

# Возвращает $true, если сервис стал healthy; иначе печатает журнал и
# объясняет причину — разную для разных сервисов, потому что «не поднялось»
# у базы, у ядра и у интерфейса означает совершенно разные вещи.
function Wait-ServiceHealthy {
    param(
        [string]$Service,
        [string]$Title,
        [int]$TimeoutSeconds
    )

    $containerId = Get-ServiceContainerId -Service $Service
    if ($containerId.Length -eq 0) {
        Stop-WithProblem -Title "контейнер '$Service' не создан" -Hints @(
            'Похоже, docker compose up отработал не полностью.',
            'Посмотри, что он написал выше, и запусти скрипт ещё раз.'
        )
    }

    $started = Get-Date
    $lastReport = Get-Date
    while ($true) {
        $state = Get-ServiceState -ContainerId $containerId
        if ($null -ne $state) {
            if ($state.Health -eq 'healthy') {
                Write-Ok "$Title — готово."
                return
            }
            # Контейнер, который упал и перезапускается по кругу, здоровым
            # не станет никогда: ждать до конца таймаута бессмысленно,
            # объясняем сразу.
            if ($state.Restarts -ge 3) {
                Show-FailureDiagnosis -Service $Service -Title $Title -Reason 'restart-loop'
            }
            if ($state.Status -eq 'exited' -or $state.Status -eq 'dead') {
                Show-FailureDiagnosis -Service $Service -Title $Title -Reason 'exited'
            }
        }

        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        if ($elapsed -ge $TimeoutSeconds) {
            Show-FailureDiagnosis -Service $Service -Title $Title -Reason 'timeout'
        }
        if (((Get-Date) - $lastReport).TotalSeconds -ge 10) {
            Write-Detail "$Title — ещё не готово, жду (прошло $elapsed сек из $TimeoutSeconds)..."
            $lastReport = Get-Date
        }
        Start-Sleep -Seconds 2
    }
}

function Show-FailureDiagnosis {
    param([string]$Service, [string]$Title, [string]$Reason)

    $logs = Show-ServiceLogs -Service $Service

    $what = switch ($Reason) {
        'restart-loop' { "$Title не запускается: контейнер падает и перезапускается по кругу" }
        'exited'       { "$Title остановилось сразу после запуска" }
        default        { "$Title не стало готовым за отведённое время" }
    }

    $hints = New-Object System.Collections.Generic.List[string]

    if ($Service -eq 'postgres') {
        if ($logs -match 'APP_DB_PASSWORD|SANDBOX_DB_PASSWORD') {
            $hints.Add('В файле .env не заполнены пароли базы — база отказалась создавать роли.') | Out-Null
            $hints.Add('Открой .env и задай непустые POSTGRES_PASSWORD, APP_DB_PASSWORD, SANDBOX_DB_PASSWORD.') | Out-Null
        } elseif ($logs -match 'database files are incompatible|incompatible version') {
            $hints.Add('Сохранённые данные созданы другой версией Postgres.') | Out-Null
            $hints.Add('Это чинится только удалением данных: docker compose down -v (весь прогресс будет потерян).') | Out-Null
        } else {
            $hints.Add('Причина — в строках журнала выше.') | Out-Null
            $hints.Add('Полный журнал: docker compose logs postgres') | Out-Null
        }
    } elseif ($Service -eq 'backend') {
        if ($logs -match 'password authentication failed') {
            $hints.Add('Ядро не может войти в базу: пароль в .env не совпадает с паролем роли внутри базы.') | Out-Null
            $hints.Add('Так бывает, если пароль в .env поменяли ПОСЛЕ первого запуска: база запоминает пароли') | Out-Null
            $hints.Add('один раз, при самом первом старте, и сама по себе их больше не перечитывает.') | Out-Null
            $hints.Add('') | Out-Null
            $hints.Add('Починить без потери прогресса:  .\scripts\start.ps1 -SyncPasswords') | Out-Null
            $hints.Add('(эта команда приводит пароли ролей в базе к тем, что сейчас в .env)') | Out-Null
        } elseif ($logs -match 'ECONNREFUSED|getaddrinfo|ENOTFOUND|connection refused') {
            $hints.Add('Ядро не достучалось до базы по сети Docker.') | Out-Null
            $hints.Add('Обычно помогает повторный запуск скрипта; если нет — docker compose logs postgres') | Out-Null
        } elseif ($logs -match 'migration|migrate|миграц') {
            $hints.Add('Ядро не смогло применить миграции базы и поэтому не стартует (и не стартует по кругу).') | Out-Null
            $hints.Add('Строки журнала выше называют конкретную миграцию и ошибку.') | Out-Null
            $hints.Add('Если база была изменена вручную — верните её в исходное состояние или, как крайняя') | Out-Null
            $hints.Add('мера, docker compose down -v (весь прогресс будет потерян).') | Out-Null
        } else {
            $hints.Add('Причина — в строках журнала выше.') | Out-Null
            $hints.Add('Полный журнал: docker compose logs backend') | Out-Null
        }
        $hints.Add('') | Out-Null
        # Формулировка дословно совпадает с тем, что показывает интерфейс
        # (services/frontend/src/ui/Layout.tsx) — чтобы пользователь связал
        # надпись на экране с этим объяснением.
        $hints.Add('Интерфейс при этом, скорее всего, открывается, но показывает «Связи с ядром нет» —') | Out-Null
        $hints.Add('настоящая причина не там, а в журнале выше.') | Out-Null
    } elseif ($Service -eq 'frontend') {
        $hints.Add('Интерфейс считается готовым только когда через него отвечает ядро (проверка идёт на /api/health).') | Out-Null
        $hints.Add('Если ядро выше отчиталось как готовое, а это — нет, посмотри: docker compose logs frontend') | Out-Null
    }

    Stop-WithProblem -Title $what -Hints $hints.ToArray()
}

# --- Смена паролей ролей ---------------------------------------------------

function ConvertTo-SqlLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

# Приводит пароли ролей в базе к тем, что записаны в .env. Работает изнутри
# контейнера через unix-сокет, где официальный образ Postgres доверяет
# суперпользователю без пароля — поэтому механизм работает даже тогда,
# когда в .env лежит уже неверный POSTGRES_PASSWORD. SQL передаётся в
# stdin, а не аргументом командной строки: пароль не должен светиться в
# списке процессов.
function Invoke-PasswordSync {
    param([hashtable]$EnvMap)

    $appPassword = Get-EnvValue -Map $EnvMap -Key 'APP_DB_PASSWORD'
    $sandboxPassword = Get-EnvValue -Map $EnvMap -Key 'SANDBOX_DB_PASSWORD'
    $superPassword = Get-EnvValue -Map $EnvMap -Key 'POSTGRES_PASSWORD'

    $sql = @"
ALTER ROLE trellis_app WITH PASSWORD $(ConvertTo-SqlLiteral $appPassword);
ALTER ROLE trellis_sandbox WITH PASSWORD $(ConvertTo-SqlLiteral $sandboxPassword);
ALTER ROLE postgres WITH PASSWORD $(ConvertTo-SqlLiteral $superPassword);
"@

    $ErrorActionPreference = 'Continue'
    $output = ($sql | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d trellis 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        foreach ($line in $output) { Write-Raw $line }
        Stop-WithProblem -Title 'не удалось обновить пароли ролей в базе' -Hints @(
            'База запущена, но команда смены паролей завершилась ошибкой (вывод выше).',
            'Проверь, что в .env заданы непустые APP_DB_PASSWORD и SANDBOX_DB_PASSWORD.'
        )
    }
}

# --- Основной сценарий -----------------------------------------------------

Write-Banner

$totalSteps = 5

# Скрипт всегда работает из своей папки — его можно запускать двойным
# кликом из любого места, текущий каталог cmd.exe при этом произвольный.
if ([string]::IsNullOrEmpty($PSScriptRoot)) {
    Stop-WithProblem -Title 'не удалось определить папку скрипта' -Hints @(
        'Запусти скрипт как файл: .\scripts\start.ps1 (а не построчно из консоли).'
    )
}

# Скрипт лежит в scripts/, а работать должен из корня проекта: docker
# compose ищет docker-compose.yml и .env в текущем каталоге.
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'docker-compose.yml'
if (-not (Test-Path -LiteralPath $composeFile)) {
    Stop-WithProblem -Title "в корне проекта нет docker-compose.yml" -Hints @(
        "Скрипт должен лежать в папке scripts/ проекта Trellis, рядом с которой есть docker-compose.yml.",
        "Сейчас корнем считается: $projectRoot"
    )
}
Set-Location -LiteralPath $projectRoot

# --- Шаг 1: Docker ---------------------------------------------------------

Write-Step -Number 1 -Total $totalSteps -Text 'Проверяю Docker'

$isWindowsHost = $true
$isWindowsVariable = Get-Variable -Name 'IsWindows' -ErrorAction SilentlyContinue
if ($null -ne $isWindowsVariable) { $isWindowsHost = [bool]$isWindowsVariable.Value }

if ($null -eq (Get-Command -Name 'docker' -ErrorAction SilentlyContinue)) {
    Stop-WithProblem -Title 'Docker не установлен (или не виден этой консоли)' -Hints @(
        'Trellis работает в контейнерах — без Docker Desktop платформу не запустить.',
        "Установи Docker Desktop: $DockerDesktopUrl",
        'После установки перезапусти компьютер и запусти этот скрипт ещё раз.'
    )
}

$composeVersion = Invoke-Docker -Arguments @('compose', 'version', '--short')
if ($composeVersion.ExitCode -ne 0) {
    Stop-WithProblem -Title 'установленный Docker не умеет "docker compose"' -Hints @(
        'Нужен Docker Compose v2 — он входит в состав современного Docker Desktop.',
        "Обнови Docker Desktop: $DockerDesktopUrl"
    )
}

if (Test-DockerDaemon) {
    Write-Ok 'Docker запущен.'
} elseif (-not $isWindowsHost) {
    Stop-WithProblem -Title 'Docker установлен, но не запущен' -Hints @(
        'Этот скрипт рассчитан на Windows; на других системах запусти Docker вручную',
        'и повтори запуск (или подними стек напрямую: docker compose up -d).'
    )
} else {
    Write-Detail 'Docker Desktop не запущен — пробую запустить его сам.'

    $candidatePaths = New-Object System.Collections.Generic.List[string]
    if ($env:ProgramFiles) {
        $candidatePaths.Add((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')) | Out-Null
    }
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        $candidatePaths.Add((Join-Path $programFilesX86 'Docker\Docker\Docker Desktop.exe')) | Out-Null
    }
    if ($env:LOCALAPPDATA) {
        $candidatePaths.Add((Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')) | Out-Null
    }
    try {
        $registryAppPath = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Docker Inc.\Docker\1.0' -Name 'AppPath' -ErrorAction SilentlyContinue).AppPath
        if ($registryAppPath) {
            $candidatePaths.Add((Join-Path $registryAppPath 'Docker Desktop.exe')) | Out-Null
        }
    } catch { }

    $dockerDesktopExe = ''
    foreach ($candidate in $candidatePaths) {
        if (Test-Path -LiteralPath $candidate) { $dockerDesktopExe = $candidate; break }
    }

    if ($dockerDesktopExe.Length -eq 0) {
        Stop-WithProblem -Title 'Docker Desktop не запущен, и я не нашёл, чем его запустить' -Hints @(
            'Запусти Docker Desktop вручную (меню «Пуск» → Docker Desktop), дождись,',
            'пока значок кита перестанет мигать, и запусти этот скрипт ещё раз.'
        )
    }

    Write-Detail "Запускаю: $dockerDesktopExe"
    try {
        Start-Process -FilePath $dockerDesktopExe | Out-Null
    } catch {
        Stop-WithProblem -Title 'не удалось запустить Docker Desktop' -Hints @(
            "Windows не дала запустить $dockerDesktopExe",
            'Запусти Docker Desktop вручную и повтори запуск скрипта.'
        )
    }

    Write-Detail "Жду, пока Docker Desktop будет готов (это может занять пару минут)..."
    $waitStarted = Get-Date
    $lastReport = Get-Date
    while (-not (Test-DockerDaemon)) {
        $elapsed = [int]((Get-Date) - $waitStarted).TotalSeconds
        if ($elapsed -ge $DockerStartTimeoutSeconds) {
            Stop-WithProblem -Title "Docker Desktop не поднялся за $DockerStartTimeoutSeconds сек" -Hints @(
                'Открой Docker Desktop и посмотри, что он пишет: чаще всего он просит',
                'доустановить или обновить WSL2 либо перезагрузить компьютер.',
                'Когда в Docker Desktop появится статус «Engine running» — запусти скрипт снова.'
            )
        }
        if (((Get-Date) - $lastReport).TotalSeconds -ge 15) {
            Write-Detail "всё ещё жду Docker Desktop (прошло $elapsed сек из $DockerStartTimeoutSeconds)..."
            $lastReport = Get-Date
        }
        Start-Sleep -Seconds 3
    }
    Write-Ok 'Docker Desktop готов.'
}

# --- Шаг 2: настройки (.env) -----------------------------------------------

Write-Step -Number 2 -Total $totalSteps -Text 'Проверяю настройки (файл .env)'

$envPath = Join-Path $projectRoot '.env'
$envExamplePath = Join-Path $projectRoot '.env.example'

if (-not (Test-Path -LiteralPath $envPath)) {
    if (-not (Test-Path -LiteralPath $envExamplePath)) {
        Stop-WithProblem -Title 'нет ни .env, ни .env.example' -Hints @(
            'Похоже, папка проекта скопирована не полностью — скачай её заново.'
        )
    }
    Write-Detail 'Файла .env нет — создаю его из .env.example и придумываю пароли базы за тебя.'
    New-EnvFileFromExample -ExamplePath $envExamplePath -TargetPath $envPath
    Write-Ok 'Создан файл .env со случайными паролями.'
    Write-Note 'Эти пароли база запомнит при первом запуске. Менять их потом можно только'
    Write-Note 'вместе с командой .\scripts\start.ps1 -SyncPasswords — см. docs/run.md.'
}

$envMap = Read-EnvFile -Path $envPath

$requiredKeys = @('POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'SANDBOX_DB_PASSWORD')
$missingKeys = @()
foreach ($key in $requiredKeys) {
    if ((Get-EnvValue -Map $envMap -Key $key).Length -eq 0) { $missingKeys += $key }
}
if ($missingKeys.Count -gt 0) {
    Stop-WithProblem -Title "в файле .env не заполнены: $($missingKeys -join ', ')" -Hints @(
        "Открой файл $envPath и впиши непустые значения для перечисленных строк.",
        'Это пароли внутренней базы данных на этом же компьютере — подойдут любые,',
        'из латинских букв и цифр.'
    )
}

# Пароли уезжают в строку подключения postgres://... — символы, у которых
# в URL особый смысл, ломают подключение ядра раньше, чем дело дойдёт до
# самой базы. Лучше сказать об этом здесь, чем разбирать потом невнятную
# ошибку в журнале.
$badPasswordKeys = @()
foreach ($key in $requiredKeys) {
    if ((Get-EnvValue -Map $envMap -Key $key) -notmatch '^[A-Za-z0-9._~-]+$') { $badPasswordKeys += $key }
}
if ($badPasswordKeys.Count -gt 0) {
    Stop-WithProblem -Title "пароли в .env содержат неподходящие символы: $($badPasswordKeys -join ', ')" -Hints @(
        'В паролях можно использовать латинские буквы, цифры и знаки . _ ~ -',
        'Любые другие символы — например, @ : / ? # % или пробел — ломают подключение к базе.',
        "Поправь файл $envPath и запусти скрипт ещё раз."
    )
}

$frontendPort = Get-EnvValue -Map $envMap -Key 'FRONTEND_PORT' -Default '3000'
$backendPort = Get-EnvValue -Map $envMap -Key 'BACKEND_PORT' -Default '3001'
Write-Ok 'Настройки на месте.'

# --- Шаг 3: сборка и запуск ------------------------------------------------

Write-Step -Number 3 -Total $totalSteps -Text 'Собираю и запускаю платформу'
Write-Detail 'Первый запуск дольше остальных: образы собираются с нуля, это несколько минут.'
Write-Detail 'Ниже — вывод Docker, его можно не читать.'
Write-Host ''

# --build (а не просто up): иначе после обновления исходников Docker молча
# оставил бы собранный ранее образ, и пользователь запускал бы старую
# версию, не понимая, почему изменения не появились.
# Осознанно без --wait: healthcheck интерфейса ходит через /api/health, то
# есть при нездоровом ядре compose объявил бы интерфейс сломанным и
# откатил запуск — а нам нужно, чтобы интерфейс поднялся и честно показал
# «нет связи с ядром», а объяснение причины дал этот скрипт.
# Проверяем ДО up: если тома с данными базы ещё нет, он будет создан заново
# ЭТИМ запуском, и init-скрипт постгреса заведёт роли с паролями из ТЕКУЩЕГО
# .env — то есть пароли гарантированно совпадут и без -SyncPasswords. После
# up том уже будет существовать всегда, поэтому проверить можно только сейчас.
$volumeCheck = Invoke-Docker -Arguments @('volume', 'inspect', 'trellis_pgdata')
$volumeExistedBeforeUp = ($volumeCheck.ExitCode -eq 0)

# Флаг ставим до запуска, а не после: если up упадёт на полпути, часть
# контейнеров уже будет поднята — подсказка про журналы тогда уместна.
$script:StackStarted = $true
$up = Invoke-Docker -Arguments @('compose', 'up', '-d', '--build') -Stream

# Сборка тянет базовые образы с Docker Hub, и обрыв связи с ним — самая
# частая случайная неудача (реально ловилось при отладке этого скрипта:
# `failed to do request: Head https://registry-1.docker.io/...: EOF` на
# образе, который уже лежал локально). Один автоматический повтор дешевле
# для пользователя, чем сообщение «попробуйте ещё раз».
# `: EOF`, а не просто `EOF`: так выглядит настоящий обрыв связи с
# реестром (`Head "https://registry-1.docker.io/...": EOF`), тогда как
# голое слово EOF встречается и в совершенно других ошибках вроде
# «unexpected EOF» в разборе файла — их сюда затягивать не надо.
$transientNetworkPattern = 'failed to do request|registry-1\.docker\.io|dial tcp|no such host|TLS handshake|i/o timeout|: EOF'
if ($up.ExitCode -ne 0 -and $up.Text -match $transientNetworkPattern) {
    Write-Host ''
    Write-Note 'Docker не смог получить данные из интернета. Пробую ещё раз (это бывает случайно)...'
    Start-Sleep -Seconds 5
    $up = Invoke-Docker -Arguments @('compose', 'up', '-d', '--build') -Stream
}

# Сети нет и после повтора. Это ещё не повод отказать в запуске: сборка
# обращается к реестру даже за базовым образом, который уже лежит на диске,
# а обычный `up` — нет. Поэтому, если образы уже собраны прошлым запуском,
# платформа отлично поднимется на них и без интернета — именно так
# выглядит второй и любой следующий запуск у пользователя в самолёте.
if ($up.ExitCode -ne 0 -and $up.Text -match $transientNetworkPattern) {
    Write-Host ''
    Write-Note 'Связи с интернетом нет — пробую запустить то, что было собрано раньше...'
    $up = Invoke-Docker -Arguments @('compose', 'up', '-d') -Stream
    if ($up.ExitCode -eq 0) {
        Write-Host ''
        Write-Note 'Запущена ранее собранная версия платформы (собрать заново не вышло: нет интернета).'
        Write-Note 'Если проект обновлялся, запусти скрипт ещё раз, когда интернет появится.'
    }
}

if ($up.ExitCode -ne 0) {
    if ($up.Text -match 'port is already allocated|address already in use|Ports are not available|bind: ') {
        Stop-WithProblem -Title 'нужный порт уже занят другой программой' -Hints @(
            'Какая-то программа на этом компьютере уже слушает порт, нужный Trellis.',
            "Открой файл $envPath и поменяй FRONTEND_PORT (сейчас $frontendPort),",
            "BACKEND_PORT (сейчас $backendPort) или POSTGRES_PORT на свободные значения,",
            'затем запусти скрипт ещё раз. Точный порт назван в выводе Docker выше.'
        )
    } elseif ($up.Text -match 'Cannot connect to the Docker daemon|docker daemon is not running') {
        Stop-WithProblem -Title 'Docker перестал отвечать во время запуска' -Hints @(
            'Убедись, что Docker Desktop запущен («Engine running»), и повтори запуск.'
        )
    } elseif ($up.Text -match $transientNetworkPattern) {
        Stop-WithProblem -Title 'Docker не смог скачать нужные образы из интернета' -Hints @(
            'Первая сборка (и первая после обновления проекта) требует интернета: Docker',
            'скачивает базовые образы с hub.docker.com.',
            'Проверь подключение к интернету; если выходишь через корпоративный прокси или VPN —',
            'настрой его в Docker Desktop (Settings → Resources → Proxies) и повтори запуск.'
        )
    } else {
        Stop-WithProblem -Title 'Docker не смог собрать или запустить контейнеры' -Hints @(
            'Причина — в выводе Docker выше (последние строки обычно самые важные).',
            'Если там говорится о нехватке места — освободи место на диске и повтори.'
        )
    }
}
Write-Host ''
Write-Ok 'Контейнеры запущены.'

# --- Шаг 4: ожидание готовности --------------------------------------------

Write-Step -Number 4 -Total $totalSteps -Text 'Жду, пока платформа будет готова'

Wait-ServiceHealthy -Service 'postgres' -Title 'База данных' -TimeoutSeconds $PostgresTimeoutSeconds

if ($SyncPasswords) {
    if (-not $volumeExistedBeforeUp) {
        # Том только что создан этим же запуском — база и так проинициализирована
        # текущими паролями из .env, ALTER ROLE и рестарт ядра ничего бы не
        # изменили и только заняли бы время.
        Write-Detail 'База создана только что этим же запуском — пароли и так из .env, синхронизация не нужна.'
    } else {
        Write-Detail 'Обновляю пароли ролей базы по файлу .env (как просили ключом -SyncPasswords)...'
        Invoke-PasswordSync -EnvMap $envMap
        Write-Ok 'Пароли ролей в базе приведены к .env.'
        $restart = Invoke-Docker -Arguments @('compose', 'restart', 'backend')
        if ($restart.ExitCode -ne 0) {
            foreach ($line in $restart.Lines) { Write-Raw $line }
            Stop-WithProblem -Title 'не удалось перезапустить ядро после смены паролей' -Hints @(
                'Попробуй запустить скрипт ещё раз уже без -SyncPasswords.'
            )
        }
        Write-Detail 'Ядро перезапущено с новыми паролями.'
    }
}

Wait-ServiceHealthy -Service 'backend' -Title 'Ядро платформы' -TimeoutSeconds $BackendTimeoutSeconds
Wait-ServiceHealthy -Service 'frontend' -Title 'Интерфейс' -TimeoutSeconds $FrontendTimeoutSeconds

# --- Шаг 5: адрес ----------------------------------------------------------

Write-Step -Number 5 -Total $totalSteps -Text 'Готово'

$address = "http://localhost:$frontendPort"
Write-Host ''
Write-Host '  Trellis запущен и готов к работе.' -ForegroundColor Green
Write-Host ''
Write-Host "      Открой в браузере:  $address" -ForegroundColor Green
Write-Host ''
Write-Host '      Браузер намеренно не открывается сам — скопируй адрес выше.'
Write-Host '      Платформа доступна только с этого компьютера.'
Write-Host ''
Write-Host '      Остановить: docker compose down (прогресс сохранится)'
Write-Host '      Запустить снова: этот же скрипт'
Write-Host ''

exit 0
