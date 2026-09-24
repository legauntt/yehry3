param(
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'),
    [switch]$Start,
    [switch]$Disabled,
    [string[]]$Files,
    [switch]$RuntimeOnly
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath (Join-Path $Root 'config.json')) -or -not (Test-Path -LiteralPath (Join-Path $Root 'worker-credential.xml'))) {
    throw 'Prepare config.json and the current-user DPAPI credential in the installation folder first.'
}
$taskName = 'Distonyc Worker'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') { throw 'Wait for the current worker to finish before updating its installed code.' }
$monitor = Get-ScheduledTask -TaskName 'Distonyc Queue Monitor' -ErrorAction SilentlyContinue
if ($monitor -and $monitor.State -eq 'Running') { throw 'Wait for the current queue monitor to finish before updating its installed code.' }
$installedConfig = Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json
$pythonw = Join-Path (Split-Path $installedConfig.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw ('Missing windowless Python launcher: ' + $pythonw) }
if ($Files -and 'launch_hidden.py' -notin $Files -and -not (Test-Path -LiteralPath (Join-Path $Root 'launch_hidden.py'))) {
    throw 'Include launch_hidden.py in -Files when first installing the windowless launcher.'
}
New-Item -ItemType Directory -Path $Root -Force | Out-Null
$installFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.py', '.ps1', '.md' })
if ($Files) {
    foreach ($name in $Files) {
        if ([IO.Path]::GetFileName($name) -ne $name -or $name -notin $installFiles.Name) { throw ('Invalid selected runtime file: ' + $name) }
    }
    $installFiles = @($installFiles | Where-Object { $_.Name -in $Files })
}
$installBackup = Join-Path $Root ('state\installations\' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $installBackup -Force | Out-Null
$installFiles | ForEach-Object {
    $target = Join-Path $Root $_.Name
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $installBackup $_.Name) }
    if ($_.FullName -ne (Join-Path $Root $_.Name)) { Copy-Item -LiteralPath $_.FullName -Destination $Root -Force }
}
if (-not $Files) { Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot) 'basis-songs.json') -Destination (Join-Path $Root 'basis-songs.json') -Force }
$releaseHashes = @{}
Get-ChildItem -LiteralPath $Root -File | Where-Object { $_.Extension -in '.py','.ps1' -and $_.Name -notlike 'test_*' } | ForEach-Object {
    $releaseHashes[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$release = @{ at = [DateTime]::UtcNow.ToString('o'); files = $releaseHashes; backup = $installBackup; selected = @($installFiles.Name) }
$release | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Root 'runtime-release.json') -Encoding UTF8
$installedConfig = Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json
& $installedConfig.settings.python -X utf8 (Join-Path $Root 'runtime_release.py') --root $Root
if ($LASTEXITCODE -ne 0) { throw ('Installed runtime verification failed. Retained backup: ' + $installBackup) }
if ($RuntimeOnly) { return }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $Root 'launch_hidden.py') + '" --task worker') -WorkingDirectory $Root
$triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 2)),
    (New-ScheduledTaskTrigger -AtLogOn -User $identity)
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Poll the Distonyc queue, plan once, render Tony V6 locally, and publish verified songs. Runs while Jesse is signed in and this PC is awake.' -Force | Out-Null
if ($Disabled) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
elseif ($Start) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
