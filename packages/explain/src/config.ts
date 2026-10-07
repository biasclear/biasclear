// The function's settings, read once per instance from the environment
// variables that infra/aws/explain.yaml sets. A missing or out-of-range value
// makes every request answer "paused" (fail closed), never a guess.

import { MODELS } from "./models.js";

export const ALLOWED_ORIGINS = ["https://biasclear.github.io", "https://biasclear.com"] as const;

export type RetentionMode = "none";

export interface Config {
  /** The kill switch (stack parameter Explain). */
  on: boolean;
  region: string;
  table: string;
  modelId: string;
  /** US profiles approved by the owner on 2026-10-07; no other route is accepted. */
  routeApproved: boolean;
  /** Model price in nano-dollars per token (USD per million tokens × 1000). */
  inNanosPerToken: number;
  outNanosPerToken: number;
  /** Monthly cap and daily limit, in micro-dollars. */
  capMicros: number;
  dailyMicros: number;
  origins: readonly string[];
  retentionMode: RetentionMode;
  ratePer10Min: number;
  ratePerDay: number;
  /**
   * The live evaluation's key: 64 hex characters the deploy workflow draws at
   * random for each deploy or evaluation (stack parameter EvaluationKey). A
   * direct invoke must carry it. Undefined when unset: evaluation events are
   * then refused.
   */
  evalKey: string | undefined;
}

/** "2.20" → 2200: USD per million tokens as whole nano-dollars per token. */
export function priceToNanos(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,4}(\.\d{1,3})?$/.test(text.trim())) return undefined;
  const [whole = "0", frac = ""] = text.trim().split(".");
  const nanos = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  return nanos > 0 ? nanos : undefined;
}

function intIn(text: string | undefined, min: number, max: number): number | undefined {
  if (text === undefined || !/^\d{1,9}$/.test(text.trim())) return undefined;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : undefined;
}

/** Parses the environment. Returns undefined when anything is missing or out of range. */
export function readConfig(env: Record<string, string | undefined>): Config | undefined {
  const switchValue = env.EXPLAIN_SWITCH;
  if (switchValue !== "on" && switchValue !== "off") return undefined;
  const region = env.AWS_REGION ?? "";
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) return undefined;
  const table = env.EXPLAIN_TABLE ?? "";
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(table)) return undefined;
  const modelId = env.EXPLAIN_MODEL_ID ?? "";
  if (!Object.hasOwn(MODELS, modelId)) return undefined;
  const model = MODELS[modelId]!;
  if (region !== model.region || model.route !== "us-profile" || !model.settingsVerified || model.billedMaxTokens === null || model.liveBlockReason !== "") return undefined;
  const inNanos = priceToNanos(env.EXPLAIN_PRICE_IN);
  const outNanos = priceToNanos(env.EXPLAIN_PRICE_OUT);
  const capUsd = intIn(env.EXPLAIN_MONTHLY_CAP_USD, 1, 25);
  const dailyPercent = intIn(env.EXPLAIN_DAILY_PERCENT, 1, 100);
  const ratePer10Min = intIn(env.EXPLAIN_RATE_10MIN, 1, 100);
  const ratePerDay = intIn(env.EXPLAIN_RATE_DAY, 1, 1000);
  const retention = env.EXPLAIN_RETENTION_MODE;
  if (
    inNanos === undefined ||
    outNanos === undefined ||
    capUsd === undefined ||
    dailyPercent === undefined ||
    ratePer10Min === undefined ||
    ratePerDay === undefined ||
    retention !== "none" ||
    inNanos !== Math.round(model.inputPricePerMillion * 1000) ||
    outNanos !== Math.round(model.outputPricePerMillion * 1000)
  ) {
    return undefined;
  }
  const origins = (env.EXPLAIN_ORIGINS ?? "").split(",").map((o) => o.trim());
  if (origins.length === 0 || origins.some((o) => !(ALLOWED_ORIGINS as readonly string[]).includes(o))) {
    return undefined;
  }
  const evalKey = /^[0-9a-f]{64}$/.test(env.EXPLAIN_EVAL_KEY ?? "") ? env.EXPLAIN_EVAL_KEY : undefined;
  const capMicros = capUsd * 1_000_000;
  return {
    on: switchValue === "on",
    region,
    table,
    modelId,
    routeApproved: true,
    inNanosPerToken: inNanos,
    outNanosPerToken: outNanos,
    capMicros,
    dailyMicros: Math.floor((capMicros * dailyPercent) / 100),
    origins,
    retentionMode: retention,
    ratePer10Min,
    ratePerDay,
    evalKey,
  };
}
