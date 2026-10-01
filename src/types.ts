export type Variant = "baseline" | "quota-off" | "quota-on" | "rate-off" | "rate-on";
export type Origin = "backend" | "apim-limit" | "apim-other" | "input" | "transport" | "unknown";
export interface Usage { prompt: number; completion: number; total: number }
export interface Scenario {
  id: string;
  variant: Variant;
  stream: boolean;
  concurrency: number;
  maxRequests: number;
  repetitions: number;
}
export interface RequestSpec {
  experimentId: string;
  trialId: string;
  counter: string;
  sequence: number;
  wave: number;
  probe: boolean;
  scenario: Scenario;
}
export interface RequestRecord {
  experimentId: string;
  trialId: string;
  sequence: number;
  wave: number;
  probe: boolean;
  scenarioId: string;
  variant: Variant;
  stream: boolean;
  concurrency: number;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  firstEventMs: number | null;
  status: number | null;
  origin: Origin;
  rejectedBeforeBackend: boolean;
  usage: Usage | null;
  apimRemaining: number | null;
  apimConsumed: number | null;
  retryAfter: string | null;
  retryAfterSeconds: number | null;
  errorKind: string | null;
  rawBody: string;
  rawHeaders: Record<string, string>;
}
export type PublicRecord = Omit<RequestRecord, "rawBody" | "rawHeaders" | "retryAfter">;
export interface Config {
  restrictClientIp: boolean;
  gatewayUrl: string;
  subscriptionKey: string;
  apiVersion: string;
  createdAt: string;
  quotaTokens: number;
  rateTokens: number;
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function parseUsage(value: unknown): Usage | null {
  if (!isObject(value) || value.usage === null || value.usage === undefined) return null;
  const usage = value.usage;
  if (!isObject(usage) || !nonnegativeInteger(usage.prompt_tokens) ||
      !nonnegativeInteger(usage.completion_tokens) || !nonnegativeInteger(usage.total_tokens) ||
      usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens) {
    throw new Error("invalid_usage");
  }
  return { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens };
}
