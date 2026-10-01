import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scenarios } from "../src/experiment.js";
import { recordFor } from "./fixtures.js";

const cli = path.resolve("dist/src/report.js");
const verifyCli = path.resolve("dist/src/verify-results.js");
const temporary: string[] = [];
function fixture(): { root: string; privateRoot: string; runId: string; run: string } {
  const root = mkdtempSync(path.join(tmpdir(), "token-lab-test-"));
  temporary.push(root);
  const privateRoot = path.join(root, "private");
  const runId = "00000000-0000-0000-0000-000000000001";
  const run = path.join(privateRoot, "runs", runId);
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, "manifest.json"), JSON.stringify({
    dirty: false, restrictClientIp: true, profile: "control", createdAt: "2026-01-01T00:00:00.000Z",
    sourceCommit: "a".repeat(40), model: "test-model", modelVersion: "test-version",
    region: "test-region", gateway: "test-tier", apiVersion: "test-version",
    quotaTokens: 1200, rateTokens: 1200, privateField: "must-not-be-exported",
  }));
  writeFileSync(path.join(run, "completion.json"), JSON.stringify({ completed: true }));
  const requests = [];
  const trials = [];
  for (const scenario of scenarios("control")) {
    for (let repetition = 1; repetition <= scenario.repetitions; repetition++) {
      const trialId = `${scenario.id}-${repetition}`;
      requests.push({
        ...recordFor({ experimentId: runId, trialId, counter: trialId,
          sequence: 1, wave: 1, probe: false, scenario }),
        rawBody: "private-body", rawHeaders: { authorization: "private-key" },
      });
      trials.push({ trialId, scenario, repetition, requestCount: 1, valid: true, invalidReasons: [] });
    }
  }
  writeFileSync(path.join(run, "requests.jsonl"), requests.map(item => JSON.stringify(item)).join("\n"));
  writeFileSync(path.join(run, "trials.jsonl"), trials.map(item => JSON.stringify(item)).join("\n"));
  return { root, privateRoot, runId, run };
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true });
});
describe("compiled reporting CLI", () => {
  it("reproducibly exports the entire registered profile without private fields", () => {
    const data = fixture();
    const execute = (): string => execFileSync(process.execPath, [cli, data.privateRoot, data.runId],
      { cwd: data.root, encoding: "utf8" });
    const first = execute();
    expect(execute()).toBe(first);
    const summary = JSON.parse(first);
    expect(summary.trialCount).toBe(18);
    expect(summary.observedTokens).toBe(90);
    expect(summary.missingUsage).toBe(0);
    expect(execFileSync(process.execPath, [verifyCli], { cwd: data.root, encoding: "utf8" }))
      .toContain("18 requests and 18 trials");
    for (const name of ["requests.jsonl", "manifests.json", "trials.json", "trials.csv", "quota-overshoot.svg"]) {
      expect(readFileSync(path.join(data.root, "results", name), "utf8")).not.toMatch(/private-body|private-key|must-not-be-exported/);
    }
  });
  it("rejects incomplete and duplicate primary evidence", () => {
    const data = fixture();
    expect(() => execFileSync(process.execPath, [cli, data.privateRoot, data.runId, data.runId],
      { cwd: data.root, stdio: "pipe" })).toThrow();
    writeFileSync(path.join(data.run, "trials.jsonl"), "");
    expect(() => execFileSync(process.execPath, [cli, data.privateRoot, data.runId],
      { cwd: data.root, stdio: "pipe" })).toThrow();
  });
  it("rejects a modified public aggregate", () => {
    const data = fixture();
    execFileSync(process.execPath, [cli, data.privateRoot, data.runId], { cwd: data.root, stdio: "pipe" });
    const file = path.join(data.root, "results", "summary.json");
    const summary = JSON.parse(readFileSync(file, "utf8"));
    summary.observedTokens++;
    writeFileSync(file, JSON.stringify(summary));
    expect(() => execFileSync(process.execPath, [verifyCli], { cwd: data.root, stdio: "pipe" })).toThrow();
  });
  it("exports deletion and cost evidence with timezone-safe elapsed hours", () => {
    const data = fixture();
    mkdirSync(path.join(data.privateRoot, "config"));
    mkdirSync(path.join(data.root, "results"));
    writeFileSync(path.join(data.privateRoot, "config", "azure-state.json"),
      JSON.stringify({ createdAt: "2026-01-01T08:00:00Z", subscriptionId: "private-identifier" }));
    writeFileSync(path.join(data.privateRoot, "config", "cleanup-verification.json"),
      JSON.stringify({ deleted: true, verifiedAt: "2026-01-01T22:00:00+09:00" }));
    const output = execFileSync(process.execPath, [path.resolve("dist/src/export-operations.js"), data.privateRoot],
      { cwd: data.root, encoding: "utf8" });
    expect(JSON.parse(output).elapsedHoursThroughDeletionVerification).toBe(5);
    expect(JSON.parse(output).recordedRequestsIncludingPilots).toBe(18);
    expect(output).not.toContain("private-identifier");
  });
  it("keeps pilot attempts separate and strips raw credentials", () => {
    const data = fixture();
    mkdirSync(path.join(data.root, "results"));
    const manifestPath = path.join(data.run, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.profile = "pilot";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    execFileSync(process.execPath, [path.resolve("dist/src/export-pilots.js"), data.privateRoot],
      { cwd: data.root, stdio: "pipe" });
    const output = readFileSync(path.join(data.root, "results", "pilot-requests.jsonl"), "utf8");
    expect(output.trim().split("\n")).toHaveLength(18);
    expect(output).not.toMatch(/private-body|private-key/);
  });
});
