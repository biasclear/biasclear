// The spend cap: the real stop (SPEC §8). Money is counted in whole
// micro-dollars at list price, from the model's own token counts, whatever
// credits the account has. A request reserves its worst case on the month and
// the day before the model is called, and settles the real cost after.

import type { Config } from "./config.js";
import type { Ddb } from "./aws/dynamodb.js";
import { numberAttr } from "./aws/dynamodb.js";
import { DAY_MS, dayKey, monthKey, seconds } from "./time.js";

/** Message framing the byte count doesn't cover (SPEC §8 step 1; the evaluation checks it). */
export const FRAMING_TOKENS = 50;
export const MONTH_TTL_MS = 100 * DAY_MS;
export const DAY_TTL_MS = 3 * DAY_MS;

type Prices = Pick<Config, "inNanosPerToken" | "outNanosPerToken">;

/** Worst case: a token is never shorter than a byte, so bytes (+ framing) bound the input tokens from above. */
export function worstCaseMicros(promptBytes: number, maxTokens: number, prices: Prices): number {
  const nanos = (promptBytes + FRAMING_TOKENS) * prices.inNanosPerToken + maxTokens * prices.outNanosPerToken;
  return Math.ceil(nanos / 1000);
}

/** The real cost, from the model's token counts, rounded up. */
export function actualMicros(inTok: number, outTok: number, prices: Prices): number {
  return Math.ceil((inTok * prices.inNanosPerToken + outTok * prices.outNanosPerToken) / 1000);
}

export function spendKeys(nowMs: number): { month: string; day: string } {
  return { month: `spend#${monthKey(nowMs)}`, day: `spendday#${dayKey(nowMs)}` };
}

/** A reservation in hand. The model call takes one, so it can't be made without one. */
export interface Reservation {
  readonly month: string;
  readonly day: string;
  readonly micros: number;
}

/**
 * Cheap, eventually consistent reads of both counters (SPEC §4 step 6).
 * True when both have room for `micros`. Throws a DdbError on any fault.
 */
export async function hasHeadroom(ddb: Ddb, cfg: Config, nowMs: number, micros: number): Promise<boolean> {
  const keys = spendKeys(nowMs);
  const now = seconds(nowMs);
  const [month, day] = await Promise.all([ddb.get(keys.month, now), ddb.get(keys.day, now)]);
  const spentMonth = numberAttr(month, "m") ?? 0;
  const spentDay = numberAttr(day, "m") ?? 0;
  return spentMonth + micros <= cfg.capMicros && spentDay + micros <= cfg.dailyMicros;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; which: "month" | "day" };

/**
 * Reserves `micros` on the month, then on the day, each with one
 * conditional update (SPEC §8 steps 3 and 4). If the day refuses, the month's
 * share is given back. Throws a DdbError on any other fault.
 */
export async function reserve(ddb: Ddb, cfg: Config, nowMs: number, micros: number): Promise<ReserveResult> {
  if (micros > cfg.capMicros || micros > cfg.dailyMicros) return { ok: false, which: "day" };
  const keys = spendKeys(nowMs);
  if (!(await ddb.reserve(keys.month, micros, cfg.capMicros, seconds(nowMs + MONTH_TTL_MS)))) {
    return { ok: false, which: "month" };
  }
  let dayOk: boolean;
  try {
    dayOk = await ddb.reserve(keys.day, micros, cfg.dailyMicros, seconds(nowMs + DAY_TTL_MS));
  } catch (err) {
    await ddb.add(keys.month, -micros).catch(() => undefined);
    throw err;
  }
  if (!dayOk) {
    // If the give-back fails, the month over-counts: the safe direction.
    await ddb.add(keys.month, -micros).catch(() => undefined);
    return { ok: false, which: "day" };
  }
  return { ok: true, reservation: { month: keys.month, day: keys.day, micros } };
}

/**
 * Settles on the keys the reservation used, so a request that crosses UTC
 * midnight settles where it reserved (SPEC §8 step 6). The delta is signed
 * and never clamped. Returns false if either write failed (the reservation
 * then stays counted: the meter can only over-count).
 */
export async function settle(ddb: Ddb, r: Reservation, actual: number): Promise<boolean> {
  const delta = actual - r.micros;
  if (delta === 0) return true;
  const results = await Promise.allSettled([ddb.add(r.month, delta), ddb.add(r.day, delta)]);
  return results.every((x) => x.status === "fulfilled");
}

/** Gives a reservation back, for a call AWS doesn't bill. */
export async function release(ddb: Ddb, r: Reservation): Promise<boolean> {
  return settle(ddb, r, 0);
}
