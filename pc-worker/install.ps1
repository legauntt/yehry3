param(
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'),
    [switch]$Start,
    [switch]$Disabled
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath (Join-Path $Root 'config.json')) -or -not (Test-Path -LiteralPath (Join-Path $Root 'worker-credential.xml'))) {
    throw 'Prepare config.json and the current-user DPAPI credential in the installation folder first.'
}
$taskName = 'Distonyc Worker'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') { throw 'Wait for the current worker to finish before updating its installed code.' }
New-Item -ItemType Directory -Path $Root -Force | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.py', '.ps1', '.md' } | ForEach-Object {
    if ($_.FullName -ne (Join-Path $Root $_.Name)) { Copy-Item -LiteralPath $_.FullName -Destination $Root -Force }
}
Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot) 'basis-songs.json') -Destination (Join-Path $Root 'basis-songs.json') -Force
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + (Join-Path $Root 'run.ps1') + '"') -WorkingDirectory $Root
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
