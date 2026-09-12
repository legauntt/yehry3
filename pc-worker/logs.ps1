param(
    [string]$JobId,
    [ValidateSet('renderer', 'planner', 'progress')][string]$Kind = 'renderer',
    [switch]$Follow,
    [switch]$List,
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc')
)
$ErrorActionPreference = 'Stop'
$jobs = Join-Path $Root 'state\jobs'
if ($List) {
    Get-ChildItem -LiteralPath $jobs -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object {
        $promptPath = Join-Path $_.FullName 'prompt.json'
        $prompt = if (Test-Path -LiteralPath $promptPath) { Get-Content -LiteralPath $promptPath -Raw | ConvertFrom-Json } else { $null }
        [pscustomobject]@{ JobId = $_.Name; Idea = $prompt.prompt; Folder = $_.FullName }
    }
    return
}
if (-not $JobId) {
    $healthPath = Join-Path $Root 'state\health.json'
    if (Test-Path -LiteralPath $healthPath) { $JobId = (Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json).promptId }
    if (-not $JobId) { $JobId = (Get-ChildItem -LiteralPath $jobs -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name }
}
if (-not $JobId -or $JobId -notmatch '^[a-zA-Z0-9-]+$') { throw 'No song job found. Use -List to choose a saved job.' }
$file = Join-Path (Join-Path $jobs $JobId) ($Kind + $(if ($Kind -eq 'progress') { '.json' } else { '.log' }))
if (-not (Test-Path -LiteralPath $file)) { throw "This log has not been created yet: $file" }
Write-Host "Reading $file"
if ($Follow) {
    Write-Host 'Ctrl+C stops watching; song generation continues.'
    if ($Kind -eq 'progress') {
        # Progress is atomically replaced, so reopen it instead of following an old file handle.
        while ($true) { Get-Content -LiteralPath $file; Start-Sleep -Seconds 5 }
    } else { Get-Content -LiteralPath $file -Tail 40 -Wait }
} else { Get-Content -LiteralPath $file -Tail 40 }
