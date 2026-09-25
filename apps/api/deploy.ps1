# Deploys fruitcats-api to its App Service, signed in as the deploy-only identity (deploy-viamochi) in its own CLI
# folder. The owner's own `az` login is never used. No CI: run it from this machine (npm run deploy -w @fruitcats/api).
$ErrorActionPreference = 'Stop'
$dir = "$HOME\.azure-viamochi-deploy"
$cfg = Get-Content "$dir\deploy.json" | ConvertFrom-Json
$env:AZURE_CONFIG_DIR = $dir
# Signed in fresh each time. (Never `az logout`: on Windows that signs out every Azure CLI login, including the owner's.)
az login --service-principal -u $cfg.appId --certificate "$dir\deploy.pem" --tenant $cfg.tenant --allow-no-subscriptions -o none
if ($LASTEXITCODE) { throw 'Sign-in as deploy-viamochi failed.' }

# One bundled file: the server and everything it imports, the game's card data included.
npm run build --prefix $PSScriptRoot
if ($LASTEXITCODE) { throw 'Build failed.' }
$zip = Join-Path $env:TEMP 'fruitcats-api.zip'
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, "$PSScriptRoot\dist\server.mjs", 'server.mjs') | Out-Null
} finally { $archive.Dispose() }

az webapp deploy --subscription 32564bc0-941d-4aa9-9b15-5b3a85c57693 -g rg-viamochi-apps -n fruitcats-api --src-path $zip --type zip -o none
if ($LASTEXITCODE) { throw 'Deploy failed.' }
Write-Host "Deployed. Health: https://fruitcats-api.azurewebsites.net/healthz"
