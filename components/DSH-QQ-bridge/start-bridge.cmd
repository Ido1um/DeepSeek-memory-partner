@echo off
chcp 65001 >nul
title QQ Bridge (DSH)
cd /d "%~dp0"
set "QQ_MEMORY_CONFIG=%~dp0config.json"
rem DSH bundled node through an ASCII junction, so this batch never contains non-ASCII paths.
set "PATH=%~dp0tools\node-runtime\bin;%PATH%"
rem DSH picks a new Web port after some restarts; follow it before starting the bridge.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-dsh-now.ps1"
call "%~dp0start.bat"
