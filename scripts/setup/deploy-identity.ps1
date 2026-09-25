# One-time setup, run by the owner: creates the deploy-only identity used by scripts/deploy.ps1.
# It gets no rights here; Claude's agent grants it Website Contributor on the apps once they exist.
# Uses the temporary setup CLI folder; the owner's normal `az` login is untouched.
$ErrorActionPreference = 'Stop'
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-bootstrap"

Write-Host "1/2 Creating the deploy identity 'deploy-viamochi' with a certificate..."
$out = az ad sp create-for-rbac -n deploy-viamochi --create-cert --years 1 -o json | ConvertFrom-Json

Write-Host "2/2 Moving the certificate into the deploy folder..."
$dir = "$HOME\.azure-viamochi-deploy"
New-Item -ItemType Directory -Force $dir | Out-Null
Move-Item $out.fileWithCertAndPrivateKey "$dir\deploy.pem" -Force
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
@{ appId = $out.appId; tenant = $out.tenant } | ConvertTo-Json | Set-Content "$dir\deploy.json"
Write-Host "Done. Deploy app id: $($out.appId). Tell Claude it's finished."
