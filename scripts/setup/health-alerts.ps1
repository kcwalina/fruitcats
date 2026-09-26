#Requires -Version 7.3
# Azure watches the two live services, so no one (and no Claude session) has to (docs/playtests.md, Health alerts):
#   - App Service's health check calls /healthz on viamochi-id and fruitcats-api every minute, and replaces an instance
#     that keeps failing it;
#   - a "<app>-down" alert emails the owner (action group ag-owner-alerts) when a service stops answering its health
#     check for 5 minutes, and again when it's back. The existing "<app>-errors" alerts cover server errors.
# Runs as Claude's agent (~/.azure-viamochi-agent). Safe to run again.
#
# Turning on the health check restarts the app (about 2 minutes down): tell the other sessions first
# (docs/accounts.md), and pass -SkipHealthCheck to only make the alerts.
param([switch]$SkipHealthCheck)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$env:AZURE_CONFIG_DIR = "$HOME\.azure-viamochi-agent"
$subscription = '32564bc0-941d-4aa9-9b15-5b3a85c57693'   # ViaMochi Production
$group = 'rg-viamochi-apps'
$actionGroup = "/subscriptions/$subscription/resourceGroups/rg-viamochi-shared/providers/microsoft.insights/actionGroups/ag-owner-alerts"

foreach ($app in 'viamochi-id', 'fruitcats-api') {
    $site = "/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.Web/sites/$app"
    $path = az webapp config show --subscription $subscription -g $group -n $app --query healthCheckPath -o tsv
    if ($path -eq '/healthz') { Write-Host "${app}: health check already on /healthz" }
    elseif ($SkipHealthCheck) { Write-Host "${app}: health check not on (skipped); the down alert needs it" }
    else {
        az webapp config set --subscription $subscription -g $group -n $app --generic-configurations '{\"healthCheckPath\": \"/healthz\"}' -o none
        Write-Host "${app}: health check on /healthz (the app restarts now)"
    }
    # HealthCheckStatus is the share of instances answering /healthz (100 = all). Below 100 for 5 minutes: down.
    az monitor metrics alert create --subscription $subscription -g $group -n "$app-down" --scopes $site `
        --condition 'avg HealthCheckStatus < 100' --window-size 5m --evaluation-frequency 1m --severity 1 `
        --auto-mitigate true --action $actionGroup `
        --description "$app is not answering /healthz. Check it: docs/emergency-stop.md, docs/accounts.md." -o none
    Write-Host "${app}: alert $app-down emails the owner"
}
