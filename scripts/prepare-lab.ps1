param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$PrivateRoot,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{5,24}$')][string]$Suffix,
    [string]$AllowedIp
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$project = Split-Path $PSScriptRoot -Parent
$private = [IO.Path]::GetFullPath($PrivateRoot)
if ($private.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $private -eq $project) {
    throw 'Private storage must be outside the public repository.'
}
$group = "rg-ai-gateway-token-lab-$Suffix"
$exists = az group exists --name $group --subscription $SubscriptionId --output tsv
if ($exists -ne 'false') { throw 'Refusing to reuse an existing resource group.' }
$account = az account show --subscription $SubscriptionId --output json | ConvertFrom-Json
if ($account.id -ne $SubscriptionId -or $account.state -ne 'Enabled') { throw 'Subscription verification failed.' }
$publisher = az ad signed-in-user show --query userPrincipalName --output tsv
$ip = if ($AllowedIp) { $AllowedIp.Trim() } else { (Invoke-RestMethod 'https://api4.ipify.org').Trim() }
if (-not [Net.IPAddress]::TryParse($ip, [ref]([Net.IPAddress]$null))) { throw 'Could not resolve source IP.' }
New-Item -ItemType Directory -Force -Path (Join-Path $private 'config') | Out-Null
$parameters = @{
    '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
    contentVersion = '1.0.0.0'
    parameters = @{
        suffix = @{ value = $Suffix }
        publisherEmail = @{ value = $publisher }
        allowedIp = @{ value = $ip }
    }
}
$parameterPath = Join-Path $private 'config\parameters.json'
$parameters | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $parameterPath
$state = @{
    subscriptionId = $SubscriptionId
    resourceGroup = $group
    deployment = 'token-lab'
    purpose = 'ai-gateway-token-lab'
    createdAt = [DateTime]::UtcNow.ToString('o')
    apimName = "aigtl-$Suffix"
}
$state | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $private 'config\azure-state.json')
az group create --subscription $SubscriptionId --name $group --location japaneast --tags purpose=ai-gateway-token-lab owner=yukurash --output none
$preview = az deployment group what-if --subscription $SubscriptionId --resource-group $group --name token-lab --template-file (Join-Path $project 'infra\main.bicep') --parameters "@$parameterPath" --output json --no-pretty-print | ConvertFrom-Json
$preview | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 (Join-Path $private 'config\what-if.json')
if ($preview.status -ne 'Succeeded' -or $preview.changes.Count -eq 0) { throw 'What-if did not return a successful, nonempty change set.' }
$prefix = "/subscriptions/$SubscriptionId/resourceGroups/$group/"
foreach ($change in $preview.changes) {
    if (-not $change.resourceId.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'What-if targets a resource outside the experiment group.' }
    if ($change.changeType -notin @('Create', 'Ignore', 'NoChange')) { throw "Unexpected what-if change: $($change.changeType)" }
}
Write-Output "Prepared dedicated group and validated $($preview.changes.Count) what-if changes. No paid deployment started."
