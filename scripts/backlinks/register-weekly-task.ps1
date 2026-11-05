[CmdletBinding()]
param(
    [ValidateSet('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')]
    [string] $Day = 'Monday',
    [ValidatePattern('^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')]
    [string] $Time = '09:00',
    [switch] $Unregister
)

$ErrorActionPreference = 'Stop'
$taskName = 'site-ops-backlinks-weekly'
if ($Unregister) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    return
}

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$npm = (Get-Command npm.cmd -CommandType Application | Select-Object -First 1).Source
$npmLiteral = "'" + $npm.Replace("'", "''") + "'"
$body = @"
New-Item -ItemType Directory -Path 'reports/backlinks' -Force | Out-Null
& $npmLiteral run --silent backlinks -- weekly *>> 'reports/backlinks/weekly.log'
exit `$LASTEXITCODE
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body))
$exe = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$action = New-ScheduledTaskAction -Execute $exe -Argument "-NoProfile -NonInteractive -EncodedCommand $encoded" -WorkingDirectory $repo
$at = [datetime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $at
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings
