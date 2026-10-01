import { randomUUID } from "node:crypto";
import type { RequestRecord, RequestSpec, Scenario } from "./types.js";

export interface TrialResult {
  trialId: string;
  scenario: Scenario;
  repetition: number;
  attempt: number;
  valid: boolean;
  invalidReasons: string[];
  stoppedBy: "limit" | "request_cap" | "invalid_response";
  records: RequestRecord[];
}

export async function runTrial(options: {
  experimentId: string;
  scenario: Scenario;
  repetition: number;
  attempt: number;
  reserve: (count: number) => void;
  call: (spec: RequestSpec) => Promise<RequestRecord>;
  save: (record: RequestRecord) => void;
}): Promise<TrialResult> {
  const { scenario } = options;
  if (!Number.isInteger(scenario.concurrency) || scenario.concurrency < 1 || scenario.concurrency > 8 ||
      !Number.isInteger(scenario.maxRequests) || scenario.maxRequests < 1 || scenario.maxRequests > 64) {
    throw new Error("Invalid bounded trial configuration");
  }
  const trialId = randomUUID();
  const counter = `${options.experimentId.slice(0, 8)}-${scenario.id}-r${options.repetition}-u1-${trialId}`;
  if (!/^[a-z0-9-]{8,80}$/.test(counter)) throw new Error("Invalid experiment counter");
  const records: RequestRecord[] = [];
  const invalidReasons: string[] = [];
  let stoppedBy: TrialResult["stoppedBy"] = "request_cap";
  let sequence = 0;
  let wave = 0;
  let probe = false;
  for (;;) {
    const remaining = scenario.maxRequests - sequence;
    if (remaining <= 0) break;
    const count = probe ? 1 : Math.min(scenario.concurrency, remaining);
    options.reserve(count);
    wave++;
    const batch = await Promise.all(Array.from({ length: count }, async () => {
      const spec: RequestSpec = {
        experimentId: options.experimentId, trialId, counter,
        sequence: ++sequence, wave, probe, scenario,
      };
      const record = await options.call(spec);
      options.save(record);
      return record;
    }));
    records.push(...batch);
    for (const record of batch) {
      if (record.errorKind) invalidReasons.push(record.errorKind);
      if (record.origin === "backend" && record.status !== 200) invalidReasons.push(`backend_${record.status}`);
      if (record.origin === "unknown" || record.origin === "apim-other") invalidReasons.push(`origin_${record.origin}`);
    }
    if (invalidReasons.length) { stoppedBy = "invalid_response"; break; }
    if (probe) break;
    if (batch.some(record => record.origin === "apim-limit")) {
      stoppedBy = "limit";
      probe = true;
      continue;
    }
  }
  if (scenario.variant !== "baseline" && stoppedBy === "request_cap") invalidReasons.push("limit_not_observed");
  if (scenario.variant.startsWith("quota")) {
    const hours = new Set(records.flatMap(record => [
      record.startedAt.slice(0, 13),
      record.endedAt.slice(0, 13),
      new Date(Date.parse(record.startedAt) + record.elapsedMs).toISOString().slice(0, 13),
    ]));
    if (hours.size > 1) invalidReasons.push("quota_window_boundary");
    const last = records.at(-1);
    if (stoppedBy === "limit" && (!last?.probe || last.origin !== "apim-limit")) invalidReasons.push("post_limit_probe_not_rejected");
  }
  return { trialId, scenario, repetition: options.repetition, attempt: options.attempt,
    valid: invalidReasons.length === 0, invalidReasons: [...new Set(invalidReasons)], stoppedBy, records };
}

export function scenarios(profile: string): Scenario[] {
  const modes: { name: string; suffix: "off" | "on"; stream: boolean }[] = [
    { name: "normal-off", suffix: "off", stream: false },
    { name: "normal-on", suffix: "on", stream: false },
    { name: "stream", suffix: "on", stream: true },
  ];
  if (profile === "pilot") {
    return [
      { id: "pilot-normal", variant: "baseline", stream: false, concurrency: 1, maxRequests: 1, repetitions: 1 },
      { id: "pilot-baseline-stream", variant: "baseline", stream: true, concurrency: 1, maxRequests: 1, repetitions: 1 },
      ...modes.map(mode => ({ id: `pilot-${mode.name}`, variant: `quota-${mode.suffix}` as const,
        stream: mode.stream, concurrency: 1, maxRequests: 10, repetitions: 1 })),
    ];
  }
  if (profile === "quota") return modes.flatMap(mode => [1, 4, 8].map(concurrency => ({
    id: `quota-${mode.name}-c${concurrency}`, variant: `quota-${mode.suffix}` as const,
    stream: mode.stream, concurrency, maxRequests: 64, repetitions: 5,
  })));
  if (profile === "control") return [false, true].flatMap(stream => [1, 4, 8].map(concurrency => ({
    id: `control-${stream ? "stream" : "normal"}-c${concurrency}`, variant: "baseline" as const,
    stream, concurrency, maxRequests: concurrency * 2, repetitions: 3,
  })));
  if (profile === "rate") return modes.map(mode => ({
    id: `rate-${mode.name}`, variant: `rate-${mode.suffix}` as const,
    stream: mode.stream, concurrency: 1, maxRequests: 64, repetitions: 3,
  }));
  throw new Error(`Unknown experiment profile: ${profile}`);
}
