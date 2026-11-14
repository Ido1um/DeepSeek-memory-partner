@echo off
chcp 65001 >nul
title Stop QQ Bridge
cd /d "%~dp0"
rem Kill every supervising loop first: start-bridge.cmd restarts the bridge when it
rem dies, and start-bot.cmd can start another supervisor while it is still running.
rem Supervisors may be launched with a relative script name (cwd-based), so match the
rem script name only, never the "DSH-QQ-bridge" path.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; for($round=0;$round -lt 3;$round++){ $killed=0; foreach($p in (Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\")){ $cl=[string]$p.CommandLine; if($p.ProcessId -eq $PID){continue}; if($cl -match 'start(-bridge|-bot)?\.(bat|cmd)' -and $cl -notmatch 'restart' -and $cl -notmatch 'stop-bridge' -and $cl -notmatch 'stop-bot'){ Write-Host ('kill supervisor PID ' + $p.ProcessId + ' : ' + $cl); Stop-Process -Id $p.ProcessId -Force; $killed++ } }; foreach($p in (Get-CimInstance Win32_Process -Filter \"Name='node.exe'\")){ $cl=[string]$p.CommandLine; if($cl -match 'bridge\.js' -and $cl -notmatch 'mcp-' -and $cl -notmatch 'node_modules'){ Write-Host ('kill bridge PID ' + $p.ProcessId); Stop-Process -Id $p.ProcessId -Force; $killed++ } }; $c=Get-NetTCPConnection -LocalPort 3100 -State Listen; foreach($x in $c){ Write-Host ('kill listener PID ' + $x.OwningProcess); Stop-Process -Id $x.OwningProcess -Force; $killed++ }; Start-Sleep -Milliseconds 1200; if(-not (Get-NetTCPConnection -LocalPort 3100 -State Listen)){ Write-Host ('[stop-bridge] port 3100 closed (round ' + ($round+1) + ')'); exit 0 } }; Write-Host '[stop-bridge] WARN: 3100 still listening after 3 rounds'; exit 1"
del /q "%~dp0state\bridge.lock" 2>nul
if errorlevel 1 echo [stop-bridge] done with warning.
if not errorlevel 1 echo [stop-bridge] done.
