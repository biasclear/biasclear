// Read the single JSON-literal table in models.ts without executing TypeScript.
// --write regenerates the reviewed model sections; --check refuses drift.
// No network, AWS credentials or third-party modules are used.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MODEL_SOURCE = fileURLToPath(new URL("../../packages/explain/src/models.ts", import.meta.url));
export const SERVICE = fileURLToPath(new URL("./explain.yaml", import.meta.url));
export const SETUP = fileURLToPath(new URL("./setup.yaml", import.meta.url));

/** Same as consentFingerprint in packages/explain/src/models.ts (a test holds them together): what the
 * visitor's consent names, for the site's settings and the deploy script's public test call (314 M3). */
export function consentFingerprint(id, model) {
  const named = JSON.stringify([id, model.provider, model.displayName, model.route, model.region, [...model.destinationRegions]]);
  return `c1-${createHash("sha256").update(named).digest("hex").slice(0, 16)}`;
}

export function modelTable(source = readFileSync(MODEL_SOURCE, "utf8")) {
  const match = /\/\/ BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ([\s\S]*?);\n\/\/ END_REVIEWED_MODEL_TABLE/.exec(source);
  const defaultId = /export const DEFAULT_MODEL_ID = "([^"]+)";/.exec(source)?.[1];
  if (!match || !defaultId) throw new Error("reviewed model table not found");
  const models = JSON.parse(match[1]);
  if (!Object.hasOwn(models, defaultId)) throw new Error("default is outside the model table");
  const keys = new Set();
  for (const [id, m] of Object.entries(models)) {
    if (!/^us\.[a-z0-9][a-z0-9.-]*$/.test(id) || id !== `us.${m.foundationModelId}` ||
        !/^[a-z][a-z0-9]*$/.test(m.key) || keys.has(m.key) ||
        m.region !== "us-east-1" || m.route !== "us-profile" ||
        !Array.isArray(m.destinationRegions) || m.destinationRegions.length !== 3 ||
        m.destinationRegions.join(",") !== "us-east-1,us-east-2,us-west-2" ||
        ![m.inputPricePerMillion, m.outputPricePerMillion].every(n => Number.isFinite(n) && n > 0) ||
        m.maxTokens !== 400 || typeof m.settingsVerified !== "boolean" ||
        typeof m.liveBlockReason !== "string" ||
        (m.billedMaxTokens !== null && (!Number.isSafeInteger(m.billedMaxTokens) || m.billedMaxTokens < m.maxTokens)) ||
        ((m.billedMaxTokens === null || !m.settingsVerified) && m.liveBlockReason === "")) throw new Error("invalid reviewed model entry");
    for (const field of ["reasoningAccounting", "inputTokenBound"]) {
      const evidence = m[field];
      if (!evidence || !["yes", "no", "unknown"].includes(evidence.state) ||
          typeof evidence.source !== "string" || !evidence.source || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.checkedOn)) throw new Error("invalid model evidence");
    }
    if (m.inputTokenBound.framingTokens !== null && (!Number.isSafeInteger(m.inputTokenBound.framingTokens) || m.inputTokenBound.framingTokens < 0)) throw new Error("invalid input token bound");
    if (m.inputTokenBound.state === "yes" && m.inputTokenBound.framingTokens === null) throw new Error("verified input bound missing framing maximum");
    for (const field of ["profile", "price", "settings"]) {
      if (typeof m.source?.[field] !== "string" || !m.source[field] || !/^\d{4}-\d{2}-\d{2}$/.test(m.source[`${field}CheckedOn`])) throw new Error("source provenance date missing");
    }
    keys.add(m.key);
    // Settings may never enable external tools/search, even after a table edit.
    const settings = JSON.stringify(m.requestFields);
    if (/tools?|search|web|grounding|browse|citations?|cache/iu.test(settings)) throw new Error("external or cache feature in model settings");
  }
  return { models, defaultId, defaultKey: models[defaultId].key };
}

export function modelParameter(table = modelTable()) {
  return `  # BEGIN_GENERATED_MODEL_PARAMETER\n  Model:\n    Type: String\n    AllowedValues: ${JSON.stringify(Object.values(table.models).map(m => m.key))}\n    Default: ${table.defaultKey}\n    Description: >-\n      One reviewed model key. Default Grok 4.7; alternatives Claude Sonnet 5.5\n      and GPT-6.1 Sol. Converse uses the approved US profile selected below.\n      Unknown/unverified model settings refuse startup; no fallback exists.\n  # END_GENERATED_MODEL_PARAMETER\n`;
}

