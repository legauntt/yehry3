param(
    [Parameter(Mandatory = $true)][string]$Catalog,
    [string[]]$Song = @(),
    [switch]$Replace,
    [switch]$Write,
    [string]$Root = $PSScriptRoot,
    [string]$CodeRoot = $Root,
    [string]$AuditReport
)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'worker-credential.xml')
$catalogPath = [IO.Path]::GetFullPath($Catalog)
$studioRoot = Split-Path $config.settings.studio_dir -Parent
$cueArgs = @(
    (Join-Path $CodeRoot 'backfill_lyric_cues.py'),
    '--catalog', $catalogPath,
    '--studio-root', $studioRoot,
    '--sync-config', $configPath
)
if ($AuditReport) {
    if ($Replace -or $Song.Count) { throw 'A reviewed audit report defines its exact batch; do not combine it with Replace or Song.' }
    $cueArgs = @((Join-Path $CodeRoot 'audit_lyric_cues.py'), '--catalog', $catalogPath,
        '--apply', [IO.Path]::GetFullPath($AuditReport), '--sync-config', $configPath)
}
if ($Replace) { $cueArgs += '--replace' }
if ($Write) { $cueArgs += '--write' }
foreach ($id in $Song) { $cueArgs += @('--song', $id) }
try {
    $env:DISTONYC_WORKER_TOKEN = $credential.GetNetworkCredential().Password
    & $config.settings.python -X utf8 @cueArgs
    $cueExit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_WORKER_TOKEN -ErrorAction SilentlyContinue
}
exit $cueExit
