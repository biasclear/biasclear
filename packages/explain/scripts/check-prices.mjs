// Compare the single reviewed model table against current primary AWS sources.
// No account API, invocation or spend. --file uses archived source excerpts offline.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { modelTable, SERVICE } from "../../../infra/aws/model-table.mjs";
export const TEMPLATE = SERVICE;
export const PRICE_URL = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/us-east-1/index.json";

export function templateDefault(yaml, name) {
  const block = new RegExp(`^  ${name}:\\n((?:    .*\\n|      .*\\n)+)`, "m").exec(yaml);
  const value = block && /^    Default: *"?([^"\n]+)"?$/m.exec(block[1]);
  if (!value) throw new Error(`parameter ${name} has no Default`);
  return value[1].trim();
}

function onDemandUsd(prices, sku) {
  const terms = prices.terms?.OnDemand?.[sku];
  for (const term of Object.values(terms ?? {})) for (const d of Object.values(term.priceDimensions ?? {})) {
    if (d.unit === "1M tokens" && d.pricePerUnit?.USD !== undefined) return Number(d.pricePerUnit.USD);
  }
  return undefined;
}

/** Read Standard geographic rates; never substitute cheaper Global/cache rates. */
export function listPrices(sources, modelId) {
  const model = modelTable().models[modelId];
  if (!model) throw new Error("model is outside reviewed table");
  if (model.foundationModelId === "anthropic.claude-sonnet-5-5") {
    const found = {};
    for (const [sku, p] of Object.entries(sources.offer?.products ?? {})) {
      const a = p.attributes ?? {};
      if (a.servicename !== "Claude Sonnet 5.5 (Amazon Bedrock Edition)" || a.regionCode !== model.region) continue;
      if (a.usagetype === "USE1-MP:USE1_input_tokens_standard-Units") found.input = onDemandUsd(sources.offer, sku);
      if (a.usagetype === "USE1-MP:USE1_output_tokens_standard-Units") found.output = onDemandUsd(sources.offer, sku);
    }
    if (!(found.input > 0) || !(found.output > 0)) throw new Error("Sonnet 5.5 Standard prices missing");
    return found;
  }
  const html = sources.cards?.[modelId]?.html;
  if (typeof html !== "string" || !/Standard tier/i.test(html) || !/1 million tokens/i.test(html)) throw new Error("Standard model price source missing");
  const label = model.foundationModelId === "xai.grok-4.7" ? "Geo CRIS" : "US CRIS (bedrock-runtime)";
  // The reviewed AWS label is literal text in its table cell. Read that
  // literal row; this is source inspection, with no HTML sanitizing/rendering.
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]).find(r => r.includes(label));
  if (!row) throw new Error("geographic Standard price row missing");
  const amounts = [...row.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map(m => Number(m[1]));
  // Grok: input/output/cache-read. Sol: input/cache-write/cache-read/output.
  const outputIndex = model.foundationModelId === "xai.grok-4.7" ? 1 : 3;
  if (amounts.length !== outputIndex + (outputIndex === 1 ? 2 : 1) || !(amounts[0] > 0) || !(amounts[outputIndex] > 0)) throw new Error("price table shape changed");
  return { input: amounts[0], output: amounts[outputIndex] };
}

export function compare(yaml, sources) {
  const table = modelTable();
  const defaultKey = templateDefault(yaml, "Model");
  const rows = Object.entries(table.models).map(([modelId, model]) => {
    const list = listPrices(sources, modelId);
    const reviewed = { input: model.inputPricePerMillion, output: model.outputPricePerMillion };
    return { modelId, reviewed, list, ok: reviewed.input === list.input && reviewed.output === list.output };
  });
  return { ok: rows.every(r => r.ok) && defaultKey === table.defaultKey, defaultKey, rows };
}

async function main() {
  const args = process.argv.slice(2);
  let sources;
  if (args.length === 2 && args[0] === "--file") sources = JSON.parse(readFileSync(args[1], "utf8"));
  else if (args.length === 0) {
    const read = async url => {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("AWS price source unavailable");
      return r;
    };
    const table = modelTable();
    const ids = Object.entries(table.models).filter(([, m]) => m.provider !== "Anthropic");
    const cards = await Promise.all(ids.map(async ([id, m]) => [id, { html: await (await read(m.source.profile)).text() }]));
    sources = { offer: await (await read(PRICE_URL)).json(), cards: Object.fromEntries(cards) };
  } else throw new Error("Usage: node scripts/check-prices.mjs [--file PATH]");
  const result = compare(readFileSync(TEMPLATE, "utf8"), sources);
  for (const row of result.rows) process.stdout.write(`${row.modelId}: reviewed $${row.reviewed.input}/$${row.reviewed.output}; AWS $${row.list.input}/$${row.list.output} per million tokens.\n`);
  if (!result.ok) throw new Error("reviewed prices changed; no deployment allowed");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { process.stderr.write("Price verification failed; no deployment allowed.\n"); process.exit(1); });
}
