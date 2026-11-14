# One-shot boot for the QQ bot stack.
# Called by start-bot.cmd so the whole sequence runs inside a single PowerShell
# process. Every window it opens is either hidden or minimized on purpose: the
# panel button used to flash one console per step.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$snowluma = '<DSMP_PLUGIN_ROOT>\components\SnowLuma'

function Port-Open([int]$port) {
  return [bool](Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

if (-not (Get-Process -Name 'QQ' -ErrorAction SilentlyContinue)) {
  Write-Host '[start-bot] WARN: QQ client is not running. Start QQNT and log in the small account <BOT_QQ> first.'
}

if (-not (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
  $exe = Join-Path $root 'tools\dsh-app\DeepSeek Harness.exe'
  if (Test-Path $exe) { Start-Process $exe -WorkingDirectory (Split-Path -Parent $exe) }
}

Start-Sleep -Seconds 4
& (Join-Path $PSScriptRoot 'sync-dsh-now.ps1')

if (-not (Port-Open 5099)) {
  Start-Process (Join-Path $snowluma 'start-snowluma-autostart.cmd') -WorkingDirectory $snowluma -WindowStyle Hidden
}
for ($i = 0; $i -lt 20; $i++) {
  if (Port-Open 5099) { break }
  Start-Sleep -Seconds 1
}

if (-not (Port-Open 3100)) {
  Start-Process (Join-Path $root 'start-bridge.cmd') -WorkingDirectory $root -WindowStyle Hidden
}
for ($i = 0; $i -lt 60; $i++) {
  if (Port-Open 3100) { break }
  Start-Sleep -Seconds 1
}

if (Port-Open 3100) { Write-Host '[start-bot] qq-bridge is listening on 3100.' }
else { Write-Host '[start-bot] WARN: qq-bridge did not open 3100 within 60s, see logs.' }
