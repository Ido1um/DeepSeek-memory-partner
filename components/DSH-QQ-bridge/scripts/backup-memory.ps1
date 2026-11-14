#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Hot', 'Cold')]
  [string]$Mode = 'Hot',
  # Test-only: skip stopping/restarting DSH. Never use for a real cold backup.
  [switch]$SkipStop,
  [switch]$SkipRestart,
  # 热备保留份数：2 = 最新 + 上一份兜底（当前设定）；1 = 只留最新。
  [ValidateRange(1, 30)]
  [int]$KeepHot = 2,
  # 演练：仍会生成一份新快照用于校验，但不删除任何旧快照。
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root        = Split-Path -Parent $PSScriptRoot
$backupRoot  = '<BACKUP_ROOT>\dsmp-memory'
$dshHome     = if ($env:DSH_HOME) { $env:DSH_HOME } else { '<DSH_HOME>' }
$shenmingDir = '<DSMP_MEMORY_DIR>'
try {
  $bridgeConfig = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($bridgeConfig.memory -and $bridgeConfig.memory.dir) { $shenmingDir = [string]$bridgeConfig.memory.dir }
} catch { }
# 记忆面板插件（含记忆引擎源码 vendor\memory）：源码很关键、体积小；node_modules/backup/logs 必须排除
$memoryPartnerDir = '<DSMP_PLUGIN_ROOT>'
$autostart   = Join-Path $root 'scripts\autostart-qqbot.ps1'
$stopBot     = Join-Path $root 'stop-bot.cmd'
$logPath     = Join-Path $backupRoot 'backup.log'
$statusPath  = Join-Path $backupRoot 'LAST-STATUS.txt'
$script:coldRestart = ''
$script:prevPayload = ''
$script:payloadRoot = ''
$nodeExe = '<DSH_HOME>\app\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = 'node' }
$incTool = '<BACKUP_ROOT>\_tools\incremental-copy.mjs'

function Write-Log([string]$message) {
  $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Mode, $message
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
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

function Invoke-Robocopy([string]$source, [string]$destination) {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "备份源不存在：$source"
  }
  Ensure-Dir $destination
  & robocopy.exe $source $destination /E /R:2 /W:2 /COPY:DAT /DCOPY:T /NFL /NDL /NJH /NJS *> $null
  $code = $LASTEXITCODE
  # 0-7 are success for robocopy; 8+ means at least one file could not be copied.
  if ($code -ge 8) {
    throw "robocopy 复制失败（exit=$code）：$source -> $destination"
  }
}

function Copy-OneFile([string]$source, [string]$destination) {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "备份源文件不存在：$source"
  }
  Ensure-Dir (Split-Path -Parent $destination)
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Get-LatestPayload {
  $snapshots = Get-ChildItem -LiteralPath (Join-Path $backupRoot 'snapshots') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'payload') } |
    Sort-Object Name -Descending
  if ($snapshots) { return (Join-Path $snapshots[0].FullName 'payload') }
  return ''
}

