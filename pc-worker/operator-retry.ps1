param(
    [Parameter(Mandatory = $true)][string]$Request,
    [Parameter(Mandatory = $true)][string]$Reason,
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc')
)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
& $config.settings.python -X utf8 (Join-Path $Root 'runtime_release.py') --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Installed runtime verification failed; inspect runtime-release.json before requeueing.' }
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'monitor-credential.xml')
try {
    $env:DISTONYC_MONITOR_PASSWORD = $credential.GetNetworkCredential().Password
    & $config.settings.python -X utf8 (Join-Path $Root 'operator_retry.py') --config $configPath --request $Request --reason $Reason
    $exit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_MONITOR_PASSWORD -ErrorAction SilentlyContinue
}
if ($exit -eq 0) { Start-ScheduledTask -TaskName 'Distonyc Worker' }
exit $exit
