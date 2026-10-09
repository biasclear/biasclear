// Connection keys, the daily salt and the over-limit list (SPEC §9).

import { describe, expect, it } from "vitest";
import { Ddb } from "../src/aws/dynamodb.js";
import { SALT_DELETE_DAYS, connectionHash, connectionKey, todaysSalt } from "../src/ratelimit.js";
import { OVER_LIMIT_MAX, isOverLimit, newState, rememberOverLimit } from "../src/state.js";
import { FakeAws } from "./helpers.js";

describe("connectionKey", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(connectionKey("203.0.113.7")).toBe("203.0.113.7");
    expect(connectionKey("256.0.0.1")).toBeUndefined();
  });

  it("groups IPv6 addresses by their first 64 bits", () => {
    expect(connectionKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(connectionKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(connectionKey("2001:DB8:1:2:a:b:c:d")).toBe("2001:db8:1:2::/64");
    expect(connectionKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(connectionKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(connectionKey("::1")).toBe("0:0:0:0::/64");
  });

  it("reads an IPv4 address written as IPv6 as the IPv4 address", () => {
    expect(connectionKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(connectionKey("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("refuses anything that isn't an address", () => {
    for (const bad of [undefined, "", "not an ip", "1::2::3", "2001:db8:1:2:3:4:5:6:7", "12345::1", "::g", "x".repeat(65)]) {
      expect(connectionKey(bad)).toBeUndefined();
    }
  });
});

describe("the salted hash", () => {
  const salt = new Uint8Array(32).fill(7);
  it("is 16 bytes of hex, stable for one salt and different for another", () => {
    const h = connectionHash(salt, "203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(connectionHash(salt, "203.0.113.7")).toBe(h);
    expect(connectionHash(new Uint8Array(32).fill(8), "203.0.113.7")).not.toBe(h);
    expect(connectionHash(salt, "203.0.113.8")).not.toBe(h);
  });
});

describe("the daily salt", () => {
  const day = Date.UTC(2026, 9, 5, 0, 0, 1);

  it("is made on the day's first request, deletes the salt from two days back, and is cached", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    aws.table.items.set("salt#2026-10-03", { pk: { S: "salt#2026-10-03" }, s: { S: "0".repeat(64) } });
    const state = newState();
    const a = await todaysSalt(ddb, state, day, (n) => new Uint8Array(n).fill(1));
    expect(a).toEqual(new Uint8Array(32).fill(1));
    expect(aws.table.items.has("salt#2026-10-05")).toBe(true);
    expect(aws.table.items.has("salt#2026-10-03")).toBe(false);
    expect(aws.table.num("salt#2026-10-05", "ttl")).toBe(Math.floor(day / 1000) + 2 * 86400);
    const ops = aws.table.ops.length;
    expect(await todaysSalt(ddb, state, day + 1000, () => new Uint8Array(32))).toBe(a);
    expect(aws.table.ops.length).toBe(ops);
  });

  it("deletes every salt from two to nine days back, so a quiet day doesn't leave one behind", async () => {
    // RT finding: only day-2 was deleted, and only when a request arrived on
    // exactly that day; after a quiet day an old salt waited for TTL.
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    for (const d of ["2026-09-25", "2026-09-26", "2026-09-28", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) {
      aws.table.items.set(`salt#${d}`, { pk: { S: `salt#${d}` }, s: { S: "0".repeat(64) } });
    }
    await todaysSalt(ddb, newState(), day, (n) => new Uint8Array(n).fill(1));
    const left = [...aws.table.items.keys()].filter((k) => k.startsWith("salt#")).sort();
    // Yesterday's salt stays (its hashes still count today); 2026-09-25 is ten days back, past TTL.
    expect(left).toEqual(["salt#2026-09-25", "salt#2026-10-04", "salt#2026-10-05"]);
    expect(SALT_DELETE_DAYS).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("still makes the salt when the deletes fail, and retries them on the next day", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    aws.table.items.set("salt#2026-10-03", { pk: { S: "salt#2026-10-03" }, s: { S: "0".repeat(64) } });
    aws.table.fault = (op) => (op === "DeleteItem" ? "throttle" : undefined);
    const salt = await todaysSalt(ddb, newState(), day, (n) => new Uint8Array(n).fill(1));
    expect(salt).toEqual(new Uint8Array(32).fill(1));
    expect(aws.table.items.has("salt#2026-10-03")).toBe(true);
    aws.table.fault = undefined;
    await todaysSalt(ddb, newState(), day + 86_400_000, (n) => new Uint8Array(n).fill(2));
    expect(aws.table.items.has("salt#2026-10-03")).toBe(false);
  });

  it("is read with a strongly consistent read when another instance made it first", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const other = "ab".repeat(32);
    aws.table.items.set("salt#2026-10-05", { pk: { S: "salt#2026-10-05" }, s: { S: other } });
    const salt = await todaysSalt(ddb, newState(), day, (n) => new Uint8Array(n).fill(1));
    expect(salt).toEqual(new Uint8Array(32).fill(0xab));
    const get = aws.calls.map((c) => JSON.parse(c.body) as Record<string, unknown>).find((b) => "ConsistentRead" in b);
    expect(get?.ConsistentRead).toBe(true);
    expect(aws.table.items.has("salt#2026-10-05")).toBe(true);
  });

  it("rotates at the next UTC day", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, "us-east-1", "t");
    const state = newState();
    let n = 0;
    const rnd = (len: number) => new Uint8Array(len).fill(++n);
    const a = await todaysSalt(ddb, state, day, rnd);
    const b = await todaysSalt(ddb, state, day + 86_400_000, rnd);
    expect(b).not.toEqual(a);
    expect(state.salt?.day).toBe("2026-10-06");
  });
});

describe("the over-limit list", () => {
  it("forgets an entry when its limit resets", () => {
    const s = newState();
    rememberOverLimit(s, "h", 1000, 0);
    expect(isOverLimit(s, "h", 999)).toBe(true);
    expect(isOverLimit(s, "h", 1000)).toBe(false);
    expect(s.overLimit.size).toBe(0);
  });

  it("holds at most 10,000 entries, dropping expired ones first, then the oldest", () => {
    const s = newState();
    for (let i = 0; i < OVER_LIMIT_MAX; i++) rememberOverLimit(s, `h${i}`, i < 10 ? 5 : 10_000, 0);
    rememberOverLimit(s, "new", 10_000, 6);
    expect(s.overLimit.size).toBe(OVER_LIMIT_MAX - 9);
    for (let i = OVER_LIMIT_MAX - 9; i < OVER_LIMIT_MAX + 5; i++) rememberOverLimit(s, `more${i}`, 10_000, 6);
    expect(s.overLimit.size).toBe(OVER_LIMIT_MAX);
    expect(s.overLimit.has("h10")).toBe(false);
    expect(s.overLimit.has("new")).toBe(true);
  });
});
