@echo off
rem Trellis: start the platform. Double-click entry point for Windows.
rem Everything this does lives in start.ps1; _run.bat is the shared wrapper.
call "%~dp0_run.bat" start.ps1 %*
exit /b %ERRORLEVEL%
