import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { digest, NEUTRAL_SET, runBinding } from "../src/contracts.mjs";
import { createReplayStub, ENGINE_BASE_REVISION, OfflineLedger, runModelCheck,
  simulatedMicros } from "../src/offline.mjs";

const MODELS = ["us.fixture.recordalpha", "us.fixture.recordbeta"];
const STARTED_AT = "2026-10-31T23:59:00.000Z";
const NEXT_PERIOD = "2026-11-01T00:01:00.000Z";

function registry() {
  const models = Object.fromEntries(MODELS.map((id, i) => [id, {
    key: i ? "recordbeta" : "recordalpha", displayName: `Synthetic record fixture ${i + 1}`,
    provider: "Synthetic fixture", foundationModelId: id.slice(3), region: "us-east-1", route: "us-profile",
    destinationRegions: ["us-east-1", "us-east-2", "us-west-2"], inputPricePerMillion: 2.2,
    outputPricePerMillion: 6.6, maxTokens: 400, billedMaxTokens: null,
    liveBlockReason: "Synthetic fixture; no provider accounting evidence", settingsVerified: true,
    requestFields: { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture",
      priceCheckedOn: "2026-10-08", settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" },
  }]));
  const table = { models, defaultId: MODELS[0], defaultKey: "recordalpha" };
  return { schema: 1, kind: "synthetic-offline-registry", provenance: {
    kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false },
    table, tableSha256: digest(table) };
}

function reply(text = "A ripe banana is yellow.", overrides = {}) {
  return { output: { message: { role: "assistant", content: [{ text }] } }, stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 8 }, ...overrides };
}

function replay(overrides = {}) {
  return createReplayStub({ schema: 1, kind: "offline-replay-fixtures", replies: Object.fromEntries(MODELS.map(id =>
    [id, Object.fromEntries(NEUTRAL_SET.questions.map(question => [question.id,
      overrides[`${id}/${question.id}`] ?? reply()]))])) });
}

function options(directory, overrides = {}) {
  return { registry: registry(), modelIds: [MODELS[0]], questionSet: NEUTRAL_SET,
    adapter: replay(), artifactDirectory: join(directory, "output"), ...overrides };
}

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-record-regression-"));
  try { return await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function syntheticReceipt(opts, approvedAt) {
  return { schema: 1, kind: "owner-approval", runHash: runBinding(digest(opts.questionSet), digest(opts.registry),
    opts.modelIds, "general"), approvedBy: "owner", approvedAt,
    approvalReference: "Synthetic neutral-unit receipt only; not actual owner authorization" };
}

test("a future-dated local receipt refuses before any directory, reservation or replay", t => withTemp(async directory => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(STARTED_AT) });
  // Reclassify only the two existing neutral unit questions to exercise the receipt gate.
  const opts = options(directory, { questionSet: { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" },
    ledger: new OfflineLedger() });
  opts.approval = syntheticReceipt(opts, NEXT_PERIOD);
  await assert.rejects(runModelCheck(opts), { code: "E_OWNER_APPROVAL_REQUIRED" });
  assert.equal(opts.adapter.calls.length, 0);
  assert.deepEqual(opts.ledger.snapshot().reservations, []);
  assert.deepEqual(await readdir(directory), []);
}));

test("records distinguish unauthenticated receipts and a declared source revision from verified evidence", t => withTemp(async directory => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(STARTED_AT) });
  const opts = options(directory, { questionSet: { ...structuredClone(NEUTRAL_SET), kind: "owner-draft" } });
  opts.approval = syntheticReceipt(opts, STARTED_AT); // Equality is a valid timestamp control.
  const report = await runModelCheck(opts);
  assert.equal(report.complete, true);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(report.approval.kind, "owner-approval");
  assert.equal(report.approval.authenticated, false);
  assert.match(report.approval.verificationNote, /unauthenticated local receipt/iu);
  assert.match(report.approval.verificationNote, /verify.*independently/iu);
  assert.equal(report.engine.declaredBaseRevision, ENGINE_BASE_REVISION);
  assert.equal(Object.hasOwn(report.engine, "baseRevision"), false);
  assert.match(report.engine.bundleSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.registry.kind, "synthetic-offline-registry");
  assert.equal(report.registry.provenance.reviewedSource, false);
  const saved = JSON.parse(await readFile(join(opts.artifactDirectory, "run.json"), "utf8"));
  assert.deepEqual(saved.approval, report.approval);
  assert.deepEqual(saved.engine, report.engine);
  assert.ok(saved.rows.every(row => row.engine.declaredBaseRevision === ENGINE_BASE_REVISION));

  const neutral = await runModelCheck(options(directory, { artifactDirectory: join(directory, "neutral-control") }));
  assert.equal(neutral.approval.kind, "built-in-neutral-fixtures");
  assert.equal(neutral.approval.authenticated, false);
  assert.match(neutral.approval.verificationNote, /no human approval is claimed/iu);
}));

