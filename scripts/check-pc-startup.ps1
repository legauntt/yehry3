param([Parameter(Mandatory = $true)][string]$Evidence)
$ErrorActionPreference = 'Stop'
# Read-only audit; exporting definitions never interrupts a running task.
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
$service = Get-Service Schedule
if ($service.Status -ne 'Running' -or $service.StartType -ne 'Automatic') { throw 'Windows Task Scheduler must be running with automatic startup.' }
$names = @('Distonyc Worker', 'Distonyc Lyric Writer', 'Distonyc Queue Monitor', 'Distonyc Paid Budget', 'yehry3 Whisper Transcripts', 'yehry3 Artwork Lifecycle')
$report = foreach ($name in $names) {
    $task = Get-ScheduledTask -TaskName $name
    $info = Get-ScheduledTaskInfo -TaskName $name
    Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $Evidence ($name + '.xml')) -Encoding UTF8
    if ($task.State -eq 'Disabled') { throw "$name is disabled." }
    $kinds = @($task.Triggers | ForEach-Object { $_.CimClass.CimClassName })
    if ('MSFT_TaskLogonTrigger' -notin $kinds -or 'MSFT_TaskTimeTrigger' -notin $kinds) { throw "$name requires sign-in and recurring triggers." }
    if (-not $task.Settings.StartWhenAvailable -or $task.Settings.RestartCount -lt 1 -or $task.Settings.MultipleInstances -ne 2) { throw "$name requires missed-start recovery, retries and IgnoreNew." }
    if ($task.Settings.DisallowStartIfOnBatteries -or $task.Settings.StopIfGoingOnBatteries) { throw "$name is blocked by battery settings." }
    foreach ($action in $task.Actions) {
        if (-not (Test-Path -LiteralPath $action.Execute -PathType Leaf)) { throw "$name executable is missing." }
        if ([IO.Path]::GetFileName($action.Execute) -ne 'pythonw.exe') { throw "$name must use a windowless launcher." }
        foreach ($match in [regex]::Matches($action.Arguments, '"([^"]+)"')) {
            if (-not (Test-Path -LiteralPath $match.Groups[1].Value -PathType Leaf)) { throw "$name entry point/config is missing." }
        }
    }
    [pscustomobject]@{Task=$name; State=[string]$task.State; LogonType=[string]$task.Principal.LogonType; LastResult=$info.LastTaskResult; LastRun=$info.LastRunTime; NextRun=$info.NextRunTime; RestartCount=$task.Settings.RestartCount; Interval=($task.Triggers.Repetition.Interval | Where-Object { $_ }) -join ','}
}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Evidence 'startup-report.json') -Encoding UTF8
$report | Format-Table -AutoSize
Write-Output 'Verified automatic recovery after Jesse signs in. Network credentials remain bound to Jesse; this does not configure unattended pre-login execution.'
