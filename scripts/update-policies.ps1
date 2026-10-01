param([Parameter(Mandatory)][string]$PrivateRoot)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content -Raw (Join-Path $PrivateRoot 'config\azure-state.json') | ConvertFrom-Json
$parameters = Get-Content -Raw (Join-Path $PrivateRoot 'config\parameters.json') | ConvertFrom-Json
$group = az group show --subscription $state.subscriptionId --name $state.resourceGroup --output json | ConvertFrom-Json
if ($group.tags.purpose -ne $state.purpose -or $group.tags.owner -ne 'yukurash') { throw 'Dedicated group verification failed.' }
$deployment = az deployment group show --subscription $state.subscriptionId --resource-group $state.resourceGroup --name $state.deployment --output json | ConvertFrom-Json
if ($deployment.properties.provisioningState -ne 'Succeeded' -or $deployment.properties.outputs.apimName.value -ne $state.apimName) {
    throw 'Initial deployment is not ready or does not match the configured service.'
}
$quota = if ($parameters.parameters.quotaTokens) { [int]$parameters.parameters.quotaTokens.value } else { 1200 }
$rate = if ($parameters.parameters.rateTokens) { [int]$parameters.parameters.rateTokens.value } else { 1200 }
$template = Join-Path (Split-Path $PSScriptRoot -Parent) 'infra\api.bicep'
$variants = @('baseline','quota-off','quota-on','rate-off','rate-on')
foreach ($variant in $variants) {
    $uri = "https://management.azure.com/subscriptions/$($state.subscriptionId)/resourceGroups/$($state.resourceGroup)/providers/Microsoft.ApiManagement/service/$($state.apimName)/apis/$variant`?api-version=2024-05-01"
    $api = az rest --method get --url $uri --output json | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($api.properties.serviceUrl)) { throw 'Missing existing API backend URL.' }
    $kind = if ($variant -eq 'baseline') { 'baseline' } elseif ($variant.StartsWith('quota-')) { 'quota' } else { 'rate' }
    $values = @{
        apimName = $state.apimName
        variant = $variant
        kind = $kind
        estimate = $variant.EndsWith('-on')
        backendUrl = $api.properties.serviceUrl
        allowedIp = $parameters.parameters.allowedIp.value
        quotaTokens = $quota
        rateTokens = $rate
    }
    $apiParameters = @{}
    foreach ($key in $values.Keys) { $apiParameters[$key] = @{ value = $values[$key] } }
    $parameterPath = Join-Path $PrivateRoot "config\api-$variant-parameters.json"
    @{ parameters = $apiParameters } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $parameterPath
    az deployment group create --subscription $state.subscriptionId --resource-group $state.resourceGroup --name "update-$variant" --template-file $template --parameters "@$parameterPath" --mode Incremental --output none
}
Write-Output 'Updated only the five experiment APIs and policies; the APIM service was not redeployed.'
