@echo off
chcp 65001 >nul
title DeepSeek QQ Memory Hot Backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-memory-weekly.ps1"
echo.
echo [done] see <BACKUP_ROOT>\dsmp-memory\LAST-STATUS.txt
pause
