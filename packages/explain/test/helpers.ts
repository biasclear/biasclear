// Test doubles: a fake AWS (an in-memory DynamoDB that runs the exact update
// and condition expressions the function sends, a scripted Bedrock model and
// the two account settings), a clock, and builders for events and replies.
// No test reaches the network or spends anything.

import { createHandler, type Deps } from "../src/app.js";
import type { AwsCall, AwsReply, Transport } from "../src/aws/transport.js";
import { TransportError } from "../src/aws/transport.js";
import { MODELS, type ModelInfo } from "../src/models.js";
import { readConfig, type Config } from "../src/config.js";
import { bundledEngines } from "../src/engines.js";
import type { HttpResult } from "../src/http.js";
import { bundledMoves } from "../src/moves.js";
import { newState } from "../src/state.js";

export const SENTENCE =
  "Every serious economist agrees that the Harlan Valley plan will lower rents within two years.";
export const RULE = "CONSENSUS_AS_EVIDENCE";
export const START = 0;
export const END = 30;
export const RULES_VERSION = bundledEngines().current;
export const ORIGIN = "https://biasclear.github.io";
/** A made-up evaluation key (64 hex characters), not a credential. */
export const EVAL_KEY = "e".repeat(64);

/** The model's choice for the documented example: reviewed phrase ids (data/explain-phrases.json). */
export const GOOD_CHOICE = { does: ["d1"], unsaid: ["u1", "u2"] };
/** The explanation the server writes from GOOD_CHOICE (src/compose.ts). */
export const GOOD_HOW =
  'The words \u{201C}Every serious economist agrees\u{201D} treat agreement as if it were evidence. ' +
  "The sentence does not say who exactly agrees or what evidence the agreement rests on.";
export const GOOD_PLAINER = "Many economists say that the Harlan Valley plan will lower rents within two years.";

export const ENV: Record<string, string> = {
  AWS_REGION: "us-east-1",
  EXPLAIN_SWITCH: "on",
  EXPLAIN_TABLE: "biasclear-explain",
  EXPLAIN_MODEL_ID: "us.xai.grok-4.7",
  EXPLAIN_PRICE_IN: "2.20",
  EXPLAIN_PRICE_OUT: "6.60",
  EXPLAIN_MONTHLY_CAP_USD: "25",
  EXPLAIN_DAILY_PERCENT: "10",
  EXPLAIN_ORIGINS: "https://biasclear.github.io,https://biasclear.com",
  EXPLAIN_RETENTION_MODE: "none",
  EXPLAIN_RATE_10MIN: "10",
  EXPLAIN_RATE_DAY: "50",
  EXPLAIN_EVAL_KEY: EVAL_KEY,
};

/** The live evaluation's direct invoke, carrying this deploy's key. */
export function evalEvent(request: unknown = requestBody(), key: string = EVAL_KEY): Record<string, unknown> {
  return { explainEvaluation: 1, key, request };
}

/** Explicit finite synthetic model contract. It is never used by the production entrypoint. */
export const STUB_MODELS: Readonly<Record<string, ModelInfo>> = Object.freeze(Object.fromEntries(
  Object.entries(MODELS).map(([id, model]) => [id, Object.freeze({ ...model, billedMaxTokens: 400,
    liveBlockReason: "", settingsVerified: true,
    reasoningAccounting: { state: "yes" as const, source: "synthetic fixture, not Bedrock evidence", checkedOn: "2026-10-07" },
    inputTokenBound: { state: "yes" as const, framingTokens: 50, source: "synthetic fixture, not Bedrock evidence", checkedOn: "2026-10-07" },
  })]),
));

export function stubConfig(env: Record<string, string>): Config | undefined {
  return readConfig(env, STUB_MODELS);
}

export function config(overrides: Record<string, string> = {}): Config {
  const c = stubConfig({ ...ENV, ...overrides });
  if (c === undefined) throw new Error("test config is invalid");
  return c;
}

export function requestBody(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { v: 1, rules: RULES_VERSION, rule: RULE, domain: "general", sentence: SENTENCE, start: START, end: END, ...over };
}

export interface EventOptions {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  method?: string;
  path?: string;
  ip?: string;
  contentType?: string | null;
  headers?: Record<string, string>;
  isBase64Encoded?: boolean;
}

