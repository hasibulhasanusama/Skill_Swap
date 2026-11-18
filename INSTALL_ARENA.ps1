param([Parameter(Mandatory=$true)][string]$ProjectPath)
$ErrorActionPreference = "Stop"
$target = (Resolve-Path -LiteralPath $ProjectPath).Path
$package = Get-Content -LiteralPath (Join-Path $target "package.json") -Raw | ConvertFrom-Json
if ($package.name -ne "skill-swap") { throw "Choose your existing skill-swap project folder." }
$files = Get-Content -LiteralPath (Join-Path $PSScriptRoot "changed-files.json") -Raw | ConvertFrom-Json
$source = Join-Path $PSScriptRoot "skill-swap"
foreach ($relative in $files) {
  if ($relative -match '(^/|\.\.|:)') { throw "Invalid update path." }
  $from = Join-Path $source $relative
  if (!(Test-Path -LiteralPath $from -PathType Leaf)) { throw "Missing update file: $relative" }
  $to = Join-Path $target $relative
  if ($relative -eq "db/migrations/012_skill_arena.sql" -and (Test-Path -LiteralPath $to)) {
    if ((Get-FileHash -LiteralPath $from).Hash -ne (Get-FileHash -LiteralPath $to).Hash) {
      throw "Migration 012 already exists with different content. No files copied."
    }
  }
}
$backup = Join-Path $target ("arena-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
foreach ($relative in $files) {
  $to = Join-Path $target $relative
  if (Test-Path -LiteralPath $to) {
    $saved = Join-Path $backup $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $saved) | Out-Null
    Copy-Item -LiteralPath $to -Destination $saved
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
  Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $to -Force
}
Write-Host "Skill Arena files installed. Backup: $backup"
Write-Host "In your project folder run: npm install"
Write-Host "Then: npm run db:migrate"
Write-Host "Then: npm run test:arena"
Write-Host "Then: npm start"
