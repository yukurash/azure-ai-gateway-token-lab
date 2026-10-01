import { describe, expect, it } from "vitest";
import { runTrial, scenarios } from "../src/experiment.js";
import { recordFor } from "./fixtures.js";
import type { Scenario } from "../src/types.js";
const scenario: Scenario = {
  id: "quota-test", variant: "quota-on", stream: false, concurrency: 4, maxRequests: 16, repetitions: 1,
};

describe("bounded experiment", () => {
  it("drains the active wave, stops scheduling, and sends one sequential probe", async () => {
    let active = 0;
    let peak = 0;
    let reserved = 0;
    const saved: number[] = [];
    const trial = await runTrial({
      experimentId: "test", scenario, repetition: 1, attempt: 1,
      reserve: count => { reserved += count; },
      call: async spec => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 3));
        active--;
        return recordFor(spec, spec.sequence >= 3);
      },
      save: record => saved.push(record.sequence),
    });
    expect(peak).toBe(4);
    expect(reserved).toBe(5);
    expect(saved).toHaveLength(5);
    expect(trial.records.at(-1)?.probe).toBe(true);
    expect(trial.valid).toBe(true);
  });
  it("retains upstream failures as invalid trials", async () => {
    const trial = await runTrial({
      experimentId: "test", scenario, repetition: 1, attempt: 1, reserve: () => {},
      call: async spec => ({ ...recordFor(spec), status: 429, errorKind: "http_error" }), save: () => {},
    });
    expect(trial.valid).toBe(false);
    expect(trial.invalidReasons).toContain("backend_429");
    expect(trial.records).toHaveLength(4);
  });
  it("fails rather than silently accepting a quota that never rejects", async () => {
    const trial = await runTrial({
      experimentId: "test", scenario: { ...scenario, maxRequests: 4 }, repetition: 1, attempt: 1,
      reserve: () => {}, call: async spec => recordFor(spec), save: () => {},
    });
    expect(trial.invalidReasons).toContain("limit_not_observed");
  });
  it("does not send a request when reservation fails", async () => {
    let called = false;
    await expect(runTrial({
      experimentId: "test", scenario, repetition: 1, attempt: 1,
      reserve: () => { throw new Error("budget exceeded"); },
      call: async spec => { called = true; return recordFor(spec); }, save: () => {},
    })).rejects.toThrow("budget exceeded");
    expect(called).toBe(false);
  });
  it("invalidates a request whose response crosses the hourly quota boundary", async () => {
    const trial = await runTrial({
      experimentId: "test", scenario: { ...scenario, concurrency: 1 }, repetition: 1, attempt: 1,
      reserve: () => {},
      call: async spec => ({
        ...recordFor(spec, true), startedAt: "2026-01-01T00:59:59.900Z",
        endedAt: "2026-01-01T01:00:00.100Z", elapsedMs: 200,
      }),
      save: () => {},
    });
    expect(trial.invalidReasons).toContain("quota_window_boundary");
  });
  it("matches the approved matrix and pilot cap", () => {
    expect(scenarios("quota").reduce((sum, item) => sum + item.repetitions, 0)).toBe(45);
    expect(scenarios("control").reduce((sum, item) => sum + item.repetitions, 0)).toBe(18);
    expect(scenarios("rate").reduce((sum, item) => sum + item.repetitions, 0)).toBe(9);
    expect(scenarios("pilot").reduce((sum, item) => sum + item.maxRequests, 0)).toBe(32);
    expect(new Set(scenarios("pilot").map(item => item.id)).size).toBe(scenarios("pilot").length);
    expect(() => scenarios("typo")).toThrow("Unknown");
  });
});
