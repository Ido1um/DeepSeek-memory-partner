@echo off
chcp 65001 >nul
set "SU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%SU%\QQ Bridge Autostart.lnk" (
  del /f /q "%SU%\QQ Bridge Autostart.lnk"
  echo [done] QQ Bridge autostart disabled.
) else (
  echo [skip] QQ Bridge Autostart.lnk not found.
)
timeout /t 3 >nul
