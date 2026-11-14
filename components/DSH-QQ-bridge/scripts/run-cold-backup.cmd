@echo off
setlocal EnableExtensions
title DeepSeek Memory - Cold Backup
echo ============================================================
echo  Cold backup of the DeepSeek memory data
echo ============================================================
echo  This will STOP the QQ bot and DSH for about 20-60 seconds,
echo  copy a consistent snapshot, then start them again.
echo.
echo    - the DSH window will close and reopen
echo    - do not close this window while it runs
echo    - progress log: <BACKUP_ROOT>\dsmp-memory\backup.log
echo.
set "GO="
set /p "GO=Continue? [Y/N] "
if /i not "%GO%"=="Y" (
  echo.
  echo Cancelled. Nothing was stopped.
  echo.
  pause
  exit /b 1
)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-memory-cold.ps1" -Force
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo Done. Snapshot: <BACKUP_ROOT>\dsmp-memory\snapshots
) else (
  echo FAILED rc=%RC% - see <BACKUP_ROOT>\dsmp-memory\backup.log
)
echo.
pause
exit /b %RC%
