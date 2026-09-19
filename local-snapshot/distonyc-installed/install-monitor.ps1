param([string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'), [switch]$Start)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
foreach ($monitorRequired in @('config.json','monitor-credential.xml','queue_monitor.py','monitor-run.ps1','vocal_repair.py','launch_hidden.py')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $monitorRequired))) { throw ('Missing monitor installation file: ' + $monitorRequired) }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$installedConfig = Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json
$pythonw = Join-Path (Split-Path $installedConfig.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw ('Missing windowless Python launcher: ' + $pythonw) }
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + (Join-Path $Root 'launch_hidden.py') + '" --task monitor') -WorkingDirectory $Root
$triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)),
    (New-ScheduledTaskTrigger -AtLogOn -User $identity)
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Distonyc Queue Monitor' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Classify Needs Attention requests, retry bounded recoveries with cooldowns, and record resolution trends. Runs while Jesse is signed in and this PC is awake.' -Force | Out-Null
if ($Start) { Start-ScheduledTask -TaskName 'Distonyc Queue Monitor' }
Get-ScheduledTask -TaskName 'Distonyc Queue Monitor' | Select-Object TaskName,State
