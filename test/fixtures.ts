import type { RequestRecord, RequestSpec } from "../src/types.js";

export function recordFor(spec: RequestSpec, rejected = false): RequestRecord {
  return {
    experimentId: spec.experimentId, trialId: spec.trialId, sequence: spec.sequence, wave: spec.wave,
    probe: spec.probe, scenarioId: spec.scenario.id, variant: spec.scenario.variant,
    stream: spec.scenario.stream, concurrency: spec.scenario.concurrency,
    startedAt: "2026-01-01T00:10:00.000Z", endedAt: "2026-01-01T00:10:00.010Z", elapsedMs: 10, firstEventMs: null,
    status: rejected ? 403 : 200, origin: rejected ? "apim-limit" : "backend",
    rejectedBeforeBackend: rejected, usage: rejected ? null : { prompt: 2, completion: 3, total: 5 },
    apimRemaining: 5, apimConsumed: 5, retryAfter: null, retryAfterSeconds: null, errorKind: null, rawBody: "", rawHeaders: {},
  };
}
