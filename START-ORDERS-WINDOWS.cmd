@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python -m server.manage serve --setup --open
) else (
  py -3 -m server.manage serve --setup --open
)
pause
