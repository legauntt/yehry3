param([string]$Root = $PSScriptRoot, [switch]$DryRun)
# Settle the paid music holds against provider history, then tell Chairlift.
# Conservative $1.00/minute reservations are never lowered on their own, so both the local
# cap and Chairlift's counter drift toward exhaustion on a fraction of the real spending.
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $Root 'config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
& $config.settings.python -X utf8 (Join-Path $Root 'runtime_release.py') --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Installed runtime verification failed; inspect runtime-release.json before settling.' }

$log = Join-Path (Split-Path $config.paid_music_policy) 'reconcile.log'
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force
}
"--- $([DateTime]::UtcNow.ToString('o'))" | Add-Content -LiteralPath $log

# Settling the local ledger is safe to repeat and never sends a provider request.
# Build one array: a conditional that yields a single string would splat it per character.
$arguments = @((Join-Path $Root 'reconcile_paid_music.py'), '--policy', $config.paid_music_policy)
if (-not $DryRun) { $arguments += '--apply' }
& $config.settings.python -X utf8 @arguments *>> $log
if ($LASTEXITCODE -ne 0) {
    "local settlement failed; leaving Chairlift untouched" | Add-Content -LiteralPath $log
    exit $LASTEXITCODE
}
if ($DryRun) { Get-Content -LiteralPath $log -Tail 40; exit 0 }

$credential = Import-Clixml -LiteralPath (Join-Path $Root 'monitor-credential.xml')
try {
    $env:DISTONYC_MONITOR_PASSWORD = $credential.GetNetworkCredential().Password
    & $config.settings.python -X utf8 (Join-Path $Root 'push_music_settlement.py') `
        --config $configPath --policy $config.paid_music_policy *>> $log
    $exit = $LASTEXITCODE
} finally {
    Remove-Item Env:DISTONYC_MONITOR_PASSWORD -ErrorAction SilentlyContinue
}
# A 409 means a concurrent admission moved the counter; the next hourly run settles it.
if ($exit -ne 0) { "chairlift settlement failed" | Add-Content -LiteralPath $log }
exit $exit