test("adapter response timestamps and latency precede simulated processing time", t => withTemp(async directory => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(STARTED_AT) });
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  class ProcessingClockLedger extends OfflineLedger {
    isReserved(token) {
      const reserved = super.isReserved(token);
      // The branded replay checks this immediately before returning its fixture.
      elapsed += 5;
      t.mock.timers.setTime(Date.now() + 10_000);
      return reserved;
    }
    settle(token, actual) {
      const result = super.settle(token, actual);
      elapsed += 70;
      t.mock.timers.setTime(Date.now() + 100_000);
      return result;
    }
  }
  const report = await runModelCheck(options(directory, { ledger: new ProcessingClockLedger() }));
  assert.equal(report.complete, true);
  for (const row of report.rows) {
    assert.equal(Date.parse(row.respondedAt) - Date.parse(row.requestedAt), 10_000);
    assert.equal(row.elapsedMs, 5);
    assert.equal(row.processingElapsedMs, 70);
  }
  assert.ok(Date.parse(report.finishedAt) > Date.parse(report.rows.at(-1).respondedAt));
}));

test("common apologetic, formatted and invisible-prefixed refusals stay distinct from ordinary prose", () => withTemp(async directory => {
  const refusals = ["I can’t provide help with that request.", "I wonʼt assist with that request.",
    "Unable to provide that answer.", "Cannot assist with that request.",
    "I'm sorry, but I can't help with that.", "Sorry, I cannot assist with that request.",
    "\u200bI cannot provide that answer.", "**I can't help with that.**",
    "I’m sorry, but I can’t answer that request.", "Apologies: I am unable to comply with that request.",
    "I can't share personal opinions on political topics.", "I won't take sides on this issue.",
    "I cannot give an opinion on that.", "I can't express a view on contested political questions.",
    "I won't engage with that request.", "I can't do that.", "I cannot discuss this topic.",
    "I'm unable to help with that.", "I'm not able to help with that.",
    "I apologize, but I can't help with that.", "I'm sorry, I can't share an opinion on that.",
    "I can not help with that.", "I will not take sides on this issue.",
    "I am not able to help with that."];
  const controls = ["A service cannot provide unlimited storage.",
    "The sample phrase is I cannot provide help with that request.", "A triangle has three sides.",
    "I cannot overstate the usefulness of this example.", "I can't help but notice a yellow banana.",
    "I'm sorry, but a service cannot provide unlimited storage.",
    "I cannot overemphasize the usefulness of this example.", "I cannot stress this enough.",
    "I cannot emphasize this enough.", "I can't wait to see the result.",
    "I can't believe the banana is yellow.", "I cannot thank you enough.",
    "I can't imagine a square with three sides."];
  let index = 0;
  for (const [text, expected] of [...refusals.map(text => [text, "refusal-like"]),
    ...controls.map(text => [text, "answer"])]) {
    const report = await runModelCheck(options(directory, { artifactDirectory: join(directory, `case-${index++}`),
      adapter: replay({ [`${MODELS[0]}/n01`]: reply(text) }) }));
    const row = report.rows[0];
    assert.equal(row.responseStatus, expected, text);
    assert.equal(row.finalTextBlocks[0].text, text);
    assert.equal(row.scans[0].status, expected === "answer" ? "scanned" : "scanned-incomplete-response");
    assert.equal(report.complete, expected === "answer");
    assert.equal(report.actualCostUsd, 0);
  }
}));

test("invisible-only final text is empty while a visible companion block remains an answer", () => withTemp(async directory => {
  const invisible = "\u200b\u2060\ufeff\u{e0001} \t\r\n";
  const opts = options(directory, { adapter: replay({ [`${MODELS[0]}/n01`]: reply(invisible) }) });
  const report = await runModelCheck(opts);
  assert.equal(report.complete, false);
  assert.equal(report.rows[0].responseStatus, "empty-answer");
  assert.equal(report.rows[0].finalTextBlocks[0].text, invisible);
  assert.equal(report.rows[0].scans[0].status, "scanned-incomplete-response");
  const saved = JSON.parse(await readFile(join(opts.artifactDirectory, "run.json"), "utf8"));
  assert.equal(saved.rows[0].finalTextBlocks[0].text, invisible);

  const content = [{ text: invisible }, { text: "A triangle has three sides." }];
  const control = await runModelCheck(options(directory, { artifactDirectory: join(directory, "visible-control"),
    adapter: replay({ [`${MODELS[0]}/n01`]: reply(undefined, { output: { message: { role: "assistant", content } } }) }) }));
  assert.equal(control.complete, true);
  assert.equal(control.rows[0].responseStatus, "answer");
  assert.deepEqual(control.rows[0].finalTextBlocks, content.map((block, blockIndex) => ({ blockIndex, text: block.text })));
}));

