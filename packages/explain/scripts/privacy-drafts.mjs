// Drafts only. No public site edits, network requests or account evidence.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { modelTable } from "../../../infra/aws/model-table.mjs";

export const DRAFT_FILE = fileURLToPath(new URL("../../../handoff/explain/PRIVACY-DRAFTS.md", import.meta.url));
const REGION_NAMES = Object.freeze({
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-2": "Oregon",
});

function places(regions) {
  const names = regions.map(region => {
    if (!Object.hasOwn(REGION_NAMES, region)) throw new Error("unreviewed processing location");
    return `${REGION_NAMES[region]} (${region})`;
  });
  if (names.length === 0 || new Set(regions).size !== regions.length) throw new Error("invalid processing locations");
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

export function privacyDraft(id, model) {
  if (id !== `us.${model.foundationModelId}` || model.route !== "us-profile" || !Object.hasOwn(REGION_NAMES, model.region)) throw new Error("unreviewed model route");
  const destinations = places(model.destinationRegions);
  const source = REGION_NAMES[model.region];
  return {
    id, key: model.key, maker: model.provider, displayName: model.displayName,
    sourceRegion: model.region, destinationRegions: [...model.destinationRegions],
    consent: `Explain sends this sentence, and nothing else you pasted, to BiasClear's service on Amazon Web Services. It asks ${model.displayName}, an AI model made by ${model.provider}, through Amazon Bedrock, how the wording works. Amazon may process it in ${destinations} in the United States. We keep no copy. Our Amazon account uses Bedrock's zero data retention setting; Explain pauses if that setting changes.`,
    privacy: `After you agree, the page sends one marked sentence (at most 500 characters), the move and its position, the domain and rules version to BiasClear's Explain service on Amazon Web Services. Nothing else you pasted is sent. The service rechecks the mark, then sends that sentence and our fixed wording prompt to ${model.displayName}, made by ${model.provider}, through Amazon Bedrock. It calls Amazon from ${source} (${model.region}); the approved US profile ${id} may process the sentence in ${destinations} in the United States. BiasClear does not request web or X search, grounding or tools. It sends no conversation history or the rest of your text. The service keeps no copy of the sentence, answer or reasoning. Its logs keep counts and settings only for 7 days. The approved account retention setting is none; invocation logging must be off. Publishing this wording requires a successful owner-approved zero-retention compatibility check for this exact model and route.`,
  };
}

export function renderDrafts(table = modelTable()) {
  const lines = [
    "# Explain privacy drafts — not published",
    "",
    "Generated from the single reviewed model table by `node packages/explain/scripts/privacy-drafts.mjs --write`. `--check` refuses stale copy. These are draft words, not evidence that a model is usable or that account settings were checked.",
    "",
    `The reviewed default is ${table.models[table.defaultId].displayName}. Before any switch-on: confirm the exact account profile and all destination regions, current prices, reasoning and input accounting bounds, logging off and retention none. A successful exact-model retention check and owner approval are required; a review-retention requirement stops the work. These drafts never authorize a model switch.`,
  ];
  for (const [id, model] of Object.entries(table.models)) {
    const draft = privacyDraft(id, model);
    lines.push("", `## ${model.displayName} (${model.key})`, "",
      `Maker: ${model.provider}. Exact invocation ID: \`${id}\`. Route source: \`${model.region}\`. Destinations: ${places(model.destinationRegions)}.`, "",
      `Provenance: base ID — ${model.source.baseId}; profile/destinations — ${model.source.profile}. The profile and routes are documentation evidence; account confirmation remains required.`, "",
      "Consent draft:", "", `> ${draft.consent}`, "",
      "Privacy draft:", "", `> ${draft.privacy}`);
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length || !["--write", "--check"].includes(mode)) throw new Error("Usage: privacy-drafts.mjs --write|--check");
    const draft = renderDrafts();
    if (mode === "--write") writeFileSync(DRAFT_FILE, draft);
    else if (readFileSync(DRAFT_FILE, "utf8") !== draft) throw new Error("privacy draft/model table drift");
    process.stdout.write("Model-specific privacy drafts match the reviewed table; nothing was published.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "privacy draft check failed"}\n`);
    process.exit(1);
  }
}
