@echo off
chcp 65001 >nul
title QQ Bridge Restart
cd /d "%~dp0"
rem stop-bridge now also kills the start.bat supervisor, so this is a real restart.
call "%~dp0stop-bridge.cmd"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
start "" "%~dp0start-bridge.cmd"
echo [restart-bridge] started.