export function httpEvent(o: EventOptions = {}): Record<string, unknown> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.contentType !== null) headers["content-type"] = o.contentType ?? "application/json";
  const path = o.path ?? "/v1/explain";
  return {
    version: "2.0",
    routeKey: `${o.method ?? "POST"} ${path}`,
    rawPath: path,
    headers,
    body: o.rawBody ?? JSON.stringify(o.body ?? requestBody()),
    isBase64Encoded: o.isBase64Encoded ?? false,
    requestContext: { http: { method: o.method ?? "POST", path, sourceIp: o.ip ?? "203.0.113.7" } },
  };
}

export interface ModelReplyOptions {
  /** A free-text explanation: the old reply shape, which the checker now refuses. */
  how?: string;
  does?: unknown;
  unsaid?: unknown;
  plainer?: string | null;
  text?: string;
  stop_reason?: string;
  inTok?: number;
  outTok?: number;
  usage?: unknown;
  content?: unknown;
}

export function modelReply(o: ModelReplyOptions = {}): Record<string, unknown> {
  const payload: Record<string, unknown> =
    o.how !== undefined ? { how: o.how } : { does: o.does ?? GOOD_CHOICE.does, unsaid: o.unsaid ?? GOOD_CHOICE.unsaid };
  if (o.plainer !== null) payload.plainer = o.plainer ?? GOOD_PLAINER;
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: o.content ?? [{ type: "text", text: o.text ?? JSON.stringify(payload) }],
    stop_reason: o.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: o.usage === undefined ? { input_tokens: o.inTok ?? 820, output_tokens: o.outTok ?? 120 } : o.usage,
  };
}

/** Convert the validator's normalized reply fixture into a Converse wire reply. */
export function converseReply(reply: Record<string, unknown>): Record<string, unknown> {
  if ("output" in reply || !("content" in reply)) return reply;
  const content = Array.isArray(reply.content) ? reply.content.map((value: unknown) => {
    const b = value as Record<string, unknown>;
    if (b?.type === "text") return { text: b.text };
    if (b?.type === "thinking") return { reasoningContent: { reasoningText: { text: b.thinking } } };
    return { toolUse: b };
  }) : reply.content;
  const u = reply.usage;
  const usage = u !== null && typeof u === "object" && !Array.isArray(u)
    ? { inputTokens: (u as Record<string, unknown>).input_tokens, outputTokens: (u as Record<string, unknown>).output_tokens } : u;
  return { output: { message: { role: "assistant", content } }, stopReason: reply.stop_reason, usage };
}

export type ModelScript = (body: Record<string, unknown>) =>
  | { status: number; json?: unknown; errorType?: string }
  | "timeout"
  | "network"
  | Promise<{ status: number; json?: unknown; errorType?: string } | "timeout" | "network">;

type Attr = { S: string } | { N: string };
type Item = Record<string, Attr>;

/** An in-memory DynamoDB table that evaluates the function's own expressions. */
export class FakeTable {
  readonly items = new Map<string, Item>();
  /** Return a fault for an operation instead of running it. */
  fault: ((op: string, payload: Record<string, unknown>) => "throttle" | "network" | "response-lost" | undefined) | undefined;
  /** Delay (ms) before each operation runs, to interleave concurrent requests. */
  delayMs = 0;
  readonly ops: string[] = [];

  num(pk: string, attr: string): number | undefined {
    const a = this.items.get(pk)?.[attr] as { N?: string } | undefined;
    return a?.N === undefined ? undefined : Number(a.N);
  }

  private static ccf(): AwsReply {
    return {
      status: 400,
      headers: {},
      body: JSON.stringify({ __type: "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException", message: "The conditional request failed" }),
    };
  }

