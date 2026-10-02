param(
    [Parameter(Mandatory = $true)][string]$Config,
    [string]$Pythonw = 'C:/Python311/pythonw.exe'
)
$ErrorActionPreference = 'Stop'
if ((Get-ScheduledTask -TaskName 'yehry3 Artwork Lifecycle' -ErrorAction SilentlyContinue).State -eq 'Running') { throw 'Wait for the active artwork pass before updating its runtime.' }
$configPath = (Resolve-Path -LiteralPath $Config).Path
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($settings.budget -le 0 -or $settings.budget -gt 40 -or $settings.budgetPeriod -ne 'monthly') { throw 'Ongoing authorization is capped at $40 per month.' }
if (-not (Test-Path -LiteralPath (Join-Path $settings.state 'ledger.json'))) { throw 'The shared existing spend ledger is required.' }
if (-not (Test-Path -LiteralPath $Pythonw)) { throw 'A windowless Python executable is required.' }
$runtime = Join-Path $settings.state 'automation'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$runner = Join-Path $runtime 'artwork-lifecycle.py'
if (Test-Path -LiteralPath $runner) { Copy-Item -LiteralPath $runner -Destination ($runner + '.backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')) }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'artwork-lifecycle.py') -Destination $runner
$action = New-ScheduledTaskAction -Execute $Pythonw -Argument ('"{0}" --config "{1}"' -f $runner, $configPath) -WorkingDirectory $runtime
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = @(
    (New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(15)) -RepetitionInterval (New-TimeSpan -Minutes 15)),
    (New-ScheduledTaskTrigger -AtLogOn -User $identity)
)
$taskSettings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'yehry3 Artwork Lifecycle' -Action $action -Trigger $trigger -Settings $taskSettings -Principal $principal -Description 'Cheap pictorial covers for new songs; one mature cover after 24 hours. Protect pins and archives; $40/month cap and persistent audit.' -Force | Select-Object TaskName,State
