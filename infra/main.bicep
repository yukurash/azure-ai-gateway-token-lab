targetScope = 'resourceGroup'

param location string = resourceGroup().location
param suffix string
param publisherEmail string
param allowedIp string
param quotaTokens int = 1200
param rateTokens int = 1200
param modelCapacity int = 1000

var tags = {
  purpose: 'ai-gateway-token-lab'
  owner: 'yukurash'
}

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: 'aigtl-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Developer'
    capacity: 1
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherName: 'yukurash'
    publisherEmail: publisherEmail
    publicNetworkAccess: 'Enabled'
    virtualNetworkType: 'None'
  }
}

resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aigtl-model-${suffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'aigtl-model-${suffix}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'lab-mini'
  sku: {
    name: 'Standard'
    capacity: modelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4.1-mini'
      version: '2025-04-14'
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource modelAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, apim.id, 'model-user')
  scope: openai
  properties: {
    principalId: apim.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

var variants = [
  { name: 'baseline', kind: 'baseline', estimate: false }
  { name: 'quota-off', kind: 'quota', estimate: false }
  { name: 'quota-on', kind: 'quota', estimate: true }
  { name: 'rate-off', kind: 'rate', estimate: false }
  { name: 'rate-on', kind: 'rate', estimate: true }
]

module apis 'api.bicep' = [for variant in variants: {
  name: 'api-${variant.name}'
  params: {
    apimName: apim.name
    variant: variant.name
    kind: variant.kind
    estimate: variant.estimate
    backendUrl: '${openai.properties.endpoint}openai/deployments/${model.name}'
    allowedIp: allowedIp
    quotaTokens: quotaTokens
    rateTokens: rateTokens
  }
}]

resource client 'Microsoft.ApiManagement/service/subscriptions@2024-05-01' = {
  parent: apim
  name: 'lab-client'
  properties: {
    displayName: 'Local experiment client'
    scope: '/apis'
    state: 'active'
    allowTracing: false
  }
}

output gatewayUrl string = apim.properties.gatewayUrl
output apimName string = apim.name
output modelEndpoint string = openai.properties.endpoint
output modelAccountName string = openai.name
