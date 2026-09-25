# One-time setup, run by the owner: gives Claude's agent permission to configure the player tenant
# (Via Mochi Players, Entra External ID). Uses its own CLI folder; the owner's normal `az` login is untouched.
# See docs/accounts.md.
$ErrorActionPreference = 'Stop'
$tenant = 'b795dd5c-aa4f-43e2-ab15-5e0bf0cdcff4'   # viamochiplayers.onmicrosoft.com
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-bootstrap-players"

Write-Host "1/4 Sign in to the player tenant in the browser window..."
az login --tenant $tenant --allow-no-subscriptions -o none

Write-Host "2/4 Creating the agent app 'claude-agent-players' with a certificate..."
$out = az ad sp create-for-rbac -n claude-agent-players --create-cert --years 1 -o json | ConvertFrom-Json

Write-Host "3/4 Adding Microsoft Graph permissions and granting admin consent..."
$graph = '00000003-0000-0000-c000-000000000000'
$wanted = 'Application.ReadWrite.All', 'IdentityUserFlow.ReadWrite.All', 'EventListener.ReadWrite.All',
          'CustomAuthenticationExtension.ReadWrite.All', 'Policy.ReadWrite.AuthenticationMethod',
          'Policy.ReadWrite.AuthenticationFlows', 'User.ReadWrite.All'
$appRoles = az ad sp show --id $graph --query appRoles -o json | ConvertFrom-Json
$perms = foreach ($name in $wanted) { "$(($appRoles | Where-Object value -eq $name).id)=Role" }
az ad app permission add --id $out.appId --api $graph --api-permissions $perms -o none
Start-Sleep 30
az ad app permission admin-consent --id $out.appId

Write-Host "4/4 Moving the certificate into Claude's agent folder..."
$dir = "$HOME\.azure-viamochi-agent-players"
New-Item -ItemType Directory -Force $dir | Out-Null
Move-Item $out.fileWithCertAndPrivateKey "$dir\agent.pem" -Force
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
@{ appId = $out.appId; tenant = $tenant } | ConvertTo-Json | Set-Content "$dir\agent.json"
Write-Host "Done. Agent app id: $($out.appId). Tell Claude it's finished."
