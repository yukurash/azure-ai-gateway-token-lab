import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isObject } from "./types.js";
import { parseRecord, sanitize } from "./evidence.js";

const root = process.argv[2];
if (!root) throw new Error("Usage: node dist/src/export-pilots.js PRIVATE_ROOT");
const attempts = [];
const records = [];
for (const runId of readdirSync(path.join(root, "runs")).sort()) {
  const directory = path.join(root, "runs", runId);
  const manifestPath = path.join(directory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing run manifest: ${runId}`);
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isObject(manifest)) throw new Error("Invalid manifest");
  if (manifest.profile !== "pilot") continue;
  const requestFile = path.join(directory, "requests.jsonl");
  const rows = existsSync(requestFile) ? readFileSync(requestFile, "utf8").trim().split("\n").filter(Boolean)
    .map(line => sanitize(parseRecord(JSON.parse(line)))) : [];
  const trialFile = path.join(directory, "trials.jsonl");
  const trials = existsSync(trialFile) ? readFileSync(trialFile, "utf8").trim().split("\n").filter(Boolean).map(line => {
    const trial: unknown = JSON.parse(line);
    if (!isObject(trial) || !isObject(trial.scenario) || !Array.isArray(trial.invalidReasons) ||
        !trial.invalidReasons.every(reason => typeof reason === "string")) throw new Error("Invalid pilot trial");
    return { trialId: trial.trialId, scenarioId: trial.scenario.id, valid: trial.valid, invalidReasons: trial.invalidReasons };
  }) : [];
  records.push(...rows);
  attempts.push({
    experimentId: runId, createdAt: manifest.createdAt, sourceCommit: manifest.sourceCommit,
    dirty: manifest.dirty, quotaTokens: manifest.quotaTokens, requestCount: rows.length, trials,
  });
}
writeFileSync(path.resolve("results/pilot-attempts.json"), JSON.stringify(attempts, null, 2) + "\n");
writeFileSync(path.resolve("results/pilot-requests.jsonl"), records.map(record => JSON.stringify(record)).join("\n") + "\n");
console.log(`Exported ${attempts.length} pilot attempts and ${records.length} requests separately from final evidence.`);
