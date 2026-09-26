#Requires -Version 7.3
# One-time setup for the playtest dashboard (docs/playtests.md): lets fruitcats-api's own identity read viamochi-id's
# logs and read log, for the Accounts tab (apps/api/src/playtests/ops.ts): the logs, security and
# insights-logs-storageread containers of viamochiidstore (fruitcatsdata's it can already read). Reading only, and
# container scopes only, nothing wider. Runs as Claude's agent (~/.azure-viamochi-agent), which may assign roles; the
# owner's own `az` login isn't used. Safe to run again: existing assignments are left alone.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-agent"
$subscription = '32564bc0-941d-4aa9-9b15-5b3a85c57693'   # ViaMochi Production

$api = az webapp identity show --subscription $subscription -g rg-viamochi-apps -n fruitcats-api --query principalId -o tsv
if (-not $api) { throw 'fruitcats-api has no managed identity.' }
$grants = @(
    @{ role = 'Storage Blob Data Reader';      group = 'rg-viamochi-id'; account = 'viamochiidstore'; container = 'logs' },
    @{ role = 'Storage Blob Data Reader';      group = 'rg-viamochi-id'; account = 'viamochiidstore'; container = 'security' },
    @{ role = 'Storage Blob Data Reader';      group = 'rg-viamochi-id'; account = 'viamochiidstore'; container = 'insights-logs-storageread' }
)
foreach ($g in $grants) {
    $scope = "/subscriptions/$subscription/resourceGroups/$($g.group)/providers/Microsoft.Storage/storageAccounts/$($g.account)/blobServices/default/containers/$($g.container)"
    $have = az role assignment list --scope $scope --assignee-object-id $api --role $g.role --query '[0].id' -o tsv
    if ($have) { Write-Host "  already: $($g.role) on $($g.account)/$($g.container)"; continue }
    az role assignment create --assignee-object-id $api --assignee-principal-type ServicePrincipal --role $g.role --scope $scope -o none
    Write-Host "  granted: $($g.role) on $($g.account)/$($g.container)"
}
