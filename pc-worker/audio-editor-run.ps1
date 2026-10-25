param([string]$Root = (Split-Path $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$taskConfigPath = Join-Path $Root 'config.json'
$taskConfig = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
$taskCredential = Import-Clixml -LiteralPath (Join-Path $Root 'worker-credential.xml')
$taskLog = Join-Path $taskConfig.state_dir 'audio-editor.log'
if ((Test-Path -LiteralPath $taskLog) -and (Get-Item -LiteralPath $taskLog).Length -gt 5MB) {
    Move-Item -LiteralPath $taskLog -Destination ($taskLog + '.previous') -Force
}
try {
    $env:DISTONYC_WORKER_TOKEN = $taskCredential.GetNetworkCredential().Password
    & $taskConfig.settings.python -X utf8 (Join-Path $PSScriptRoot 'audio_editor.py') --config $taskConfigPath *>> $taskLog
    $taskExit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_WORKER_TOKEN -ErrorAction SilentlyContinue
}
exit $taskExit
