param([Parameter(Mandatory=$true)][string]$PreviousProject)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
node scripts/upgrade.js --from $PreviousProject
if ($LASTEXITCODE -ne 0) { throw "Upgrade stopped before dependency installation." }
npm ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw "Migration failed. Read the error; do not reset the database." }
Write-Host "Update complete. Start with npm start. Existing database and private uploads are preserved."
