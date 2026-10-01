# Azure AI Gateway token limit experiments

[日本語](README.md)

This repository compares configured `llm-token-limit` quotas with actual model token usage on a single Azure API Management Developer gateway. It covers non-streaming responses with prompt estimation enabled or disabled, and streaming responses, at concurrency levels 1, 4 and 8.

The experiment environment is being prepared. There are no measurements yet. The documented possibility of temporary overshoot is a hypothesis to investigate, not a predetermined result. Invalid and failed trials will be retained.

## Publication boundary

Only reproduction code and sanitized evidence belong here. Article drafts, raw logs, Azure identifiers and credentials are stored outside the repository.

## Cost and cleanup

APIM Developer incurs charges while provisioned, even without requests. Model inference is charged separately. Check current prices and quota before deploying into a dedicated resource group, and delete only that group after exporting the evidence.

```powershell
npm ci
npm run typecheck
npm test
az bicep build --file infra\main.bicep
```

Keep deployment parameters and raw logs outside this repository. CI does not deploy Azure resources or call paid models.

## Runner

Use Node.js 24, PowerShell 7 and Azure CLI. Set `$private` to a directory outside the repository, `$subscription` to the target subscription, and `$suffix` to an unused suffix.

```powershell
.\scripts\prepare-lab.ps1 -SubscriptionId $subscription -PrivateRoot $private -Suffix $suffix
.\scripts\deploy-lab.ps1 -PrivateRoot $private
```

Once deployment succeeds, export the client configuration to private storage. To update API policies without redeploying the APIM service, use `update-policies.ps1`.

```powershell
.\scripts\export-client-config.ps1 -PrivateRoot $private
npm run build
node dist\src\run.js $private pilot
```

The pilot sends at most 32 requests. Verify usage capture, complete streams and rejection attribution, then freeze the quota before final measurements. Streaming always uses estimation and is not counted as separate estimation-on/off conditions.

Final runs require a clean committed worktree. Requests are never automatically retried. Missing usage or backend errors are retained and stop the run rather than being reported as successful evidence.

```powershell
node dist\src\run.js $private control
node dist\src\run.js $private quota
node dist\src\run.js $private rate
node dist\src\report.js $private $controlRunId $quotaRunId $rateRunId
```

The registered matrix has 18 controls, 45 quota trials and 9 rate-limit trials. A trial sends at most 64 requests, with concurrency capped at 8. Persistent reservations enforce overall limits of 4,000 requests, 2,000,000 estimated tokens and an estimated budget of JPY 10,000.

Raw bodies and headers remain private. The report exports allowlisted JSONL, CSV and SVG files under `results`. HTTP 403/429 alone does not prove an APIM rejection. Zero backend consumption requires the token-policy identifier and evidence of rejection before backend forwarding.

Client-supplied counter keys isolate experimental trials; this is not a production per-user quota design. Production counters should be derived from authenticated identity.

After preserving the evidence, explicitly confirm and delete the dedicated group.

```powershell
.\scripts\remove-lab.ps1 -PrivateRoot $private -ConfirmResourceGroup $dedicatedGroupName
```

## Reference

The [official policy reference](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy) documents tier support, estimation, streaming and concurrency. Periodic quota rejections (403) and token rate-limit rejections (429) are analyzed separately.

Japanese prose is reviewed with [yomiyasu](https://github.com/nanaism/yomiyasu), pinned to `23e16634357f3361cf3ea1cacf2684aa3d9f182f`.