# Copy one source tree into the current staging payload. When a previous snapshot
# exists on the same volume, unchanged files are hardlinked instead of copied.
function Invoke-PayloadCopy([string]$source, [string]$destination, [string]$excludeDir = '') {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "备份源不存在：$source"
  }
  Ensure-Dir $destination
  $linkFrom = ''
  if ($script:prevPayload) {
    $rel = $destination.Substring($script:payloadRoot.Length).TrimStart('\')
    if ($rel) {
      $candidate = Join-Path $script:prevPayload $rel
      if (Test-Path -LiteralPath $candidate) { $linkFrom = $candidate }
    } else {
      $linkFrom = $script:prevPayload
    }
  }
  if ($linkFrom -and (Test-Path -LiteralPath $incTool)) {
    $nodeArgs = @($incTool, '--source', $source, '--dest', $destination, '--link-from', $linkFrom)
    if ($excludeDir) { $nodeArgs += @('--exclude-dir', $excludeDir) }
    $json = & $nodeExe @nodeArgs 2>&1 | Select-Object -Last 1
    try {
      $stat = $json | ConvertFrom-Json
      if ($stat.ok) {
        Write-Log ("incremental {0}: linked={1} copied={2}" -f (Split-Path -Leaf $destination), $stat.linked, $stat.copied)
        return
      }
    } catch { }
    Write-Log ("WARN: incremental copy failed, falling back to robocopy: {0}" -f $destination)
  }
  if ($excludeDir) {
    $xd = @()
    foreach ($name in $excludeDir.Split(',')) { $xd += '/XD'; $xd += $name.Trim() }
    & robocopy.exe $source $destination /E /R:2 /W:2 /COPY:DAT /DCOPY:T @xd /NFL /NDL /NJH /NJS *> $null
  } else {
    & robocopy.exe $source $destination /E /R:2 /W:2 /COPY:DAT /DCOPY:T /NFL /NDL /NJH /NJS *> $null
  }
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy 复制失败（exit=$LASTEXITCODE）：$source -> $destination"
  }
}

function Wait-DshStopped([int]$seconds = 30) {
  for ($i = 0; $i -lt $seconds; $i++) {
    $p = Get-DshHostProcess
    if (-not $p) { return $true }
    Start-Sleep -Seconds 1
  }
  return -not [bool](Get-DshHostProcess)
}

function Stop-BotAndDsh {
  $dsh = Get-DshHostProcess
  if (-not $dsh) { return $false }

  Write-Log 'cold: stopping QQ bot services'
  if (Test-Path -LiteralPath $stopBot) {
    & cmd.exe /c "`"$stopBot`"" | Out-Null
  }
  Start-Sleep -Seconds 4

  Write-Log 'cold: stopping DSH desktop processes'
  Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $stopped = Wait-DshStopped 30
  if (-not $stopped) {
    throw 'DSH 进程在 30 秒内没有完全退出，已中止冷备份'
  }
  Start-Sleep -Seconds 2
  return $true
}

function Start-BotAfterCold {
  Write-Log 'cold: restarting DSH + SnowLuma + qq-bridge via autostart-qqbot.ps1'
  if (-not (Test-Path -LiteralPath $autostart)) {
    $script:coldRestart = 'warn:autostart-missing'
    Write-Log "WARN: 找不到 $autostart，无法自动重启机器人"
    return
  }
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', "`"$autostart`""
  ) -WindowStyle Hidden | Out-Null

  for ($i = 0; $i -lt 120; $i++) {
    if (Test-LocalPort 3100) {
      $script:coldRestart = 'ok'
      Write-Log 'cold: qq-bridge 3100 is back'
      return
    }
    Start-Sleep -Seconds 2
  }
  $script:coldRestart = 'warn:no-3100'
  Write-Log 'WARN: 冷备份完成，但 qq-bridge 3100 在 240 秒内未恢复，请手动运行 start-bot.cmd'
}

