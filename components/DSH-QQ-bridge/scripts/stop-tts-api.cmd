@echo off
setlocal
set "PIDFILE=<TTS_ROOT>\GPT-SoVITS-v2pro-20250604-nvidia50\api.pid"
if exist "%PIDFILE%" (
  set /p TTS_PID=<"%PIDFILE%"
  if defined TTS_PID (
    taskkill /PID %TTS_PID% /F >nul 2>nul
  )
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9880" ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>nul
endlocal
