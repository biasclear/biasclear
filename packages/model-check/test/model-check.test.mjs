import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scan, MAX_INPUT_CHARS } from "../../engine/dist/index.js";
import { bytesDigest, digest, importQuestionDraft, NEUTRAL_SET, NEUTRAL_SET_HASH, runBinding,
  userOnlyRequest, validateRegistry } from "../src/contracts.mjs";
import { createReplayStub, DAILY_CAP_MICROS, MONTHLY_CAP_MICROS, OfflineLedger, runModelCheck,
  simulatedMicros } from "../src/offline.mjs";
import { registryFromExplainSource } from "../src/registry-import.mjs";

const MODELS = ["us.fixture.alpha", "us.fixture.beta"];
const provenance = { kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false };
function registry() {
  const models = Object.fromEntries(MODELS.map((id, i) => [id, {
    key: i ? "beta" : "alpha", displayName: i ? "Synthetic fixture B" : "Synthetic fixture A", provider: "Synthetic fixture",
    foundationModelId: id.slice(3), region: "us-east-1", route: "us-profile", destinationRegions: ["us-east-1", "us-east-2", "us-west-2"],
    inputPricePerMillion: 2.2, outputPricePerMillion: 6.6, maxTokens: 400, billedMaxTokens: null,
    liveBlockReason: "Synthetic-only; no provider accounting evidence", settingsVerified: true,
    requestFields: i ? { thinking: { type: "adaptive" }, output_config: { effort: "low" } } : { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture; no provider evidence", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture; no provider evidence", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture", priceCheckedOn: "2026-10-08",
      settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" },
  }]));
  const table = { models, defaultId: MODELS[0], defaultKey: "alpha" };
  return { schema: 1, kind: "synthetic-offline-registry", provenance, table, tableSha256: digest(table) };
}
function reply(text = "A ripe banana is yellow.", overrides = {}) {
  return { output: { message: { role: "assistant", content: [{ text }] } }, stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 8 }, ...overrides };
}
function replay(overrides = {}) {
  return { schema: 1, kind: "offline-replay-fixtures", replies: Object.fromEntries(MODELS.map(id =>
    [id, Object.fromEntries(NEUTRAL_SET.questions.map(q => [q.id, overrides[`${id}/${q.id}`] ?? reply()]))])) };
}
async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "biasclear-model-check-test-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function options(dir, over = {}) {
  return { registry: registry(), modelIds: MODELS, questionSet: NEUTRAL_SET,
    adapter: createReplayStub(replay()), artifactDirectory: join(dir, "chosen-output"), ...over };
}
function noExternalFields(value) {
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /system|tools?|search|web|ground|browse|citation|cache/iu);
    noExternalFields(child);
  }
}

