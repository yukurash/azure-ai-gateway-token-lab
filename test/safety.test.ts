import { describe, expect, it } from "vitest";
import { assertLimits } from "../src/safety.js";

describe("experiment budgets", () => {
  it("accepts bounded calls", () => {
    expect(() => assertLimits({ requests: 32, estimatedTokens: 8000, estimatedYen: 100 })).not.toThrow();
  });
  it.each([NaN, Infinity, -1])("rejects invalid values: %s", value => {
    expect(() => assertLimits({ requests: value, estimatedTokens: 0, estimatedYen: 0 })).toThrow();
  });
  it("stops before the confirmation threshold", () => {
    expect(() => assertLimits({ requests: 1, estimatedTokens: 100, estimatedYen: 10_000 })).toThrow();
  });
  it("caps requests regardless of monetary estimates", () => {
    expect(() => assertLimits({ requests: 4001, estimatedTokens: 100, estimatedYen: 1 })).toThrow();
  });
});
