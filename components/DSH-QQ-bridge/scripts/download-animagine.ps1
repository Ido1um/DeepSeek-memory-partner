$ErrorActionPreference = 'Stop'
$url = 'https://hf-mirror.com/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors'
$total = [int64]6938434056
$downloadDir = '<AI_ROOT> sd-webui-aki-v4.7\downloads\animagine-xl-4.0'
$logPath = '<AI_ROOT> sd-webui-aki-v4.7\animagine-download.log'
$modelsDir = '<AI_ROOT> sd-webui-aki-v4.7\sd-webui-aki-v4.7\models\Stable-diffusion'
$finalName = 'animagine-xl-4.0.safetensors'
$finalPath = Join-Path $modelsDir $finalName

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
function Write-Log([string]$message) {
  Add-Content -Path $logPath -Value ('{0} {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
}

function Download-Part([int]$index, [int64]$start, [int64]$end) {
  $partPath = Join-Path $downloadDir ("part{0}.bin" -f $index)
  $expected = $end - $start + 1
  if ((Test-Path $partPath) -and ((Get-Item $partPath).Length -eq $expected)) {
    Write-Log ("part{0} already complete ({1} bytes)" -f $index, $expected)
    return
  }
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    if (Test-Path $partPath) { Remove-Item $partPath -Force }
    Write-Log ("part{0} attempt {1}: bytes {2}-{3}" -f $index, $attempt, $start, $end)
    & curl.exe -L --fail --retry 3 --retry-delay 5 --connect-timeout 30 --range ("{0}-{1}" -f $start, $end) -o $partPath $url 2>&1 | Out-Null
    if ((Test-Path $partPath) -and ((Get-Item $partPath).Length -eq $expected)) {
      Write-Log ("part{0} complete ({1} bytes)" -f $index, $expected)
      return
    }
    Write-Log ("part{0} incomplete; retrying" -f $index)
    Start-Sleep -Seconds 3
  }
  throw ("part{0} failed" -f $index)
}

try {
  Write-Log '=== animagine download begin ==='
  $parts = 4
  $base = [int64][math]::Floor($total / $parts)
  $ranges = @()
  for ($i = 0; $i -lt $parts; $i++) {
    $start = [int64]($i * $base)
    $end = if ($i -eq ($parts - 1)) { [int64]($total - 1) } else { [int64](($i + 1) * $base - 1) }
    $ranges += ,@($start, $end)
  }

  # Run curl parts in parallel from this process.
  $procs = @()
  for ($i = 0; $i -lt $parts; $i++) {
    $idx = $i + 1
    $start = $ranges[$i][0]
    $end = $ranges[$i][1]
    $partPath = Join-Path $downloadDir ("part{0}.bin" -f $idx)
    $expected = $end - $start + 1
    if ((Test-Path $partPath) -and ((Get-Item $partPath).Length -eq $expected)) {
      Write-Log ("part{0} already complete" -f $idx)
      continue
    }
    if (Test-Path $partPath) { Remove-Item $partPath -Force }
    Write-Log ("part{0} start bytes {1}-{2}" -f $idx, $start, $end)
    $curlArgs = '-L --fail --retry 8 --retry-delay 5 --connect-timeout 30 --range "{0}-{1}" -o "{2}" "{3}"' -f $start, $end, $partPath, $url
    $procs += Start-Process -FilePath 'curl.exe' -ArgumentList $curlArgs -WindowStyle Hidden -PassThru
  }
  foreach ($p in $procs) { $p.WaitForExit() }
  Write-Log 'all curl parts exited'

  for ($i = 0; $i -lt $parts; $i++) {
    $idx = $i + 1
    $partPath = Join-Path $downloadDir ("part{0}.bin" -f $idx)
    $expected = $ranges[$i][1] - $ranges[$i][0] + 1
    $actual = if (Test-Path $partPath) { (Get-Item $partPath).Length } else { 0 }
    if ($actual -ne $expected) { throw ("part{0} size {1} != expected {2}" -f $idx, $actual, $expected) }
  }

  $finalTemp = Join-Path $downloadDir $finalName
  if ((Test-Path $finalTemp) -and ((Get-Item $finalTemp).Length -eq $total)) {
    Write-Log 'assembled file already complete'
  } else {
    Write-Log 'assembling parts'
    if (Test-Path $finalTemp) { Remove-Item $finalTemp -Force }
    $out = [System.IO.File]::Create($finalTemp)
    try {
      for ($i = 0; $i -lt $parts; $i++) {
        $partPath = Join-Path $downloadDir ("part{0}.bin" -f ($i + 1))
        $in = [System.IO.File]::OpenRead($partPath)
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
  Write-Log '=== animagine download done ==='
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message)
  throw
}
