param([string]$Root = $PSScriptRoot, [Parameter(Mandatory)][string]$Request,
      [Parameter(Mandatory)][ValidateSet('authorize','render','publish','verify')][string]$Action,
      [string]$Reason = '')
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath (Join-Path $Root 'worker-credential.xml')
try {
    $env:DISTONYC_WORKER_TOKEN = $credential.GetNetworkCredential().Password
    & $config.settings.python (Join-Path $Root 'retained_instrumental.py') --config $configPath --request $Request --action $Action --reason $Reason
    $workerExit = $LASTEXITCODE
} finally { Remove-Item Env:DISTONYC_WORKER_TOKEN -ErrorAction SilentlyContinue }
exit $workerExit
