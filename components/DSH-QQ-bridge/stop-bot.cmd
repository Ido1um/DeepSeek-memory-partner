@echo off
chcp 65001 >nul
title Stop QQ Bot
cd /d "%~dp0"
rem One PowerShell process drives all four stop scripts, so the panel button does
rem not flash a console per step.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\dsmp-halt.ps1"
echo To start again, run start-bot.cmd.
