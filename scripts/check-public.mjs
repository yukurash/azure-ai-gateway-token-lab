import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const allowed = /^(README(?:\.en)?\.md|AGENTS\.md|\.gitignore|package(?:-lock)?\.json|tsconfig\.json|\.github\/workflows\/ci\.yml|(?:infra|src|test|experiments|results|scripts)\/)/;
const privatePath = /(?:^|\/)(?:article|articles|private|raw|runs|node_modules|dist)(?:\/|$)|(?:\.local\.|\.bicepparam$|\.pem$|\.key$|\.log$)/i;
const forbidden = [
  /\/subscriptions\/[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  /https:\/\/[a-z0-9-]+\.(?:openai\.azure\.com|azure-api\.net)/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
];
const denyTerms = (process.env.PUBLIC_DENY_TERMS ?? "").split("|").filter(Boolean);
const errors = [];
for (const file of files) {
  if (!allowed.test(file) || privatePath.test(file)) errors.push(`Forbidden path: ${file}`);
  const content = readFileSync(path.resolve(file), "utf8");
  if (forbidden.some(pattern => pattern.test(content)) || denyTerms.some(term => content.includes(term))) {
    errors.push(`Sensitive content: ${file}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public boundary check passed (${files.length} tracked files).`);
}
