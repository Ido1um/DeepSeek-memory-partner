$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'backup-memory.ps1') -Mode Hot -KeepHot 1
exit $LASTEXITCODE
