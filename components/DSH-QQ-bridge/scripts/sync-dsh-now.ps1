# Find the running DSH host, read its listening ports, and update config.json dsh.baseUrl.
# Used by start-bot.cmd so a manual start still follows a changed DSH Web port.
#
# 2026-10-29 修正：不再只认「命令行含 dsh-desktop-host」的进程——实测监听 Web 端口的是主进程
# "DeepSeek Harness.exe"。旧匹配会让 baseUrl 停留在上一次的旧端口，桥接起来后连不上事件流
# （日志表现为「DSH 事件流已结束（本次收到 0 帧）」）。现在枚举所有 DSH 进程的监听端口逐个试。
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$node = Join-Path $root 'tools\node-runtime\bin\node.exe'

$synced = $false
$lastPorts = @()
for ($i = 0; $i -lt 45; $i++) {
  $lastPorts = @()
  foreach ($p in (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
    $lastPorts += @(Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty LocalPort)
  }
  $lastPorts = @($lastPorts | Where-Object { $_ } | Sort-Object -Unique)
  if ($lastPorts.Count -gt 0) {
    & $node (Join-Path $PSScriptRoot 'sync-dsh-port.mjs') @lastPorts
    if ($LASTEXITCODE -eq 0) { $synced = $true; break }
  }
  Start-Sleep -Seconds 2
}
if (-not $synced) {
  Write-Output "[sync-dsh-now] 未找到 DSH API（试过端口：$($lastPorts -join ',')）"
  exit 1
}
exit 0