test("every model receives identical question bytes in approved order, user-only requests, and its exact frozen low settings", () => withTemp(async dir => {
  const opts = options(dir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network forbidden"); };
  try {
    const report = await runModelCheck(opts);
    assert.equal(report.complete, true);
    assert.equal(report.actualCostUsd, 0);
    assert.equal(report.rows.length, 4);
    assert.equal(report.registry.table.models[MODELS[0]].reasoningAccounting.state, "unknown");
    assert.deepEqual(opts.adapter.calls.map(c => [c.modelId, c.questionId]), MODELS.flatMap(id => NEUTRAL_SET.questions.map(q => [id, q.id])));
    for (const call of opts.adapter.calls) {
      assert.equal(call.reservedBeforeCall, true);
      assert.deepEqual(call.request, userOnlyRequest(NEUTRAL_SET.questions.find(q => q.id === call.questionId).text, opts.registry.table.models[call.modelId]));
      noExternalFields(call.request);
      assert.equal(call.request.inferenceConfig.maxTokens, 400);
    }
    assert.throws(() => { report.rows[2].settings.additionalModelRequestFields.thinking.type = "other"; }, TypeError);
    assert.deepEqual(await readdir(opts.artifactDirectory), ["alpha.json", "alpha.md", "beta.json", "beta.md", "run.json"]);
  } finally { globalThis.fetch = originalFetch; }
}));

test("non-offline modes and untrusted adapter lookalikes refuse before creating artifacts or calling", () => withTemp(async dir => {
  for (const mode of ["live", "aws", "HTTP", null]) {
    const opts = options(dir, { mode });
    await assert.rejects(runModelCheck(opts), { code: "E_OFFLINE_ONLY" });
    assert.equal(opts.adapter.calls.length, 0);
  }
  const untrusted = { kind: "trusted-offline-stub", name: "built-in-replay", invoke: () => assert.fail("called") };
  await assert.rejects(runModelCheck(options(dir, { adapter: untrusted })), { code: "E_TRUSTED_OFFLINE_STUB_REQUIRED" });
  assert.deepEqual(await readdir(dir), []);
}));

test("unknown model, unknown settings, bad settings, cap parameters, and registry drift all refuse startup", () => withTemp(async dir => {
  await assert.rejects(runModelCheck(options(dir, { modelIds: ["us.fixture.absent"] })), { code: "E_UNKNOWN_MODEL" });
  for (const mutate of [m => { m.settingsVerified = false; }, m => { m.requestFields.reasoning_effort = "high"; },
    m => { m.requestFields.system = "not allowed"; }, m => { m.maxTokens = 800; }]) {
    const document = registry(); mutate(document.table.models[MODELS[0]]); document.tableSha256 = digest(document.table);
    await assert.rejects(runModelCheck(options(dir, { registry: document })), /E_MODEL_SETTINGS_UNVERIFIED|E_REGISTRY/);
  }
  const drifted = registry(); drifted.table.models[MODELS[0]].inputPricePerMillion = 2.3;
  await assert.rejects(runModelCheck(options(dir, { registry: drifted })), { code: "E_REGISTRY" });
  assert.deepEqual(await readdir(dir), []);
}));

test("neutral self-label, changed question bytes/order, and wrong approval hash produce zero calls", () => withTemp(async dir => {
  for (const change of [set => { set.questions[0].text += " "; }, set => { set.questions.reverse(); }]) {
    const set = structuredClone(NEUTRAL_SET); change(set);
    const opts = options(dir, { questionSet: set });
    await assert.rejects(runModelCheck(opts), { code: "E_NEUTRAL_FIXTURE_DRIFT" });
    assert.equal(opts.adapter.calls.length, 0);
  }
  // Still only the two neutral unit questions, reclassified to exercise the receipt gate.
  const set = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" };
  const opts = options(dir, { questionSet: set });
  await assert.rejects(runModelCheck(opts), { code: "E_OWNER_APPROVAL_REQUIRED" });
  opts.approval = { schema: 1, kind: "owner-approval", runHash: "0".repeat(64), approvedBy: "owner",
    approvedAt: "2026-10-08T12:00:00.000Z", approvalReference: "Neutral automated fixture receipt; not actual owner approval" };
  await assert.rejects(runModelCheck(opts), { code: "E_OWNER_APPROVAL_REQUIRED" });
  assert.equal(opts.adapter.calls.length, 0);
  assert.deepEqual(await readdir(dir), []);
}));

test("digest-bound receipt binds exact neutral test set, registry, model order and domain", () => withTemp(async dir => {
  const set = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" };
  const opts = options(dir, { questionSet: set });
  opts.approval = { schema: 1, kind: "owner-approval", runHash: runBinding(digest(set), digest(opts.registry), MODELS, "general"),
    approvedBy: "owner", approvedAt: "2026-10-08T12:00:00.000Z", approvalReference: "Neutral automated fixture only; no real owner approval" };
  for (const over of [{ domain: "all" }, { modelIds: [...MODELS].reverse() },
    { questionSet: { ...set, questions: [...set.questions].reverse() } }]) {
    await assert.rejects(runModelCheck({ ...opts, ...over }), { code: "E_OWNER_APPROVAL_REQUIRED" });
  }
  const report = await runModelCheck(opts);
  assert.equal(report.complete, true);
  assert.equal(report.setHash, digest(set));
}));

test("multiple final blocks preserve Unicode, CRLF and offsets; reasoning bytes never enter artifacts", () => withTemp(async dir => {
  const raw = "🙂 Cafe\u0301\r\nEveryone agrees this is right.";
  const second = "The triangle has three sides.\n";
  const fixture = replay({ [`${MODELS[0]}/n01`]: reply(undefined, { output: { message: { role: "assistant", content: [
    { reasoningContent: { reasoningText: { text: "PRIVATE_REASONING_FIXTURE" } } }, { text: raw }, { text: second },
  ] } } }) });
  const report = await runModelCheck(options(dir, { adapter: createReplayStub(fixture) }));
  const row = report.rows[0];
  assert.deepEqual(row.finalTextBlocks, [{ blockIndex: 1, text: raw }, { blockIndex: 2, text: second }]);
  assert.deepEqual(row.scans[0].moves, scan(raw).moves);
  assert.ok(row.scans[0].moves.length > 0);
  for (const s of row.scans) for (const m of s.moves) assert.equal(row.finalTextBlocks.find(b => b.blockIndex === s.blockIndex).text.slice(m.start, m.end), m.match);
  for (const name of await readdir(join(dir, "chosen-output"))) assert.doesNotMatch(await readFile(join(dir, "chosen-output", name), "utf8"), /PRIVATE_REASONING_FIXTURE/);
}));

test("failure, refusal, truncation, empty response and overlong scan remain distinct from successful zero marks", () => withTemp(async dir => {
  const cases = [
    [{ fixtureError: "timeout" }, "stub-failed", null],
    [reply("I cannot help with this request."), "refusal-like", "scanned-incomplete-response"],
    [reply("The triangle has three sides.", { stopReason: "max_tokens" }), "incomplete-response", "scanned-incomplete-response"],
    [reply(""), "empty-answer", "scanned-incomplete-response"],
    [reply("x".repeat(MAX_INPUT_CHARS + 1)), "answer", "scan-too-long"],
  ];
  let n = 0;
  for (const [value, status, scanStatus] of cases) {
    const report = await runModelCheck(options(dir, { artifactDirectory: join(dir, `case-${n++}`),
      adapter: createReplayStub(replay({ [`${MODELS[0]}/n01`]: value })) }));
    assert.equal(report.complete, false);
    assert.equal(report.rows[0].responseStatus, status);
    assert.equal(report.rows[0].scans[0]?.status ?? null, scanStatus);
    if (scanStatus === "scan-too-long") assert.equal(report.rows[0].finalTextBlocks[0].text.length, MAX_INPUT_CHARS + 1);
  }
  const normal = await runModelCheck(options(dir, { artifactDirectory: join(dir, "zero-mark-control") }));
  assert.equal(normal.complete, true);
  assert.equal(normal.rows[0].scans[0].interpretation, "no-structural-marks");
}));

test("unknown/malformed usage retains reservation, stops later calls, and keeps exact final text", () => withTemp(async dir => {
  let n = 0;
  for (const usage of [undefined, { inputTokens: 1, outputTokens: -1 }, { inputTokens: 1, outputTokens: 1, totalTokens: 0 },
    { inputTokens: 1, outputTokens: 1, reasoningTokens: 200 }]) {
    const value = reply("Exact text", { usage });
    if (usage === undefined) delete value.usage;
    const opts = options(dir, { artifactDirectory: join(dir, `usage-${n++}`),
      adapter: createReplayStub(replay({ [`${MODELS[0]}/n01`]: value })) });
    const report = await runModelCheck(opts);
    assert.equal(report.complete, false);
    assert.equal(opts.adapter.calls.length, 1);
    assert.equal(report.rows[0].finalTextBlocks[0].text, "Exact text");
    assert.equal(report.rows[0].simulatedCost.kind, "unknown-retained-reservation");
    assert.equal(report.finalLedger.reservations[0].state, "reserved");
    assert.equal(report.rows[1].code, "E_SIMULATED_LEDGER_PAUSE");
    if (usage?.reasoningTokens) { assert.equal(report.rows[0].usageStatus, "unverified-fields"); assert.deepEqual(report.rows[0].reportedUsage, usage); }
  }
}));

test("fixed simulated caps stop before invocation; exact-cap reservation succeeds without retries or fallback", () => withTemp(async dir => {
  const now = new Date().toISOString(), day = now.slice(0, 10), month = now.slice(0, 7);
  const reserve = simulatedMicros(Buffer.byteLength(NEUTRAL_SET.questions[0].text) + 50, 400, registry().table.models[MODELS[0]]);
  const blocked = options(dir, { ledger: new OfflineLedger({ months: {}, days: { [day]: DAILY_CAP_MICROS - reserve + 1 } }) });
  const report = await runModelCheck(blocked);
  assert.equal(blocked.adapter.calls.length, 0);
  assert.equal(report.rows[0].code, "E_SIMULATED_DAY_CAP");
  assert.equal(report.rows[0].requestedAt, null);
  assert.equal(report.actualCostUsd, 0);
  const ledger = new OfflineLedger({ months: { [month]: MONTHLY_CAP_MICROS - reserve }, days: { [day]: DAILY_CAP_MICROS - reserve } });
  const exact = ledger.reserve(now, reserve);
  assert.equal(exact.ok, true);
  assert.equal(ledger.reserve(now, 1).ok, false);
  ledger.settle(exact.reservation.token, 0);
  assert.throws(() => ledger.settle(exact.reservation.token, 0), { code: "E_FAKE_SETTLEMENT" });
  const failureOpts = options(dir, { artifactDirectory: join(dir, "failure"), adapter: createReplayStub(replay({ [`${MODELS[0]}/n01`]: { fixtureError: "network" } })) });
  const failed = await runModelCheck(failureOpts);
  assert.equal(failureOpts.adapter.calls.length, 1);
  assert.equal(failed.finalLedger.reservations.length, 1);
}));

test("Markdown images, links, HTML, pipes, fences and bidi render as inert text; JSON retains raw bytes", () => withTemp(async dir => {
  const raw = "![remote](https://invalid.example/image) [link](https://invalid.example/) <img src=x> |\n```\n**bold**\u202e";
  const opts = options(dir, { adapter: createReplayStub(replay({ [`${MODELS[0]}/n01`]: reply(raw) })) });
  await runModelCheck(opts);
  const json = JSON.parse(await readFile(join(opts.artifactDirectory, "alpha.json"), "utf8"));
  assert.equal(json.rows[0].finalTextBlocks[0].text, raw);
  const md = await readFile(join(opts.artifactDirectory, "alpha.md"), "utf8");
  const table = md.split("\n").filter(line => line.startsWith("|"));
  assert.equal(table.length, 4);
  assert.doesNotMatch(table.join("\n"), /!\[remote\]|<img|\u202e/);
  assert.match(table.join("\n"), /\\u0021\\u005bremote/);
  assert.ok(table.slice(2).every(line => line.includes("| ` "))); // Code spans also suppress URL autolinking.
  assert.match(md, /````\n/); // A fence longer than any returned fence.
}));

test("explicit artifact directory is required and existing directories/files are never overwritten", () => withTemp(async dir => {
  const opts = options(dir);
  await assert.rejects(runModelCheck({ ...opts, artifactDirectory: undefined }), { code: "E_EXPLICIT_ARTIFACT_DIRECTORY_REQUIRED" });
  await runModelCheck(opts);
  const before = await readFile(join(opts.artifactDirectory, "run.json"));
  const fresh = options(dir);
  await assert.rejects(runModelCheck(fresh), { code: "E_ARTIFACT_DIRECTORY_UNAVAILABLE" });
  assert.equal(fresh.adapter.calls.length, 0);
  assert.deepEqual(await readFile(join(opts.artifactDirectory, "run.json")), before);
}));

test("source parser preserves the single table verbatim and cannot execute adjacent source", () => {
  const table = registry().table;
  const source = `export const DEFAULT_MODEL_ID = "${table.defaultId}";\n// BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ${JSON.stringify(table.models)};\n// END_REVIEWED_MODEL_TABLE\nthrow new Error("must not execute");`;
  const imported = registryFromExplainSource(source, "1".repeat(40));
  assert.deepEqual(imported.table, table);
  assert.equal(imported.provenance.sourceSha256, bytesDigest(source));
  assert.equal(imported.tableSha256, digest(table));
  assert.equal(imported.provenance.commitVerification, "operator-asserted");
  assert.throws(() => validateRegistry(imported, MODELS), { code: "E_REGISTRY" });
});

test("malformed reasoning structures never make a reply complete and their bytes are excluded", () => withTemp(async dir => {
  let n = 0;
  for (const reasoningContent of [null, { unknown: "UNSUPPORTED_PRIVATE_BYTES" }, { reasoningText: { text: 123 } }]) {
    const value = reply("Ordinary final answer.");
    value.output.message.content.push({ reasoningContent });
    const opts = options(dir, { artifactDirectory: join(dir, `reasoning-${n++}`),
      adapter: createReplayStub(replay({ [`${MODELS[0]}/n01`]: value })) });
    const report = await runModelCheck(opts);
    assert.equal(report.complete, false);
    assert.equal(report.rows[0].responseStatus, "invalid-reply");
    assert.doesNotMatch(await readFile(join(opts.artifactDirectory, "run.json"), "utf8"), /UNSUPPORTED_PRIVATE_BYTES/);
  }
}));

test("reserved artifact basename and malformed question identifiers refuse before calls", () => withTemp(async dir => {
  const document = registry(); document.table.models[MODELS[1]].key = "run"; document.tableSha256 = digest(document.table);
  const opts = options(dir, { registry: document });
  await assert.rejects(runModelCheck(opts), { code: "E_REGISTRY" });
  assert.equal(opts.adapter.calls.length, 0);
  for (const q of [{ id: null, text: "Neutral text" }, { id: "n01", text: "\ud800" }]) {
    await assert.rejects(runModelCheck(options(dir, { questionSet: { schema: 1, id: "neutral-example", kind: "owner-draft", questions: [q] } })), { code: "E_QUESTION_SET" });
  }
  assert.deepEqual(await readdir(dir), []);
}));

test("draft archival bytes and metadata remain unchanged; lossless bridge is not executed", async () => {
  const files = { "questions.draft.json": "2a52b833ecc865856882ddae6340f64d368ef825fab53882e1f256c87c4f71af",
    "DESIGN-DRAFT.md": "cdc50a62967c18819618b9b0596be7400b5bd94420a18ea18a439e3584dd99a5",
    "QUESTIONS-DRAFT.md": "91590074803079abd0de3445451ef7e55f1120872d1ae73d3a28108a72d82b94",
    "MANIFEST.json": "6332dad68529388dc6868739b10448db719305f199149e670c5e221a6fa7b4fa" };
  for (const [name, hash] of Object.entries(files)) assert.equal(bytesDigest(await readFile(new URL(`../drafts/${name}`, import.meta.url))), hash);
  const bytes = await readFile(new URL("../drafts/questions.draft.json", import.meta.url));
  const document = JSON.parse(bytes.toString("utf8"));
  const set = importQuestionDraft(document, bytes);
  assert.equal(set.questions.length, 28);
  assert.equal(set.sourceDraft.ownerApproved, false);
  assert.equal(set.sourceDraftSha256, files["questions.draft.json"]);
  assert.deepEqual(set.questions.map(q => ({ id: q.id, axis: q.axis, position: q.position, kind: q.kind, question: q.text })), document.questions);
  assert.notEqual(digest(set), NEUTRAL_SET_HASH);
  const changed = structuredClone(document); changed.questions[0].question += " ";
  assert.throws(() => importQuestionDraft(changed, bytes), { code: "E_QUESTION_DRAFT_SOURCE_MISMATCH" });
  assert.throws(() => importQuestionDraft(changed, JSON.stringify(changed)), { code: "E_QUESTION_DRAFT_FINGERPRINT" });
  // No runModelCheck call is made with these questions, including a stub call.
});

test("CLI rejects live mode with only a fixed code and never prints inputs", () => withTemp(async dir => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../cli.mjs", import.meta.url)), "--mode", "live"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "E_OFFLINE_ONLY\n");
  const settings = options(dir);
  const fixtures = replay();
  const files = {};
  for (const [key, data] of Object.entries({ registry: settings.registry, questions: NEUTRAL_SET, fixtures })) {
    files[key] = join(dir, `${key}.json`); await writeFile(files[key], JSON.stringify(data));
  }
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../cli.mjs", import.meta.url)),
    "--registry", files.registry, "--models", MODELS.join(","), "--questions", files.questions,
    "--fixtures", files.fixtures, "--artifacts", join(dir, "cli-output")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
}));

