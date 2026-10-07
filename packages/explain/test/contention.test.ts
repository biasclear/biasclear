// Ledger writes under DynamoDB's transaction-conflict rule (test/conflicts.ts).
// The 306 review showed routine concurrency losing the durable pause and debt
// (fix b); these cases fail on that code.

import { describe, expect, it } from "vitest";
import type { EvaluationResult } from "../src/app.js";
import { Ddb } from "../src/aws/dynamodb.js";
import { BILLING_PAUSE_KEY, SETTLE_ATTEMPTS, persistBillingPause, reserve, settle, spendKeys } from "../src/spend.js";
import { ConflictAws, sleep } from "./conflicts.js";
import { FakeAws, config, evalEvent, harness, modelReply } from "./helpers.js";

const cfg = config();
const now = Date.UTC(2026, 9, 7, 14);
const actualOf = (item: Record<string, { S: string } | { N: string }>): number => Number((item.actual as { N: string }).N);

describe("durable pause and debt under contention (306 b)", () => {
  it("persists the pause and this event's debt while another instance's reserve holds billing#pause", async () => {
    const ca = new ConflictAws();
    const ddb = new Ddb(ca.transport, cfg.region, cfg.table);
    const a = await reserve(ddb, cfg, now, 10_000);
    if (!a.ok) throw new Error("no reservation");
    ca.txMs = 50;
    const b = reserve(ddb, cfg, now, 10_000); // in flight: its ConditionCheck holds billing#pause
    await sleep(5);
    const persisted = await persistBillingPause(ddb, { reason: "E_MODEL_TIMEOUT", nowMs: now, reservedMicros: 10_000, event: a.reservation.event });
    expect((await b).ok).toBe(true);
    expect(ca.conflicts).toBeGreaterThan(0); // the case really met a held item
    expect(persisted).toBe(true);
    expect(ca.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
    expect(ca.items("billingdebt#")).toHaveLength(1);
    expect(ca.aws.table.items.get(BILLING_PAUSE_KEY)?.ttl).toBeUndefined();
  });

  it("an unknown-usage call during another instance's reserve still fences every instance", async () => {
    const ca = new ConflictAws();
    ca.txMs = 40;
    const hA = harness({ transport: ca.transport });
    const hB = harness({ transport: ca.transport });
    let b: Promise<unknown> | undefined;
    let n = 0;
    ca.aws.model = async () => {
      n++;
      if (n === 1) {
        b = hB.handler(evalEvent());
        for (let i = 0; i < 400 && !ca.locks.has(BILLING_PAUSE_KEY); i++) await sleep(1);
        return { status: 200, json: modelReply({ usage: null }) }; // A can't show what it was billed
      }
      return { status: 200, json: modelReply() };
    };
    const ra = await hA.handler(evalEvent()) as EvaluationResult;
    await b;
    expect(ra.evaluation.code).toBe("E_MODEL_NO_USAGE");
    expect(ra.evaluation.pausePersisted).toBe(true);
    expect(ca.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
    expect(ca.items("billingdebt#")).toHaveLength(1);
    const hC = harness({ transport: ca.transport });
    const rc = await hC.handler(evalEvent()) as EvaluationResult;
    expect(rc.evaluation.code).toBe("E_BILLING_PAUSE");
    expect(rc.evaluation.modelCalled).toBe(false);
    expect(ca.aws.modelCalls).toHaveLength(2); // A, and B, which reserved before the pause existed
  });

  it("two unresolved events at once both keep their debts", async () => {
    const ca = new ConflictAws();
    const ddb = new Ddb(ca.transport, cfg.region, cfg.table);
    const a = await reserve(ddb, cfg, now, 10_000);
    const b = await reserve(ddb, cfg, now, 10_000);
    if (!a.ok || !b.ok) throw new Error("no reservation");
    ca.txMs = 20;
    const results = await Promise.all([a.reservation, b.reservation].map((r, i) => persistBillingPause(ddb, {
      reason: "E_SETTLE", nowMs: now, reservedMicros: r.micros, actualMicros: 15_000 + i, event: r.event })));
    expect(results).toEqual([true, true]);
    expect(ca.items("billingdebt#").map(([, item]) => actualOf(item)).sort()).toEqual([15_000, 15_001]);
    expect(ca.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
  });

  it("a bound breach settles with its own debt row, never the shared pause item, and both breaches keep their evidence", async () => {
    const ca = new ConflictAws();
    const ddb = new Ddb(ca.transport, cfg.region, cfg.table);
    const a = await reserve(ddb, cfg, now, 10_000);
    const b = await reserve(ddb, cfg, now, 10_000);
    if (!a.ok || !b.ok) throw new Error("no reservation");
    ca.txMs = 20;
    const before = ca.txLog.length; // the reserves above check billing#pause, as they must
    const breach = (r: typeof a.reservation, actual: number) =>
      settle(ddb, r, actual, { reason: "E_PROVIDER_BOUND", nowMs: now, reservedMicros: r.micros, actualMicros: actual, event: r.event });
    const settled = await Promise.all([breach(a.reservation, 1_600_000), breach(b.reservation, 1_700_000)]);
    expect(ca.txLog.length).toBeGreaterThan(before);
    for (const keys of ca.txLog.slice(before)) expect(keys).not.toContain(BILLING_PAUSE_KEY);
    // Each breach that settled has a debt row written with its counters; the rest are retried by fix c or end as E_SETTLE.
    const debts = ca.items("billingdebt#").map(([, item]) => actualOf(item)).sort();
    expect(debts).toEqual([1_600_000, 1_700_000].filter((_, i) => settled[i]));
  });
});

describe("a bound breach whose fence can't be written (306 b)", () => {
  it("keeps the breach's debt with its settlement and reports the missing pause honestly", async () => {
    const h = harness();
    h.aws.model = () => {
      h.aws.table.fault = (op, p) => op === "PutItem" && (p.Item as { pk: { S: string } }).pk.S === BILLING_PAUSE_KEY ? "network" : undefined;
      return { status: 200, json: modelReply({ outTok: 5_000 }) }; // over the 400-token billed bound
    };
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(r.evaluation.code).toBe("E_PROVIDER_BOUND");
    expect(r.evaluation.billedBoundViolated).toBe(true);
    expect(r.evaluation.pausePersisted).toBe(false);
    expect(h.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(false);
    const debts = [...h.aws.table.items.entries()].filter(([k]) => k.startsWith("billingdebt#"));
    expect(debts).toHaveLength(1);
    expect(actualOf(debts[0]![1])).toBe(r.evaluation.actualMicros);
    expect(h.deps.state.pausedUntil).toBe(Number.POSITIVE_INFINITY); // this instance still stops
  });
});

describe("a definite settle cancellation is retried, not treated as an unknown charge (306 c)", () => {
  const settleTx = (body: Record<string, unknown>) => JSON.stringify(body).includes(":settled");
  const settleAttempts = (ca: ConflictAws) => ca.txLog.filter((keys) => keys.length >= 3 && keys[0]!.startsWith("billing#") && keys[0] !== BILLING_PAUSE_KEY && keys.length === 3).length;

  it("a TransactionConflict on settlement: the paid, checked answer is returned and nothing pauses", async () => {
    const ca = new ConflictAws();
    let forced = 0;
    ca.forceConflict = (body) => settleTx(body) && forced++ === 0;
    const h = harness({ transport: ca.transport });
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(forced).toBeGreaterThan(1); // the first settlement was cancelled, a later one ran
    expect(r.status).toBe(200);
    expect(r.evaluation.pausePersisted).toBeUndefined();
    expect(ca.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(false);
    expect(ca.items("billingdebt#")).toHaveLength(0);
    for (const key of Object.values(spendKeys(h.clock.ms))) expect(ca.aws.table.num(key, "m")).toBe(r.evaluation.actualMicros);
    expect(h.deps.state.pausedUntil).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("a throttled settlement is retried the same way", async () => {
    const h = harness();
    let throttled = 0;
    h.aws.model = () => {
      h.aws.table.fault = (op, p) => op === "TransactWriteItems" && settleTx(p) && throttled++ === 0 ? "throttle" : undefined;
      return { status: 200, json: modelReply() };
    };
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(throttled).toBeGreaterThan(1);
    expect(r.status).toBe(200);
    expect(h.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(false);
  });

  it("a conflict on every attempt still ends in the durable E_SETTLE pause, after a bounded number of tries", async () => {
    const ca = new ConflictAws();
    ca.forceConflict = settleTx;
    const h = harness({ transport: ca.transport });
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(r.evaluation.code).toBe("E_SETTLE");
    expect(r.evaluation.pausePersisted).toBe(true);
    expect(settleAttempts(ca)).toBe(SETTLE_ATTEMPTS);
  });

  it("an ambiguous failure (no reply) is not retried: the reservation stays and the service pauses", async () => {
    const h = harness();
    let sent = 0;
    h.aws.model = () => {
      h.aws.table.fault = (op, p) => op === "TransactWriteItems" && settleTx(p) && ++sent > 0 ? "network" : undefined;
      return { status: 200, json: modelReply() };
    };
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(sent).toBe(1);
    expect(r.evaluation.code).toBe("E_SETTLE");
    expect(r.evaluation.pausePersisted).toBe(true);
  });

  it("a settlement that committed before a lost reply is never applied twice", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, cfg.region, cfg.table);
    const r = await reserve(ddb, cfg, now, 10_000);
    if (!r.ok) throw new Error("no reservation");
    aws.table.fault = (op) => op === "TransactWriteItems" ? "response-lost" : undefined;
    expect(await settle(ddb, r.reservation, 3_000)).toBe(true);
    for (const key of Object.values(spendKeys(now))) expect(aws.table.num(key, "m")).toBe(3_000);
  });

  it("a reserve cancelled by a conflict is retried instead of answering E_DDB", async () => {
    const ca = new ConflictAws();
    let forced = 0;
    ca.forceConflict = (body) => JSON.stringify(body).includes(":reserved") === false && JSON.stringify(body).includes("if_not_exists") && forced++ === 0;
    const h = harness({ transport: ca.transport });
    const r = await h.handler(evalEvent()) as EvaluationResult;
    expect(forced).toBeGreaterThan(1);
    expect(r.status).toBe(200);
    expect(ca.aws.modelCalls).toHaveLength(1);
  });
});
