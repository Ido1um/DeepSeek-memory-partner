@echo off
setlocal
if "%COMFY_ROOT%"=="" set "COMFY_ROOT=<LOCAL_TOOLS>\ComfyUI"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%COMFY_ROOT%\tools\stop.ps1"
exit /b %ERRORLEVEL%
