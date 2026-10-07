// Spend math and the reservation's life (SPEC §8).

import { describe, expect, it } from "vitest";
import { Ddb } from "../src/aws/dynamodb.js";
import { priceToNanos, readConfig } from "../src/config.js";
import { actualMicros, hasHeadroom, release, reserve, settle, spendKeys, worstCaseMicros } from "../src/spend.js";
import { ENV, FakeAws, config } from "./helpers.js";

const cfg = config();

describe("prices and money", () => {
  it("reads USD per million tokens as whole nano-dollars per token, with no floating point", () => {
    expect(priceToNanos("2.20")).toBe(2200);
    expect(priceToNanos("11")).toBe(11000);
    expect(priceToNanos("0.1")).toBe(100);
    expect(priceToNanos("2.2001")).toBeUndefined();
    expect(priceToNanos("-1")).toBeUndefined();
    expect(priceToNanos("0")).toBeUndefined();
    expect(priceToNanos("")).toBeUndefined();
  });

  it("bounds the worst case from above: every byte a token, plus framing, plus a full answer", () => {
    // (1000 + 50) × 2200 + 400 × 6600 = 4,950,000 nano-dollars = 4,950 micro-dollars
    expect(worstCaseMicros(1000, 400, cfg)).toBe(4950);
    // Rounds up.
    expect(worstCaseMicros(1, 0, { inNanosPerToken: 1, outNanosPerToken: 1 })).toBe(1);
  });

  it("rounds the real cost up", () => {
    expect(actualMicros(820, 120, cfg)).toBe(Math.ceil((820 * 2200 + 120 * 6600) / 1000));
    expect(actualMicros(1, 0, cfg)).toBe(3);
    expect(actualMicros(0, 0, cfg)).toBe(0);
  });

  it("sets the daily limit from the cap and the percentage", () => {
    expect(cfg.capMicros).toBe(25_000_000);
    expect(cfg.dailyMicros).toBe(2_500_000);
    expect(readConfig({ ...ENV, EXPLAIN_MONTHLY_CAP_USD: "26" })).toBeUndefined();
    expect(readConfig({ ...ENV, EXPLAIN_MONTHLY_CAP_USD: "0" })).toBeUndefined();
    expect(readConfig({ ...ENV, EXPLAIN_ORIGINS: "https://example.org" })).toBeUndefined();
    expect(readConfig({ ...ENV, EXPLAIN_MODEL_ID: "anthropic.claude-opus-5-5" })).toBeUndefined();
  });
});

describe("reservations", () => {
  const now = Date.UTC(2026, 9, 31, 23, 59, 59, 900); // a moment before midnight at the end of a month

  it("reserves on both keys and settles on the same keys, even after midnight", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const r = await reserve(ddb, cfg, now, 10_000);
    expect(r).toEqual({ ok: true, reservation: { month: "spend#2026-10", day: "spendday#2026-10-31", micros: 10_000 } });
    if (!r.ok) throw new Error("unreachable");
    // The model answered after midnight: the settle still goes to October 31.
    expect(await settle(ddb, r.reservation, 3_000)).toBe(true);
    expect(aws.table.num("spend#2026-10", "m")).toBe(3_000);
    expect(aws.table.num("spendday#2026-10-31", "m")).toBe(3_000);
    expect(aws.table.items.has(spendKeys(now + 1000).day)).toBe(false);
  });

  it("applies a positive delta unclamped (an overrun), and gives everything back on release", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const r = await reserve(ddb, cfg, now, 10_000);
    if (!r.ok) throw new Error("unreachable");
    await settle(ddb, r.reservation, 15_000);
    expect(aws.table.num("spend#2026-10", "m")).toBe(15_000);
    const r2 = await reserve(ddb, cfg, now, 5_000);
    if (!r2.ok) throw new Error("unreachable");
    await release(ddb, r2.reservation);
    expect(aws.table.num("spend#2026-10", "m")).toBe(15_000);
  });

  it("gives items a TTL: 100 days for the month, 3 days for the day", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    await reserve(ddb, cfg, now, 1);
    const secs = Math.floor(now / 1000);
    expect(aws.table.num("spend#2026-10", "ttl")).toBe(secs + 100 * 86400);
    expect(aws.table.num("spendday#2026-10-31", "ttl")).toBe(secs + 3 * 86400);
  });

  it("refuses at the exact limit", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    aws.table.items.set("spendday#2026-10-31", { pk: { S: "spendday#2026-10-31" }, m: { N: "2499000" } });
    expect(await hasHeadroom(ddb, cfg, now, 1000)).toBe(true);
    expect(await hasHeadroom(ddb, cfg, now, 1001)).toBe(false);
    expect((await reserve(ddb, cfg, now, 1001)).ok).toBe(false);
    expect((await reserve(ddb, cfg, now, 1000)).ok).toBe(true);
    expect(aws.table.num("spendday#2026-10-31", "m")).toBe(2_500_000);
  });

  it("ignores an item whose TTL has passed but that DynamoDB hasn't deleted yet", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const key = spendKeys(now).day;
    aws.table.items.set(key, { pk: { S: key }, m: { N: "2500000" }, ttl: { N: String(Math.floor(now / 1000) - 1) } });
    expect(await hasHeadroom(ddb, cfg, now, 1000)).toBe(true);
  });

  it("a settle that fails leaves the reservation counted (the meter can only over-count)", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const r = await reserve(ddb, cfg, now, 10_000);
    if (!r.ok) throw new Error("unreachable");
    aws.table.fault = () => "throttle";
    expect(await settle(ddb, r.reservation, 1_000)).toBe(false);
    aws.table.fault = undefined;
    expect(aws.table.num("spend#2026-10", "m")).toBe(10_000);
  });
});