  async handle(op: string, payload: Record<string, unknown>): Promise<AwsReply> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    else await Promise.resolve();
    this.ops.push(op);
    const f = this.fault?.(op, payload);
    if (f === "network") throw new TransportError("network");
    if (f === "throttle") {
      return { status: 400, headers: {}, body: JSON.stringify({ __type: "com.amazonaws.dynamodb.v20120810#ThrottlingException" }) };
    }
    const reply = this.apply(op, payload);
    if (f === "response-lost" && reply.status === 200) throw new TransportError("network");
    return reply;
  }

  private apply(op: string, payload: Record<string, unknown>): AwsReply {
    if (op === "TransactWriteItems") {
      const shadow = new FakeTable();
      for (const [key, item] of this.items) shadow.items.set(key, { ...item });
      const writes = payload.TransactItems as Record<string, Record<string, unknown>>[];
      const reasons = writes.map(() => ({ Code: "None" }));
      for (let i = 0; i < writes.length; i++) {
        const [component, body] = Object.entries(writes[i]!)[0]!;
        const mapped = { Put: "PutItem", Update: "UpdateItem", Delete: "DeleteItem", ConditionCheck: "ConditionCheck" }[component];
        if (mapped === undefined) throw new Error("unexpected transaction component");
        const fault = this.fault?.(mapped, body);
        const result = fault === "network" || fault === "throttle"
          ? { status: 400, headers: {}, body: "{}" } : shadow.apply(mapped, body);
        if (result.status !== 200) {
          reasons[i] = { Code: fault === undefined ? "ConditionalCheckFailed" : "ProvisionedThroughputExceeded" };
          return { status: 400, headers: {}, body: JSON.stringify({ __type: "com.amazonaws.dynamodb.v20120810#TransactionCanceledException", CancellationReasons: reasons }) };
        }
      }
      this.items.clear();
      for (const [key, item] of shadow.items) this.items.set(key, item);
      return { status: 200, headers: {}, body: "{}" };
    }
    const key = (payload.Key as { pk: { S: string } } | undefined)?.pk.S;
    const values = (payload.ExpressionAttributeValues ?? {}) as Record<string, Attr>;
    const names = (payload.ExpressionAttributeNames ?? {}) as Record<string, string>;
    const val = (k: string): number => Number((values[k] as { N: string }).N);
    switch (op) {
      case "ConditionCheck":
        if (payload.ConditionExpression !== "attribute_not_exists(pk)") throw new Error("unexpected transaction condition");
        return key !== undefined && this.items.has(key) ? FakeTable.ccf() : { status: 200, headers: {}, body: "{}" };
      case "GetItem": {
        const item = key === undefined ? undefined : this.items.get(key);
        return { status: 200, headers: {}, body: JSON.stringify(item ? { Item: item } : {}) };
      }
      case "DeleteItem":
        if (key !== undefined) this.items.delete(key);
        return { status: 200, headers: {}, body: "{}" };
      case "PutItem": {
        const item = payload.Item as Item;
        const pk = (item.pk as { S: string }).S;
        if (payload.ConditionExpression !== undefined && payload.ConditionExpression !== "attribute_not_exists(pk)") throw new Error("unexpected PutItem condition");
        if (payload.ConditionExpression !== undefined && this.items.has(pk)) return FakeTable.ccf();
        this.items.set(pk, { ...item });
        return { status: 200, headers: {}, body: "{}" };
      }
      case "UpdateItem": {
        if (key === undefined) throw new Error("UpdateItem without key");
        const current: Item = { ...(this.items.get(key) ?? { pk: { S: key } }) };
        const numOf = (attr: string): number | undefined => {
          const a = current[attr] as { N?: string } | undefined;
          return a?.N === undefined ? undefined : Number(a.N);
        };
        const cond = payload.ConditionExpression as string | undefined;
        if (cond !== undefined) {
          if (cond === "#s = :reserved") {
            const have = current[names["#s"]!] as { S?: string } | undefined;
            if (have?.S !== (values[":reserved"] as { S: string }).S) return FakeTable.ccf();
          } else {
          const m = /^attribute_not_exists\((#\w+)\) OR (#\w+) (<=|<) (:\w+)$/.exec(cond);
          if (!m || m[1] !== m[2]) throw new Error(`unexpected condition ${cond}`);
          const have = numOf(names[m[1]!]!);
          const limit = val(m[4]!);
          const pass = have === undefined || (m[3] === "<=" ? have <= limit : have < limit);
          if (!pass) return FakeTable.ccf();
          }
        }
        const expr = payload.UpdateExpression as string;
        const clauses = expr.split(/\b(?=SET |ADD )/).map((c) => c.trim()).filter(Boolean);
        for (const clause of clauses) {
          if (clause.startsWith("SET ")) {
            const body = clause.slice(4);
            const re = /(#\w+)\s*=\s*(?:if_not_exists\((#\w+),\s*(:\w+)\)\s*\+\s*(:\w+)|(:\w+))/g;
            let matched = 0;
            for (const a of body.matchAll(re)) {
              matched++;
              const target = names[a[1]!]!;
              if (a[2] !== undefined) {
                const base = numOf(names[a[2]]!) ?? val(a[3]!);
                current[target] = { N: String(base + val(a[4]!)) };
              } else {
                current[target] = values[a[5]!]!;
              }
            }
            if (matched === 0) throw new Error(`unexpected SET ${body}`);
          } else if (clause.startsWith("ADD ")) {
            const a = /^ADD (#\w+) (:\w+)$/.exec(clause);
            if (!a) throw new Error(`unexpected ADD ${clause}`);
            const target = names[a[1]!]!;
            current[target] = { N: String((numOf(target) ?? 0) + val(a[2]!)) };
          } else {
            throw new Error(`unexpected clause ${clause}`);
          }
        }
        this.items.set(key, current);
        return { status: 200, headers: {}, body: "{}" };
      }
      default:
        throw new Error(`unexpected DynamoDB operation ${op}`);
    }
  }
}

export class FakeAws {
  readonly table = new FakeTable();
  readonly modelCalls: Array<Record<string, unknown>> = [];
  readonly calls: AwsCall[] = [];
  model: ModelScript = () => ({ status: 200, json: modelReply() });
  settings: { logging: unknown; retention: string } | "fail" = { logging: {}, retention: "none" };
  settingsReads = 0;
  /** Regional retention fixtures; absent entries use the common settings above. */
  regionalRetention: Record<string, string | "fail"> = {};

  readonly transport: Transport = async (call) => {
    this.calls.push(call);
    if (call.service === "dynamodb") {
      const op = (call.headers["x-amz-target"] ?? "").replace("DynamoDB_20120810.", "");
      return this.table.handle(op, JSON.parse(call.body) as Record<string, unknown>);
    }
    if (call.host.startsWith("bedrock-runtime.")) {
      const body = JSON.parse(call.body) as Record<string, unknown>;
      this.modelCalls.push(body);
      const r = await this.model(body);
      if (r === "timeout" || r === "network") throw new TransportError(r);
      const headers: Record<string, string> = {};
      if (r.errorType) headers["x-amzn-errortype"] = r.errorType;
      const json = r.status === 200 && r.json !== null && typeof r.json === "object" && !Array.isArray(r.json)
        ? converseReply(r.json as Record<string, unknown>) : r.json;
      return { status: r.status, headers, body: json === undefined ? "" : JSON.stringify(json) };
    }
    if (call.host.startsWith("bedrock.")) {
      this.settingsReads++;
      if (this.settings === "fail") return { status: 500, headers: {}, body: "{}" };
      if (call.path === "/logging/modelinvocations") {
        const logging = this.settings.logging;
        const off = logging === undefined || (typeof logging === "object" && logging !== null && Object.keys(logging).length === 0);
        return { status: 200, headers: {}, body: off ? "{}" : JSON.stringify({ loggingConfig: logging }) };
      }
      if (call.path === "/data-retention") {
        const region = call.host.split(".")[1]!;
        const mode = this.regionalRetention[region] ?? this.settings.retention;
        if (mode === "fail") return { status: 500, headers: {}, body: "{}" };
        return { status: 200, headers: {}, body: JSON.stringify({ mode }) };
      }
      throw new Error(`unexpected Bedrock path ${call.path}`);
    }
    throw new Error(`unexpected call to ${call.host}`);
  };
}

export class Clock {
  constructor(public ms = Date.UTC(2026, 9, 5, 14, 3, 0)) {}
  now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface Harness {
  aws: FakeAws;
  clock: Clock;
  logs: string[];
  deps: Deps;
  handler: (event: unknown) => Promise<unknown>;
  call: (event: unknown) => Promise<HttpResult & { json: Record<string, unknown> }>;
}

let counter = 0;

export function harness(over: Partial<Deps> & { env?: Record<string, string> } = {}): Harness {
  const aws = new FakeAws();
  const clock = new Clock();
  const logs: string[] = [];
  const deps: Deps = {
    models: STUB_MODELS,
    config: over.env ? stubConfig({ ...ENV, ...over.env }) : config(),
    transport: aws.transport,
    now: clock.now,
    randomBytes: (n) => {
      counter++;
      return Uint8Array.from({ length: n }, (_, i) => (i * 7 + counter) & 255);
    },
    engines: bundledEngines(),
    moves: bundledMoves(),
    promptMode: "how-and-plainer",
    sink: (line) => logs.push(line),
    state: newState(),
    ...over,
  };
  const handler = createHandler(deps);
  const call = async (event: unknown) => {
    const r = (await handler(event)) as HttpResult;
    return { ...r, json: r.body ? (JSON.parse(r.body) as Record<string, unknown>) : {} };
  };
  return { aws, clock, logs, deps, handler, call };
}

export function lastLog(h: Harness): Record<string, unknown> {
  const line = h.logs.at(-1);
  if (line === undefined) throw new Error("no log line");
  return JSON.parse(line) as Record<string, unknown>;
}
