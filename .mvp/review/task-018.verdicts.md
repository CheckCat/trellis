# Reviewer replies: task 018

Raw, unparsed. One section per poll.

## reviewer-018-1

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "bug", "file": "start.ps1", "line": 318, "quote": "$containerId = Get-ServiceContainerId -Service $Service\n    if ($containerId.Length -eq 0) {\n        Stop-WithProblem -Title \"контейнер '$Service' не создан\" -Hints @(", "summary": "Get-ServiceContainerId runs `docker compose ps -q <service>` (no `--all`) exactly once and only tries again; Compose v2's default `ps` excludes non-running containers, so a service that crashes immediately after `docker compose up -d --build` (e.g. postgres/backend crash-looping under `restart: unless-stopped`) can be mid-restart-backoff at that single lookup, making the ID empty — the script then reports the misleading 'контейнер не создан' / 'запусти скрипт ещё раз' message instead of running Show-FailureDiagnosis's actual log-based diagnosis, defeating the script's own stated fault-tolerance design for exactly the crash-loop case it built restart/health parsing to handle."}, {"severity": "minor", "file": "start.ps1", "line": 618, "quote": "'Другие символы (@ : / ? # % и пробел) ломают подключение к базе.',", "summary": "The validation regex `^[A-Za-z0-9._~-]+$` (line 613) rejects any character outside that whitelist, but this hint line only names six symbols plus space as the problem, so a password containing e.g. `!` or `$` gets rejected with a message that doesn't mention the actual offending character class."}]
```

## reviewer-018-2

```
The reviewer skill specifies a plain-text final reply format (not the ReportFindings tool), so I'll give my answer directly as instructed.

VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": ".gitattributes", "line": 8, "quote": "*.bat text eol=crlf\n*.ps1 text eol=crlf", "summary": "New file added outside the brief's declared file list (start.ps1, start.bat, docs/run-windows.md); justified in the report but not itself a named task-018 deliverable."}, {"severity": "minor", "file": "start.ps1", "line": 714, "quote": "if ($SyncPasswords) {", "summary": "On a fully fresh environment (no prior .env/containers) -SyncPasswords still runs an ALTER ROLE pass and an extra backend restart even though freshly-initialized DB passwords already match .env — harmless/idempotent but unnecessary delay."}]
```

## reviewer-018-3

```
Based on my review of the brief (`.mvp/briefs/task-018.md`), the review package (`.mvp/review/task-018.md`), the implementer's report, and the current `docker-compose.yml`, the implementation is thorough and technically sound: Docker Desktop detection/auto-start, `.env` bootstrapping with cryptographically-random passwords, sequential healthcheck waiting matching the compose `depends_on` chain (postgres → backend → frontend), correct failure diagnosis per service (including matching the *current* frontend healthcheck contract `/api/health`, not the stale one from task 002's interface digest), no browser auto-open, human-readable "installer-style" Russian messages, PS 5.1-compatible syntax, and CRLF line-ending handling via a new `.gitattributes`. All match `CLAUDE.md` and `.mvp/invariants.md` requirements I could check.

One minor accuracy issue found:

VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "start.ps1", "line": 116, "quote": "Write-Host '      Контейнеры оставлены запущенными — их журналы можно посмотреть командой'", "summary": "Stop-WithProblem always claims containers were left running whenever $script:StackStarted is true, but in an engine-level failure of `docker compose up` (e.g. a port bind failure before any container actually starts) this can be shown even though no container process is actually running, making the 'посмотри docker compose logs' hint potentially unhelpful for that edge case."}]
```