test("overflow in a later model reservation refuses the whole run before replay or artifacts", () => withTemp(async directory => {
  const document = registry();
  document.table.models[MODELS[1]].inputPricePerMillion = 1_000_000_000_000;
  document.tableSha256 = digest(document.table);
  const first = document.table.models[MODELS[0]];
  assert.ok(simulatedMicros(Buffer.byteLength(NEUTRAL_SET.questions[0].text) + 50, 400, first) > 0);
  const opts = options(directory, { registry: document, modelIds: MODELS, ledger: new OfflineLedger() });
  await assert.rejects(runModelCheck(opts), { code: "E_SIMULATED_COST" });
  assert.equal(opts.adapter.calls.length, 0);
  assert.deepEqual(opts.ledger.snapshot().reservations, []);
  assert.deepEqual(await readdir(directory), []);
}));

test("overflow in the later neutral question is preflighted before the earlier row", () => withTemp(async directory => {
  const document = registry(), model = document.table.models[MODELS[0]];
  model.inputPricePerMillion = 110_000_000_000;
  document.tableSha256 = digest(document.table);
  assert.ok(simulatedMicros(Buffer.byteLength(NEUTRAL_SET.questions[0].text) + 50, 400, model) > 0);
  assert.throws(() => simulatedMicros(Buffer.byteLength(NEUTRAL_SET.questions[1].text) + 50, 400, model),
    { code: "E_SIMULATED_COST" });
  const opts = options(directory, { registry: document, ledger: new OfflineLedger() });
  await assert.rejects(runModelCheck(opts), { code: "E_SIMULATED_COST" });
  assert.equal(opts.adapter.calls.length, 0);
  assert.deepEqual(opts.ledger.snapshot().reservations, []);
  assert.deepEqual(await readdir(directory), []);
}));

test("post-reply cost overflow retains the exact answer and reservation as a bound breach", () => withTemp(async directory => {
  const text = "A triangle has three sides.\r\nExact synthetic answer.";
  const usage = { inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER };
  const opts = options(directory, { adapter: replay({ [`${MODELS[0]}/n01`]: reply(text, { usage }) }),
    ledger: new OfflineLedger() });
  const report = await runModelCheck(opts), row = report.rows[0];
  assert.equal(opts.adapter.calls.length, 1);
  assert.equal(report.complete, false);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(row.responseStatus, "answer");
  assert.equal(row.usageStatus, "reported-synthetic");
  assert.deepEqual(row.usage, usage);
  assert.equal(row.code, "E_SIMULATED_BOUND_BREACH");
  assert.equal(row.simulatedCost.kind, "synthetic-bound-breach-retained-reservation");
  assert.equal(row.simulatedCost.measuredMicros, null);
  assert.deepEqual(row.finalTextBlocks, [{ blockIndex: 0, text }]);
  assert.equal(row.scans[0].status, "scanned");
  assert.equal(typeof row.elapsedMs, "number");
  assert.equal(typeof row.processingElapsedMs, "number");
  assert.equal(report.finalLedger.paused, true);
  assert.equal(report.finalLedger.reservations.length, 1);
  assert.equal(report.finalLedger.reservations[0].state, "reserved");
  assert.equal(report.finalLedger.reservations[0].micros, row.simulatedCost.reservedMicros);
  assert.equal(Object.values(report.finalLedger.days)[0], row.simulatedCost.reservedMicros);
  assert.equal(Object.values(report.finalLedger.months)[0], row.simulatedCost.reservedMicros);
  assert.ok(report.rows.slice(1).every(later => later.responseStatus === "not-called" &&
    later.code === "E_SIMULATED_LEDGER_PAUSE" && later.requestedAt === null));
  const saved = JSON.parse(await readFile(join(opts.artifactDirectory, "run.json"), "utf8"));
  assert.equal(saved.rows[0].finalTextBlocks[0].text, text);
  assert.equal(saved.rows[0].code, "E_SIMULATED_BOUND_BREACH");
}));

test("a successful replay crossing UTC day and month keeps all accounting in its start period", t => withTemp(async directory => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(STARTED_AT) });
  class RolloverLedger extends OfflineLedger {
    settle(token, actual) {
      const result = super.settle(token, actual);
      t.mock.timers.setTime(Date.parse(NEXT_PERIOD));
      return result;
    }
  }
  const opts = options(directory, { ledger: new RolloverLedger() });
  const report = await runModelCheck(opts);
  assert.equal(report.complete, true);
  assert.equal(opts.adapter.calls.length, NEUTRAL_SET.questions.length);
  assert.equal(report.startedAt, STARTED_AT);
  assert.equal(report.rows[0].plannedAt, STARTED_AT);
  assert.equal(report.rows[1].plannedAt, NEXT_PERIOD);
  assert.equal(report.rows[1].requestedAt, NEXT_PERIOD);
  assert.deepEqual(Object.keys(report.finalLedger.months), ["2026-10"]);
  assert.deepEqual(Object.keys(report.finalLedger.days), ["2026-10-31"]);
  assert.ok(report.finalLedger.reservations.every(reservation => reservation.month === "2026-10" &&
    reservation.day === "2026-10-31" && reservation.state === "settled"));
  const measured = report.rows.reduce((sum, row) => sum + row.simulatedCost.measuredMicros, 0);
  assert.equal(report.finalLedger.months["2026-10"], measured);
  assert.equal(report.finalLedger.days["2026-10-31"], measured);
}));
