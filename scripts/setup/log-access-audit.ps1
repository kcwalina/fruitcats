#Requires -Version 7.3
# One-time setup: turns on Azure's read log (StorageRead) for both storage accounts, so the Accounts tab of the
# playtest dashboard can show who read the services' logs (tools/ops.mjs, "Who read the logs"). Each account writes
# its read log into its own insights-logs-storageread container, kept for 90 days. nightly-reader-viamochi can't
# read that container. See docs/accounts.md.
# Runs as Claude's agent (its own CLI folder, ~/.azure-viamochi-agent), which already has the rights it needs; no
# sign-in, and the owner's own `az` login isn't used.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-agent"
$subscription = '32564bc0-941d-4aa9-9b15-5b3a85c57693'   # ViaMochi Production
$agentAppId = 'b224f78d-5fdb-49fd-9fa0-0e64fccae134'   # claude-agent-viamochi
$accounts = @(
    @{ group = 'rg-viamochi-id'; name = 'viamochiidstore' },
    @{ group = 'rg-fruitcats';   name = 'fruitcatsdata' }
)
$container = 'insights-logs-storageread'
$keepDays = 90

az account set --subscription $subscription
# The agent's object id, from its own sign-in token (it may not read the directory).
$payload = (az account get-access-token --query accessToken -o tsv).Split('.')[1].Replace('-', '+').Replace('_', '/')
$payload += '=' * ((4 - $payload.Length % 4) % 4)
$token = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
if ($token.appid -ne $agentAppId) { throw "Signed in as $($token.appid), not Claude's agent ($agentAppId)." }
$agentObjectId = $token.oid

foreach ($a in $accounts) {
    $account = "/subscriptions/$subscription/resourceGroups/$($a.group)/providers/Microsoft.Storage/storageAccounts/$($a.name)"
    Write-Host "$($a.name):"

    Write-Host "  1/4 Read log on, written to this account"
    az monitor diagnostic-settings create --name log-access --resource "$account/blobServices/default" `
        --storage-account $account --logs '[{"category":"StorageRead","enabled":true}]' -o none

    Write-Host "  2/4 The container it goes to"
    az storage container-rm create --storage-account $account --name $container -o none

    Write-Host "  3/4 Claude's agent may read it (for the dashboard)"
    az role assignment create --assignee-object-id $agentObjectId --assignee-principal-type ServicePrincipal `
        --role 'Storage Blob Data Reader' --scope "$account/blobServices/default/containers/$container" -o none

    Write-Host "  4/4 Deleted after $keepDays days (added to the account's existing lifecycle rules)"
    # Read the current rules first: `create` replaces them all. Stop on any error but "there are none yet".
    $PSNativeCommandUseErrorActionPreference = $false
    $errors = New-TemporaryFile
    $shown = az storage account management-policy show --account-name $a.name --resource-group $a.group -o json 2>$errors
    $failed = $LASTEXITCODE -ne 0
    $PSNativeCommandUseErrorActionPreference = $true
    $problem = Get-Content $errors -Raw
    Remove-Item $errors
    if (-not $failed) { $policy = ($shown | Out-String | ConvertFrom-Json).policy }
    elseif ($problem -match 'ManagementPolicyNotFound|not found') { $policy = [pscustomobject]@{ rules = @() } }
    else { throw "Couldn't read the lifecycle rules of $($a.name): $problem" }
    $rules = @($policy.rules | Where-Object { $_.name -ne 'log-access' })
    $rules += [pscustomobject]@{
        name = 'log-access'; enabled = $true; type = 'Lifecycle'
        definition = [pscustomobject]@{
            filters = [pscustomobject]@{ blobTypes = @('appendBlob', 'blockBlob'); prefixMatch = @("$container/") }
            actions = [pscustomobject]@{ baseBlob = [pscustomobject]@{ delete = [pscustomobject]@{ daysAfterModificationGreaterThan = $keepDays } } }
        }
    }
    $file = New-TemporaryFile
    [pscustomobject]@{ rules = $rules } | ConvertTo-Json -Depth 20 | Set-Content $file
    az storage account management-policy create --account-name $a.name --resource-group $a.group --policy "@$file" -o none
    Remove-Item $file
}

Write-Host ""
Write-Host "Done. Azure starts writing the read log within about 15 minutes; the dashboard's 'Who read the logs' fills"
Write-Host "from then on (older reads weren't recorded)."
