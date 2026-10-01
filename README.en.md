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

## Reference

The [official policy reference](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy) documents tier support, estimation, streaming and concurrency. Periodic quota rejections (403) and token rate-limit rejections (429) are analyzed separately.

Japanese prose is reviewed with [yomiyasu](https://github.com/nanaism/yomiyasu), pinned to `23e16634357f3361cf3ea1cacf2684aa3d9f182f`.
