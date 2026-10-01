import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scenarios } from "../src/experiment.js";
import { recordFor } from "./fixtures.js";

const cli = path.resolve("dist/src/report.js");
const temporary: string[] = [];
function fixture(): { root: string; privateRoot: string; runId: string; run: string } {
  const root = mkdtempSync(path.join(tmpdir(), "token-lab-test-"));
  temporary.push(root);
  const privateRoot = path.join(root, "private");
  const runId = "00000000-0000-0000-0000-000000000001";
  const run = path.join(privateRoot, "runs", runId);
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, "manifest.json"), JSON.stringify({
    dirty: false, profile: "control", createdAt: "2026-01-01T00:00:00.000Z",
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
});
