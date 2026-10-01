param([Parameter(Mandatory)][string]$PrivateRoot)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content -Raw (Join-Path $PrivateRoot 'config\azure-state.json') | ConvertFrom-Json
$group = az group show --subscription $state.subscriptionId --name $state.resourceGroup --output json | ConvertFrom-Json
if ($group.tags.purpose -ne $state.purpose -or $state.purpose -ne 'ai-gateway-token-lab') { throw 'Experiment tag mismatch.' }
$parameters = Join-Path $PrivateRoot 'config\parameters.json'
$template = Join-Path (Split-Path $PSScriptRoot -Parent) 'infra\main.bicep'
az deployment group create --subscription $state.subscriptionId --resource-group $state.resourceGroup --name $state.deployment --template-file $template --parameters "@$parameters" --no-wait --output none
Write-Output 'Deployment submitted. Wait for successful provisioning before sending inference requests.'