export function mappings(table = modelTable()) {
  const lines = ["# BEGIN_GENERATED_MODEL_MAPPINGS", "Mappings:", "  ReviewedModels:"];
  for (const [id, m] of Object.entries(table.models)) {
    lines.push(`    ${m.key}:`, `      InvocationId: ${JSON.stringify(id)}`,
      `      InputPrice: ${JSON.stringify(String(m.inputPricePerMillion))}`,
      `      OutputPrice: ${JSON.stringify(String(m.outputPricePerMillion))}`);
  }
  lines.push("# END_GENERATED_MODEL_MAPPINGS");
  return `${lines.join("\n")}\n`;
}

export function iamStatements(table = modelTable()) {
  const lines = ["              # BEGIN_GENERATED_MODEL_IAM"];
  for (const [id, m] of Object.entries(table.models)) {
    const profile = `arn:\${AWS::Partition}:bedrock:${m.region}:\${AWS::AccountId}:inference-profile/${id}`;
    lines.push(`              - Sid: Profile${m.key}`, "                Effect: Allow", "                Action: [bedrock:InvokeModel, bedrock:GetInferenceProfile]",
      `                Resource: !Sub ${JSON.stringify(profile)}`, `              - Sid: Model${m.key}ThroughItsProfileOnly`,
      "                Effect: Allow", "                Action: bedrock:InvokeModel", "                Resource:");
    for (const region of m.destinationRegions) lines.push(`                  - !Sub ${JSON.stringify(`arn:\${AWS::Partition}:bedrock:${region}::foundation-model/${m.foundationModelId}`)}`);
    lines.push("                Condition:", "                  StringEquals:", `                    \"bedrock:InferenceProfileArn\": !Sub ${JSON.stringify(profile)}`);
  }
  lines.push("              # END_GENERATED_MODEL_IAM");
  return `${lines.join("\n")}\n`;
}

function replace(yaml, name, content) {
  const re = new RegExp(`^([ ]*)# BEGIN_GENERATED_${name}\\n[\\s\\S]*?^\\1# END_GENERATED_${name}\\n`, "m");
  if (!re.test(yaml)) throw new Error(`generated ${name} section missing`);
  return yaml.replace(re, content);
}

export function generatedTemplates(service, setup, table = modelTable()) {
  return {
    service: replace(replace(service, "MODEL_PARAMETER", modelParameter(table)), "MODEL_MAPPINGS", mappings(table)),
    setup: replace(setup, "MODEL_IAM", iamStatements(table)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 2 && ["--id", "--check-key", "--regions", "--name", "--consent"].includes(args[0])) {
      const entry = Object.entries(modelTable().models).find(([, model]) => model.key === args[1]);
      if (!entry) throw new Error("unknown model key");
      if (args[0] === "--id") process.stdout.write(`${entry[0]}\n`);
      if (args[0] === "--regions") process.stdout.write(`${entry[1].destinationRegions.join("\n")}\n`);
      // The maker visitors are told about, for the approval summary and refusals (306 e).
      if (args[0] === "--name") process.stdout.write(`${entry[1].displayName}, made by ${entry[1].provider}\n`);
      if (args[0] === "--consent") process.stdout.write(`${consentFingerprint(entry[0], entry[1])}\n`);
      process.exit(0);
    }
    if (args.length !== 1 || !["--check", "--write"].includes(args[0])) throw new Error("Usage: node infra/aws/model-table.mjs --check|--write|--id KEY|--check-key KEY|--regions KEY|--name KEY|--consent KEY");
    const service = readFileSync(SERVICE, "utf8");
    const setup = readFileSync(SETUP, "utf8");
    const generated = generatedTemplates(service, setup);
    if (args[0] === "--write") { writeFileSync(SERVICE, generated.service); writeFileSync(SETUP, generated.setup); }
    else if (generated.service !== service || generated.setup !== setup) throw new Error("model table/template drift; review and regenerate before deployment");
    process.stdout.write("Reviewed model table, selector, prices and exact IAM routes match.\n");
  } catch (err) { process.stderr.write(`${err instanceof Error ? err.message : "model table check failed"}\n`); process.exit(1); }
}
