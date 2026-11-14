@echo off
setlocal
rem Legacy filename kept. Since 2026-11-14 this stops ComfyUI (A-Huishi is retired).
set "COMFY_ROOT=<LOCAL_TOOLS>\ComfyUI"
if exist "%COMFY_ROOT%\tools\stop.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%COMFY_ROOT%\tools\stop.ps1"
  exit /b %ERRORLEVEL%
)
echo [%date% %time%] ComfyUI stop script missing
exit /b 0