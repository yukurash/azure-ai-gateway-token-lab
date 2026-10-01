import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseRecord, sanitize, summarize } from "./evidence.js";
import { isObject, type PublicRecord } from "./types.js";
import { scenarios } from "./experiment.js";

function json(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function lines(file: string): unknown[] {
  return readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid manifest string");
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid manifest integer");
  return value;
}
function median(values: number[]): number {
  if (!values.length) throw new Error("Cannot summarize an empty group");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const [privateRoot, ...runIds] = process.argv.slice(2);
if (!privateRoot || !runIds.length) throw new Error("Usage: node dist/src/report.js PRIVATE_ROOT RUN_ID...");
if (new Set(runIds).size !== runIds.length) throw new Error("Duplicate run identifier");
const output = path.resolve("results");
mkdirSync(output, { recursive: true });
const allRecords: PublicRecord[] = [];
const trials: {
  trialId: string; scenarioId: string; profile: string; repetition: number; valid: boolean;
  invalidReasons: string[]; concurrency: number; stream: boolean; requestCount: number;
  totalTokens: number | null; observedTokens: number; overshoot: number | null; overshootRatio: number | null;
  accepted: number; rejected: number; complete: boolean; peakStartSkewMs: number;
  requestsThroughFirstRejectedWave: number | null; firstRejectionMs: number | null;
  medianLatencyMs: number; medianFirstEventMs: number | null;
}[] = [];
const manifests: Record<string, unknown>[] = [];
const profiles = new Set<string>();
for (const runId of runIds) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Invalid run identifier");
  const directory = path.join(privateRoot, "runs", runId);
  const manifest = json(path.join(directory, "manifest.json"));
  const completion = json(path.join(directory, "completion.json"));
  if (!isObject(manifest) || manifest.dirty !== false || !isObject(completion) || completion.completed !== true) {
    throw new Error("Only completed runs from clean source revisions can form the primary report");
  }
  const profile = text(manifest.profile);
  if (profile === "pilot") throw new Error("Pilot data is not final evidence");
  if (profiles.has(profile)) throw new Error("Only one completed run per profile belongs in a primary report");
  profiles.add(profile);
  const expected = scenarios(profile);
  const quota = positive(manifest.quotaTokens);
  if (typeof manifest.restrictClientIp !== "boolean") throw new Error("Missing network configuration");
  const records = lines(path.join(directory, "requests.jsonl")).map(parseRecord).map(sanitize);
  if (records.some(record => record.experimentId !== runId)) throw new Error("Experiment ID mismatch");
  allRecords.push(...records);
  const summaries = lines(path.join(directory, "trials.jsonl"));
  if (summaries.length !== expected.reduce((sum, scenario) => sum + scenario.repetitions, 0)) {
    throw new Error("Final trial count does not match the registered matrix");
  }
  const seen = new Set<string>();
  const seenTrials = new Set<string>();
  for (const summary of summaries) {
    if (!isObject(summary) || !isObject(summary.scenario) || !Array.isArray(summary.invalidReasons) ||
        typeof summary.valid !== "boolean") throw new Error("Invalid trial summary");
    const scenarioId = text(summary.scenario.id);
    const registered = expected.find(scenario => scenario.id === scenarioId);
    if (!registered) throw new Error("Unexpected scenario");
    const repetition = positive(summary.repetition);
    const key = `${scenarioId}:${repetition}`;
    if (seen.has(key) || repetition > registered.repetitions) throw new Error("Duplicate or out-of-range repetition");
    seen.add(key);
    const trialId = text(summary.trialId);
    if (seenTrials.has(trialId)) throw new Error("Duplicate trial ID");
    seenTrials.add(trialId);
    const requests = records.filter(record => record.trialId === trialId).sort((a, b) => a.sequence - b.sequence);
    if (requests.length !== positive(summary.requestCount)) throw new Error("Trial request count mismatch");
    if (requests.some(record => record.scenarioId !== scenarioId || record.variant !== registered.variant ||
        record.concurrency !== registered.concurrency || record.stream !== registered.stream)) {
      throw new Error("Request scenario mismatch");
    }
    const sequences = new Set(requests.map(record => record.sequence));
    if (sequences.size !== requests.length) throw new Error("Duplicate request sequence");
    const metrics = summarize(requests, quota);
    const waves = [...new Set(requests.map(record => record.wave))];
    const skews = waves.map(wave => {
      const starts = requests.filter(record => record.wave === wave).map(record => Date.parse(record.startedAt));
      return Math.max(...starts) - Math.min(...starts);
    });
    const origin = Math.min(...requests.map(record => Date.parse(record.startedAt)));
    const rejections = requests.filter(record => record.origin === "apim-limit")
      .sort((a, b) => Date.parse(a.startedAt) + a.elapsedMs - Date.parse(b.startedAt) - b.elapsedMs);
    const firstRejection = rejections[0];
    const firstEvents = requests.flatMap(record => record.firstEventMs === null ? [] : [record.firstEventMs]);
    trials.push({
      trialId, scenarioId, profile, repetition,
      valid: summary.valid && metrics.complete, invalidReasons: summary.invalidReasons.map(text),
      concurrency: registered.concurrency, stream: registered.stream,
      requestCount: requests.length, ...metrics,
      overshoot: profile === "quota" ? metrics.overshoot : null,
      overshootRatio: profile === "quota" ? metrics.overshootRatio : null,
      peakStartSkewMs: Math.max(...skews),
      requestsThroughFirstRejectedWave: firstRejection ?
        requests.filter(record => record.wave <= firstRejection.wave).length : null,
      firstRejectionMs: firstRejection ? Date.parse(firstRejection.startedAt) + firstRejection.elapsedMs - origin : null,
      medianLatencyMs: median(requests.map(record => record.elapsedMs)),
      medianFirstEventMs: firstEvents.length ? median(firstEvents) : null,
    });
  }
  if (records.some(record => !seenTrials.has(record.trialId))) throw new Error("Orphan request evidence");
  manifests.push({
    schemaVersion: 1, experimentId: runId, profile, createdAt: text(manifest.createdAt),
    sourceCommit: text(manifest.sourceCommit), model: text(manifest.model),
    modelVersion: text(manifest.modelVersion), region: text(manifest.region),
    gateway: text(manifest.gateway), apiVersion: text(manifest.apiVersion),
    quotaTokens: quota, rateTokens: positive(manifest.rateTokens), restrictClientIp: manifest.restrictClientIp,
    scenarios: expected,
  });
}
const groups = [...new Set(trials.filter(trial => trial.profile === "quota").map(trial => trial.scenarioId))].map(scenarioId => {
  const group = trials.filter(trial => trial.scenarioId === scenarioId);
  const valid = group.filter(trial => trial.valid && trial.overshoot !== null);
  const overshoots = valid.map(trial => trial.overshoot!);
  return {
    scenarioId, trials: group.length, validTrials: valid.length,
    medianOvershoot: overshoots.length ? median(overshoots) : null,
    maxOvershoot: overshoots.length ? Math.max(...overshoots) : null,
    overshootTrials: overshoots.filter(value => value > 0).length,
    tokens: valid.map(trial => trial.totalTokens),
  };
});
const requestsJsonl = allRecords.map(record => JSON.stringify(record)).join("\n") + "\n";
writeFileSync(path.join(output, "requests.jsonl"), requestsJsonl);
writeFileSync(path.join(output, "trials.json"), JSON.stringify(trials, null, 2) + "\n");
writeFileSync(path.join(output, "manifests.json"), JSON.stringify(manifests, null, 2) + "\n");
const summary = {
  schemaVersion: 1, requestCount: allRecords.length, trialCount: trials.length,
  validTrials: trials.filter(trial => trial.valid).length,
  observedTokens: allRecords.reduce((sum, record) => sum + (record.usage?.total ?? 0), 0),
  missingUsage: allRecords.filter(record => !record.usage && !record.rejectedBeforeBackend).length,
  evidenceSha256: createHash("sha256").update(requestsJsonl).digest("hex"),
  groups,
};
writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const columns = ["scenarioId", "repetition", "valid", "requestCount", "totalTokens", "overshoot", "peakStartSkewMs"] as const;
writeFileSync(path.join(output, "trials.csv"), [
  columns.join(","),
  ...trials.map(trial => columns.map(column => trial[column] ?? "").join(",")),
].join("\n") + "\n");

const maximum = Math.max(10, ...groups.map(group => group.maxOvershoot ?? 0));
const width = 920;
const height = 110 + groups.length * 55;
const elements = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  '<rect width="100%" height="100%" fill="white"/>',
  '<g font-family="sans-serif" font-size="14" fill="#172033">',
  '<text x="24" y="28" font-size="20">Observed quota overshoot (tokens)</text>',
  '<text x="24" y="51">Each point is one independent counter trial; no missing values are imputed.</text>',
];
for (let index = 0; index < groups.length; index++) {
  const group = groups[index]!;
  const y = 88 + index * 55;
  elements.push(`<text x="24" y="${y + 5}">${group.scenarioId}</text>`);
  elements.push(`<line x1="290" y1="${y}" x2="820" y2="${y}" stroke="#d7dce3"/>`);
  const values = trials.filter(trial => trial.scenarioId === group.scenarioId && trial.valid && trial.overshoot !== null);
  values.forEach((trial, point) => {
    const x = 290 + trial.overshoot! / maximum * 530;
    elements.push(`<circle cx="${x.toFixed(1)}" cy="${y - 8 + point * 4}" r="4" fill="#2463b4" fill-opacity="0.75"/>`);
  });
  elements.push(`<text x="835" y="${y + 5}">n=${values.length}</text>`);
}
elements.push(`<text x="287" y="${height - 12}">0</text><text x="780" y="${height - 12}">${maximum}</text></g></svg>`);
writeFileSync(path.join(output, "quota-overshoot.svg"), elements.join("\n") + "\n");
const selected = trials.filter(trial => trial.profile === "quota" && trial.concurrency === 8 &&
  trial.repetition === 1 && trial.valid);
