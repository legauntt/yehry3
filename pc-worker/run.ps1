param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'worker-credential.xml')
$log = Join-Path $config.state_dir 'worker.log'
New-Item -ItemType Directory -Path $config.state_dir -Force | Out-Null
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) {
    Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force
}
try {
    $env:DISTONYC_WORKER_TOKEN = $credential.GetNetworkCredential().Password
    & $config.settings.python (Join-Path $Root 'worker.py') --config $configPath *>> $log
    $workerExit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_WORKER_TOKEN -ErrorAction SilentlyContinue
}
exit $workerExit
