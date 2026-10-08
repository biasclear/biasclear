// Every reservation and settlement updates month/day together. A durable event
// record proves committed writes after a lost acknowledgment. No signed ADD is
// blindly retried, and a persistent billing pause fences new reservations.

import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Code } from "./codes.js";
import { DDB_TIMEOUT_MS, DdbError, numberAttr, stringAttr, type Ddb, type Item } from "./aws/dynamodb.js";
import { DAY_MS, dayKey, monthKey, seconds } from "./time.js";

/** Synthetic/legacy arithmetic allowance only; live callers need model-specific evidence. */
export const FRAMING_TOKENS = 50;
export const MONTH_TTL_MS = 100 * DAY_MS;
export const DAY_TTL_MS = 3 * DAY_MS;
export const BILLING_PAUSE_KEY = "billing#pause";

/** Time left in this invocation, in ms (the Lambda context); Infinity when unknown (tests, scripts). */
export interface Deadline { left(): number }
export const NO_DEADLINE: Deadline = { left: () => Number.POSITIVE_INFINITY };
/** Kept at the very end of an invocation for the fixed log line. */
export const LOG_RESERVE_MS = 300;
/** Kept after a settlement attempt for the fence and debt writes, if the settlement fails (314 M1). */
export const FENCE_RESERVE_MS = 2_500;
/** The longest the fence and debt writes keep retrying: a reserve can hold billing#pause for a
 * second or more under contention (314 M2). Always cut to the time the invocation has left. */
export const PERSIST_WINDOW_MS = 4_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Prices = Pick<Config, "inNanosPerToken" | "outNanosPerToken">;

/** A candidate bound, usable live only when the selected model's evidence says yes. */
export function worstCaseMicros(promptBytes: number, maxTokens: number, prices: Prices, framingTokens = FRAMING_TOKENS): number {
  return Math.ceil(((promptBytes + framingTokens) * prices.inNanosPerToken + maxTokens * prices.outNanosPerToken) / 1000);
}

export function actualMicros(inTok: number, outTok: number, prices: Prices): number {
  return Math.ceil((inTok * prices.inNanosPerToken + outTok * prices.outNanosPerToken) / 1000);
}

export function spendKeys(nowMs: number): { month: string; day: string } {
  return { month: `spend#${monthKey(nowMs)}`, day: `spendday#${dayKey(nowMs)}` };
}

export interface Reservation {
  readonly month: string;
  readonly day: string;
  readonly micros: number;
  readonly event: string;
  readonly token: string;
}

/** No TTL: only an owner can clear a billing anomaly, including after month rollover. */
export async function billingPaused(ddb: Ddb, nowMs: number): Promise<boolean> {
  return (await ddb.get(BILLING_PAUSE_KEY, seconds(nowMs), true)) !== undefined;
}

export async function hasHeadroom(ddb: Ddb, cfg: Config, nowMs: number, micros: number): Promise<boolean> {
  const keys = spendKeys(nowMs);
  const [month, day] = await Promise.all([ddb.get(keys.month, seconds(nowMs)), ddb.get(keys.day, seconds(nowMs))]);
  return (numberAttr(month, "m") ?? 0) + micros <= cfg.capMicros && (numberAttr(day, "m") ?? 0) + micros <= cfg.dailyMicros;
}

/** Attempts for a reserve or settlement that DynamoDB definitely rejected (306 c). */
export const SETTLE_ATTEMPTS = 3;
const BUSY_REASONS = new Set(["TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded", "RequestLimitExceeded"]);
const BUSY_TYPES = new Set(["ThrottlingException", "ProvisionedThroughputExceededException", "RequestLimitExceeded", "TransactionConflictException"]);

/** DynamoDB answered, and nothing in the transaction was written: a conflict or throttling, with no
 * failed condition. A missing reply, a timeout or a server error is never definite. */
export function definitelyNotWritten(err: unknown): boolean {
  if (!(err instanceof DdbError)) return false;
  if (BUSY_TYPES.has(err.type)) return true;
  return err.type === "TransactionCanceledException" && err.cancellationReasons.some((r) => BUSY_REASONS.has(r)) &&
    err.cancellationReasons.every((r) => r === "None" || BUSY_REASONS.has(r));
}

function backoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 20)));
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; which: "month" | "day" | "pause" };

function reserveUpdate(pk: string, micros: number, limit: number, ttl: number): Record<string, unknown> {
  return {
    Key: { pk: { S: pk } },
    UpdateExpression: "SET #m = if_not_exists(#m, :zero) + :r, #t = :t",
    ConditionExpression: "attribute_not_exists(#m) OR #m <= :max",
    ExpressionAttributeNames: { "#m": "m", "#t": "ttl" },
    ExpressionAttributeValues: { ":zero": { N: "0" }, ":r": { N: String(micros) }, ":t": { N: String(ttl) }, ":max": { N: String(limit - micros) } },
  };
}

