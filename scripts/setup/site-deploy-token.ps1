# Saves the public site's deployment token (Azure Static Web App "fruitcats", Visual Studio subscription) in a folder only
# this Windows user can read, so `npm run deploy` no longer needs anyone's `az login`. Sessions kept signing that login
# out, which stopped every site deploy until the owner signed in again.
#
# Run it once, signed in with the owner's own `az login` (the only time that login is needed). Run it again only if the
# token is reset in the portal (then the old one stops working and deploys say so). The token is never printed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup/site-deploy-token.ps1

$ErrorActionPreference = 'Stop'
$dir = Join-Path $HOME '.fruitcats-deploy'
$file = Join-Path $dir 'swa-token'

$token = az staticwebapp secrets list -n fruitcats -g mochi-tcg --subscription 57c8ee32-8d62-47b9-9eec-1c0ef6d0e39f --query properties.apiKey -o tsv
if ($LASTEXITCODE -or -not $token) { throw 'Could not read the token. Sign in with az login (the Visual Studio subscription) and run this again.' }

New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Only this Windows user may read the folder: no inherited access for anyone else.
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
Set-Content -LiteralPath $file -Value $token.Trim() -NoNewline -Encoding ascii
icacls $file /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
Write-Host "Saved the site's deployment token in $file (readable only by $env:USERNAME). npm run deploy uses it from now on."
