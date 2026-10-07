// The DynamoDB calls this function makes, on its one table. Each is a single
// request with no retry. Items hold counters, one daily salt, and a TTL;
// never text and never an address (SPEC §8, §9, §10).

import { parseJsonOrUndefined } from "../json.js";
import type { Transport } from "./transport.js";

export type Attr = { S: string } | { N: string };
export type Item = Record<string, Attr>;

/** A DynamoDB error. `kind` is "condition" for a failed condition, "other" for anything else. */
export class DdbError extends Error {
  readonly kind: "condition" | "other";
  constructor(kind: "condition" | "other") {
    super(kind);
    this.kind = kind;
    this.name = "DdbError";
  }
}

export const DDB_TIMEOUT_MS = 3000;

export class Ddb {
  constructor(
    private readonly transport: Transport,
    private readonly region: string,
    private readonly table: string,
  ) {}

  private async call(operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let reply;
    try {
      reply = await this.transport({
        service: "dynamodb",
        host: `dynamodb.${this.region}.amazonaws.com`,
        method: "POST",
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.0",
          "x-amz-target": `DynamoDB_20120810.${operation}`,
        },
        body: JSON.stringify({ TableName: this.table, ...payload }),
        timeoutMs: DDB_TIMEOUT_MS,
      });
    } catch {
      throw new DdbError("other");
    }
    const json = parseJsonOrUndefined(reply.body);
    const obj = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
    if (reply.status !== 200) {
      const type = typeof obj.__type === "string" ? obj.__type : "";
      throw new DdbError(type.endsWith("#ConditionalCheckFailedException") ? "condition" : "other");
    }
    return obj;
  }

  /** The item, or undefined if there is none or its TTL has passed. */
  async get(pk: string, nowSec: number, consistent = false): Promise<Item | undefined> {
    const out = await this.call("GetItem", { Key: { pk: { S: pk } }, ConsistentRead: consistent });
    const item = out.Item as Item | undefined;
    if (item === undefined || item === null || typeof item !== "object") return undefined;
    const ttl = numberAttr(item, "ttl");
    if (ttl !== undefined && ttl <= nowSec) return undefined;
    return item;
  }

  /**
   * Adds `amount` to the micro-dollar counter `m` if the result stays within
   * `limit`. One conditional UpdateItem: atomic even on a busy item.
   * Returns false when the limit would be passed.
   */
  async reserve(pk: string, amount: number, limit: number, ttl: number): Promise<boolean> {
    try {
      await this.call("UpdateItem", {
        Key: { pk: { S: pk } },
        UpdateExpression: "SET #m = if_not_exists(#m, :zero) + :r, #t = :t",
        ConditionExpression: "attribute_not_exists(#m) OR #m <= :max",
        ExpressionAttributeNames: { "#m": "m", "#t": "ttl" },
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
          ":r": { N: String(amount) },
          ":t": { N: String(ttl) },
          ":max": { N: String(limit - amount) },
        },
      });
      return true;
    } catch (err) {
      if (err instanceof DdbError && err.kind === "condition") return false;
      throw err;
    }
  }

  /** Adds a signed amount to the micro-dollar counter `m`, with no condition. */
  async add(pk: string, delta: number): Promise<void> {
    await this.call("UpdateItem", {
      Key: { pk: { S: pk } },
      UpdateExpression: "ADD #m :d",
      ExpressionAttributeNames: { "#m": "m" },
      ExpressionAttributeValues: { ":d": { N: String(delta) } },
    });
  }

  /** Counts one request if the count is still under `limit`. Returns false when it isn't (the request is not counted). */
  async countUp(pk: string, limit: number, ttl: number): Promise<boolean> {
    try {
      await this.call("UpdateItem", {
        Key: { pk: { S: pk } },
        UpdateExpression: "ADD #n :one SET #t = :t",
        ConditionExpression: "attribute_not_exists(#n) OR #n < :limit",
        ExpressionAttributeNames: { "#n": "n", "#t": "ttl" },
        ExpressionAttributeValues: { ":one": { N: "1" }, ":t": { N: String(ttl) }, ":limit": { N: String(limit) } },
      });
      return true;
    } catch (err) {
      if (err instanceof DdbError && err.kind === "condition") return false;
      throw err;
    }
  }

  /** Takes back one count (used when a later limit refuses the request). */
  async countDown(pk: string): Promise<void> {
    await this.call("UpdateItem", {
      Key: { pk: { S: pk } },
      UpdateExpression: "ADD #n :minus",
      ExpressionAttributeNames: { "#n": "n" },
      ExpressionAttributeValues: { ":minus": { N: "-1" } },
    });
  }

  /** Writes an item only if none has this key. Returns false if one already exists. */
  async putIfAbsent(item: Item): Promise<boolean> {
    try {
      await this.call("PutItem", { Item: item, ConditionExpression: "attribute_not_exists(pk)" });
      return true;
    } catch (err) {
      if (err instanceof DdbError && err.kind === "condition") return false;
      throw err;
    }
  }

  async delete(pk: string): Promise<void> {
    await this.call("DeleteItem", { Key: { pk: { S: pk } } });
  }
}

export function numberAttr(item: Item | undefined, name: string): number | undefined {
  const a = item?.[name] as { N?: unknown } | undefined;
  if (a === undefined || typeof a.N !== "string" || !/^-?\d{1,15}$/.test(a.N)) return undefined;
  return Number(a.N);
}

export function stringAttr(item: Item | undefined, name: string): string | undefined {
  const a = item?.[name] as { S?: unknown } | undefined;
  return a !== undefined && typeof a.S === "string" ? a.S : undefined;
}
