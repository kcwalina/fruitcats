# Deploys fruitcats-api to its App Service, signed in as the deploy-only identity (deploy-viamochi) in its own CLI
# folder. The owner's own `az` login is never used. No CI: run it from this machine (npm run deploy -w @fruitcats/api).
$ErrorActionPreference = 'Stop'

# Only ever origin/main, pushed first, one deploy at a time, and only over a build this one contains: a deploy from an
# unpushed or older checkout takes other sessions' changes (security fixes too) off the live service.
# scripts/git/deploy-guard.mjs; the lock belongs to this PowerShell process, so it frees itself if the script dies.
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$guard = "$repo\scripts\git\deploy-guard.mjs"
node $guard lock api $PID
if ($LASTEXITCODE) { throw 'Another fruitcats-api deploy is running.' }
Push-Location $repo
try {
  node $guard on-main
  if ($LASTEXITCODE) { throw 'fruitcats-api deploys only origin/main: see the message above.' }
  $commit = (git rev-parse HEAD).Trim()
  $live = try { (Invoke-RestMethod 'https://api.fruitcats.viamochi.com/version' -TimeoutSec 10).commit } catch { '' }
  node $guard live "$live" fruitcats-api
  if ($LASTEXITCODE) { throw 'The live fruitcats-api has changes this checkout lacks: see the message above.' }
} finally { Pop-Location }

$dir = "$HOME\.azure-viamochi-deploy"
$cfg = Get-Content "$dir\deploy.json" | ConvertFrom-Json
$env:AZURE_CONFIG_DIR = $dir
# Signed in fresh each time. (Never `az logout`: on Windows that signs out every Azure CLI login, including the owner's.)
az login --service-principal -u $cfg.appId --certificate "$dir\deploy.pem" --tenant $cfg.tenant --allow-no-subscriptions -o none
if ($LASTEXITCODE) { throw 'Sign-in as deploy-viamochi failed.' }

# Online play needs Web Sockets on (docs/pvp-plan.md). Only set when it's off: a settings change can restart the app,
# and a deploy already restarts it once.
$sockets = az webapp config show --subscription 32564bc0-941d-4aa9-9b15-5b3a85c57693 -g rg-viamochi-apps -n fruitcats-api --query webSocketsEnabled -o tsv
if ($sockets -ne 'true') {
  az webapp config set --subscription 32564bc0-941d-4aa9-9b15-5b3a85c57693 -g rg-viamochi-apps -n fruitcats-api --web-sockets-enabled true -o none
  if ($LASTEXITCODE) { throw 'Could not switch on Web Sockets for fruitcats-api.' }
}

# One bundled file: the server and everything it imports, the game's card data included.
npm run build --prefix $PSScriptRoot
if ($LASTEXITCODE) { throw 'Build failed.' }
$zip = Join-Path $env:TEMP 'fruitcats-api.zip'
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, "$PSScriptRoot\dist\server.mjs", 'server.mjs') | Out-Null
  # Served at /version, so the next deploy can check it has everything that's live.
  $entry = $archive.CreateEntry('commit.txt')
  $writer = New-Object System.IO.StreamWriter($entry.Open())
  try { $writer.Write($commit) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }

az webapp deploy --subscription 32564bc0-941d-4aa9-9b15-5b3a85c57693 -g rg-viamochi-apps -n fruitcats-api --src-path $zip --type zip -o none
$deployFailed = [bool]$LASTEXITCODE

# Players are using it: make sure it's answering again, whatever the deploy said. A deploy once left the site hung
# while starting (2026-09-25), and only a restart brought it back.
function Test-Healthy {
  try { return (Invoke-WebRequest 'https://api.fruitcats.viamochi.com/healthz' -TimeoutSec 10 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}
function Wait-Healthy([int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) { if (Test-Healthy) { return $true }; Start-Sleep -Seconds 5 }
  return $false
}
if (-not (Wait-Healthy 120)) {
  Write-Warning 'fruitcats-api is not answering 2 minutes after the deploy: restarting it.'
  az webapp restart --subscription 32564bc0-941d-4aa9-9b15-5b3a85c57693 -g rg-viamochi-apps -n fruitcats-api -o none
  if (-not (Wait-Healthy 120)) { throw 'fruitcats-api is DOWN after the deploy and a restart. Check it now: docs/emergency-stop.md.' }
}
if ($deployFailed) { throw 'The deploy reported a failure (fruitcats-api is answering, but may be running the old version).' }
$running = try { (Invoke-RestMethod 'https://api.fruitcats.viamochi.com/version' -TimeoutSec 10).commit } catch { '' }
node $guard unlock api
if ($running -ne $commit) { Write-Warning "fruitcats-api says it runs '$running', not $commit." }
Write-Host "Deployed $($commit.Substring(0, 9)). Health: https://fruitcats-api.azurewebsites.net/healthz"
