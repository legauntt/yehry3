param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'monitor-credential.xml')
$monitorDirectory = Join-Path $config.state_dir 'monitor'
New-Item -ItemType Directory -Path $monitorDirectory -Force | Out-Null
$monitorLog = Join-Path $monitorDirectory 'monitor.log'
if ((Test-Path -LiteralPath $monitorLog) -and (Get-Item -LiteralPath $monitorLog).Length -gt 5MB) {
    Move-Item -LiteralPath $monitorLog -Destination ($monitorLog + '.previous') -Force
}
try {
    $env:DISTONYC_MONITOR_PASSWORD = $credential.GetNetworkCredential().Password
    & $config.settings.python (Join-Path $Root 'queue_monitor.py') --config $configPath *>> $monitorLog
    $monitorExit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_MONITOR_PASSWORD -ErrorAction SilentlyContinue
}
if ($monitorExit -eq 0) {
    $monitorHealth = Get-Content -LiteralPath (Join-Path $monitorDirectory 'health.json') -Raw | ConvertFrom-Json
    if ($monitorHealth.retried -gt 0) { Start-ScheduledTask -TaskName 'Distonyc Worker' }
}
exit $monitorExit
