import { describe, expect, it } from "vitest";
import { parseRecord, sanitize, summarize } from "../src/evidence.js";
import { recordFor } from "./fixtures.js";
import type { RequestSpec } from "../src/types.js";

const spec: RequestSpec = {
  experimentId: "test", trialId: "test", counter: "counter-id", sequence: 1, wave: 1, probe: false,
  scenario: { id: "test", variant: "quota-on", stream: false, concurrency: 1, maxRequests: 1, repetitions: 1 },
};
describe("publication boundary", () => {
  it("exports only allowed fields, including nested usage", () => {
    const privateRecord = Object.assign(recordFor(spec), {
      rawBody: "private content", rawHeaders: { authorization: "private secret" }, secret: "unexpected field",
    });
    Object.assign(privateRecord.usage ?? {}, { credential: "nested secret" });
    const output = JSON.stringify(sanitize(privateRecord));
    expect(output).not.toMatch(/private|secret|credential|authorization|unexpected/);
  });
  it("does not convert missing usage into zero", () => {
    const result = summarize([sanitize({ ...recordFor(spec), usage: null })], 4);
    expect(result.complete).toBe(false);
    expect(result.totalTokens).toBeNull();
    expect(result.overshoot).toBeNull();
  });
  it("counts proven pre-backend rejections as zero consumption", () => {
    const result = summarize([sanitize(recordFor(spec)), sanitize(recordFor(spec, true))], 4);
    expect(result.totalTokens).toBe(5);
    expect(result.overshoot).toBe(1);
    expect(result.overshootRatio).toBe(0.25);
  });
  it("does not treat an empty experiment as complete", () => {
    expect(summarize([], 4).complete).toBe(false);
  });
  it("validates raw evidence instead of casting untrusted JSON", () => {
    expect(parseRecord(recordFor(spec))).toEqual(recordFor(spec));
    expect(() => parseRecord({ ...recordFor(spec), elapsedMs: "10" })).toThrow("finite number");
    expect(() => parseRecord({ ...recordFor(spec), usage: { prompt: 1, completion: 2, total: 4 } })).toThrow("usage");
    expect(() => parseRecord({ ...recordFor(spec), origin: "guessed" })).toThrow("enum");
  });
});
