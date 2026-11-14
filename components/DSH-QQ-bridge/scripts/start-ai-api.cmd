@echo off
setlocal
rem Legacy filename kept for old Start Menu shortcuts and dsmp-halt.ps1.
rem Since 2026-11-14 this controls ComfyUI (A-Huishi is retired).
set "COMFY_ROOT=<LOCAL_TOOLS>\ComfyUI"
if not exist "%COMFY_ROOT%\tools\start-comfy.cmd" (
  echo [%date% %time%] ComfyUI start script missing: %COMFY_ROOT%\tools\start-comfy.cmd
  exit /b 1
)
call "%COMFY_ROOT%\tools\start-comfy.cmd"
exit /b %ERRORLEVEL%