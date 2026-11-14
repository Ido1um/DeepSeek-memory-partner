@echo off
setlocal
set "TTS_ROOT=<TTS_ROOT>\GPT-SoVITS-v2pro-20250604-nvidia50"
set "LOG=%TTS_ROOT%\api.log"
cd /d "%TTS_ROOT%"
if not exist "%LOG%" type nul > "%LOG%"
powershell -NoProfile -Command "if (Test-NetConnection 127.0.0.1 -Port 9880 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo [%date% %time%] GPT-SoVITS API already listening on 9880 >> "%LOG%"
  exit /b 0
)
echo [%date% %time%] starting GPT-SoVITS v1 CPU API >> "%LOG%"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUNBUFFERED=1"
set "TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1"
runtime\python.exe -u api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS\configs\tts_infer_v1_cpu.yaml >> "%LOG%" 2>&1
echo [%date% %time%] GPT-SoVITS API exited code %ERRORLEVEL% >> "%LOG%"
endlocal
