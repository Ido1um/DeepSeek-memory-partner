# One-shot shutdown for the QQ bot stack.
# Called by stop-bot.cmd so the four stop scripts run inside a single PowerShell
# process instead of opening one console per step.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$snowluma = '<DSMP_PLUGIN_ROOT>\components\SnowLuma'

Write-Host 'Stopping qq-bridge...'
& (Join-Path $root 'stop-bridge.cmd')
Write-Host 'Stopping SnowLuma...'
& (Join-Path $snowluma 'stop-snowluma.cmd')
Write-Host 'Stopping A-Huishi API...'
& (Join-Path $PSScriptRoot 'stop-ai-api.cmd')
Write-Host 'Stopping GPT-SoVITS API...'
& (Join-Path $PSScriptRoot 'stop-tts-api.cmd')
Start-Sleep -Seconds 4
Write-Host '[stop-bot] QQ bot stopped. DSH and the QQ client are left running.'
