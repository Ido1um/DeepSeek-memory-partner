$ErrorActionPreference = 'Stop'
$url = 'https://hf-mirror.com/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors'
$total = [int64]6938434056
$dir = '<AI_ROOT> sd-webui-aki-v4.7\downloads\animagine-xl-4.0'
$part0 = Join-Path $dir 'part0.bin'
$finalTemp = Join-Path $dir 'animagine-xl-4.0.safetensors'
$modelsDir = '<AI_ROOT> sd-webui-aki-v4.7\sd-webui-aki-v4.7\models\Stable-diffusion'
$finalName = 'animagine-xl-4.0.safetensors'
$finalPath = Join-Path $modelsDir $finalName
$logPath = '<AI_ROOT> sd-webui-aki-v4.7\animagine-chunks.log'
$chunkSize = [int64]67108864
$workers = 4

function Write-Log([string]$message) {
  Add-Content -Path $logPath -Value ('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
}

if (-not (Test-Path $part0)) { throw "missing part0: $part0" }
$offset = (Get-Item $part0).Length
$chunkCount = [int][math]::Ceiling((($total - $offset)) / $chunkSize)
Write-Log ("=== chunk download begin: offset=$offset chunks=$chunkCount size=$chunkSize workers=$workers ===")

function Get-ChunkInfo([int]$index) {
  $start = $offset + ([int64]$index * $chunkSize)
  $end = [math]::Min($total - 1, $start + $chunkSize - 1)
  $path = Join-Path $dir ("chunk{0:D3}.bin" -f $index)
  return [pscustomobject]@{ Index = $index; Start = $start; End = $end; Expected = ($end - $start + 1); Path = $path }
}

function Start-Chunk([object]$info) {
  if ((Test-Path $info.Path) -and ((Get-Item $info.Path).Length -eq $info.Expected)) {
    return $null
  }
  if (Test-Path $info.Path) { Remove-Item $info.Path -Force }
  $arg = '-L --connect-timeout 30 --max-time 300 --range "{0}-{1}" -o "{2}" "{3}"' -f $info.Start, $info.End, $info.Path, $url
  return Start-Process -FilePath 'curl.exe' -ArgumentList $arg -WindowStyle Hidden -PassThru
}

function Wait-Chunk([object]$info) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $proc = Start-Chunk $info
    if ($null -eq $proc) { return $true }
    $proc.WaitForExit()
    $actual = if (Test-Path $info.Path) { (Get-Item $info.Path).Length } else { 0 }
    if ($actual -eq $info.Expected) { return $true }
    Write-Log ("chunk{0} attempt {1} size {2}/{3}; retrying" -f $info.Index, $attempt, $actual, $info.Expected)
  }
  return $false
}

try {
  for ($batchStart = 0; $batchStart -lt $chunkCount; $batchStart += $workers) {
    $infos = @()
    for ($j = 0; $j -lt $workers; $j++) {
      $idx = $batchStart + $j
      if ($idx -ge $chunkCount) { break }
      $infos += Get-ChunkInfo $idx
    }
    Write-Log ("batch {0}-{1}" -f $infos[0].Index, $infos[-1].Index)
    $procs = @()
    foreach ($info in $infos) {
      $proc = Start-Chunk $info
      if ($proc) { $procs += [pscustomobject]@{ Info = $info; Proc = $proc } }
    }
    foreach ($item in $procs) { $item.Proc.WaitForExit() }
    foreach ($info in $infos) {
      $actual = if (Test-Path $info.Path) { (Get-Item $info.Path).Length } else { 0 }
      if ($actual -ne $info.Expected) {
        if (-not (Wait-Chunk $info)) { throw ("chunk{0} failed" -f $info.Index) }
      }
      Write-Log ("chunk{0} ok ({1} bytes)" -f $info.Index, $info.Expected)
    }
  }

  Write-Log 'all chunks complete; assembling'
  if ((Test-Path $finalTemp) -and ((Get-Item $finalTemp).Length -eq $total)) {
    Write-Log 'assembled file already complete'
  } else {
    if (Test-Path $finalTemp) { Remove-Item $finalTemp -Force }
    $out = [System.IO.File]::Create($finalTemp)
    try {
      $in0 = [System.IO.File]::OpenRead($part0)
      try { $in0.CopyTo($out, 1048576) } finally { $in0.Dispose() }
      for ($i = 0; $i -lt $chunkCount; $i++) {
        $info = Get-ChunkInfo $i
        $in = [System.IO.File]::OpenRead($info.Path)
        try { $in.CopyTo($out, 1048576) } finally { $in.Dispose() }
      }
    } finally { $out.Dispose() }
  }
  if ((Get-Item $finalTemp).Length -ne $total) { throw 'assembled size mismatch' }
  Write-Log ('assembled size OK: ' + (Get-Item $finalTemp).Length)

  New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
  Copy-Item -Path $finalTemp -Destination $finalPath -Force
  if ((Get-Item $finalPath).Length -ne $total) { throw 'copied file size mismatch' }
  Write-Log ('installed to ' + $finalPath)
  Write-Log '=== chunk download done ==='
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message)
  throw
}
