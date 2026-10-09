import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bytesDigest, digest, NEUTRAL_SET, validateRegistry } from "../src/contracts.mjs";
import { registryFromExplainSource } from "../src/registry-import.mjs";
import { createReplayStub, runModelCheck, simulatedMicros } from "../src/offline.mjs";

const ID = "us.fixture.importer";
function fixtureRegistry(price = 2.2) {
  const model = { key: "importer", displayName: "Synthetic fixture importer", provider: "Synthetic fixture",
    foundationModelId: ID.slice(3), region: "us-east-1", route: "us-profile",
    destinationRegions: ["us-east-1", "us-east-2", "us-west-2"], inputPricePerMillion: price,
    outputPricePerMillion: price, maxTokens: 400, billedMaxTokens: null,
    liveBlockReason: "Synthetic-only", settingsVerified: true, requestFields: { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture",
      priceCheckedOn: "2026-10-08", settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" } };
  const table = { models: { [ID]: model }, defaultId: ID, defaultKey: model.key };
  return { schema: 1, kind: "synthetic-offline-registry",
    provenance: { kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false },
    table, tableSha256: digest(table) };
}
function source() {
  return `// Synthetic UTF-8 fixture: é\nexport const DEFAULT_MODEL_ID = "${ID}";\n// BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ${JSON.stringify(fixtureRegistry().table.models)};\n// END_REVIEWED_MODEL_TABLE\n`;
}
async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-import-regression-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("parser hashes exact valid UTF-8 bytes and rejects invalid encodings or string surrogates", () => {
  const bytes = Buffer.from(source());
  const parsed = registryFromExplainSource(bytes, "1".repeat(40));
  assert.equal(parsed.provenance.sourceSha256, bytesDigest(bytes));
  assert.deepEqual(parsed, registryFromExplainSource(source(), "1".repeat(40)));
  assert.throws(() => validateRegistry(parsed, [ID]), { code: "E_REGISTRY" }); // Synthetic source is not reviewed content.
  for (const byte of [0xfe, 0xff]) {
    const invalid = Buffer.concat([Buffer.from([byte]), bytes]);
    assert.throws(() => registryFromExplainSource(invalid, "1".repeat(40)), { code: "E_REGISTRY_SOURCE" });
  }
  assert.throws(() => registryFromExplainSource(`${source()}\ud800`, "1".repeat(40)), { code: "E_REGISTRY_SOURCE" });
});

test("parser refuses duplicate markers, defaults, nested tables and comment decoys", () => {
  for (const text of [
    `${source()}${source()}`,
    `${source()}// BEGIN_REVIEWED_MODEL_TABLE\n`,
    `${source()}// END_REVIEWED_MODEL_TABLE\n`,
    `${source()}export const DEFAULT_MODEL_ID = "${ID}";\n`,
    `function nested() {\n${source()}\n}\n`,
    `/*\n${source()}\n*/\n`,
    source().replace("const MODEL_TABLE", "  const MODEL_TABLE"),
    source().replace("// END_REVIEWED_MODEL_TABLE", "// missing end"),
  ]) assert.throws(() => registryFromExplainSource(text, "1".repeat(40)), { code: "E_REGISTRY_SOURCE" });
});

test("adjacent JavaScript is never executed and cannot make synthetic source reviewed", () => {
  const parsed = registryFromExplainSource(`${source()}\nthrow new Error("must never execute");`, "1".repeat(40));
  assert.equal(parsed.table.defaultId, ID);
  assert.equal(parsed.provenance.commitVerification, "operator-asserted");
  assert.throws(() => validateRegistry(parsed, [ID]), { code: "E_REGISTRY" });
});

test("preparation CLI rejects invalid UTF-8 and unreviewed source without writing an envelope", () => withTemp(async directory => {
  const script = fileURLToPath(new URL("../scripts/import-registry.mjs", import.meta.url));
  for (const [name, bytes, expected] of [
    ["invalid", Buffer.concat([Buffer.from([0xff]), Buffer.from(source())]), "E_REGISTRY_SOURCE\n"],
    ["synthetic", Buffer.from(source()), "E_REGISTRY\n"],
  ]) {
    const input = join(directory, `${name}.ts`), output = join(directory, `${name}.json`);
    await writeFile(input, bytes);
    const result = spawnSync(process.execPath, [script, "--source", input, "--source-commit", "1".repeat(40), "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, expected);
  }
  assert.deepEqual(await readdir(directory), ["invalid.ts", "synthetic.ts"]);
}));

test("rounded thousandth prices accept ordinary binary float noise and reject extra precision", () => {
  for (const price of [2.01, 4.03, 8.05, 1.005]) {
    const document = fixtureRegistry(price), validated = validateRegistry(document, [ID]);
    assert.equal(validated.document.table.models[ID].inputPricePerMillion, price);
    assert.equal(simulatedMicros(1_000_000, 0, document.table.models[ID]), Math.round(price * 1_000_000));
  }
  for (const price of [2.0101, 4.03001, 8.0502, 1.0055, 0.00000001, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => validateRegistry(fixtureRegistry(price), [ID]), { code: "E_REGISTRY" });
  }
});

test("an enormous representable price fails reservation preflight before artifacts or replay", () => withTemp(async directory => {
  const document = fixtureRegistry(1e12);
  validateRegistry(document, [ID]); // Its rounded unit price is safe; a call's total is not.
  const stub = createReplayStub({ schema: 1, kind: "offline-replay-fixtures", replies: { [ID]:
    Object.fromEntries(NEUTRAL_SET.questions.map(q => [q.id, { output: { message: { role: "assistant",
      content: [{ text: "A neutral synthetic answer." }] } }, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 8 } }])) } });
  await assert.rejects(runModelCheck({ registry: document, modelIds: [ID], questionSet: NEUTRAL_SET,
    adapter: stub, artifactDirectory: join(directory, "must-not-exist") }), { code: "E_SIMULATED_COST" });
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(await readdir(directory), []);
}));