function matches(item: Item | undefined, r: Reservation): boolean {
  return stringAttr(item, "month") === r.month && stringAttr(item, "day") === r.day && numberAttr(item, "reserved") === r.micros;
}

/** The pause condition and both cap checks are in the same atomic transaction. A transaction
 * DynamoDB definitely rejected (conflict or throttling) is tried again with a new event. */
export async function reserve(ddb: Ddb, cfg: Config, nowMs: number, micros: number): Promise<ReserveResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await reserveOnce(ddb, cfg, nowMs, micros);
    } catch (err) {
      if (!(err instanceof BusyError) || attempt >= SETTLE_ATTEMPTS) throw err instanceof BusyError ? new DdbError("other") : err;
      await backoff(attempt);
    }
  }
}

/** A definite rejection whose event read back as absent: nothing was written. */
class BusyError extends DdbError {}

async function reserveOnce(ddb: Ddb, cfg: Config, nowMs: number, micros: number): Promise<ReserveResult> {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new DdbError("other");
  if (micros > cfg.capMicros || micros > cfg.dailyMicros) return { ok: false, which: "day" };
  const token = randomUUID();
  const keys = spendKeys(nowMs);
  const r: Reservation = { ...keys, micros, token, event: `billing#${token}` };
  try {
    await ddb.transact([
      { ConditionCheck: { Key: { pk: { S: BILLING_PAUSE_KEY } }, ConditionExpression: "attribute_not_exists(pk)" } },
      { Update: reserveUpdate(r.month, micros, cfg.capMicros, seconds(nowMs + MONTH_TTL_MS)) },
      { Update: reserveUpdate(r.day, micros, cfg.dailyMicros, seconds(nowMs + DAY_TTL_MS)) },
      { Put: { Item: { pk: { S: r.event }, state: { S: "reserved" }, month: { S: r.month }, day: { S: r.day }, reserved: { N: String(micros) }, ttl: { N: String(seconds(nowMs + MONTH_TTL_MS)) } }, ConditionExpression: "attribute_not_exists(pk)" } },
    ], token);
    return { ok: true, reservation: r };
  } catch (err) {
    // A read proving the unique event committed proves both counters committed.
    // A missing/unreadable event never authorizes a model call or a refund.
    const item = await ddb.get(r.event, seconds(nowMs), true);
    if (matches(item, r) && stringAttr(item, "state") === "reserved") return { ok: true, reservation: r };
    if (err instanceof DdbError) {
      const reasons = err.cancellationReasons;
      if (reasons[0] === "ConditionalCheckFailed") return { ok: false, which: "pause" };
      if (reasons[1] === "ConditionalCheckFailed") return { ok: false, which: "month" };
      if (reasons[2] === "ConditionalCheckFailed") return { ok: false, which: "day" };
    }
    if (item === undefined && definitelyNotWritten(err)) throw new BusyError("other");
    throw new DdbError("other");
  }
}

export interface PauseDetail {
  reason: Code;
  nowMs: number;
  reservedMicros: number;
  actualMicros?: number;
  event: string;
}

function pauseItem(p: PauseDetail): Item {
  return {
    pk: { S: BILLING_PAUSE_KEY }, reason: { S: p.reason }, at: { N: String(seconds(p.nowMs)) }, reserved: { N: String(p.reservedMicros) },
    ...(p.actualMicros === undefined ? {} : { actual: { N: String(p.actualMicros) } }),
    event: { S: p.event },
  };
}

function debtItem(p: PauseDetail): Item {
  return { ...pauseItem(p), pk: { S: `billingdebt#${p.event.slice("billing#".length)}` } };
}

/** Writes one record that is safe to overwrite (no counter) until it lands or the time is up: each
 * failure (a conflict, a throttle, a lost acknowledgment) is read back, then retried with growing
 * backoff. Every call's timeout is cut to the time left, so nothing outlives the invocation. */
async function putDurably(ddb: Ddb, item: Item, landed: (found: Item | undefined) => boolean, deadline: Deadline): Promise<boolean> {
  const pk = stringAttr(item, "pk")!;
  const stopAt = Date.now() + Math.min(PERSIST_WINDOW_MS, deadline.left() - LOG_RESERVE_MS);
  const left = (): number => stopAt - Date.now();
  for (let attempt = 0; left() > 0; attempt++) {
    try {
      await ddb.put(item, Math.min(DDB_TIMEOUT_MS, left()));
      return true;
    } catch { /* read back below, then write again */ }
    if (left() <= 0) break;
    try {
      if (landed(await ddb.get(pk, 0, true, Math.min(DDB_TIMEOUT_MS, left())))) return true;
    } catch { /* unreadable: write again */ }
    const wait = Math.min(400, 25 * 2 ** attempt) + Math.floor(Math.random() * 25);
    if (left() <= wait) break;
    await sleep(wait);
  }
  return false;
}

