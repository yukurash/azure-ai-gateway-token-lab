import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isObject } from "./types.js";
import { parseRecord } from "./evidence.js";

const root = process.argv[2];
if (!root) throw new Error("Usage: node dist/src/export-operations.js PRIVATE_ROOT");
function config(name: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path.join(root!, "config", name), "utf8").replace(/^\uFEFF/, ""));
  if (!isObject(value)) throw new Error("Invalid private operational state");
  return value;
}
const state = config("azure-state.json");
const cleanup = config("cleanup-verification.json");
if (cleanup.deleted !== true || typeof cleanup.verifiedAt !== "string" || typeof state.createdAt !== "string") {
  throw new Error("Deletion has not been confirmed");
}
const hours = (Date.parse(cleanup.verifiedAt) - Date.parse(state.createdAt)) / 3_600_000;
if (!Number.isFinite(hours) || hours < 0) throw new Error("Invalid deployment duration");
const records = readdirSync(path.join(root, "runs")).flatMap(runId => {
  const file = path.join(root, "runs", runId, "requests.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
    .map(line => parseRecord(JSON.parse(line))) : [];
});
const input = records.reduce((sum, record) => sum + (record.usage?.prompt ?? 0), 0);
const output = records.reduce((sum, record) => sum + (record.usage?.completion ?? 0), 0);
const modelEstimate = input / 1000 * 0.0763 + output / 1000 * 0.305;
const operations = {
  schemaVersion: 1, dedicatedResourceGroupDeleted: true, deletionVerifiedAt: cleanup.verifiedAt,
  createdAt: state.createdAt, elapsedHoursThroughDeletionVerification: hours,
  recordedRequestsIncludingPilots: records.length,
  successfulModelRequestsIncludingPilots: records.filter(record => record.status === 200).length,
  observedPromptTokensIncludingPilots: input, observedCompletionTokensIncludingPilots: output,
  pricesJPY: { apimPerHour: 10.3668, modelInputPer1000: 0.0763, modelOutputPer1000: 0.305 },
  modelRetailEstimateYen: modelEstimate,
  apimRetailEstimateYen: hours * 10.3668,
  roundedHourRetailEstimateYen: Math.ceil(hours) * 10.3668 + modelEstimate,
  invoiceStatus: "Not confirmed. Retail estimate, not a bill; taxes and contract prices excluded. Input cache discounts ignored.",
  networkException: "Client IP restriction disabled with owner approval; subscription-key authentication retained and missing-key 401 verified.",
};
writeFileSync(path.resolve("results/operations.json"), JSON.stringify(operations, null, 2) + "\n");
console.log(JSON.stringify(operations, null, 2));