if (selected.length) {
  const panels = selected.map(trial => {
    const requests = allRecords.filter(record => record.trialId === trial.trialId);
    const start = Math.min(...requests.map(record => Date.parse(record.startedAt)));
    return {
      trial,
      events: requests.map(record => ({ record, time: Date.parse(record.startedAt) + record.elapsedMs - start }))
        .sort((a, b) => a.time - b.time),
    };
  });
  const maxTime = Math.max(1, ...panels.flatMap(panel => panel.events.map(event => event.time)));
  const maxTokens = Math.max(1, ...selected.map(trial => trial.totalTokens ?? 0),
    ...manifests.map(manifest => positive(manifest.quotaTokens))) * 1.1;
  const figure = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="940" height="${90 + panels.length * 220}">`,
    '<rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="13">',
    '<text x="25" y="28" font-size="20">Cumulative provider usage, concurrency 8</text>',
    '<text x="25" y="49">First repetition of each mode. Blue: completed usage; red: APIM rejection; dashed: quota.</text>',
  ];
  panels.forEach((panel, index) => {
    const top = 85 + index * 220;
    const bottom = top + 145;
    const x = (time: number): number => 100 + time / maxTime * 780;
    const y = (tokens: number): number => bottom - tokens / maxTokens * 135;
    const manifest = manifests.find(item => item.profile === "quota")!;
    const quota = positive(manifest.quotaTokens);
    figure.push(`<text x="25" y="${top - 12}">${panel.trial.scenarioId}</text>`);
    figure.push(`<line x1="100" y1="${bottom}" x2="880" y2="${bottom}" stroke="#555"/>`);
    figure.push(`<line x1="100" y1="${y(quota)}" x2="880" y2="${y(quota)}" stroke="#777" stroke-dasharray="5 4"/>`);
    figure.push(`<text x="25" y="${y(quota) + 4}">${quota}</text>`);
    let cumulative = 0;
    const points = [`100,${bottom}`];
    for (const event of panel.events) {
      points.push(`${x(event.time)},${y(cumulative)}`);
      cumulative += event.record.usage?.total ?? 0;
      points.push(`${x(event.time)},${y(cumulative)}`);
      if (event.record.origin === "apim-limit") {
        figure.push(`<circle cx="${x(event.time)}" cy="${y(cumulative)}" r="5" fill="#be3434"/>`);
      }
    }
    figure.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#2463b4" stroke-width="2"/>`);
    figure.push(`<text x="95" y="${bottom + 20}">0</text><text x="745" y="${bottom + 20}">${(maxTime / 1000).toFixed(2)} seconds</text>`);
  });
  figure.push("</g></svg>");
  writeFileSync(path.join(output, "quota-timeline.svg"), figure.join("\n") + "\n");
}
console.log(JSON.stringify(summary, null, 2));
