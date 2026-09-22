@echo off
rem Trellis: rebuild images from scratch (no cache) and start again.
rem Use after pulling changes from the repository. Progress is kept.
rem Everything this does lives in rebuild.ps1; _run.bat is the shared wrapper.
call "%~dp0_run.bat" rebuild.ps1 %*
exit /b %ERRORLEVEL%
