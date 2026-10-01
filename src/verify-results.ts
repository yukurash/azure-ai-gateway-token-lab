import { deepStrictEqual, ok } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aggregate, parseRecord, sanitize, summarize, type AggregateTrial } from "./evidence.js";
import { scenarios } from "./experiment.js";
import { isObject, nonnegativeInteger } from "./types.js";

const directory = path.resolve(process.argv[2] ?? "results");
function json(name: string): unknown {
  return JSON.parse(readFileSync(path.join(directory, name), "utf8"));
}
const input = readFileSync(path.join(directory, "requests.jsonl"), "utf8");
const records = input.trim().split(/\r?\n/).map(line => {
  const value: unknown = JSON.parse(line);
  ok(isObject(value), "Invalid public request");
  const record = sanitize(parseRecord({ ...value, rawBody: "", rawHeaders: {}, retryAfter: null }));
  deepStrictEqual(value, record, "Unexpected or missing public request fields");
  return record;
});
const manifests = json("manifests.json");
const trials = json("trials.json");
ok(Array.isArray(manifests) && Array.isArray(trials), "Invalid report containers");
const verified = new Map<string, AggregateTrial>();
const seen = new Set<string>();
const seenProfiles = new Set<string>();
let expectedTrials = 0;
for (const manifest of manifests) {
  ok(isObject(manifest) && typeof manifest.profile === "string" &&
    typeof manifest.experimentId === "string" && nonnegativeInteger(manifest.quotaTokens), "Invalid manifest");
  ok(!seenProfiles.has(manifest.profile), "Duplicate profile");
  seenProfiles.add(manifest.profile);
  const matrix = scenarios(manifest.profile);
  deepStrictEqual(manifest.scenarios, matrix);
  expectedTrials += matrix.reduce((sum, scenario) => sum + scenario.repetitions, 0);
  for (const scenario of matrix) {
    for (let repetition = 1; repetition <= scenario.repetitions; repetition++) {
      const matches: Record<string, unknown>[] = trials.filter(trial => isObject(trial) && trial.profile === manifest.profile &&
        trial.scenarioId === scenario.id && trial.repetition === repetition);
      ok(matches.length === 1 && isObject(matches[0]), "Missing or duplicated trial");
      const trial = matches[0];
      ok(typeof trial.trialId === "string" && typeof trial.valid === "boolean", "Invalid trial");
      ok(!seen.has(trial.trialId), "Duplicate trial ID");
      seen.add(trial.trialId);
      const requests = records.filter(record => record.trialId === trial.trialId).sort((a, b) => a.sequence - b.sequence);
      ok(requests.length > 0 && requests.length === trial.requestCount && requests.length <= scenario.maxRequests);
      ok(requests.every((record, index) => record.sequence === index + 1 &&
        record.experimentId === manifest.experimentId && record.scenarioId === scenario.id &&
        record.variant === scenario.variant && record.stream === scenario.stream && record.concurrency === scenario.concurrency));
      const metrics = summarize(requests, manifest.quotaTokens);
      const expected: ReturnType<typeof summarize> = {
        ...metrics, overshoot: manifest.profile === "quota" ? metrics.overshoot : null,
        overshootRatio: manifest.profile === "quota" ? metrics.overshootRatio : null,
      };
      for (const [key, value] of Object.entries(expected)) deepStrictEqual(trial[key], value, `Trial metric mismatch: ${key}`);
      ok(!trial.valid || metrics.complete, "Invalid usage cannot form a valid trial");
      if (trial.valid && manifest.profile === "quota") {
        ok(requests.at(-1)?.probe && requests.at(-1)?.origin === "apim-limit", "Missing rejected post-limit probe");
        const hours = new Set(requests.flatMap(record => [record.startedAt.slice(0, 13), record.endedAt.slice(0, 13)]));
        ok(hours.size === 1, "Valid trial crossed a quota boundary");
      }
      verified.set(trial.trialId, { scenarioId: scenario.id, profile: manifest.profile, valid: trial.valid,
        totalTokens: metrics.totalTokens, overshoot: expected.overshoot });
    }
  }
}
ok(trials.length === expectedTrials && records.every(record => seen.has(record.trialId)), "Orphan evidence");
const ordered = trials.map(trial => {
  ok(isObject(trial) && typeof trial.trialId === "string");
  const item = verified.get(trial.trialId);
  ok(item);
  return item;
});
deepStrictEqual(aggregate(records, ordered, input), json("summary.json"), "Summary is not reproducible");
console.log(`Verified ${records.length} requests and ${trials.length} trials using public data only.`);
