param(
    [Parameter(Mandatory = $true)][string]$Request,
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc')
)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
& $config.settings.python -X utf8 (Join-Path $Root 'runtime_release.py') --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Installed runtime verification failed.' }
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'monitor-credential.xml')
try {
    $env:DISTONYC_MONITOR_PASSWORD = $credential.GetNetworkCredential().Password
    & $config.settings.python -X utf8 (Join-Path $PSScriptRoot 'operator_local_ace.py') --config $configPath --runtime-root $Root --request $Request
    $exit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_MONITOR_PASSWORD -ErrorAction SilentlyContinue
}
if ($exit -ne 0) { exit $exit }
& (Join-Path $Root 'operator-retry.ps1') -Request $Request -Reason 'Operator explicitly selected Local ACE and exact supplied wording. Archived the refused unstarted plan; validated retained arrangement and every supplied lyric before requeueing.' -Root $Root
exit $LASTEXITCODE
