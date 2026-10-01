param([Parameter(Mandatory)][string]$PrivateRoot)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content -Raw (Join-Path $PrivateRoot 'config\azure-state.json') | ConvertFrom-Json
$deployment = az deployment group show --subscription $state.subscriptionId --resource-group $state.resourceGroup --name $state.deployment --output json | ConvertFrom-Json
if ($deployment.properties.provisioningState -ne 'Succeeded') { throw 'Deployment is not ready.' }
$endpoint = $deployment.properties.outputs.gatewayUrl.value
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
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $PrivateRoot 'config\client.json')
Write-Output 'Client configuration written to private storage. No credentials printed.'