/** The shared fence. Every reserve checks it, so it is written alone, never in a transaction
 * with another item (306 b); a later pause may overwrite an earlier one, as before. */
export async function persistPause(ddb: Ddb, p: PauseDetail, deadline: Deadline = NO_DEADLINE): Promise<boolean> {
  return putDurably(ddb, pauseItem(p), (found) => found !== undefined, deadline);
}

/** Persist every unresolved event, not just the first pause, without text or keys. The shared fence
 * and the event's own debt row (a key nothing else writes) are written at the same time, each on its
 * own, so a slow or unavailable debt key can't delay the fence (314 M1). Both are overwrites; no
 * money ADD is retried. A debt survives log expiry and month rollover until an owner reconciles it. */
export async function persistBillingPause(ddb: Ddb, p: PauseDetail, deadline: Deadline = NO_DEADLINE): Promise<boolean> {
  const [paused, debtKept] = await Promise.all([
    persistPause(ddb, p, deadline),
    putDurably(ddb, debtItem(p), (known) => stringAttr(known, "event") === p.event &&
      numberAttr(known, "reserved") === p.reservedMicros && numberAttr(known, "actual") === p.actualMicros, deadline),
  ]);
  return paused && debtKept;
}

/** Atomic CAS event + month + day. A bound breach commits its own debt row with them (a key
 * nothing else writes); the caller then writes the shared pause on its own (persistPause), so the
 * settlement never contends on the item every reserve checks (306 b). Every attempt leaves
 * FENCE_RESERVE_MS of the invocation for the stop records in case it fails (314 M1). */
export async function settle(ddb: Ddb, r: Reservation, actual: number, breach?: PauseDetail, deadline: Deadline = NO_DEADLINE): Promise<boolean> {
  if (!Number.isSafeInteger(actual) || actual < 0) return false;
  const delta = actual - r.micros;
  const add = (pk: string) => ({ Key: { pk: { S: pk } }, UpdateExpression: "ADD #m :d", ExpressionAttributeNames: { "#m": "m" }, ExpressionAttributeValues: { ":d": { N: String(delta) } } });
  const writes: Record<string, Record<string, unknown>>[] = [
    { Update: { Key: { pk: { S: r.event } }, UpdateExpression: "SET #s = :settled, #a = :actual", ConditionExpression: "#s = :reserved", ExpressionAttributeNames: { "#s": "state", "#a": "actual" }, ExpressionAttributeValues: { ":reserved": { S: "reserved" }, ":settled": { S: "settled" }, ":actual": { N: String(actual) } } } },
    { Update: add(r.month) }, { Update: add(r.day) },
  ];
  if (breach !== undefined) writes.push({ Put: { Item: debtItem(breach) } });
  const budget = (): number => deadline.left() - FENCE_RESERVE_MS - LOG_RESERVE_MS;
  for (let attempt = 1; ; attempt++) {
    if (budget() <= 0) return false; // Out of time: left unresolved for the caller's durable pause.
    try {
      // Distinct token from the reservation, fresh on each retry; the CAS is the durable idempotence fence.
      await ddb.transact(writes, attempt === 1 ? r.token.replace(/.$/, r.token.endsWith("0") ? "1" : "0") : randomUUID(),
        Math.min(DDB_TIMEOUT_MS, budget()));
      return true;
    } catch (err) {
      let item: Item | undefined;
      try {
        if (budget() <= 0) return false;
        item = await ddb.get(r.event, 0, true, Math.min(DDB_TIMEOUT_MS, budget()));
      } catch { return false; }
      // The debt row commits atomically with the event, so a settled event proves it.
      if (matches(item, r) && stringAttr(item, "state") === "settled" && numberAttr(item, "actual") === actual) return true;
      // Only a definite rejection of a still-reserved event is tried again; anything uncertain stays
      // unresolved for the caller's durable pause (306 c).
      const reserved = matches(item, r) && stringAttr(item, "state") === "reserved";
      if (!reserved || !definitelyNotWritten(err) || attempt >= SETTLE_ATTEMPTS) return false;
      await backoff(attempt);
    }
  }
}

export async function release(ddb: Ddb, r: Reservation, deadline: Deadline = NO_DEADLINE): Promise<boolean> {
  return settle(ddb, r, 0, undefined, deadline);
}
