export interface Limits {
  requests: number;
  estimatedTokens: number;
  estimatedYen: number;
}

export function assertLimits(limits: Limits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid ${key} budget`);
    }
  }
  if (limits.requests > 4000 || limits.estimatedTokens > 2_000_000 ||
      limits.estimatedYen >= 10_000) {
    throw new Error("Experiment budget requires user confirmation");
  }
}
