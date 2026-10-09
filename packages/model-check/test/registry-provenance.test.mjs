import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, NEUTRAL_SET, validateRegistry } from "../src/contracts.mjs";
import { createReplayStub, runModelCheck } from "../src/offline.mjs";
import { registryFromExplainSource } from "../src/registry-import.mjs";

const FIXTURE_ID = "us.fixture.provenance";
const SOL_ID = "us.openai.gpt-6.1-sol";
const REVIEWED_FIXTURE_SHA256 = "a5100697c88c2244027859fc55c8095b285d3a65f7a13e1c02e1852143757661";
const REVIEWED_TABLE_SHA256 = "1bba1367aded6a9dc94cd17d7b120872219623835b2c997f3758e7228404dcd9";
const OFFICIAL_PROVENANCE = { repository: "biasclear/biasclear", path: "packages/explain/src/models.ts",
  commit: "19eebb338ad5676075c4ab5a971eec6d379ef1bc",
  sourceSha256: "b7d4cd785fad2ab611eb1089fd1ad81223bb07887b01e4eabeedfa0531f58ae0",
  commitVerification: "operator-asserted" };

// Frozen output of the real importer over the local 19eebb3 models.ts Git object.
// This is test evidence for a reviewed content pin, not current provider availability.
async function reviewedRegistry() {
  const bytes = await readFile(new URL("./fixtures/reviewed-registry.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), REVIEWED_FIXTURE_SHA256);
  const document = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(document.provenance, OFFICIAL_PROVENANCE);
  assert.equal(document.tableSha256, REVIEWED_TABLE_SHA256);
  assert.equal(digest(document.table), REVIEWED_TABLE_SHA256);
  return document;
}

function registry() {
  const model = { key: "provenance", displayName: "Synthetic fixture provenance", provider: "Synthetic fixture",
    foundationModelId: FIXTURE_ID.slice(3), region: "us-east-1", route: "us-profile",
    destinationRegions: ["us-east-1", "us-east-2", "us-west-2"], inputPricePerMillion: 2.2,
    outputPricePerMillion: 6.6, maxTokens: 400, billedMaxTokens: null,
    liveBlockReason: "Synthetic fixture; no live evidence", settingsVerified: true,
    requestFields: { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture",
      priceCheckedOn: "2026-10-08", settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" } };
  const table = { models: { [FIXTURE_ID]: model }, defaultId: FIXTURE_ID, defaultKey: model.key };
  return { schema: 1, kind: "synthetic-offline-registry",
    provenance: { kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false },
    table, tableSha256: digest(table) };
}

function adapter(modelId = FIXTURE_ID) {
  return createReplayStub({ schema: 1, kind: "offline-replay-fixtures", replies: { [modelId]:
    Object.fromEntries(NEUTRAL_SET.questions.map(q => [q.id, {
      output: { message: { role: "assistant", content: [{ text: "A neutral synthetic answer." }] } },
      stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 8 },
    }])) } });
}

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-registry-provenance-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("synthetic provenance is explicit in both the registry and saved full run record", () => withTemp(async directory => {
  const document = registry(), artifactDirectory = join(directory, "output");
  assert.equal(validateRegistry(document, [FIXTURE_ID]).document.kind, "synthetic-offline-registry");
  const stub = adapter();
  const report = await runModelCheck({ registry: document, modelIds: [FIXTURE_ID], questionSet: NEUTRAL_SET,
    adapter: stub, artifactDirectory });
  assert.equal(report.actualCostUsd, 0);
  assert.equal(stub.calls.length, 2);
  const saved = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
  assert.equal(saved.registry.kind, "synthetic-offline-registry");
  assert.deepEqual(saved.registry.provenance, document.provenance);
  assert.equal(saved.registry.provenance.reviewedSource, false);
  assert.equal(Object.hasOwn(saved.registry.provenance, "repository"), false);
}));

test("synthetic envelopes cannot claim official provenance or real-provider identifiers", () => {
  for (const change of [
    doc => { doc.provenance = { ...OFFICIAL_PROVENANCE }; },
    doc => { doc.provenance.reviewedSource = true; },
    doc => { doc.provenance.commit = OFFICIAL_PROVENANCE.commit; },
    doc => { doc.table.models[FIXTURE_ID].provider = "OpenAI"; },
    doc => {
      const model = doc.table.models[FIXTURE_ID]; delete doc.table.models[FIXTURE_ID];
      model.foundationModelId = SOL_ID.slice(3); doc.table.models[SOL_ID] = model; doc.table.defaultId = SOL_ID;
    },
  ]) {
    const document = registry(); change(document); document.tableSha256 = digest(document.table);
    assert.throws(() => validateRegistry(document, [document.table.defaultId]), { code: "E_REGISTRY" });
  }
});

test("rehashed Sol settings under official source claims refuse before any neutral replay", () => withTemp(async directory => {
  const document = registry(), model = document.table.models[FIXTURE_ID];
  delete document.table.models[FIXTURE_ID];
  model.foundationModelId = SOL_ID.slice(3); model.provider = "OpenAI";
  model.settingsVerified = true; model.requestFields = { reasoning_effort: "low" };
  document.table.models[SOL_ID] = model; document.table.defaultId = SOL_ID;
  document.kind = "explain-reviewed-registry"; document.provenance = { ...OFFICIAL_PROVENANCE };
  document.tableSha256 = digest(document.table);
  const stub = adapter(SOL_ID);
  await assert.rejects(runModelCheck({ registry: document, modelIds: [SOL_ID], questionSet: NEUTRAL_SET,
    adapter: stub, artifactDirectory: join(directory, "must-not-exist") }), { code: "E_REGISTRY" });
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(await readdir(directory), []);
}));

test("the frozen real reviewed registry validates and permits neutral replay only", () => withTemp(async directory => {
  const document = await reviewedRegistry(), modelId = document.table.defaultId;
  const validated = validateRegistry(document, [modelId]);
  assert.deepEqual(validated.document, document);
  assert.equal(validated.document.kind, "explain-reviewed-registry");
  assert.equal(validated.document.table.models[SOL_ID].settingsVerified, false);
  const stub = adapter(modelId), artifactDirectory = join(directory, "output");
  const report = await runModelCheck({ registry: document, modelIds: [modelId], questionSet: NEUTRAL_SET,
    adapter: stub, artifactDirectory });
  assert.equal(report.complete, true);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(stub.calls.length, NEUTRAL_SET.questions.length);
  const saved = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
  assert.deepEqual(saved.registry, document);
}));

test("real reviewed content refuses wrong commit, source, verification and mixed pins before replay", () => withTemp(async directory => {
  const mutations = [
    doc => { doc.provenance.commit = "f".repeat(40); },
    doc => { doc.provenance.sourceSha256 = "e".repeat(64); },
    doc => { doc.provenance.commit = "f".repeat(40); doc.provenance.sourceSha256 = "e".repeat(64); },
    doc => { doc.provenance.commitVerification = "verified"; },
    doc => { doc.provenance.commit = "dfcc8d3ef148420054a222de92d4f36cc6bb87b0"; },
    doc => { doc.tableSha256 = "e".repeat(64); },
    doc => { doc.table.models[doc.table.defaultId].inputPricePerMillion = 1; doc.tableSha256 = digest(doc.table); },
  ];
  for (const change of mutations) {
    const document = await reviewedRegistry(), modelId = document.table.defaultId;
    change(document);
    const stub = adapter(modelId);
    await assert.rejects(runModelCheck({ registry: document, modelIds: [modelId], questionSet: NEUTRAL_SET,
      adapter: stub, artifactDirectory: join(directory, "must-not-exist") }), { code: "E_REGISTRY" });
    assert.equal(stub.calls.length, 0);
    assert.deepEqual(await readdir(directory), []);
  }
}));

test("source parser labels the commit as operator-asserted without executing source or authenticating lineage", () => {
  const document = registry();
  const source = `export const DEFAULT_MODEL_ID = "${FIXTURE_ID}";\n// BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ${JSON.stringify(document.table.models)};\n// END_REVIEWED_MODEL_TABLE\nthrow new Error("must not execute");`;
  const parsed = registryFromExplainSource(source, "1".repeat(40));
  assert.equal(parsed.provenance.commitVerification, "operator-asserted");
  assert.equal(parsed.provenance.commit, "1".repeat(40));
  assert.deepEqual(parsed.table, document.table);
  assert.throws(() => validateRegistry(parsed, [FIXTURE_ID]), { code: "E_REGISTRY" });
});
