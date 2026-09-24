param([string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'), [switch]$Start)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$taskName = 'Distonyc Lyric Writer'
if ((Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running') { throw 'Stop the lyric writer before updating its runtime.' }
# Use the maintained selective installer: preserve config, credentials and all other runtime files.
& (Join-Path $PSScriptRoot 'install.ps1') -Root $taskRoot -RuntimeOnly -Files @('lyric_writer.py','lyric-writer-run.ps1','lyric_writer_launch.py','launch_hidden.py')
if (-not $?) { throw 'Selective runtime installation failed.' }
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config.json') -Raw | ConvertFrom-Json
$taskPythonw = Join-Path (Split-Path $taskConfig.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $taskPythonw)) { throw 'Windowless Python is unavailable.' }
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute $taskPythonw -Argument ('"' + (Join-Path $taskRoot 'lyric_writer_launch.py') + '"') -WorkingDirectory $taskRoot
$taskTriggers = @((New-ScheduledTaskTrigger -AtLogOn -User $taskIdentity), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskIdentity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTriggers -Settings $taskSettings -Principal $taskPrincipal -Description 'Write and revise private lyric drafts while this PC is awake. Uses no GPU and does not enter the song queue.' -Force | Out-Null
if ($Start) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
