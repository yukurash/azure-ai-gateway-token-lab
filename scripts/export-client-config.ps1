param([Parameter(Mandatory)][string]$PrivateRoot)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content -Raw (Join-Path $PrivateRoot 'config\azure-state.json') | ConvertFrom-Json
$serviceUri = "https://management.azure.com/subscriptions/$($state.subscriptionId)/resourceGroups/$($state.resourceGroup)/providers/Microsoft.ApiManagement/service/$($state.apimName)?api-version=2024-05-01"
$service = az rest --method get --url $serviceUri --output json | ConvertFrom-Json
if ($service.properties.provisioningState -ne 'Succeeded' -or $service.tags.purpose -ne $state.purpose) {
    throw 'The dedicated APIM service is not ready.'
}
$endpoint = $service.properties.gatewayUrl
$secretsUri = "https://management.azure.com/subscriptions/$($state.subscriptionId)/resourceGroups/$($state.resourceGroup)/providers/Microsoft.ApiManagement/service/$($state.apimName)/subscriptions/lab-client/listSecrets?api-version=2024-05-01"
$keys = az rest --method post --url $secretsUri --output json | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($keys.primaryKey)) { throw 'No client subscription key returned.' }
$parameters = Get-Content -Raw (Join-Path $PrivateRoot 'config\parameters.json') | ConvertFrom-Json
$quota = if ($parameters.parameters.quotaTokens) { $parameters.parameters.quotaTokens.value } else { 1200 }
$rate = if ($parameters.parameters.rateTokens) { $parameters.parameters.rateTokens.value } else { 1200 }
@{
    gatewayUrl = $endpoint
    subscriptionKey = $keys.primaryKey
    apiVersion = '2024-10-21'
    createdAt = $state.createdAt
    quotaTokens = $quota
    rateTokens = $rate
    restrictClientIp = if ($parameters.parameters.restrictClientIp) { [bool]$parameters.parameters.restrictClientIp.value } else { $true }
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $PrivateRoot 'config\client.json')
Write-Output 'Client configuration written to private storage. No credentials printed.'
