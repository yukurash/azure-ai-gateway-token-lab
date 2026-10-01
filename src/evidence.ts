import { isObject, nonnegativeInteger, type PublicRecord, type RequestRecord } from "./types.js";

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string in evidence");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number in evidence");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean in evidence");
  return value;
}
function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}
function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}
function member<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  if (!found) throw new Error("Unknown evidence enum");
  return found;
}
export function parseRecord(value: unknown): RequestRecord {
  if (!isObject(value)) throw new Error("Invalid evidence record");
  let usage: RequestRecord["usage"] = null;
  if (value.usage !== null) {
    if (!isObject(value.usage) || !nonnegativeInteger(value.usage.prompt) ||
        !nonnegativeInteger(value.usage.completion) || !nonnegativeInteger(value.usage.total) ||
        value.usage.total !== value.usage.prompt + value.usage.completion) throw new Error("Invalid usage evidence");
    usage = { prompt: value.usage.prompt, completion: value.usage.completion, total: value.usage.total };
  }
  if (!isObject(value.rawHeaders)) throw new Error("Invalid raw headers");
  const rawHeaders = Object.fromEntries(Object.entries(value.rawHeaders).map(([key, item]) => [key, string(item)]));
  const startedAt = string(value.startedAt);
  const endedAt = string(value.endedAt);
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt))) throw new Error("Invalid evidence timestamp");
  return {
    experimentId: string(value.experimentId), trialId: string(value.trialId), sequence: number(value.sequence),
    wave: number(value.wave), probe: boolean(value.probe), scenarioId: string(value.scenarioId),
    variant: member(value.variant, ["baseline", "quota-off", "quota-on", "rate-off", "rate-on"]),
    stream: boolean(value.stream), concurrency: number(value.concurrency), startedAt, endedAt,
    elapsedMs: number(value.elapsedMs), firstEventMs: nullableNumber(value.firstEventMs),
    status: nullableNumber(value.status),
    origin: member(value.origin, ["backend", "apim-limit", "apim-other", "input", "transport", "unknown"]),
    rejectedBeforeBackend: boolean(value.rejectedBeforeBackend), usage,
    apimRemaining: nullableNumber(value.apimRemaining), apimConsumed: nullableNumber(value.apimConsumed),
    retryAfter: nullableString(value.retryAfter), retryAfterSeconds: nullableNumber(value.retryAfterSeconds),
    errorKind: nullableString(value.errorKind),
    rawBody: string(value.rawBody), rawHeaders,
  };
}

export function sanitize(record: RequestRecord): PublicRecord {
  return {
    experimentId: record.experimentId, trialId: record.trialId, sequence: record.sequence,
    wave: record.wave, probe: record.probe, scenarioId: record.scenarioId,
    variant: record.variant, stream: record.stream, concurrency: record.concurrency,
    startedAt: record.startedAt, endedAt: record.endedAt, elapsedMs: record.elapsedMs, firstEventMs: record.firstEventMs,
    status: record.status, origin: record.origin, rejectedBeforeBackend: record.rejectedBeforeBackend,
    usage: record.usage ? { prompt: record.usage.prompt, completion: record.usage.completion, total: record.usage.total } : null,
    apimRemaining: record.apimRemaining, apimConsumed: record.apimConsumed,
    retryAfterSeconds: record.retryAfterSeconds, errorKind: record.errorKind,
  };
}

export function summarize(records: PublicRecord[], quota: number): {
  complete: boolean;
  observedTokens: number;
  totalTokens: number | null;
  overshoot: number | null;
  overshootRatio: number | null;
  accepted: number;
  rejected: number;
} {
  if (!Number.isSafeInteger(quota) || quota <= 0) throw new Error("Invalid quota");
  let observedTokens = 0;
  let complete = records.length > 0;
  for (const record of records) {
    if (record.errorKind) complete = false;
    if (record.usage) observedTokens += record.usage.total;
    else if (!(record.origin === "apim-limit" && record.rejectedBeforeBackend)) complete = false;
  }
  const overshoot = complete ? Math.max(0, observedTokens - quota) : null;
  return {
    complete, observedTokens, totalTokens: complete ? observedTokens : null,
    overshoot, overshootRatio: overshoot === null ? null : overshoot / quota,
    accepted: records.filter(record => record.status === 200).length,
    rejected: records.filter(record => record.origin === "apim-limit").length,
  };
}
