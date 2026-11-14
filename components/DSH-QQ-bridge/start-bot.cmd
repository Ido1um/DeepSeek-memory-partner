@echo off
chcp 65001 >nul
title Start QQ Bot
cd /d "%~dp0"

rem 0-4) everything that used to be six separate powershell calls now runs in one
rem      process, with every child window hidden (panel button no longer flashes).
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\dsmp-boot.ps1"
if not defined DSMP_HEADLESS start "" http://127.0.0.1:5099

echo.
echo [start-bot] DSH + SnowLuma + qq-bridge requested.
echo A-Huishi drawing starts on demand; first drawing takes ~40-70s, then it stops when idle.
echo GPT-SoVITS voice starts on demand; first voice takes ~20-30s, then it stops when idle.
echo SnowLuma auto-loads only UIN=<BOT_QQ> (login <OWNER_QQ> is filtered out).
echo If injection fails, open SnowLuma WebUI "Process Injection" and check the log.
echo qq-bridge console: http://127.0.0.1:3100
echo.

rem 5) SnowLuma injection + OneBot + bridge upstream: one block of read-only facts.
rem    Waits up to 30s for SnowLuma to inject; never fails this script.
if exist "%~dp0tools\node-runtime\bin\node.exe" (
  "%~dp0tools\node-runtime\bin\node.exe" "%~dp0scripts\check-snowluma.mjs" --wait=30 --warn-only --log
) else (
  echo [start-bot] WARN: tools\node-runtime\bin\node.exe not found, skip bot health check.
)
rem 6) preset readiness: one line at boot, never blocks and never fails the start
if exist "%~dp0tools\node-runtime\bin\node.exe" (
  "%~dp0tools\node-runtime\bin\node.exe" "%~dp0scripts\check-presets.mjs" --wait=25 --warn-only --log
)