function New-Snapshot {
  $stamp = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
  $name = '{0}_{1}' -f $stamp, $Mode.ToLower()
  $staging = Join-Path $backupRoot ('.staging-' + $name)
  $payload = Join-Path $staging 'payload'
  $final = Join-Path $backupRoot ('snapshots\' + $name)

  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Ensure-Dir $payload
  $script:payloadRoot = $payload
  $script:prevPayload = Get-LatestPayload
  if ($script:prevPayload) { Write-Log "incremental base: $($script:prevPayload)" }

  $dshWasRunning = [bool](Get-DshHostProcess)
  $stoppedDsh = $false
  $errorText = $null
  try {
    if ($Mode -eq 'Cold' -and -not $SkipStop) {
      $stoppedDsh = Stop-BotAndDsh
    }

    Write-Log 'copying DSH QQ session stores'
    $sessionRoot = Join-Path $dshHome 'sessions'
    $sessionMapPath = Join-Path $root 'state\sessions.json'
    if (-not (Test-Path -LiteralPath $sessionMapPath)) { throw "找不到桥接会话映射：$sessionMapPath" }
    $mapped = (Get-Content -LiteralPath $sessionMapPath -Raw | ConvertFrom-Json).sessions
    $sessionIds = @($mapped.PSObject.Properties | ForEach-Object { [string]$_.Value } | Where-Object { $_ })
    if ($sessionIds.Count -eq 0) {
      # 桥接重启/策略变化后映射可能为空，会话会在下一条消息时重建；不要让备份整体失败
      Write-Log 'WARN: state\sessions.json 里没有会话映射，跳过 DSH 会话备份'
    } else {
      $sessionParents = New-Object System.Collections.Generic.List[string]
      foreach ($sid in $sessionIds) {
        $found = Get-ChildItem -LiteralPath $sessionRoot -Directory -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -eq $sid } | Select-Object -First 1
        if ($found) {
          $parentPath = $found.Parent.FullName
          if (-not $sessionParents.Contains($parentPath)) { $sessionParents.Add($parentPath) }
        }
      }
      if ($sessionParents.Count -eq 0) {
        Write-Log "WARN: 找不到映射会话的 DSH 会话目录（$sessionRoot），跳过 DSH 会话备份"
      }
      foreach ($parentDir in $sessionParents) {
        $dir = Get-Item -LiteralPath $parentDir
        Invoke-PayloadCopy $dir.FullName (Join-Path $payload ('dsh-sessions\' + $dir.Name))
      }
    }

    Write-Log 'copying DSH memories'
    Invoke-PayloadCopy (Join-Path $dshHome 'memories') (Join-Path $payload 'dsh-memories')

    Write-Log 'copying DSH attachments (images pasted into chats)'
    Invoke-PayloadCopy (Join-Path $dshHome 'attachments') (Join-Path $payload 'dsh-attachments')

    Write-Log 'copying dsmp-memory logs'
    Invoke-PayloadCopy $shenmingDir (Join-Path $payload 'shenming')

    Write-Log 'copying memory partner plugin code'
    if (Test-Path -LiteralPath $memoryPartnerDir) {
      $pkgDest = Join-Path $payload 'memory-partner'
      # node_modules 可能是 junction，backup/logs 体积大且可重生成
      Invoke-PayloadCopy $memoryPartnerDir $pkgDest 'node_modules,backup,logs,.git'
    } else {
      Write-Log "memory partner plugin missing, skipped: $memoryPartnerDir"
    }



    Write-Log 'copying qq-bridge state / identity / config'
    $bridgeStateDest = Join-Path $payload 'qq-bridge\state'
    New-Item -ItemType Directory -Force -Path $bridgeStateDest | Out-Null
    Copy-OneFile (Join-Path $root 'state\sessions.json') (Join-Path $payload 'qq-bridge\sessions.json')
    foreach ($stateFile in @('social-v2.json','current-role.json','mode.json','slang.json','slang-session.json','feedback.json','stickers.json')) {
      $src = Join-Path $root ('state\' + $stateFile)
      if (Test-Path -LiteralPath $src) { Copy-OneFile $src (Join-Path $bridgeStateDest $stateFile) }
    }
    Invoke-PayloadCopy (Join-Path $root 'roles') (Join-Path $payload 'qq-bridge\roles')
    Copy-OneFile (Join-Path $root 'config.json') (Join-Path $payload 'qq-bridge\config.json')

    Write-Log 'generating manifest and snapshot metadata'
    $files = @(Get-ChildItem -LiteralPath $payload -Recurse -File -Force)
    $totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
    $hashLines = New-Object System.Collections.Generic.List[string]
    foreach ($file in ($files | Sort-Object FullName)) {
      $relative = $file.FullName.Substring($payload.Length).TrimStart('\')
      $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $hashLines.Add(('{0}  {1}' -f $hash, $relative))
    }
    $hashLines | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding UTF8

    $snapshot = [ordered]@{
      name          = $name
      mode          = $Mode.ToLower()
      createdAt     = (Get-Date).ToString('o')
      host          = $env:COMPUTERNAME
      user          = $env:USERNAME
      dshWasRunning = $dshWasRunning
      dshWasStopped = $stoppedDsh
      fileCount     = $files.Count
      totalBytes    = [int64]$totalBytes
      sources       = @(
        (Join-Path $dshHome 'sessions') + '（映射会话所在工作区）',
        (Join-Path $dshHome 'memories'),
        (Join-Path $dshHome 'attachments') + '（聊天图片附件）',
        $shenmingDir,
        (Join-Path $root 'state\sessions.json'),
        (Join-Path $root 'state\social-v2.json') + ' 等状态文件',
        (Join-Path $root 'roles'),
        (Join-Path $root 'config.json'),
        $memoryPartnerDir + '（记忆面板插件 + vendor 记忆引擎；排除 node_modules、backup、logs）'
      )
      note = 'config.json and workbench/.workbench-token contain tokens; keep this backup private.'
    }
    $snapshot | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $staging 'SNAPSHOT.json') -Encoding UTF8

    $readme = "DeepSeek QQ 机器人记忆快照`r`n" +
              "=========================`r`n" +
              "快照名: $name`r`n" +
              "类型:   $Mode (cold = DSH 已停止时复制；hot = DSH 运行中复制)`r`n" +
              "时间:   $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))`r`n" +
              "文件数: $($files.Count)`r`n" +
              "大小:   $([math]::Round($totalBytes / 1MB, 2)) MB`r`n" +
              "DSH 运行中: $dshWasRunning`r`n`r`n" +
              "包含:`r`n" +
              "  payload\dsh-sessions\    QQ 机器人的 DSH 会话（聊天历史）`r`n" +
              "  payload\dsh-memories\    DSH 长期记忆 MEMORY/KEY/项目记忆`r`n" +
              "  payload\dsh-attachments\ DSH 聊天图片附件（面板/记录里的图片）`r`n" +
              "  payload\shenming\        7 天记忆日志/摘要/状态`r`n" +
              "  payload\qq-bridge\       sessions.json、roles、config.json`r`n" +
              "  payload\memory-partner\  记忆面板插件 + vendor 记忆引擎源码（无 node_modules、backup、logs）`r`n`r`n" +
              "恢复: 查看同目录的 RESTORE.md 或 E 盘根目录 RESTORE.md。`r`n" +
              "注意: config.json 含控制台/桥接令牌，请勿外传。`r`n"
    $readme | Set-Content -LiteralPath (Join-Path $staging 'README.txt') -Encoding UTF8
    try {
      $nodeExe = Join-Path $root 'tools\node-runtime\bin\node.exe'
      $cli = Join-Path $memoryPartnerDir 'vendor\memory\scripts\memory-cli.mjs'
      if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $cli)) {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $healthOut = (& $nodeExe $cli health 2>&1 | Out-String)
        Set-Content -LiteralPath (Join-Path $staging 'health.txt') -Value $healthOut -Encoding UTF8
      }
    } catch {
      Write-Log ('WARN: health capture failed: ' + $_.Exception.Message)
    }

    foreach ($doc in @('README.md', 'RESTORE.md')) {
      $sourceDoc = Join-Path $backupRoot $doc
      if (Test-Path -LiteralPath $sourceDoc) {
        Copy-Item -LiteralPath $sourceDoc -Destination (Join-Path $staging $doc) -Force
      }
    }

    Ensure-Dir (Join-Path $backupRoot 'snapshots')
    if (Test-Path -LiteralPath $final) { throw "目标快照已存在：$final" }
    Move-Item -LiteralPath $staging -Destination $final
    Write-Log "OK snapshot=$final files=$($files.Count) sizeMB=$([math]::Round($totalBytes/1MB,2))"
    # 保留策略：冷备只留最新 1 份；热备保留 $KeepHot 份（默认 1）。
    $snapRoot = Join-Path $backupRoot 'snapshots'
    $keep = if ($Mode -eq 'Cold') { 1 } else { [Math]::Max(1, $KeepHot) }
    $filter = if ($Mode -eq 'Cold') { '*_cold' } else { '*_hot' }
    $olds = @(Get-ChildItem -LiteralPath $snapRoot -Directory -Filter $filter -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $final } | Sort-Object Name -Descending)
    # $olds 新的在前：保留最新 (keep-1) 份，其余待删
    $drop = if ($Mode -eq 'Cold') { $olds } else { @($olds | Select-Object -Skip ([Math]::Max(0, $keep - 1))) }

    # 安全闸：新快照的文件数明显少于上一份（<80%）时不删旧快照，
    # 避免一次半截备份把仅有的历史版本清掉。
    if ($drop.Count -gt 0 -and $script:prevPayload -and (Test-Path -LiteralPath $script:prevPayload)) {
      $prevCount = @(Get-ChildItem -LiteralPath $script:prevPayload -Recurse -File -ErrorAction SilentlyContinue).Count
      $newPayload = Join-Path $final 'payload'
      $newCount = @(Get-ChildItem -LiteralPath $newPayload -Recurse -File -ErrorAction SilentlyContinue).Count
      if ($prevCount -gt 0 -and $newCount -lt [Math]::Floor($prevCount * 0.8)) {
        Write-Log ("WARN: prune skipped - new payload {0} files vs previous {1} (<80%)" -f $newCount, $prevCount)
        $drop = @()
      }
    }

    foreach ($old in $drop) {
      try {
        if ($DryRun) {
          Write-Log "prune (dry-run): would remove $($old.Name)"
        } else {
          Remove-Item -LiteralPath $old.FullName -Recurse -Force
          Write-Log "prune: removed $($old.Name) (keep=$keep)"
        }
      } catch {
        Write-Log ("WARN: prune failed for {0}: {1}" -f $old.Name, $_.Exception.Message)
      }
    }
    if ($Mode -eq 'Cold') {
      $prov = "OK $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) mode=Cold snapshot=$final files=$(($files.Count)) sizeMB=$([math]::Round($totalBytes/1MB,2)) restart=pending"
      Set-Content -LiteralPath $statusPath -Value $prov -Encoding UTF8
    }
    return $final
  } catch {
    $errorText = $_.Exception.Message
    throw
  } finally {
    if ($stoppedDsh -and -not $SkipRestart) {
      try { Start-BotAfterCold } catch { Write-Log ('WARN restart failed: ' + $_.Exception.Message) }
    }
    if ($errorText) {
      $status = "FAILED $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) mode=$Mode error=$errorText"
      Set-Content -LiteralPath $statusPath -Value $status -Encoding UTF8
      if (Test-Path -LiteralPath $staging) {
        try { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }
}

Ensure-Dir $backupRoot
Ensure-Dir (Join-Path $backupRoot 'snapshots')
if (-not (Test-Path -LiteralPath $logPath)) { New-Item -ItemType File -Path $logPath | Out-Null }

$started = Get-Date
Write-Log "begin mode=$Mode skipStop=$SkipStop skipRestart=$SkipRestart"
try {
  $final = New-Snapshot
  $size = (Get-ChildItem -LiteralPath $final -Recurse -File | Measure-Object -Property Length -Sum).Sum
  $restartNote = if ($script:coldRestart) { ' restart=' + $script:coldRestart } else { '' }
  $status = "OK $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) mode=$Mode snapshot=$final$restartNote files=$(@(Get-ChildItem -LiteralPath $final -Recurse -File).Count) sizeMB=$([math]::Round($size/1MB,2))"
  Set-Content -LiteralPath $statusPath -Value $status -Encoding UTF8
  Write-Log "done in $([math]::Round(((Get-Date)-$started).TotalSeconds,1))s"
  exit 0
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message)
  $restartNote = if ($script:coldRestart) { ' restart=' + $script:coldRestart } else { '' }
  $status = "FAILED $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) mode=$Mode error=$($_.Exception.Message)$restartNote"
  Set-Content -LiteralPath $statusPath -Value $status -Encoding UTF8
  exit 1
}
