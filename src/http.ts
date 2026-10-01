import { performance } from "node:perf_hooks";
import { SseParser } from "./sse.js";
import { isObject, parseUsage, type Config, type Origin, type RequestRecord, type RequestSpec, type Usage } from "./types.js";

export const prompt = "Write the integers from 1 to 80 in ascending order, separated by single spaces. Do not add an introduction, explanations, headings, or punctuation. Continue until you have written 80.";
export const outputLimit = 128;

export function requestBody(stream: boolean): Record<string, unknown> {
  return {
    messages: [
      { role: "system", content: "You follow formatting instructions exactly." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: outputLimit,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

export function classifyResponse(status: number, headers: Headers): { origin: Origin; rejectedBeforeBackend: boolean } {
  const source = headers.get("x-lab-origin");
  const limited = (status === 403 || status === 429) &&
    source === "apim-error" && headers.get("x-lab-error-policy") === "lab-token-limit";
  if (limited) {
    return {
      origin: "apim-limit",
      rejectedBeforeBackend: headers.get("x-lab-error-section") === "inbound" &&
        headers.get("x-lab-limit-passed")?.toLowerCase() === "false",
    };
  }
  return {
    origin: source === "backend" ? "backend" : source === "apim-error" ? "apim-other" :
      source === "input" ? "input" : "unknown",
    rejectedBeforeBackend: false,
  };
}

function numericHeader(headers: Headers, key: string): number | null {
  const value = headers.get(key);
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function callModel(config: Config, spec: RequestSpec, fetcher: typeof fetch = fetch): Promise<RequestRecord> {
  const start = performance.now();
  const record: RequestRecord = {
    experimentId: spec.experimentId, trialId: spec.trialId, sequence: spec.sequence,
    wave: spec.wave, probe: spec.probe, scenarioId: spec.scenario.id,
    variant: spec.scenario.variant, stream: spec.scenario.stream, concurrency: spec.scenario.concurrency,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), elapsedMs: 0, firstEventMs: null,
    status: null, origin: "unknown", rejectedBeforeBackend: false, usage: null,
    apimRemaining: null, apimConsumed: null, retryAfter: null, retryAfterSeconds: null, errorKind: null,
    rawBody: "", rawHeaders: {},
  };
  let stage = "request";
  try {
    const url = new URL(`/lab/${spec.scenario.variant}/chat/completions`, config.gatewayUrl);
    url.searchParams.set("api-version", config.apiVersion);
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": config.subscriptionKey,
        "x-lab-counter": spec.counter,
      },
      body: JSON.stringify(requestBody(spec.scenario.stream)),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    stage = "response";
    record.status = response.status;
    Object.assign(record, classifyResponse(response.status, response.headers));
    record.rawHeaders = Object.fromEntries(response.headers);
    record.apimRemaining = numericHeader(response.headers, "x-lab-remaining");
    record.apimConsumed = numericHeader(response.headers, "x-lab-consumed");
    record.retryAfter = response.headers.get("retry-after");
    record.retryAfterSeconds = numericHeader(response.headers, "retry-after");
    if (!response.ok) {
      record.rawBody = await response.text();
      if (!(record.origin === "apim-limit" && record.rejectedBeforeBackend)) record.errorKind = "http_error";
      return record;
    }
    if (!spec.scenario.stream) {
      record.rawBody = await response.text();
      record.usage = parseUsage(JSON.parse(record.rawBody));
    } else {
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new Error("invalid_sse_content_type");
      }
      let done = false;
      let usage: Usage | null = null;
      const parser = new SseParser(data => {
        if (record.firstEventMs === null) record.firstEventMs = performance.now() - start;
        if (data === "[DONE]") { done = true; return; }
        if (done) throw new Error("sse_data_after_done");
        const event: unknown = JSON.parse(data);
        if (isObject(event) && event.error !== undefined) throw new Error("sse_provider_error");
        const candidate = parseUsage(event);
        if (candidate) usage = candidate;
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let finished = false;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) { finished = true; break; }
          const text = decoder.decode(chunk.value, { stream: true });
          record.rawBody += text;
          parser.feed(text);
        }
        const tail = decoder.decode();
        record.rawBody += tail;
        parser.feed(tail, true);
      } finally {
        try {
          if (!finished) await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
      if (!done) throw new Error("sse_missing_done");
      record.usage = usage;
    }
    if (!record.usage) record.errorKind = "missing_usage";
    if (record.origin !== "backend") record.errorKind = "unclassified_success";
  } catch (error) {
    const knownErrors = new Set(["invalid_usage", "incomplete_sse_event", "invalid_sse_content_type",
      "sse_data_after_done", "sse_provider_error", "sse_missing_done"]);
    record.errorKind = error instanceof Error && knownErrors.has(error.message) ? error.message :
      error instanceof Error && error.name === "TimeoutError" ? "timeout" :
        stage === "request" ? "transport_error" : "response_decode_error";
    if (stage === "request") record.origin = "transport";
    record.rawBody += `\nLOCAL_ERROR: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    record.elapsedMs = performance.now() - start;
    record.endedAt = new Date().toISOString();
  }
  return record;
}
