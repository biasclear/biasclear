// Shared Bedrock Converse transport. The model table supplies the reviewed
// route/settings; the wire body never carries tools, search or grounding.

import type { Code } from "../codes.js";
import type { ModelInfo } from "../models.js";
import { parseJsonOrUndefined } from "../json.js";
import { TransportError, type Transport } from "./transport.js";

export const MODEL_TIMEOUT_MS = 20_000;
export const SETTINGS_TIMEOUT_MS = 3000;

export interface ModelRequest {
  system: [{ text: string }];
  messages: [{ role: "user"; content: [{ text: string }] }];
  inferenceConfig: { maxTokens: number };
  additionalModelRequestFields?: Readonly<Record<string, unknown>>;
}

/** A closed request shape: provider settings are fixed reviewed data, never user input. */
export function modelRequest(system: string, user: string, model: ModelInfo): ModelRequest {
  return {
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens: model.maxTokens },
    ...(Object.keys(model.requestFields).length > 0 ? { additionalModelRequestFields: model.requestFields } : {}),
  };
}

export type ModelOutcome =
  | { kind: "reply"; reply: Record<string, unknown>; inTok: number; outTok: number }
  /** No usage came back: it may have been billed, so the whole reservation stays counted. */
  | { kind: "maybe-billed"; code: Code }
  /** AWS doesn't bill these: the reservation is given back. */
  | { kind: "not-billed"; code: Code; answer: "busy" | "paused" | "no_answer"; pauseInstance: boolean };

/** Settle the reported Converse outputTokens once; never estimate tokens from reasoning text.
 * Sonnet documents a total thinking + text output bound. Grok/Sol billing mappings
 * and bounds are not proven: strict live configuration blocks them pending evidence.
 * Cached input (we never request a cache) is conservatively charged at full input price. */
function usageOf(reply: Record<string, unknown>): { inTok: number; outTok: number } | undefined {
  const usage = reply.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const u = usage as Record<string, unknown>;
  const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!integer(u.inputTokens) || !integer(u.outputTokens)) return undefined;
  const read = u.cacheReadInputTokens ?? 0;
  const write = u.cacheWriteInputTokens ?? 0;
  if (!integer(read) || !integer(write)) return undefined;
  const inTok = u.inputTokens + read + write;
  if (!Number.isSafeInteger(inTok)) return undefined;
  // An unexplained total is not proof of the billed usage: retain the full reservation.
  if (u.totalTokens !== undefined && (!integer(u.totalTokens) ||
      u.totalTokens < u.inputTokens + u.outputTokens || u.totalTokens > inTok + u.outputTokens)) return undefined;
  return { inTok, outTok: u.outputTokens };
}

/** Discard known private reasoning blocks; never expose, store or log their content. */
export function normalizedReply(reply: Record<string, unknown>): Record<string, unknown> {
  const message = (reply.output as { message?: unknown } | undefined)?.message;
  const msg = message !== null && typeof message === "object" && !Array.isArray(message)
    ? message as Record<string, unknown> : undefined;
  const blocks = msg?.content;
  const text: Array<{ type: "text"; text: string }> = [];
  let malformed = msg?.role !== "assistant" || !Array.isArray(blocks);
  if (Array.isArray(blocks)) for (const block of blocks) {
    if (block === null || typeof block !== "object" || Array.isArray(block)) { malformed = true; continue; }
    const b = block as Record<string, unknown>;
    const keys = Object.keys(b);
    if (keys.length === 1 && keys[0] === "text" && typeof b.text === "string") {
      text.push({ type: "text", text: b.text });
    } else if (keys.length === 1 && keys[0] === "reasoningContent") {
      const reasoning = b.reasoningContent;
      if (reasoning === null || typeof reasoning !== "object" || Array.isArray(reasoning)) { malformed = true; continue; }
      const r = reasoning as Record<string, unknown>;
      const rk = Object.keys(r).sort().join(",");
      if (rk === "reasoningText") {
        const value = r.reasoningText;
        if (value === null || typeof value !== "object" || Array.isArray(value)) { malformed = true; continue; }
        const t = value as Record<string, unknown>;
        const tk = Object.keys(t).sort().join(",");
        if ((tk !== "text" && tk !== "signature,text") || typeof t.text !== "string" ||
            (t.signature !== undefined && typeof t.signature !== "string")) malformed = true;
      } else if (rk !== "redactedContent" || typeof r.redactedContent !== "string") malformed = true;
    } else {
      // toolUse, web/search, citations, images and every unknown content type fail closed.
      malformed = true;
    }
  }
  return {
    stop_reason: reply.stopReason === "end_turn" ? "end_turn" : reply.stopReason,
    content: !malformed && text.length === 1 ? text : [],
  };
}

/**
 * Two refusals no request can get past, told apart by AWS's error message
 * (read here, matched against fixed patterns, never logged or returned): the
 * model needs an inference profile the call didn't use, or the account's
 * data-retention setting doesn't allow this model. Both are set-up problems a
 * person must fix, so the instance pauses instead of paying for DynamoDB
 * writes on every request until then.
 */
