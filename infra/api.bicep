param apimName string
param variant string
param kind string
param estimate bool
param backendUrl string
param allowedIp string
param quotaTokens int
param rateTokens int

resource service 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  parent: service
  name: variant
  properties: {
    displayName: 'Token lab ${variant}'
    path: 'lab/${variant}'
    protocols: ['https']
    subscriptionRequired: true
    serviceUrl: backendUrl
    format: 'openapi+json'
    value: loadTextContent('openapi.json')
  }
}

var quota = 'token-quota="${quotaTokens}" token-quota-period="Hourly" remaining-quota-tokens-header-name="x-lab-remaining"'
var rate = 'tokens-per-minute="${rateTokens}" remaining-tokens-header-name="x-lab-remaining"'
var limit = '<llm-token-limit id="lab-token-limit" counter-key="@(&quot;${variant}:&quot; + (string)context.Variables[&quot;lab-counter&quot;])" ${kind == 'quota' ? quota : rate} estimate-prompt-tokens="${estimate}" tokens-consumed-header-name="x-lab-consumed" />'
var policy = replace(replace(loadTextContent('policies/gateway.xml'), '__ALLOWED_IP__', allowedIp), '__LIMIT_POLICY__', kind == 'baseline' ? '' : limit)

resource policies 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = {
  parent: api
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: policy
  }
}
