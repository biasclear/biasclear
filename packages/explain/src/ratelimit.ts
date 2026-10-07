// Per-connection limits (SPEC §9). The address is read from the request,
// turned into a salted hash, and dropped. The salt is 32 random bytes made on
// each UTC day's first request. It expires (TTL) two days after it is made,
// and the day's first request also deletes every salt from two to nine days
// back, so a missed delete is retried the next active day. DynamoDB's TTL
// erases an expired item within a few days even if the service sits idle.
// Once a salt is gone, nobody can turn a stored hash back into an address.

import { createHmac } from "node:crypto";
import type { Config } from "./config.js";
import { stringAttr, type Ddb } from "./aws/dynamodb.js";
import { CodedError } from "./codes.js";
import { isOverLimit, rememberOverLimit, type InstanceState } from "./state.js";
import { DAY_MS, dayKey, nextDayStart, seconds } from "./time.js";

export const WINDOW_MS = 10 * 60 * 1000;
export const SALT_TTL_MS = 2 * DAY_MS;
/** The day's first request deletes the salts from this many days back (2 to 9). */
export const SALT_DELETE_DAYS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function ipv4(s: string): string | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return parts.join(".");
}

/** The eight 16-bit groups of an IPv6 address, or undefined. */
function ipv6Groups(s: string): number[] | undefined {
  let text = s.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const v4 = ipv4(text.slice(lastColon + 1));
  if (v4 !== undefined) {
    const p = v4.split(".").map(Number) as [number, number, number, number];
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    text = text.slice(0, lastColon + 1) + "0:0";
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (h: string): number[] | undefined => {
    if (h === "") return [];
    const out: number[] = [];
    for (const g of h.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return undefined;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (left === undefined || right === undefined) return undefined;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 1) return undefined;
    groups = [...left, ...new Array<number>(fill).fill(0), ...right];
  } else {
    groups = left;
  }
  if (tail.length === 2) {
    groups = [...groups.slice(0, -2), ...tail];
  }
  return groups.length === 8 ? groups : undefined;
}

/**
 * What the limits count: an IPv4 address as it is, or the first 64 bits of an
 * IPv6 address (one home or phone usually holds a whole /64). An IPv4 address
 * written as IPv6 (::ffff:a.b.c.d) counts as the IPv4 address.
 */
export function connectionKey(sourceIp: string | undefined): string | undefined {
  if (typeof sourceIp !== "string" || sourceIp.length === 0 || sourceIp.length > 64) return undefined;
  const v4 = ipv4(sourceIp);
  if (v4 !== undefined) return v4;
  const g = ipv6Groups(sourceIp);
  if (g === undefined) return undefined;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".");
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(":")}::/64`;
}

/** First 16 bytes of HMAC-SHA256(salt, key), hex. */
export function connectionHash(salt: Uint8Array, key: string): string {
  return toHex(createHmac("sha256", salt).update(key, "utf8").digest().slice(0, 16));
}

/**
 * Today's salt: made on the day's first request (a conditional put), or read
 * with a strongly consistent get when another instance made it first. The
 * instance that makes it also deletes every salt from two to nine days back
 * (deleting a key that isn't there is harmless), so one failed or skipped
 * delete doesn't leave an old salt behind.
 */
export async function todaysSalt(
  ddb: Ddb,
  state: InstanceState,
  nowMs: number,
  randomBytes: (n: number) => Uint8Array,
): Promise<Uint8Array> {
  const day = dayKey(nowMs);
  if (state.salt?.day === day) return state.salt.bytes;
  const fresh = randomBytes(32);
  const made = await ddb.putIfAbsent({
    pk: { S: `salt#${day}` },
    s: { S: toHex(fresh) },
    ttl: { N: String(seconds(nowMs + SALT_TTL_MS)) },
  });
  let bytes: Uint8Array | undefined = fresh;
  if (made) {
    await Promise.allSettled(SALT_DELETE_DAYS.map((d) => ddb.delete(`salt#${dayKey(nowMs - d * DAY_MS)}`)));
  } else {
    bytes = fromHex(stringAttr(await ddb.get(`salt#${day}`, seconds(nowMs), true), "s") ?? "");
    if (bytes === undefined) throw new CodedError("E_SALT");
  }
  state.salt = { day, bytes };
  return bytes;
}

export type RateResult = "ok" | "E_RATE_SHORT" | "E_RATE_DAILY" | "E_RATE_LISTED";

/**
 * Counts this request against the connection's 10-minute and daily limits.
 * A refused request isn't counted. A hash over a limit is remembered in
 * memory until the limit resets, so its next requests cost no DynamoDB write.
 */
export async function checkRate(
  ddb: Ddb,
  state: InstanceState,
  cfg: Config,
  nowMs: number,
  hash: string,
): Promise<RateResult> {
  if (isOverLimit(state, hash, nowMs)) return "E_RATE_LISTED";
  const window = Math.floor(nowMs / WINDOW_MS);
  const windowEnd = (window + 1) * WINDOW_MS;
  const shortKey = `rate#${hash}#${window}`;
  if (!(await ddb.countUp(shortKey, cfg.ratePer10Min, seconds(windowEnd + 60 * 60 * 1000)))) {
    rememberOverLimit(state, hash, windowEnd, nowMs);
    return "E_RATE_SHORT";
  }
  const dayEnd = nextDayStart(nowMs);
  const dailyKey = `rateday#${hash}#${dayKey(nowMs)}`;
  let dailyOk: boolean;
  try {
    dailyOk = await ddb.countUp(dailyKey, cfg.ratePerDay, seconds(dayEnd + DAY_MS));
  } catch (err) {
    await ddb.countDown(shortKey).catch(() => undefined);
    throw err;
  }
  if (!dailyOk) {
    await ddb.countDown(shortKey).catch(() => undefined);
    rememberOverLimit(state, hash, dayEnd, nowMs);
    return "E_RATE_DAILY";
  }
  return "ok";
}
