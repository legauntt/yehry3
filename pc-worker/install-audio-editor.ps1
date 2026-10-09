param([string]$Root = (Join-Path $env:LOCALAPPDATA 'Distonyc'), [switch]$Start)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$taskName = 'Distonyc Audio Editor'
if ((Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running') { throw 'Stop the audio editor service before updating it.' }
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'worker-credential.xml'))) { throw 'Worker credential is unavailable.' }
$taskPythonw = Join-Path (Split-Path $taskConfig.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $taskPythonw)) { throw 'Windowless Python is unavailable.' }
# Independent runtime: installing this service never modifies or stops the music worker.
$taskRuntime = Join-Path $taskRoot 'audio-editor'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskBackup = Join-Path $taskConfig.state_dir ('audio-editor/installations/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
foreach ($taskFile in @('audio_editor.py','audio_editor_launch.py','audio-editor-run.ps1','common.py','publish.py','winprocess.py')) {
    $taskTarget = Join-Path $taskRuntime $taskFile
    if (Test-Path -LiteralPath $taskTarget) { Copy-Item -LiteralPath $taskTarget -Destination $taskBackup }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskFile) -Destination $taskTarget -Force
    if ((Get-FileHash -LiteralPath $taskTarget).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $taskFile)).Hash) { throw 'Runtime copy verification failed.' }
}
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute $taskPythonw -Argument ('"' + (Join-Path $taskRuntime 'audio_editor_launch.py') + '"') -WorkingDirectory $taskRuntime
$taskTriggers = @((New-ScheduledTaskTrigger -AtLogOn -User $taskIdentity), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskIdentity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTriggers -Settings $taskSettings -Principal $taskPrincipal -Description 'Analyze vocal regions and publish separate admin-cropped recordings, without GPU or music generation.' -Force | Out-Null
if ($Start) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
