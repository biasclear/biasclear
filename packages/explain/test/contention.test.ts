// Ledger writes under DynamoDB's transaction-conflict rule (test/conflicts.ts).
// The 306 review showed routine concurrency losing the durable pause and debt
// (fix b); these cases fail on that code.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_MODEL_TIMEOUT_MS, POST_CALL_RESERVE_MS, type EvaluationResult } from "../src/app.js";
import { DDB_TIMEOUT_MS, Ddb } from "../src/aws/dynamodb.js";
import { TransportError } from "../src/aws/transport.js";
import { BILLING_PAUSE_KEY, FENCE_RESERVE_MS, LOG_RESERVE_MS, PERSIST_WINDOW_MS, SETTLE_ATTEMPTS, persistBillingPause, reserve, settle, spendKeys } from "../src/spend.js";
import { ConflictAws, sleep } from "./conflicts.js";
import { FakeAws, config, evalEvent, harness, httpEvent, lastLog, modelReply } from "./helpers.js";

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
    vi.useFakeTimers();
    const pending = h.handler(evalEvent());
    await vi.runAllTimersAsync();
    const r = await pending as EvaluationResult;
    vi.useRealTimers();
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

describe("the stop records fit the invocation (314 M1, M2)", () => {
  afterEach(() => vi.useRealTimers());

  it("writes the fence and the debt while another reserve holds billing#pause for 500 ms, and for 1.5 s", async () => {
    for (const holdMs of [500, 1_500]) {
      const ca = new ConflictAws();
      const ddb = new Ddb(ca.transport, cfg.region, cfg.table);
      const a = await reserve(ddb, cfg, now, 10_000);
      if (!a.ok) throw new Error("no reservation");
      ca.txMs = holdMs;
      const b = reserve(ddb, cfg, now, 10_000);
      await sleep(5);
      const persisted = await persistBillingPause(ddb, { reason: "E_MODEL_NO_USAGE", nowMs: now, reservedMicros: 10_000, event: a.reservation.event });
      expect((await b).ok).toBe(true); // a reservation already in flight may complete
      expect(ca.conflicts, `${holdMs} ms`).toBeGreaterThan(1);
      expect(persisted, `${holdMs} ms`).toBe(true);
      expect(ca.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
      expect(ca.items("billingdebt#")).toHaveLength(1);
      ca.txMs = 0;
      expect(await reserve(ddb, cfg, now, 1)).toEqual({ ok: false, which: "pause" });
    }
  });

  it("writes the fence before Lambda's 28 s timeout though the debt key never answers, and logs it in time", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const h = harness();
    h.deps.now = () => Date.now();
    h.aws.model = () => "timeout";
    const delegate = h.aws.transport;
    let modelTimeoutMs: number | undefined;
    let fenceAt: number | undefined;
    h.deps.transport = async (call) => {
      if (call.host.startsWith("bedrock-runtime.")) {
        modelTimeoutMs = call.timeoutMs;
        await sleep(call.timeoutMs);
      }
      if (call.service === "dynamodb") {
        const body = JSON.parse(call.body) as { Item?: { pk?: { S?: string } }; Key?: { pk?: { S?: string } } };
        const key = body.Item?.pk?.S ?? body.Key?.pk?.S;
        if (key?.startsWith("billingdebt#")) {
          await sleep(call.timeoutMs);
          throw new TransportError("timeout");
        }
        if (call.headers["x-amz-target"]?.endsWith("PutItem") && key === BILLING_PAUSE_KEY) fenceAt ??= Date.now() - start;
      }
      return delegate(call);
    };
    const pending = h.handler(evalEvent(), { getRemainingTimeInMillis: () => 28_000 });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(h.logs).toHaveLength(1); // finished, log line written, inside the function's timeout
    const r = await pending as EvaluationResult;
    expect(modelTimeoutMs).toBeLessThanOrEqual(28_000 - POST_CALL_RESERVE_MS);
    expect(fenceAt).toBeLessThan(modelTimeoutMs! + 1_000); // right after the model call, not after the debt's retries
    expect(r.evaluation.code).toBe("E_MODEL_TIMEOUT");
    expect(h.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
    expect(r.evaluation.pausePersisted).toBe(false); // the debt never landed, and the log says so
    expect(JSON.parse(h.logs[0]!)).toMatchObject({ code: "E_MODEL_TIMEOUT", pausePersisted: 0 });
  });

  it("releases the reservation and answers busy when too little time is left for the model and the stop records", async () => {
    const h = harness();
    const r = await h.call(httpEvent(), { getRemainingTimeInMillis: () => POST_CALL_RESERVE_MS + MIN_MODEL_TIMEOUT_MS - 1 });
    expect(r.statusCode).toBe(503);
    expect(r.json).toEqual({ v: 1, error: "busy" });
    expect(lastLog(h).code).toBe("E_DEADLINE");
    expect(h.aws.modelCalls).toHaveLength(0);
    for (const key of Object.values(spendKeys(h.clock.ms))) expect(h.aws.table.num(key, "m")).toBe(0);
    expect(h.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(false);
  });

  it("cuts the model call to leave room for the ledger and the stop records", async () => {
    const h = harness();
    expect((await h.call(httpEvent(), { getRemainingTimeInMillis: () => 25_000 })).statusCode).toBe(200);
    const timeout = h.aws.calls.find((c) => c.host.startsWith("bedrock-runtime."))!.timeoutMs;
    expect(timeout).toBeLessThanOrEqual(25_000 - POST_CALL_RESERVE_MS);
    expect(timeout).toBeGreaterThan(25_000 - POST_CALL_RESERVE_MS - 1_000);
  });
});

describe("the full persist window after settlement (9391673 re-check)", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("budgets two settlement round trips, then the whole persist window and the log line", () => {
    expect(FENCE_RESERVE_MS).toBeGreaterThanOrEqual(PERSIST_WINDOW_MS);
    expect(PERSIST_WINDOW_MS).toBeGreaterThan(DDB_TIMEOUT_MS);
    expect(POST_CALL_RESERVE_MS).toBe(2 * DDB_TIMEOUT_MS + FENCE_RESERVE_MS + LOG_RESERVE_MS);
  });

  it("writes the fence after both settlement round trips time out, though a reserve holds the pause up to 2.8 s (Jarvis's probe)", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (const holdMs of [500, 1_500, 2_800, 2_990]) {
      const ca = new ConflictAws();
      const ddb = new Ddb(ca.transport, cfg.region, cfg.table);
      const h = harness({ transport: ca.transport });
      h.deps.now = () => Date.now();
      let competitor: ReturnType<typeof reserve> | undefined;
      h.deps.transport = async (call) => {
        if (call.host.startsWith("bedrock-runtime.")) await sleep(call.timeoutMs);
        if (call.service === "dynamodb") {
          const op = call.headers["x-amz-target"]!.replace("DynamoDB_20120810.", "");
          const body = JSON.parse(call.body) as { Item?: { pk?: { S?: string } }; Key?: { pk?: { S?: string } } };
          const key = body.Item?.pk?.S ?? body.Key?.pk?.S;
          if (op === "TransactWriteItems" && JSON.stringify(body).includes(":settled")) {
            await sleep(call.timeoutMs);
            throw new TransportError("timeout");
          }
          if (op === "GetItem" && key?.startsWith("billing#") && key !== BILLING_PAUSE_KEY) {
            await sleep(call.timeoutMs - 5);
            ca.txMs = holdMs; // a valid reservation starts 5 ms before recovery and holds the pause
            competitor = reserve(ddb, cfg, Date.now(), 10_000);
            await sleep(5);
            throw new TransportError("timeout");
          }
        }
        return ca.transport(call);
      };
      const pending = h.handler(evalEvent(), { getRemainingTimeInMillis: () => 28_000 });
      await vi.runAllTimersAsync();
      const r = await pending as EvaluationResult;
      expect((await competitor!).ok).toBe(true); // already in flight: it may complete
      ca.txMs = 0;
      expect(JSON.parse(h.logs[0]!).ms, `${holdMs} ms`).toBeLessThan(28_000);
      expect(r.evaluation.code).toBe("E_SETTLE");
      expect(r.evaluation.pausePersisted, `${holdMs} ms`).toBe(true);
      expect(ca.items("billingdebt#")).toHaveLength(1);
      expect(await reserve(ddb, cfg, Date.now(), 1), `${holdMs} ms`).toEqual({ ok: false, which: "pause" });
    }
  });
});
