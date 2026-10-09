// DynamoDB's transaction-conflict rule, which FakeTable does not model (it applies
// transactions one at a time and never conflicts). Adapted from the 306 review's
// fault harness. An in-flight TransactWriteItems holds every item it touches for
// `txMs`: another transaction touching one of them is cancelled with reason
// TransactionConflict, and a single-item write to a held item gets
// TransactionConflictException. Nothing here is AWS evidence; it follows the
// documented rule the ledger code must survive.

import type { AwsCall, AwsReply, Transport } from "../src/aws/transport.js";
import { FakeAws } from "./helpers.js";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function opOf(call: AwsCall): string {
  return (call.headers["x-amz-target"] ?? "").replace("DynamoDB_20120810.", "");
}

/** The item key each transaction component touches, in order. */
export function txKeys(body: Record<string, unknown>): string[] {
  return (body.TransactItems as Record<string, Record<string, unknown>>[]).map((item) => {
    const [component, b] = Object.entries(item)[0]!;
    return component === "Put" ? (b.Item as Record<string, { S: string }>).pk!.S : (b.Key as { pk: { S: string } }).pk.S;
  });
}

export class ConflictAws {
  readonly aws = new FakeAws();
  readonly locks = new Set<string>();
  /** How long an in-flight transaction holds its items (real ms). */
  txMs = 0;
  conflicts = 0;
  /** The keys of every transaction sent, in order. */
  readonly txLog: string[][] = [];
  /** Force a conflict on the next matching transaction, whatever is held. */
  forceConflict: ((body: Record<string, unknown>) => boolean) | undefined;

  readonly transport: Transport = async (call) => {
    if (call.service !== "dynamodb") return this.aws.transport(call);
    const op = opOf(call);
    const body = JSON.parse(call.body) as Record<string, unknown>;
    if (op === "TransactWriteItems") {
      const keys = txKeys(body);
      this.txLog.push(keys);
      const forced = this.forceConflict?.(body) === true;
      const idx = forced ? 0 : keys.findIndex((k) => this.locks.has(k));
      if (idx >= 0) {
        this.conflicts++;
        return {
          status: 400, headers: {},
          body: JSON.stringify({
            __type: "com.amazonaws.dynamodb.v20120810#TransactionCanceledException",
            CancellationReasons: keys.map((_, i) => ({ Code: i === idx ? "TransactionConflict" : "None" })),
          }),
        } satisfies AwsReply;
      }
      for (const k of keys) this.locks.add(k);
      try {
        if (this.txMs) await sleep(this.txMs);
        return await this.aws.transport(call);
      } finally {
        for (const k of keys) this.locks.delete(k);
      }
    }
    if (op === "PutItem" || op === "UpdateItem" || op === "DeleteItem") {
      const key = op === "PutItem" ? (body.Item as Record<string, { S: string }>).pk!.S : (body.Key as { pk: { S: string } }).pk.S;
      if (this.locks.has(key)) {
        this.conflicts++;
        return { status: 400, headers: {}, body: JSON.stringify({ __type: "com.amazonaws.dynamodb.v20120810#TransactionConflictException" }) };
      }
    }
    return this.aws.transport(call);
  };

  items(prefix: string): Array<[string, Record<string, { S: string } | { N: string }>]> {
    return [...this.aws.table.items.entries()].filter(([k]) => k.startsWith(prefix));
  }
}
