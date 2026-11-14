param(
  [switch]$Force,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

# Manual entry point: Start Menu -> "冷备份记忆", which runs this script with -Force.
# The old scheduled task "DeepSeek QQ Memory Monthly Cold Backup" is disabled.
# If it is re-enabled, this script only does the cold run on the first Sunday of the
# month, and only while the machine looks idle (guard below).
#
# A cold backup stops qq-bridge/SnowLuma/DSH for ~20 seconds, so it runs only
# when the machine looks idle: no keyboard/mouse input for $IdleNeedMinutes minutes,
# and no new chat message for $BusyNeedMinutes minutes. If still busy after $Tries
# checks (10 minutes apart), it degrades to a hot backup and leaves DSH alone.

$IdleNeedMinutes = 10
$BusyNeedMinutes = 10
$Tries = 6
$RetrySeconds = 600
$root = Split-Path -Parent $PSScriptRoot
$memDir = '<DSMP_MEMORY_DIR>'
try {
  $bridgeConfig = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($bridgeConfig.memory -and $bridgeConfig.memory.dir) { $memDir = [string]$bridgeConfig.memory.dir }
} catch { }
$HotDir = Join-Path $memDir 'raw\hot'

function Get-IdleMinutes {
  # Minutes since the last keyboard/mouse input; $null when the API is unavailable.
  try {
    if (-not ('WbIdle' -as [type])) {
      Add-Type -Namespace Wb -Name Idle -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
public static uint IdleMs() {
  var l = new LASTINPUTINFO(); l.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(l);
  if (!GetLastInputInfo(ref l)) return 0;
  return ((uint)System.Environment.TickCount - l.dwTime);
}
'@
    }
    return [math]::Round([Wb.Idle]::IdleMs() / 60000.0, 1)
  } catch {
    return $null
  }
}

function Get-SinceLastMessageMinutes {
  # Minutes since the newest chat log was written; $null when there is no log yet.
  try {
    if (-not (Test-Path -LiteralPath $HotDir)) { return $null }
    $newest = Get-ChildItem -LiteralPath $HotDir -Recurse -File -Filter '*.jsonl' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if (-not $newest) { return $null }
    return [math]::Round(((Get-Date).ToUniversalTime() - $newest.LastWriteTimeUtc).TotalMinutes, 1)
  } catch {
    return $null
  }
}

function Test-Idle {
  $idle = Get-IdleMinutes
  $msg = Get-SinceLastMessageMinutes
  $idleOk = ($null -eq $idle) -or ($idle -ge $IdleNeedMinutes)
  $msgOk = ($null -eq $msg) -or ($msg -ge $BusyNeedMinutes)
  [pscustomobject]@{ Idle = $idle; Msg = $msg; Ok = ($idleOk -and $msgOk) }
}

function Invoke-Hot([string]$why) {
  Write-Host ("[idle-guard] {0}，本次改为热备份（不停 DSH）。" -f $why)
  & (Join-Path $PSScriptRoot 'backup-memory.ps1') -Mode Hot
  exit $LASTEXITCODE
}

$month = Get-Date -Format 'yyyy-MM'
$snapshots = '<BACKUP_ROOT>\dsmp-memory\snapshots'

if (-not $Force) {
  $coldThisMonth = Get-ChildItem -LiteralPath $snapshots -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "$month-*_cold" } |
    Select-Object -First 1
  if ($coldThisMonth) {
    Write-Host "Cold backup already exists for $month ($($coldThisMonth.Name)); skipped. Use -Force for a manual run."
    exit 0
  }
}

$probe = Test-Idle
$probeText = ("键鼠空闲 {0} 分钟 / 最后一条消息 {1} 分钟前" -f `
  $(if ($null -eq $probe.Idle) { '未知' } else { $probe.Idle }), `
  $(if ($null -eq $probe.Msg) { '未知' } else { $probe.Msg }))

if ($DryRun) {
  Write-Host ("[dry-run] {0}；空闲判定={1}；下一步={2}" -f $probeText, $probe.Ok, $(if ($Force -or $probe.Ok) { '冷备' } else { '等待或转热备' }))
  exit 0
}

if (-not $Force) {
  for ($i = 1; $i -le $Tries; $i++) {
    if ($probe.Ok) { break }
    if ($i -eq $Tries) {
      Invoke-Hot ("等了 {0} 分钟仍在用（{1}）" -f [int]($Tries * $RetrySeconds / 60), $probeText)
    }
    Write-Host ("[idle-guard] 还在用：{0}；{1} 秒后重试（{2}/{3}）" -f $probeText, $RetrySeconds, $i, $Tries)
    Start-Sleep -Seconds $RetrySeconds
    $probe = Test-Idle
    $probeText = ("键鼠空闲 {0} 分钟 / 最后一条消息 {1} 分钟前" -f `
      $(if ($null -eq $probe.Idle) { '未知' } else { $probe.Idle }), `
      $(if ($null -eq $probe.Msg) { '未知' } else { $probe.Msg }))
  }
}

Write-Host ("[cold] 机器空闲（{0}），开始冷备。" -f $probeText)
# Real cold backup: stops qq-bridge/SnowLuma/DSH, copies, then restarts via autostart-qqbot.ps1.
# Run this from Task Scheduler or a detached PowerShell, NOT from an interactive DSH terminal
# (killing DSH would also kill the terminal that launched this script).
& (Join-Path $PSScriptRoot 'backup-memory.ps1') -Mode Cold
exit $LASTEXITCODE