const ROUTE_MESSAGE = /inference profile|on-demand throughput/iu;
const RETENTION_MESSAGE = /retention/iu;

/** The "message" (or "Message") field of an AWS error body, if any. */
export function errorMessage(body: string): string {
  const json = parseJsonOrUndefined(body);
  if (json === null || typeof json !== "object" || Array.isArray(json)) return "";
  const obj = json as Record<string, unknown>;
  const m = obj.message ?? obj.Message;
  return typeof m === "string" ? m.slice(0, 2000) : "";
}

/** Sorts a Bedrock error into billed or not, and what the visitor sees. */
export function classifyError(status: number, errorType: string, message = ""): ModelOutcome {
  const type = errorType.split(":")[0] ?? "";
  if (status === 429 || type === "ThrottlingException" || type === "ModelNotReadyException") {
    return { kind: "not-billed", code: "E_MODEL_THROTTLED", answer: "busy", pauseInstance: false };
  }
  if (status === 403 || type === "AccessDeniedException") {
    // The budget action or a policy has taken the model away: a person should look.
    return { kind: "not-billed", code: "E_MODEL_DENIED", answer: "paused", pauseInstance: true };
  }
  if (status === 404 || type === "ResourceNotFoundException") {
    return { kind: "not-billed", code: "E_MODEL_NOT_FOUND", answer: "paused", pauseInstance: true };
  }
  if (type === "ServiceQuotaExceededException") {
    return { kind: "not-billed", code: "E_MODEL_QUOTA", answer: "busy", pauseInstance: false };
  }
  if (status === 400 || type === "ValidationException") {
    if (RETENTION_MESSAGE.test(message)) {
      return { kind: "not-billed", code: "E_MODEL_RETENTION", answer: "paused", pauseInstance: true };
    }
    if (ROUTE_MESSAGE.test(message)) {
      return { kind: "not-billed", code: "E_MODEL_ROUTE", answer: "paused", pauseInstance: true };
    }
    return { kind: "not-billed", code: "E_MODEL_VALIDATION", answer: "no_answer", pauseInstance: false };
  }
  if (status === 408 || type === "ModelTimeoutException") return { kind: "maybe-billed", code: "E_MODEL_TIMEOUT" };
  return { kind: "maybe-billed", code: "E_MODEL_ERROR" };
}

export async function converseModel(
  transport: Transport,
  region: string,
  modelId: string,
  body: ModelRequest,
): Promise<ModelOutcome> {
  let reply;
  try {
    reply = await transport({
      service: "bedrock",
      host: `bedrock-runtime.${region}.amazonaws.com`,
      method: "POST",
      path: `/model/${encodeURIComponent(modelId)}/converse`,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      timeoutMs: MODEL_TIMEOUT_MS,
    });
  } catch (err) {
    const kind = err instanceof TransportError ? err.kind : "network";
    if (kind === "credentials") {
      return { kind: "not-billed", code: "E_MODEL_DENIED", answer: "paused", pauseInstance: true };
    }
    return { kind: "maybe-billed", code: kind === "timeout" ? "E_MODEL_TIMEOUT" : "E_MODEL_NETWORK" };
  }
  if (reply.status !== 200) {
    return classifyError(reply.status, reply.headers["x-amzn-errortype"] ?? "", errorMessage(reply.body));
  }
  const json = parseJsonOrUndefined(reply.body);
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { kind: "maybe-billed", code: "E_MODEL_NO_USAGE" };
  }
  const obj = json as Record<string, unknown>;
  const usage = usageOf(obj);
  if (usage === undefined) return { kind: "maybe-billed", code: "E_MODEL_NO_USAGE" };
  return { kind: "reply", reply: normalizedReply(obj), ...usage };
}

export interface AccountSettings {
  /** True when model invocation logging has any destination set. */
  loggingOn: boolean;
  /** The account's Bedrock data-retention mode ("none", "default", ...). */
  retention: string;
}

async function getJson(transport: Transport, region: string, path: string): Promise<Record<string, unknown>> {
  const reply = await transport({
    service: "bedrock",
    host: `bedrock.${region}.amazonaws.com`,
    method: "GET",
    path,
    headers: { accept: "application/json" },
    body: "",
    timeoutMs: SETTINGS_TIMEOUT_MS,
  });
  if (reply.status !== 200) throw new Error("settings read failed");
  const json = parseJsonOrUndefined(reply.body);
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("settings read failed");
  return json as Record<string, unknown>;
}

/** Reads the two account settings (GetModelInvocationLoggingConfiguration, GetAccountDataRetention). Throws on any failure. */
export async function readAccountSettings(transport: Transport, region: string): Promise<AccountSettings> {
  const [logging, retention] = await Promise.all([
    getJson(transport, region, "/logging/modelinvocations"),
    getJson(transport, region, "/data-retention"),
  ]);
  const config = logging.loggingConfig;
  const loggingOn = config !== undefined && config !== null && (typeof config !== "object" || Object.keys(config).length > 0);
  const mode = retention.mode;
  if (typeof mode !== "string") throw new Error("settings read failed");
  return { loggingOn, retention: mode };
}
