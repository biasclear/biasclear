// Offline gate before GitHub asks AWS for any credentials. No account reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelTable } from "./model-table.mjs";
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PROTECTED = ["packages/explain/", "infra/aws/", "packages/engine/", "site/js/explain.js", "site/data/explain.json"];

export function ownerPolicyStatus(root = ROOT) {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const owners = readFileSync(join(root, ".github/CODEOWNERS"), "utf8").split("\n")
    .filter(line => line.trim() && !line.trim().startsWith("#")).map(line => line.trim().split(/\s+/)[0]);
  const protection = /\*\*Protected paths:\*\*[^\n]*/.exec(agents)?.[0] ?? "";
  const reasons = [];
  if (!agents.includes("The one hosted exception is Explain (Mode C)")) reasons.push("owner-approved hosted privacy exception missing");
  for (const path of PROTECTED) if (!protection.includes(`\`${path}\``) || !owners.includes(`/${path}`)) reasons.push(`owner protection missing: ${path}`);
  return reasons;
}

export function modelReadiness(key, table = modelTable()) {
  const entry = Object.entries(table.models).find(([, m]) => m.key === key);
  if (!entry) return ["model key is outside reviewed table"];
  const [, model] = entry;
  const reasons = [];
  if (!model.settingsVerified) reasons.push("lowest provider reasoning setting is unverified");
  if (model.billedMaxTokens === null) reasons.push("billed total-output bound is unverified; $25 reservation cannot be guaranteed");
  if (model.reasoningAccounting?.state !== "yes") reasons.push("Converse billed reasoning accounting is unverified");
  if (model.inputTokenBound?.state !== "yes" || !Number.isSafeInteger(model.inputTokenBound.framingTokens)) reasons.push("model-specific input token framing bound is unverified");
  if (model.liveBlockReason) reasons.push(model.liveBlockReason);
  return reasons;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    const table = modelTable();
    if (args.length && !(args.length === 2 && args[0] === "--model")) throw new Error("bad readiness arguments");
    const reasons = [...ownerPolicyStatus(), ...modelReadiness(args[1] ?? table.defaultKey, table)];
    if (reasons.length) { for (const reason of reasons) process.stderr.write(`Stop before AWS credentials: ${reason}.\n`); process.exit(1); }
    process.stdout.write("Owner policy and reviewed model prerequisites pass; account zero-retention proof and real evaluation are still required.\n");
  } catch { process.stderr.write("Offline readiness check failed; no AWS credentials requested.\n"); process.exit(1); }
}
