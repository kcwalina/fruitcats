# One-time setup, run by the owner: creates the read-only identity that cloud runs (the nightly) use for
# `node tools/ops.mjs`. It may only read blobs in the `logs` and `security` containers of the two storage accounts,
# and nothing else. See docs/accounts.md.
# Uses a temporary CLI folder, deleted at the end; the owner's normal `az` login is untouched.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true   # stop when an az command fails (PowerShell 7.3+)
$subscription = '32564bc0-941d-4aa9-9b15-5b3a85c57693'   # ViaMochi Production
$containers = @(
    @{ group = 'rg-viamochi-id'; account = 'viamochiidstore'; name = 'logs' },
    @{ group = 'rg-viamochi-id'; account = 'viamochiidstore'; name = 'security' },
    @{ group = 'rg-fruitcats';   account = 'fruitcatsdata';   name = 'logs' },
    @{ group = 'rg-fruitcats';   account = 'fruitcatsdata';   name = 'security' }
)
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-bootstrap-reader"

try {
    Write-Host "1/3 Sign in in the browser window (as kcwalina@msn.com)..."
    az login -o none
    az account set --subscription $subscription

    Write-Host "2/3 Creating the identity 'nightly-reader-viamochi' with a password that expires in a year..."
    $app = az ad sp create-for-rbac -n nightly-reader-viamochi --years 1 -o json | ConvertFrom-Json

    Write-Host "3/3 Letting it read the log containers (Storage Blob Data Reader, each container only)..."
    Start-Sleep 15   # a new identity takes a moment to appear everywhere
    $objectId = az ad sp show --id $app.appId --query id -o tsv
    foreach ($c in $containers) {
        $scope = "/subscriptions/$subscription/resourceGroups/$($c.group)/providers/Microsoft.Storage" +
                 "/storageAccounts/$($c.account)/blobServices/default/containers/$($c.name)"
        az role assignment create --assignee-object-id $objectId `
            --assignee-principal-type ServicePrincipal --role 'Storage Blob Data Reader' --scope $scope -o none
        Write-Host "    $($c.account)/$($c.name)"
    }

    Write-Host ""
    Write-Host "Done. Add these three environment variables to the Claude cloud environment (Edit environment):"
    Write-Host "  VIAMOCHI_READER_TENANT_ID=$($app.tenant)"
    Write-Host "  VIAMOCHI_READER_CLIENT_ID=$($app.appId)"
    Write-Host "  VIAMOCHI_READER_CLIENT_SECRET=$($app.password)"
    Write-Host "Don't paste them into a chat. Tell Claude it's finished."
}
finally {
    az logout 2>$null
    Remove-Item -Recurse -Force $env:AZURE_CONFIG_DIR -ErrorAction SilentlyContinue
}
