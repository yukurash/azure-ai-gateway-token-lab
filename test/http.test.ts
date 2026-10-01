import { describe, expect, it } from "vitest";
import { callModel, classifyResponse } from "../src/http.js";
import type { Config, RequestSpec } from "../src/types.js";

const config: Config = {
  restrictClientIp: true,
  gatewayUrl: "https://example.invalid", subscriptionKey: "test-only-not-a-secret",
  apiVersion: "test", createdAt: "2026-01-01T00:00:00Z", quotaTokens: 1200, rateTokens: 1200,
};
const spec: RequestSpec = {
  experimentId: "test", trialId: "trial", counter: "test-counter", sequence: 1, wave: 1, probe: false,
  scenario: { id: "test", variant: "baseline", stream: true, concurrency: 1, maxRequests: 1, repetitions: 1 },
};
function mockResponse(body: BodyInit, headers: Record<string, string>, status = 200): typeof fetch {
  return async () => new Response(body, { headers, status });
}

describe("response attribution", () => {
  it("does not infer APIM rejection from status alone", () => {
    expect(classifyResponse(429, new Headers()).origin).toBe("unknown");
    expect(classifyResponse(429, new Headers({ "x-lab-origin": "backend" })).origin).toBe("backend");
  });
  it("requires evidence that rejection preceded the backend", () => {
    const headers = new Headers({
      "x-lab-origin": "apim-error", "x-lab-error-policy": "lab-token-limit",
      "x-lab-error-section": "inbound", "x-lab-limit-passed": "False",
    });
    expect(classifyResponse(403, headers)).toEqual({ origin: "apim-limit", rejectedBeforeBackend: true });
    headers.set("x-lab-limit-passed", "True");
    expect(classifyResponse(403, headers).rejectedBeforeBackend).toBe(false);
  });
});

describe("model response recording", () => {
  it("decodes UTF-8 split at every byte and captures the final SSE usage", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"日本語","usage":null}\r\n\r\ndata: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\r\n\r\ndata: [DONE]\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const record = await callModel(config, spec, mockResponse(body, {
      "content-type": "text/event-stream", "x-lab-origin": "backend",
    }));
    expect(record.usage?.total).toBe(5);
    expect(record.errorKind).toBeNull();
    expect(record.rawBody).toContain("日本語");
    expect(record.firstEventMs).not.toBeNull();
  });
  it("marks successful HTTP responses without usage as incomplete evidence", async () => {
    const record = await callModel(config, { ...spec, scenario: { ...spec.scenario, stream: false } },
      mockResponse('{"choices":[]}', { "x-lab-origin": "backend" }));
    expect(record.errorKind).toBe("missing_usage");
    expect(record.usage).toBeNull();
  });
  it("does not accept a stream missing DONE", async () => {
    const record = await callModel(config, spec, mockResponse('data: {"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      { "content-type": "text/event-stream", "x-lab-origin": "backend" }));
    expect(record.errorKind).toBe("sse_missing_done");
  });
  it("records transport errors without reporting success", async () => {
    const record = await callModel(config, spec, async () => { throw new Error("connection refused"); });
    expect(record.origin).toBe("transport");
    expect(record.status).toBeNull();
    expect(record.errorKind).toBe("transport_error");
  });
});
