param(
    [string]$Root = (Join-Path $env:LOCALAPPDATA 'Yehr3Whisper'),
    [string]$WorkerConfig = (Join-Path $env:LOCALAPPDATA 'Distonyc/config.json'),
    [Parameter(Mandatory=$true)][string]$SpeechRoot,
    [Parameter(Mandatory=$true)][string]$Cache,
    [ValidateSet('cpu','cuda')][string]$Device = 'cpu',
    [switch]$Start,
    [switch]$Disabled
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$taskName = 'yehry3 Whisper Transcripts'
if ((Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running') {
    throw 'Wait for the transcript task to finish before updating its own runtime.'
}
$worker = Get-Content -LiteralPath $WorkerConfig -Raw | ConvertFrom-Json
$pythonw = Join-Path (Split-Path $worker.settings.python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw 'Windowless Python is unavailable.' }
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$backup = Join-Path $taskRoot ('backups/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
# This companion service owns its own directory. Never update the running renderer.
$files = @('transcript_service.py','transcript_data.py','transcript_sources.py','transcribe_catalog.py',
           'transcribe_performance.py','common.py','publish.py','winprocess.py')
$hashes = @{}
foreach ($name in $files) {
    $target = Join-Path $taskRoot $name
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $target -Force
    $sourceHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name) -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Runtime copy failed hash verification.' }
    $hashes[$name] = $sourceHash.ToLowerInvariant()
}
$config = @{ root=$taskRoot; python=$worker.settings.python; gh=$worker.gh; basis_root=$worker.basis_root;
    speech_root=[IO.Path]::GetFullPath($SpeechRoot); cache=[IO.Path]::GetFullPath($Cache); device=$Device;
    studio_dir=$worker.settings.studio_dir; engine_root=$worker.engine_resources;
    cuda_root=(Join-Path ([IO.Path]::GetFullPath($SpeechRoot)) 'speech-cuda') }
if (Test-Path -LiteralPath (Join-Path $taskRoot 'config.json')) { Copy-Item -LiteralPath (Join-Path $taskRoot 'config.json') -Destination $backup }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'config.json') -Encoding UTF8
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'runtime-hashes.json') -Encoding UTF8
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-X utf8 "' + (Join-Path $taskRoot 'transcript_service.py') + '" --config "' + (Join-Path $taskRoot 'config.json') + '"'
$action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory $taskRoot
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $identity),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 2)))
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Transcribe newly released yehry3 recordings locally and publish optional machine lyric views. Does not claim or render songs.' -Force | Out-Null
if ($Disabled) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
elseif ($Start) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
