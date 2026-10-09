import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NEUTRAL_SET } from "../src/contracts.mjs";
import { createReplayStub, OfflineLedger, runModelCheck } from "../src/offline.mjs";
import { prepareArtifactDirectory, writeArtifacts } from "../src/artifacts.mjs";

const IDS = ["us.fixture.alpha", "us.fixture.beta"];
const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const IMPORTER = fileURLToPath(new URL("../scripts/import-registry.mjs", import.meta.url));

// Deliberately independent of the implementation's canonical/digest/runBinding helpers.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const sha = value => createHash("sha256").update(canonical(value)).digest("hex");

function registry() {
  const models = Object.fromEntries(IDS.map((id, i) => [id, {
    key: i ? "beta" : "alpha", displayName: i ? "Synthetic fixture B" : "Synthetic fixture A",
    provider: "Synthetic fixture", foundationModelId: id.slice(3), region: "us-east-1", route: "us-profile",
    destinationRegions: ["us-east-1", "us-east-2", "us-west-2"], inputPricePerMillion: 2,
    outputPricePerMillion: 6, maxTokens: 400, billedMaxTokens: null,
    liveBlockReason: "Synthetic-only; no provider accounting evidence", settingsVerified: true,
    requestFields: { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture",
      priceCheckedOn: "2026-10-08", settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" },
  }]));
  const table = { models, defaultId: IDS[0], defaultKey: "alpha" };
  return { schema: 1, kind: "synthetic-offline-registry",
    provenance: { kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false },
    table, tableSha256: sha(table) };
}

function reply(outputTokens = 8) {
  return { output: { message: { role: "assistant", content: [{ text: "A neutral synthetic answer." }] } },
    stopReason: "end_turn", usage: { inputTokens: 10, outputTokens } };
}
function fixtures(first = reply()) {
  return { schema: 1, kind: "offline-replay-fixtures", replies: Object.fromEntries(IDS.map((id, i) =>
    [id, Object.fromEntries(NEUTRAL_SET.questions.map((question, j) => [question.id, i === 0 && j === 0 ? first : reply()]))])) };
}
function settings(directory, overrides = {}) {
  return { registry: registry(), modelIds: IDS, questionSet: NEUTRAL_SET, adapter: createReplayStub(fixtures()),
    artifactDirectory: join(directory, "new-output"), ...overrides };
}
function receipt(questionSet, document) {
  return { schema: 1, kind: "owner-approval", approvedBy: "owner", approvedAt: "2020-01-01T00:00:00.000Z",
    approvalReference: "Synthetic neutral-fixture receipt; not an actual owner approval",
    runHash: sha({ schema: 1, mode: "offline", setHash: sha(questionSet), registryHash: sha(document),
      modelIds: IDS, domain: "general" }) };
}
async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-safety-gates-"));
  try { return await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("an independently hashed receipt permits only the exact registry, including reviewed prices", () => withTemp(async directory => {
  const questionSet = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" }, original = registry();
  const approval = receipt(questionSet, original);
  const control = settings(directory, { questionSet, registry: original, approval });
  const report = await runModelCheck(control);
  assert.equal(report.complete, true);
  assert.equal(report.runHash, approval.runHash);
  assert.equal(control.adapter.calls.length, 4);
  const changed = structuredClone(original);
  changed.table.models[IDS[0]].inputPricePerMillion = 3;
  changed.tableSha256 = sha(changed.table);
  const blocked = settings(directory, { questionSet, registry: changed, approval,
    artifactDirectory: join(directory, "changed-price-must-not-exist") });
  await assert.rejects(runModelCheck(blocked), { code: "E_OWNER_APPROVAL_REQUIRED" });
  assert.equal(blocked.adapter.calls.length, 0);
  assert.deepEqual(await readdir(directory), ["new-output"]);
}));

test("receipt schema, kind, human approver and date fields refuse individually before any replay", () => withTemp(async directory => {
  const questionSet = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" }, document = registry();
  for (const [field, value] of [["schema", 2], ["kind", "assistant-approval"], ["approvedBy", "assistant"],
    ["approvedAt", "2020-not-a-date"], ["approvedAt", "2099-01-01T00:00:00.000Z"]]) {
    const opts = settings(directory, { questionSet, registry: document,
      approval: { ...receipt(questionSet, document), [field]: value } });
    await assert.rejects(runModelCheck(opts), { code: "E_OWNER_APPROVAL_REQUIRED" });
    assert.equal(opts.adapter.calls.length, 0);
    assert.deepEqual(await readdir(directory), []);
  }
}));

test("401 output tokens pause the batch even when the measured cost remains below its reservation", () => withTemp(async directory => {
  const adapter = createReplayStub(fixtures(reply(401)));
  const report = await runModelCheck(settings(directory, { adapter }));
  assert.equal(report.complete, false);
  assert.equal(adapter.calls.length, 1);
  assert.equal(report.rows[0].code, "E_SIMULATED_BOUND_BREACH");
  assert.ok(report.rows[0].simulatedCost.measuredMicros <= report.rows[0].simulatedCost.reservedMicros);
  assert.equal(report.finalLedger.paused, true);
  assert.equal(report.finalLedger.reservations.length, 1);
  assert.equal(report.rows.length, 4);
  assert.ok(report.rows.slice(1).every(row => row.code === "E_SIMULATED_LEDGER_PAUSE" && row.requestedAt === null));
}));

test("region, route and destination changes refuse before calls or directory creation", () => withTemp(async directory => {
  for (const mutate of [model => { model.region = "us-west-2"; }, model => { model.route = "global-profile"; },
    model => { model.destinationRegions = ["us-east-1"]; }]) {
    const document = registry(); mutate(document.table.models[IDS[0]]); document.tableSha256 = sha(document.table);
    const opts = settings(directory, { registry: document });
    await assert.rejects(runModelCheck(opts), { code: "E_REGISTRY" });
    assert.equal(opts.adapter.calls.length, 0);
    assert.deepEqual(await readdir(directory), []);
  }
}));

test("an untrusted ledger or unsupported domain fails the startup gate before replay", () => withTemp(async directory => {
  for (const override of [{ ledger: {} }, { ledger: { reserve: () => assert.fail("untrusted ledger called") } },
    { ledger: new OfflineLedger(), domain: "unsupported" }]) {
    const opts = settings(directory, override);
    await assert.rejects(runModelCheck(opts), { code: "E_RUN_SETTINGS" });
    assert.equal(opts.adapter.calls.length, 0);
    assert.deepEqual(await readdir(directory), []);
  }
}));

async function inputFiles(directory) {
  const data = { registry: registry(), questions: NEUTRAL_SET, fixtures: fixtures() }, files = {};
  for (const [key, value] of Object.entries(data)) {
    files[key] = join(directory, `${key}.json`);
    await writeFile(files[key], JSON.stringify(value));
  }
  return files;
}
function cliArguments(files, artifactDirectory) {
  return ["--registry", files.registry, "--models", IDS.join(","), "--questions", files.questions,
    "--fixtures", files.fixtures, "--artifacts", artifactDirectory];
}
const invoke = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("CLI rejects unknown and duplicate flags even when every other input is valid", () => withTemp(async directory => {
  const files = await inputFiles(directory);
  for (const suffix of [["--unknown", "neutral"], ["--domain", "general", "--domain", "general"]]) {
    const artifactDirectory = join(directory, "must-not-exist");
    const result = invoke(CLI, [...cliArguments(files, artifactDirectory), ...suffix]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "E_CLI_ARGUMENTS\n");
    await assert.rejects(stat(artifactDirectory), { code: "ENOENT" });
  }
}));

test("CLI success writes complete per-model artifacts with files 0600 and directory 0700", () => withTemp(async directory => {
  const files = await inputFiles(directory), artifactDirectory = join(directory, "complete-output");
  const previous = process.umask(0o022);
  try {
    const result = invoke(CLI, cliArguments(files, artifactDirectory));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const expected = ["alpha.json", "alpha.md", "beta.json", "beta.md", "run.json"];
    assert.deepEqual(await readdir(artifactDirectory), expected);
    assert.equal((await stat(artifactDirectory)).mode & 0o777, 0o700);
    for (const name of expected) assert.equal((await stat(join(artifactDirectory, name))).mode & 0o777, 0o600, name);
    const report = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
    assert.equal(report.complete, true);
    assert.equal(report.actualCostUsd, 0);
    assert.equal(report.rows.length, 4);
    for (const key of ["alpha", "beta"]) {
      const perModel = JSON.parse(await readFile(join(artifactDirectory, `${key}.json`), "utf8"));
      assert.equal(perModel.complete, true);
      assert.equal(perModel.rows.length, 2);
    }
  } finally { process.umask(previous); }
}));

test("exclusive artifact writes refuse a planted model file and preserve its bytes", () => withTemp(async directory => {
  const report = await runModelCheck(settings(directory));
  const artifactDirectory = join(directory, "planted-output");
  await prepareArtifactDirectory(artifactDirectory);
  const planted = join(artifactDirectory, "alpha.json"), original = "Synthetic sentinel: never overwrite.\n";
  await writeFile(planted, original);
  await assert.rejects(writeArtifacts(artifactDirectory, report), { code: "E_ARTIFACT_WRITE_FAILED" });
  assert.equal(await readFile(planted, "utf8"), original);
  assert.deepEqual(await readdir(artifactDirectory), ["alpha.json"]);
}));

test("registry importer path/write unit refuses relative paths and overwrites; real pins reject synthetic source", () => withTemp(async directory => {
  const document = registry();
  const source = `export const DEFAULT_MODEL_ID = "${IDS[0]}";\n// BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ${JSON.stringify(document.table.models)};\n// END_REVIEWED_MODEL_TABLE\n`;
  const sourcePath = join(directory, "synthetic-models.ts"), outputPath = join(directory, "imported.json");
  await writeFile(sourcePath, source);
  const args = ["--source", sourcePath, "--source-commit", "1".repeat(40), "--output", outputPath];
  const real = invoke(IMPORTER, args);
  assert.equal(real.status, 1);
  assert.equal(real.stdout, "");
  assert.equal(real.stderr, "E_REGISTRY\n");
  await assert.rejects(stat(outputPath), { code: "ENOENT" });
  // Isolate importer I/O with a parser returning an explicit synthetic registry.
  // The real registry validator remains intact. This does not claim official-import E2E.
  const isolated = join(directory, "importer-unit"), scripts = join(isolated, "scripts"), src = join(isolated, "src");
  await mkdir(scripts, { recursive: true });
  await mkdir(src, { recursive: true });
  const unitImporter = join(scripts, "import-registry.mjs");
  await copyFile(IMPORTER, unitImporter);
  await writeFile(join(src, "contracts.mjs"),
    `export * from ${JSON.stringify(new URL("../src/contracts.mjs", import.meta.url).href)};\n`);
  await writeFile(join(src, "registry-import.mjs"),
    `export function registryFromExplainSource(bytes, commit) {\n` +
    `  if (Buffer.from(bytes).toString("utf8") !== ${JSON.stringify(source)} || commit !== "${"1".repeat(40)}") throw new Error("synthetic parser only");\n` +
    `  return ${JSON.stringify(document)};\n}\n`);
  for (const indices of [[1, "relative.ts"], [5, "relative.json"]]) {
    const invalid = [...args]; invalid[indices[0]] = indices[1];
    const result = invoke(unitImporter, invalid);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "E_IMPORT_ARGUMENTS\n");
  }
  const previous = process.umask(0o022);
  try {
    const result = invoke(unitImporter, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const original = await readFile(outputPath);
    const imported = JSON.parse(original.toString("utf8"));
    assert.deepEqual(imported.table, document.table);
    assert.equal(imported.kind, "synthetic-offline-registry");
    assert.equal(imported.provenance.reviewedSource, false);
    assert.equal(imported.tableSha256, sha(document.table));
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    const duplicate = invoke(unitImporter, args);
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, "");
    assert.equal(duplicate.stderr, "E_REGISTRY_IMPORT_FAILED\n");
    assert.deepEqual(await readFile(outputPath), original);
  } finally { process.umask(previous); }
}));
