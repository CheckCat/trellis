@echo off
rem Trellis: stop the platform and remove its containers. Progress is kept.
rem Everything this does lives in down.ps1; _run.bat is the shared wrapper.
call "%~dp0_run.bat" down.ps1 %*
exit /b %ERRORLEVEL%
