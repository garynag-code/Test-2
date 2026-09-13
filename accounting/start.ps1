<#
  Starts the accounting platform for local development: the API on port 5080 and the UI on 5173.
  Configuration comes from local.settings.ps1, which is not committed. On the first run this script
  creates it from the template and asks you to fill in the passwords.
#>

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$settings = Join-Path $here 'local.settings.ps1'

if (-not (Test-Path $settings)) {
    @'
# Local development settings. Not committed: it holds passwords.
$env:ConnectionStrings__AccountingDb = "Host=localhost;Port=5432;Database=accounting_dev;Username=accounting;Password=CHANGE-ME"
$env:Bootstrap__AdministratorEmail   = "you@example.com"
$env:Bootstrap__AdministratorPassword = "CHANGE-ME-12-CHARS"
'@ | Set-Content -Path $settings -Encoding UTF8

    Write-Host "Created $settings." -ForegroundColor Yellow
    Write-Host "Fill in your database and administrator passwords, then run this script again."
    return
}

. $settings

if ($env:ConnectionStrings__AccountingDb -match 'CHANGE-ME') {
    Write-Host "local.settings.ps1 still contains CHANGE-ME. Fill it in first." -ForegroundColor Yellow
    return
}

$env:ASPNETCORE_URLS = 'http://localhost:5080'

Write-Host 'Starting the API on http://localhost:5080 ...' -ForegroundColor Cyan
$api = Start-Process -PassThru -FilePath 'dotnet' `
    -ArgumentList 'run', '--project', (Join-Path $here 'src/Accounting.Api'), '--no-launch-profile'

Write-Host 'Starting the UI on http://localhost:5173 ...' -ForegroundColor Cyan
$web = Start-Process -PassThru -FilePath 'npm' `
    -ArgumentList 'run', 'dev', '--prefix', (Join-Path $here 'src/Accounting.Web')

Write-Host ''
Write-Host 'Both are starting. Open http://localhost:5173 once the API reports it is listening.'
Write-Host 'Press Ctrl+C here to stop both.' -ForegroundColor Cyan

try {
    while (-not $api.HasExited -and -not $web.HasExited) { Start-Sleep -Seconds 1 }
}
finally {
    foreach ($process in @($api, $web)) {
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
    Write-Host 'Stopped.'
}
