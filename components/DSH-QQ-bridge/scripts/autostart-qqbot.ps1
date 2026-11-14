# Autostart: wait for DSH -> sync DSH web port -> start SnowLuma (auto-load for this process only)
# -> wait for OneBot 3000/3001 -> start qq-bridge.
# Runs hidden from the Start Menu Startup folder.
$ErrorActionPreference = 'Continue'
$root = '<DSMP_PLUGIN_ROOT>\components\DSH-QQ-bridge'
$snow = '<DSMP_PLUGIN_ROOT>\components\SnowLuma'
$node = Join-Path $root 'tools\node-runtime\bin\node.exe'
$dshExe = Join-Path $root 'tools\dsh-app\DeepSeek Harness.exe'

$logDir = Join-Path $root 'state'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'autostart.log'

function Write-Log([string]$message) {
  Add-Content -Path $logPath -Value ('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
}

function Test-LocalPort([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $port)
    if (-not $task.Wait(700)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-DshHostProcess {
  Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh-desktop-host' } |
    Select-Object -First 1
}

function Get-DshListenPorts([int]$dshPid) {
  $ports = @()
  try {
    $ports = @(Get-NetTCPConnection -OwningProcess $dshPid -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty LocalPort | Sort-Object -Unique)
  } catch {}
  if (-not $ports -or $ports.Count -eq 0) {
    foreach ($line in (netstat -ano | Select-String 'LISTENING')) {
      $text = $line.ToString()
      if ($text -match "\s+$dshPid\s*$" -and $text -match ':(\d+)\s') {
        $ports += [int]$matches[1]
      }
    }
    $ports = @($ports | Sort-Object -Unique)
  }
  return $ports
}

$acquired = $false
$mutex = New-Object System.Threading.Mutex($false, 'Local\DSHQQBridgeAutostart')
try {
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) { exit 0 }

  Write-Log '=== autostart begin ==='

  # 1) wait for DSH desktop host (DSH already has a Startup shortcut)
  $dsh = $null
  for ($i = 0; $i -lt 90; $i++) {
    $dsh = Get-DshHostProcess
    if ($dsh) { break }
    Start-Sleep -Seconds 2
  }
  if (-not $dsh) {
    Write-Log 'DSH host not found after 180s; starting DeepSeek Harness as fallback'
    Start-Process -FilePath $dshExe -WorkingDirectory (Split-Path $dshExe) | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
      $dsh = Get-DshHostProcess
      if ($dsh) { break }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $dsh) {
    Write-Log 'ERROR: DSH host still not found; abort'
    exit 1
  }
  Write-Log ('DSH host pid=' + $dsh.ProcessId)

  # 2) wait for DSH web API to bind a port, then write it into config.json.
  #    DSH's host process appears before its web server starts; a single port
  #    query would race startup and keep the previous (now dead) baseUrl.
  $syncOk = $false
  $lastPorts = @()
  $loggedPorts = ''
  for ($i = 0; $i -lt 90; $i++) {
    $lastPorts = @(Get-DshListenPorts -dshPid $dsh.ProcessId)
    if ($lastPorts.Count -gt 0) {
      $portText = ($lastPorts -join ', ')
      if ($portText -ne $loggedPorts) {
        Write-Log ('DSH listen ports: ' + $portText)
        $loggedPorts = $portText
      }
      $syncOut = & $node (Join-Path $root 'scripts\sync-dsh-port.mjs') @lastPorts 2>&1
      $syncText = (($syncOut | Out-String).Trim())
      if ($syncText) { Write-Log ('sync-dsh-port: ' + $syncText) }
      if ($LASTEXITCODE -eq 0) { $syncOk = $true; break }
    }
    Start-Sleep -Seconds 2
  }
  if ($syncOk) {
    Write-Log 'DSH API synced'
  } elseif ($lastPorts.Count -eq 0) {
    Write-Log 'WARN: no DSH listen ports found after 180s; keeping current dsh.baseUrl'
  } else {
    Write-Log 'WARN: DSH API not ready after 180s; keeping current dsh.baseUrl'
  }

  # 3) A-Huishi is intentionally NOT started here. qq_generate_image (MCP) starts
  #    it on demand and stops the whole process after imageGen.idleStopProcessMs.
  #    Use the Start Menu "启动画图引擎" shortcut to preload it manually.
  if (Test-LocalPort 7860) { Write-Log 'A-Huishi API already listening on 7860 (external/manual)' }
  else { Write-Log 'A-Huishi API not started at boot; drawing will start it on demand' }

  # 3b) GPT-SoVITS is intentionally NOT started here. qq-bridge starts it on demand
  #     and stops it after socialV2.tts.idleStopMs of no use.

  # 4) start SnowLuma; patched SnowLuma auto-loads only UIN=<BOT_QQ>
  if (Test-LocalPort 5099) {
    Write-Log 'SnowLuma already listening on 5099'
  } else {
    Write-Log 'starting SnowLuma (targeted auto-load UIN=<BOT_QQ>)'
    Start-Process -FilePath (Join-Path $snow 'start-snowluma-autostart.cmd') -WorkingDirectory $snow -WindowStyle Hidden
    for ($i = 0; $i -lt 90; $i++) {
      if (Test-LocalPort 5099) { break }
      Start-Sleep -Seconds 2
    }
  }
  if (Test-LocalPort 5099) { Write-Log 'SnowLuma WebUI ready on 5099' }
  else { Write-Log 'WARN: SnowLuma not listening on 5099; continue anyway' }

  # 5) fallback: start QQ if it is not running (QQNT also has its own Run entry)
  if (-not (Get-Process -Name QQ -ErrorAction SilentlyContinue)) {
    Write-Log 'QQ not running; starting QQNT in background'
    Start-Process -FilePath 'C:\Program Files\Tencent\QQNT\QQ.exe' -ArgumentList '/background' | Out-Null
  }

  # 6) wait for SnowLuma to inject the account and start OneBot 3000/3001
  $onebotReady = $false
  for ($i = 0; $i -lt 120; $i++) {
    if ((Test-LocalPort 3000) -and (Test-LocalPort 3001)) { $onebotReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if ($onebotReady) { Write-Log 'OneBot 3000/3001 ready' }
  else { Write-Log 'WARN: OneBot 3000/3001 not ready yet (QQ login / SnowLuma injection pending); bridge will keep retrying' }

  # 7) start qq-bridge
  if (Test-LocalPort 3100) {
    Write-Log 'qq-bridge already listening on 3100'
  } else {
    Write-Log 'starting qq-bridge'
    Start-Process -FilePath (Join-Path $root 'start-bridge.cmd') -WorkingDirectory $root -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) {
      if (Test-LocalPort 3100) { break }
      Start-Sleep -Seconds 2
    }
  }
  if (Test-LocalPort 3100) { Write-Log 'qq-bridge console ready on 3100' }
  else { Write-Log 'ERROR: qq-bridge not listening on 3100' }

  Write-Log '=== autostart done ==='
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message)
} finally {
  if ($acquired) { try { $mutex.ReleaseMutex() | Out-Null } catch {} }
}
