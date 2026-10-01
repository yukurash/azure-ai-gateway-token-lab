import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertLimits } from "./safety.js";
import { callModel, requestBody } from "./http.js";
import { runTrial, scenarios } from "./experiment.js";
import { isObject, nonnegativeInteger, type Config } from "./types.js";

function loadJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function configFrom(value: unknown): Config {
  if (!isObject(value) || typeof value.gatewayUrl !== "string" || !value.gatewayUrl.startsWith("https://") ||
      typeof value.subscriptionKey !== "string" || value.subscriptionKey.length < 16 ||
      typeof value.apiVersion !== "string" || typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) || !nonnegativeInteger(value.quotaTokens) ||
      value.quotaTokens === 0 || !nonnegativeInteger(value.rateTokens) || value.rateTokens === 0 ||
      typeof value.restrictClientIp !== "boolean") {
    throw new Error("Invalid private experiment configuration");
  }
  return { gatewayUrl: value.gatewayUrl, subscriptionKey: value.subscriptionKey,
    apiVersion: value.apiVersion, createdAt: value.createdAt,
    quotaTokens: value.quotaTokens, rateTokens: value.rateTokens, restrictClientIp: value.restrictClientIp };
}
const [privateArgument, profile] = process.argv.slice(2);
if (!privateArgument || !profile) throw new Error("Usage: node dist/src/run.js PRIVATE_ROOT pilot|control|quota|rate");
const root = path.resolve(privateArgument);
const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const relative = path.relative(repository, root);
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  throw new Error("Private experiment data must be outside the repository");
}
const matrix = scenarios(profile);
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (profile !== "pilot" && dirty) throw new Error("Measured runs require a clean committed worktree");
const config = configFrom(loadJson(path.join(root, "config", "client.json")));
if (profile !== "pilot") {
  const protocol = loadJson(path.join(repository, "experiments", "protocol.json"));
  if (!isObject(protocol) || protocol.status !== "frozen" ||
      protocol.quotaTokens !== config.quotaTokens || protocol.rateTokens !== config.rateTokens ||
      protocol.apiVersion !== config.apiVersion || protocol.restrictClientIp !== config.restrictClientIp ||
      protocol.maxTokens !== requestBody(false).max_tokens || protocol.temperature !== requestBody(false).temperature) {
    throw new Error("Private settings do not match the frozen experiment protocol");
  }
}
const runId = randomUUID();
const runDir = path.join(root, "runs", runId);
mkdirSync(runDir, { recursive: true });
const lockFile = path.join(root, "config", "runner.lock");
const lock = openSync(lockFile, "wx");
try {
  const ledgerFile = path.join(root, "config", "budget-ledger.json");
  let requests = 0;
  let estimatedTokens = 0;
  if (existsSync(ledgerFile)) {
    const existing = loadJson(ledgerFile);
    if (!isObject(existing) || !nonnegativeInteger(existing.requests) || !nonnegativeInteger(existing.estimatedTokens)) {
      throw new Error("Invalid budget ledger; refusing to reset it");
    }
    requests = existing.requests;
    estimatedTokens = existing.estimatedTokens;
  }
  const tokenBound = Buffer.byteLength(JSON.stringify(requestBody(true)), "utf8") + 128 + 128;
  const reserve = (count: number): void => {
    const nextRequests = requests + count;
    const nextTokens = estimatedTokens + count * tokenBound;
    const apimHours = Math.max(0, (Date.now() - Date.parse(config.createdAt)) / 3_600_000);
    const estimatedYen = 1000 + apimHours * 10.3668 + nextTokens / 1000 * 0.305;
    assertLimits({ requests: nextRequests, estimatedTokens: nextTokens, estimatedYen });
    writeFileSync(`${ledgerFile}.tmp`, JSON.stringify({ requests: nextRequests, estimatedTokens: nextTokens, estimatedYen }));
    renameSync(`${ledgerFile}.tmp`, ledgerFile);
    requests = nextRequests;
    estimatedTokens = nextTokens;
  };
  const manifest = {
    schemaVersion: 1, experimentId: runId, profile, createdAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dirty: Boolean(dirty), model: "gpt-4.1-mini", modelVersion: "2025-04-14",
    region: "japaneast", gateway: "Developer classic (1 unit)",
    apiVersion: config.apiVersion, quotaTokens: config.quotaTokens,
    rateTokens: config.rateTokens, restrictClientIp: config.restrictClientIp,
    request: requestBody(true), scenarios: matrix,
  };
  writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  let invalid = 0;
  for (let repetition = 1; repetition <= Math.max(...matrix.map(item => item.repetitions)); repetition++) {
    const ordered = repetition % 2 ? matrix : [...matrix].reverse();
    for (const scenario of ordered) {
      if (repetition > scenario.repetitions) continue;
      const result = await runTrial({
        experimentId: runId, scenario, repetition, attempt: 1, reserve,
        call: spec => callModel(config, spec),
        save: record => appendFileSync(path.join(runDir, "requests.jsonl"), `${JSON.stringify(record)}\n`),
      });
      const { records, ...summary } = result;
      appendFileSync(path.join(runDir, "trials.jsonl"), `${JSON.stringify({ ...summary, requestCount: records.length })}\n`);
      console.log(JSON.stringify({ trial: result.trialId, scenario: scenario.id, repetition,
        valid: result.valid, count: records.length, reason: result.invalidReasons }));
      if (!result.valid) {
        invalid++;
        if (profile === "pilot" || result.invalidReasons.some(reason => reason !== "quota_window_boundary")) {
          throw new Error(`Trial invalid (${result.invalidReasons.join(", ")}); inspect private evidence before continuing.`);
        }
      }
    }
  }
  writeFileSync(path.join(runDir, "completion.json"), JSON.stringify({ completed: true, invalidTrials: invalid }));
  console.log(`Saved private run: ${runId}`);
} catch (error) {
  writeFileSync(path.join(runDir, "completion.json"), JSON.stringify({
    completed: false, error: error instanceof Error ? error.message : String(error),
  }));
  console.error(error);
  console.error(`Saved incomplete private run: ${runId}`);
  process.exitCode = 1;
} finally {
  closeSync(lock);
  unlinkSync(lockFile);
}
