@echo off
rem Trellis launcher for Windows: double-click entry point.
rem
rem All the real work (and all human-facing text) lives in start.ps1 -- this
rem file only picks a PowerShell to run it with, keeps the console window
rem open afterwards, and passes the exit code through.
rem
rem Deliberately ASCII-only: cmd.exe reads this file in the console code
rem page, which varies per machine, so Russian text here would be a
rem mojibake lottery. start.ps1 prints its own text in UTF-8 (hence the
rem chcp below, which switches this console to UTF-8 before PowerShell
rem starts).
rem
rem -ExecutionPolicy Bypass is required: the default Windows policy
rem (Restricted/AllSigned) refuses to run an unsigned local .ps1, and this
rem project is not code-signed. Bypass applies to this one invocation only
rem -- nothing about the machine's policy is changed.

chcp 65001 >nul 2>&1

set "TRELLIS_PS=%~dp0start.ps1"
if not exist "%TRELLIS_PS%" (
  echo ERROR: start.ps1 was not found next to start.bat.
  echo Copy the whole Trellis project folder again, keeping both files together.
  echo.
  pause
  exit /b 1
)

rem Prefer PowerShell 7+ (pwsh) when it is installed, fall back to the
rem Windows PowerShell 5.1 that ships with every Windows. `if errorlevel 1`
rem instead of `if %ERRORLEVEL%`: the latter is expanded when the whole
rem if/else block is parsed, not when it runs.
where pwsh >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%TRELLIS_PS%" %*
) else (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%TRELLIS_PS%" %*
)

set "TRELLIS_EXIT=%ERRORLEVEL%"

rem Without this pause a double-clicked window closes instantly -- taking
rem the address to open (or the explanation of what went wrong) with it.
rem Set TRELLIS_NO_PAUSE=1 to skip it when calling from another script.
if not "%TRELLIS_NO_PAUSE%"=="1" (
  echo.
  pause
)

exit /b %TRELLIS_EXIT%
