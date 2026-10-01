param(
    [Parameter(Mandatory)][string]$PrivateRoot,
    [Parameter(Mandatory)][string]$ConfirmResourceGroup
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content -Raw (Join-Path $PrivateRoot 'config\azure-state.json') | ConvertFrom-Json
if ($state.resourceGroup -ne $ConfirmResourceGroup -or $ConfirmResourceGroup -notmatch '^rg-ai-gateway-token-lab-[a-z0-9-]+$') {
    throw 'Explicit group confirmation does not match the recorded experiment.'
}
$group = az group show --subscription $state.subscriptionId --name $state.resourceGroup --output json | ConvertFrom-Json
if ($group.tags.purpose -ne 'ai-gateway-token-lab' -or $group.tags.owner -ne 'yukurash') { throw 'Experiment tags do not match.' }
$resources = az resource list --subscription $state.subscriptionId --resource-group $state.resourceGroup --output json | ConvertFrom-Json
foreach ($resource in $resources) {
    if ($resource.type -notin @('Microsoft.ApiManagement/service','Microsoft.CognitiveServices/accounts','Microsoft.Insights/components','Microsoft.OperationalInsights/workspaces')) {
        throw "Unexpected resource type: $($resource.type). Inspect before deletion."
    }
    if ($resource.tags.purpose -ne 'ai-gateway-token-lab') { throw 'An untagged resource is present; refusing deletion.' }
}
$resources | ConvertTo-Json -Depth 30 | Set-Content -Encoding utf8 (Join-Path $PrivateRoot 'config\deleted-resource-inventory.json')
az group delete --subscription $state.subscriptionId --name $state.resourceGroup --yes --no-wait
az group wait --subscription $state.subscriptionId --name $state.resourceGroup --deleted --timeout 7200
$exists = az group exists --subscription $state.subscriptionId --name $state.resourceGroup --output tsv
if ($exists -ne 'false') { throw 'Resource group deletion is not confirmed.' }
@{ deleted = $true; verifiedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json |
    Set-Content -Encoding utf8 (Join-Path $PrivateRoot 'config\cleanup-verification.json')
Write-Output 'Dedicated resource group deletion verified.'
