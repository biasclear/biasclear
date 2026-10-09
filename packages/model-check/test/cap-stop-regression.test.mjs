import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, NEUTRAL_SET } from "../src/contracts.mjs";
import { createReplayStub, DAILY_CAP_MICROS, MONTHLY_CAP_MICROS, OfflineLedger,
  runModelCheck, simulatedMicros } from "../src/offline.mjs";

const MODEL_IDS = ["us.fixture.expensive", "us.fixture.cheaper"];
const FIRST_DATE = "2026-10-31T23:59:59.000Z";
const NEXT_DAY = "2026-11-01T00:00:01.000Z";

function registry() {
  const models = Object.fromEntries(MODEL_IDS.map((id, i) => [id, {
    key: i ? "cheaper" : "expensive", displayName: i ? "Cheaper synthetic fixture" : "Expensive synthetic fixture",
    provider: "Synthetic fixture", foundationModelId: id.slice(3), region: "us-east-1", route: "us-profile",
    destinationRegions: ["us-east-1", "us-east-2", "us-west-2"],
    inputPricePerMillion: i ? 1 : 1000, outputPricePerMillion: i ? 1 : 1000,
    maxTokens: 400, billedMaxTokens: null, liveBlockReason: "Synthetic-only; no provider accounting evidence",
    settingsVerified: true, requestFields: { reasoning_effort: "low" },
    reasoningAccounting: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08" },
    inputTokenBound: { state: "unknown", source: "Synthetic fixture", checkedOn: "2026-10-08", framingTokens: null },
    source: { profile: "Synthetic fixture", profileCheckedOn: "2026-10-08", price: "Synthetic fixture",
      priceCheckedOn: "2026-10-08", settings: "Synthetic fixture", settingsCheckedOn: "2026-10-08" },
  }]));
  const table = { models, defaultId: MODEL_IDS[0], defaultKey: "expensive" };
  return { schema: 1, kind: "synthetic-offline-registry", provenance: {
    kind: "synthetic-unit-fixture", fixture: "neutral-test-registry", reviewedSource: false },
    table, tableSha256: digest(table) };
}

