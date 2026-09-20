param([string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'), [switch]$Start, [switch]$Disabled)
# Hourly settlement of the conservative paid music holds. Reservations are taken at
# $1.00/minute before the only billable call while Eleven Music bills $0.15/minute, so
# without this both the local cap and Chairlift's counter drift toward exhaustion on a
# fraction of the real spending.
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
foreach ($required in @('config.json','monitor-credential.xml','paid-budget-reconcile.ps1',
        'reconcile_paid_music.py','push_music_settlement.py','launch_hidden.py')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $required))) { throw ('Missing installation file: ' + $required) }
}
$installedConfig = Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json
if (-not $installedConfig.paid_music_policy) { throw 'config.json has no paid_music_policy; paid music is not installed here.' }
$pythonw = Join-Path (Split-Path $installedConfig.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw ('Missing windowless Python launcher: ' + $pythonw) }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $Root 'launch_hidden.py') + '" --task budget') -WorkingDirectory $Root
# Hourly is far more often than the cap can be filled, and every run is safe to repeat.
$triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)),
    (New-ScheduledTaskTrigger -AtLogOn -User $identity)
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Distonyc Paid Budget' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Settle paid music reservations against ElevenLabs provider history and report the result to Chairlift, so the shared spending cap counts real spending. Runs while Jesse is signed in and this PC is awake.' -Force | Out-Null
if ($Disabled) { Disable-ScheduledTask -TaskName 'Distonyc Paid Budget' | Out-Null }
elseif ($Start) { Start-ScheduledTask -TaskName 'Distonyc Paid Budget' }
Get-ScheduledTask -TaskName 'Distonyc Paid Budget' | Select-Object TaskName,State
