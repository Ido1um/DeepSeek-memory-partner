@echo off
rem Start ComfyUI headless for qq-bridge. Bridge polls http://127.0.0.1:8188 afterwards.
rem Only delegates to ComfyUI tools\start-comfy.cmd; must not wait for python here
rem (the bridge spawns cmd, and cmd exit would send CTRL_CLOSE to the child).
setlocal
if "%COMFY_ROOT%"=="" set "COMFY_ROOT=<LOCAL_TOOLS>\ComfyUI"
if not exist "%COMFY_ROOT%\tools\start-comfy.cmd" (
  echo [start-comfy-api] start-comfy.cmd not found under "%COMFY_ROOT%\tools"
  exit /b 1
)
call "%COMFY_ROOT%\tools\start-comfy.cmd"
exit /b %ERRORLEVEL%