function stub() {
  return createReplayStub({ schema: 1, kind: "offline-replay-fixtures", replies: Object.fromEntries(MODEL_IDS.map(id =>
    [id, Object.fromEntries(NEUTRAL_SET.questions.map(q => [q.id, {
      output: { message: { role: "assistant", content: [{ text: "A neutral synthetic answer." }] } },
      stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 8 },
    }]))])) });
}

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-cap-stop-test-"));
  try { return await fn(join(directory, "explicit-output")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

const CAP_CASES = [
  { period: "day", key: "days", cap: DAILY_CAP_MICROS, dateKey: FIRST_DATE.slice(0, 10), code: "E_SIMULATED_DAY_CAP" },
  { period: "month", key: "months", cap: MONTHLY_CAP_MICROS, dateKey: FIRST_DATE.slice(0, 7), code: "E_SIMULATED_MONTH_CAP" },
];

for (const { period, key, cap, dateKey, code } of CAP_CASES) {
  test(`${period} cap refusal stops a same-date batch before the later cheaper model`, t => withTemp(async artifactDirectory => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(FIRST_DATE) });
    const document = registry(), available = 1000;
    const reserve = model => simulatedMicros(Buffer.byteLength(NEUTRAL_SET.questions[0].text) + 50, 400, model);
    assert.ok(reserve(document.table.models[MODEL_IDS[0]]) > available);
    assert.ok(reserve(document.table.models[MODEL_IDS[1]]) <= available); // Would fit without the stop latch.
    const seed = { months: {}, days: {} }; seed[key][dateKey] = cap - available;
    const ledger = new OfflineLedger(seed), adapter = stub();
    const report = await runModelCheck({ registry: document, modelIds: MODEL_IDS,
      questionSet: NEUTRAL_SET, ledger, adapter, artifactDirectory });
    assert.equal(adapter.calls.length, 0);
    assert.equal(report.complete, false);
    assert.equal(report.actualCostUsd, 0);
    assert.equal(report.rows.length, MODEL_IDS.length * NEUTRAL_SET.questions.length);
    assert.equal(report.rows[0].code, code);
    assert.ok(report.rows.slice(1).every(row => row.code === "E_SIMULATED_LEDGER_PAUSE"));
    assert.ok(report.rows.every(row => row.responseStatus === "not-called" && row.requestedAt === null));
    assert.deepEqual(report.finalLedger.reservations, []);
    assert.equal(report.finalLedger.paused, true);
    assert.deepEqual(report.finalLedger[key], seed[key]);
  }));

  test(`${period} cap refusal stops the batch even after the clock rolls into a new period`, t => withTemp(async artifactDirectory => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(FIRST_DATE) });
    const seed = { months: {}, days: {} }; seed[key][dateKey] = cap;
    // The test advances time only; reservation decisions still use the actual OfflineLedger implementation.
    class RolloverLedger extends OfflineLedger {
      reserve(date, amount) {
        const result = super.reserve(date, amount);
        t.mock.timers.setTime(Date.parse(NEXT_DAY));
        return result;
      }
    }
    const ledger = new RolloverLedger(seed), adapter = stub();
    const report = await runModelCheck({ registry: registry(), modelIds: MODEL_IDS,
      questionSet: NEUTRAL_SET, ledger, adapter, artifactDirectory });
    assert.equal(report.rows[0].plannedAt, FIRST_DATE);
    assert.ok(report.rows.slice(1).every(row => row.plannedAt === NEXT_DAY));
    assert.equal(adapter.calls.length, 0);
    assert.equal(report.rows[0].code, code);
    assert.ok(report.rows.slice(1).every(row => row.code === "E_SIMULATED_LEDGER_PAUSE"));
    assert.ok(report.rows.every(row => row.responseStatus === "not-called" && row.requestedAt === null));
    assert.equal(report.rows.length, MODEL_IDS.length * NEUTRAL_SET.questions.length);
    assert.equal(report.finalLedger.paused, true);
    assert.deepEqual(report.finalLedger.reservations, []);
    assert.deepEqual(report.finalLedger[key], seed[key]);
  }));

  test(`${period} cap stop survives settlement refunds and next-period admission`, () => {
    const seed = { months: {}, days: {} }; seed[key][dateKey] = cap - 2;
    const ledger = new OfflineLedger(seed);
    const first = ledger.reserve(FIRST_DATE, 2);
    assert.equal(first.ok, true); // Exact-cap admission still succeeds.
    assert.deepEqual(ledger.reserve(FIRST_DATE, 1), { ok: false, code });
    ledger.settle(first.reservation.token, 0); // A refund must not silently restart a stopped run.
    assert.deepEqual(ledger.reserve(FIRST_DATE, 1), { ok: false, code: "E_SIMULATED_LEDGER_PAUSE" });
    assert.deepEqual(ledger.reserve(NEXT_DAY, 1), { ok: false, code: "E_SIMULATED_LEDGER_PAUSE" });
    assert.equal(ledger.snapshot().reservations.length, 1);
    assert.equal(ledger.snapshot().reservations[0].state, "settled");
  });
}

test("a below-cap control completes all neutral fixture rows and settles each reservation", t => withTemp(async artifactDirectory => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(FIRST_DATE) });
  const ledger = new OfflineLedger(), adapter = stub();
  const report = await runModelCheck({ registry: registry(), modelIds: MODEL_IDS,
    questionSet: NEUTRAL_SET, ledger, adapter, artifactDirectory });
  assert.equal(report.complete, true);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(adapter.calls.length, MODEL_IDS.length * NEUTRAL_SET.questions.length);
  assert.deepEqual(adapter.calls.map(call => [call.modelId, call.questionId]),
    MODEL_IDS.flatMap(id => NEUTRAL_SET.questions.map(question => [id, question.id])));
  assert.ok(adapter.calls.every(call => call.reservedBeforeCall));
  assert.equal(report.finalLedger.paused, false);
  assert.equal(report.finalLedger.reservations.length, adapter.calls.length);
  assert.ok(report.finalLedger.reservations.every(reservation => reservation.state === "settled"));
}));