test("CLI preserves incomplete records but signals exit 2 for failed, refused and unknown-usage replies", () => withTemp(async dir => {
  const document = registry();
  const registryPath = join(dir, "registry.json"), questionsPath = join(dir, "questions.json");
  await writeFile(registryPath, JSON.stringify(document));
  await writeFile(questionsPath, JSON.stringify(NEUTRAL_SET));
  const cases = [[{ fixtureError: "timeout" }, "stub-failed"],
    [reply("I cannot assist with that request."), "refusal-like"],
    [reply("A ripe banana is yellow.", { usage: undefined }), "answer"]];
  for (const [index, [value, responseStatus]] of cases.entries()) {
    const fixturePath = join(dir, `fixtures-${index}.json`), artifactDirectory = join(dir, `incomplete-${index}`);
    await writeFile(fixturePath, JSON.stringify(replay({ [`${MODELS[0]}/n01`]: value })));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../cli.mjs", import.meta.url)),
      "--registry", registryPath, "--models", MODELS.join(","), "--questions", questionsPath,
      "--fixtures", fixturePath, "--artifacts", artifactDirectory], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "E_RUN_INCOMPLETE\n");
    const record = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
    assert.equal(record.complete, false);
    assert.equal(record.rows[0].responseStatus, responseStatus);
    assert.equal(record.actualCostUsd, 0);
    if (index !== 1) assert.equal(record.rows[1].code, "E_SIMULATED_LEDGER_PAUSE");
  }
}));
