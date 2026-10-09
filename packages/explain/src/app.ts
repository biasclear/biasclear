// The Explain request, step by step (SPEC §4). Cheap checks come first, so
// junk costs nothing but a Lambda millisecond, and nothing that fails before
// the spend check touches DynamoDB, except the lasting pause written when
// Bedrock refuses the settings read with an explicit deny. The model is
// called only with a spend reservation in hand.
//
// Everything runs inside one try/catch: anything that escapes is logged as
// the fixed code E_INTERNAL, and the Lambda runtime never sees an error it
// would log with its message and stack (SPEC §4 step 0, §10).

import { timingSafeEqual } from "node:crypto";
import { Ddb, DdbError } from "./aws/dynamodb.js";
import { BedrockDenied, MODEL_TIMEOUT_MS, converseModel, modelRequest, readAccountSettings, type ModelOutcome } from "./aws/bedrock.js";
import type { Transport } from "./aws/transport.js";
import { CodedError, type Code, type ErrorName, type PlainerState } from "./codes.js";
import { bankHash, pickLimits, quotable } from "./compose.js";
import type { Config } from "./config.js";
import type { EngineRegistry } from "./engines.js";
import { STATUS, ROUTE_PATH, errorResponse, header, jsonResponse, preflight, type HttpEvent, type HttpResult } from "./http.js";
import { makeLogger, type LogLine, type LogSink } from "./log.js";
import { MODELS, consentFingerprint, modelReady, type ModelInfo } from "./models.js";
import type { MovesTable } from "./moves.js";
import { checkReply } from "./output.js";
import { buildPrompt, type PromptMode } from "./prompt.js";
import { checkRate, connectionHash, connectionKey, todaysSalt } from "./ratelimit.js";
import { bodyText, parseJson, validateRequest, type ExplainRequest } from "./request.js";
import { FENCE_RESERVE_MS, LOG_RESERVE_MS, actualMicros, billingPaused, persistBillingPause, persistPause, hasHeadroom, release, reserve, settle, worstCaseMicros, type Deadline, type Reservation } from "./spend.js";
import { SETTINGS_INTERVAL_MS, type InstanceState } from "./state.js";
import { nextDayStart } from "./time.js";

export interface Deps {
  /** undefined when the environment is incomplete: every request is then "paused". */
  config: Config | undefined;
  /** Trusted dependency injection only. Production always uses the reviewed MODELS. */
  models?: Readonly<Record<string, ModelInfo>>;
  transport: Transport;
  now: () => number;
  randomBytes: (n: number) => Uint8Array;
  engines: EngineRegistry;
  moves: MovesTable;
  promptMode: PromptMode;
  sink: LogSink;
  state: InstanceState;
}

/** What the handler reads from the Lambda context: the time this invocation has left. */
export interface InvocationContext {
  getRemainingTimeInMillis?: () => number;
}

/** After the model call: up to two settlement round trips, then the fence and debt writes and the log
 * line (314 M1). The model call is cut so this always fits inside the function's timeout. */
export const POST_CALL_RESERVE_MS = 2 * 3_000 + FENCE_RESERVE_MS + LOG_RESERVE_MS;
/** Below this, the model call isn't worth making: the reservation is released and the answer is "busy". */
export const MIN_MODEL_TIMEOUT_MS = 8_000;

/** The success body (SPEC §3). */
export interface ExplainAnswer {
  v: 1;
  rule: string;
  how: string;
  plainer: string | null;
  model: string;
  rules: string;
}

/**
 * A direct invoke for the live evaluation (SPEC §16). It skips the
 * per-connection limits and nothing else. Two things keep web requests out:
 * API Gateway's HTTP API only invokes the function with its own event shape
 * (and only this stack's API may invoke it, a fence kept by review and
 * infra/aws/test_templates.py, not by IAM), and the event must carry the key
 * the deploy workflow set for this deploy or evaluation run.
 */
export interface EvaluationEvent {
  explainEvaluation: 1;
  key: string;
  request: unknown;
}

export interface EvaluationResult {
  status: number;
  body: ExplainAnswer | { v: 1; error: ErrorName };
  evaluation: {
    modelCalled?: boolean | undefined;
    providerStopReason?: string | undefined;
    providerText?: string | undefined;
    providerTextChars?: number | undefined;
    providerTextTruncated?: boolean | undefined;
    inputBoundTokens?: number | undefined;
    outputBoundTokens?: number | undefined;
    billedBoundViolated?: boolean | undefined;
    reservedMicros?: number | undefined;
    actualMicros?: number | undefined;
    pausePersisted?: boolean | undefined;
    code?: Code | undefined;
    plainer?: PlainerState | undefined;
    inTok?: number | undefined;
    outTok?: number | undefined;
    promptBytes?: number | undefined;
    micros?: number | undefined;
    ms?: number | undefined;
    /** The model's text, returned to the evaluation's IAM caller only. Never logged. */
    raw?: string | undefined;
    /** The phrase bank the raw selection's ids refer to (src/compose.ts), kept apart from the displayed text. */
    bankHash?: string | undefined;
  };
}

type Answer =
  | { kind: "ok"; body: ExplainAnswer }
  | { kind: "error"; error: ErrorName | "forbidden"; status?: number | undefined }
  | { kind: "http"; result: HttpResult; outcome: "preflight" };

/** Exactly the keys explainEvaluation, key and request: no API Gateway field of any version. */
export function isEvaluationEvent(event: unknown): event is EvaluationEvent {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return false;
  const keys = Object.keys(event).sort().join(",");
  const e = event as { explainEvaluation?: unknown; key?: unknown };
  return keys === "explainEvaluation,key,request" && e.explainEvaluation === 1 && typeof e.key === "string";
}

/** True when the event's key equals the configured one (constant time). */
function evaluationKeyMatches(event: EvaluationEvent, config: Config | undefined): boolean {
  const want = config?.evalKey;
  if (want === undefined || !/^[0-9a-f]{64}$/.test(event.key)) return false;
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(event.key), enc.encode(want));
}

class Stop extends Error {
  constructor(
    readonly error: ErrorName | "forbidden",
    readonly code: Code,
    readonly status: number | undefined,
  ) {
    super(code);
  }
}

/** Ends the request with a fixed answer and log code. `status` overrides the answer's usual one (422 for "not a mark"). */
function stop(error: ErrorName | "forbidden", code: Code, status?: number): never {
  throw new Stop(error, code, status);
}

/** Maps a request-shape CodedError to the visitor's answer. */
function shapeStop(err: unknown): never {
  if (err instanceof CodedError) stop("invalid", err.code);
  throw err;
}

export function createHandler(deps: Deps): (event: unknown, context?: InvocationContext) => Promise<HttpResult | EvaluationResult> {
  const knownRules = new Set<string>();
  for (const b of deps.engines.builds.values()) for (const id of b.ruleIds) knownRules.add(id);
  const log = makeLogger(deps.sink, {
    rules: knownRules,
    rulesVersions: new Set(deps.engines.builds.keys()),
    models: new Set(Object.values(deps.models ?? MODELS).map((m) => m.key)),
  });

  return async (event: unknown, context?: InvocationContext) => {
    const started = deps.now();
    // One deadline for the whole invocation, measured on the real clock like Lambda's own timeout.
    const remaining = typeof context?.getRemainingTimeInMillis === "function" ? context.getRemainingTimeInMillis() : Number.POSITIVE_INFINITY;
    const t0 = Date.now();
    const deadline: Deadline = { left: () => remaining - (Date.now() - t0) };
    const evaluation = isEvaluationEvent(event);
    const line: LogLine = { outcome: "no_answer", status: 502, ms: 0 };
    if (evaluation) line.evaluation = 1;
    const detail: EvaluationResult["evaluation"] = { modelCalled: false };
    const cors: { origin?: string | undefined } = {};
    let answer: Answer;
    try {
      answer = await explain(deps, event, evaluation, line, detail, cors, deadline);
    } catch (err) {
      if (err instanceof Stop) {
        line.code = err.code;
        answer = { kind: "error", error: err.error, status: err.status };
      } else {
        line.code = "E_INTERNAL";
        answer = { kind: "error", error: "no_answer" };
      }
    }

    let status: number;
    let result: HttpResult;
    if (answer.kind === "http") {
      status = answer.result.statusCode;
      result = answer.result;
      line.outcome = answer.outcome;
    } else if (answer.kind === "ok") {
      status = 200;
      result = jsonResponse(200, answer.body, cors.origin);
      line.outcome = "ok";
    } else {
      status = answer.status ?? STATUS[answer.error];
      const shown: ErrorName = answer.error === "forbidden" ? "invalid" : answer.error;
      result = errorResponse(shown, status, cors.origin);
      line.outcome = answer.error;
    }
    line.status = status;
    line.ms = Math.max(0, deps.now() - started);
    log(line);
    if (evaluation) {
      detail.ms = line.ms;
      detail.code = line.code;
      detail.plainer = line.plainer;
      detail.inTok = line.inTok;
      detail.outTok = line.outTok;
      detail.micros = line.micros;
      return { status, body: JSON.parse(result.body) as EvaluationResult["body"], evaluation: detail };
    }
    return result;
  };
}

async function explain(
  deps: Deps,
  event: unknown,
  evaluation: boolean,
  line: LogLine,
  detail: EvaluationResult["evaluation"],
  cors: { origin?: string | undefined },
  deadline: Deadline,
): Promise<Answer> {
  const now = deps.now();
  const cfg = deps.config;
  const state = deps.state;
  const http = (evaluation ? {} : (event ?? {})) as HttpEvent;

  // 0. An evaluation event must carry this deploy's key; nothing else is read first.
  if (evaluation && !evaluationKeyMatches(event as EvaluationEvent, cfg)) stop("forbidden", "E_EVAL_KEY");

  // CORS: remember the origin only if it is one of the allowed ones.
  if (!evaluation) {
    const origin = header(http, "origin");
    const allowed = cfg?.origins ?? [];
    if (origin !== undefined && allowed.includes(origin)) cors.origin = origin;
    if (http.requestContext?.http?.method === "OPTIONS") {
      return { kind: "http", result: preflight(http, cors.origin), outcome: "preflight" };
    }
  }

  // 1. Kill switch and in-memory pauses. Nothing else is read.
  if (cfg === undefined) stop("paused", "E_CONFIG");
  const config: Config = cfg;
  const model = (deps.models ?? MODELS)[config.modelId];
  if (!modelReady(model) || config.region !== model.region || !config.routeApproved || config.retentionMode !== "none") stop("paused", "E_CONFIG");
  if (!config.on) stop("paused", "E_SWITCH_OFF");
  if (state.pausedUntil > now) stop("paused", "E_PAUSE_FLAG");

  // Bedrock refused the function with an explicit deny: most likely the $30 budget action's deny
  // policy. Explain stays off until a person checks, even after AWS resets the action next budget
  // month (owner decision D5, 2026-10-09), so the shared fence is written. Nothing is owed, so there
  // is no debt row. The function can't delete it; clearing it needs a separately reviewed recovery
  // tool, and none exists yet (infra/aws/README.md, "If an email from AWS Budgets arrives").
  const denied = async (ddb: Ddb): Promise<never> => {
    state.pausedUntil = Number.POSITIVE_INFINITY;
    const persisted = await persistPause(ddb, { reason: "E_BEDROCK_DENIED", nowMs: now, reservedMicros: 0 }, deadline);
    line.pausePersisted = persisted ? 1 : 0;
    detail.pausePersisted = persisted;
    return stop("paused", "E_BEDROCK_DENIED");
  };

  // 2. A concurrent request must await privacy proof; caching begins after it finishes.
  if (state.settingsCheck !== undefined || now >= state.nextSettingsCheck) {
    if (state.settingsCheck === undefined) {
      state.settingsCheck = (async (): Promise<Code | undefined> => {
        try {
          const s = await readAccountSettings(deps.transport, config.region, model.destinationRegions);
          if (s.loggingOn) return "E_SETTINGS_LOGGING_ON";
          if (Object.values(s.retentionByRegion).some((mode) => mode !== config.retentionMode)) return "E_SETTINGS_RETENTION";
          return undefined;
        } catch (err) { return err instanceof BedrockDenied ? "E_BEDROCK_DENIED" : "E_SETTINGS_READ"; }
      })();
    }
    const code = await state.settingsCheck;
    state.settingsCheck = undefined;
    state.nextSettingsCheck = deps.now() + SETTINGS_INTERVAL_MS;
    if (code === "E_BEDROCK_DENIED") return denied(new Ddb(deps.transport, config.region, config.table));
    if (code !== undefined) {
      state.pausedUntil = deps.now() + SETTINGS_INTERVAL_MS;
      stop("paused", code);
    }
  }

  // 3. Shape and size.
  let parsed: unknown;
  if (evaluation) {
    parsed = (event as EvaluationEvent).request;
  } else {
    const method = http.requestContext?.http?.method;
    if (method !== "POST") stop("invalid", "E_METHOD");
    const path = http.requestContext?.http?.path ?? http.rawPath;
    if (path !== ROUTE_PATH) stop("invalid", "E_ROUTE");
    // Stops casual use from other sites' pages. Not a security boundary: a script can set any Origin.
    if (cors.origin === undefined) stop("forbidden", "E_ORIGIN");
    const type = (header(http, "content-type") ?? "").toLowerCase();
    if (!/^application\/json\s*(;\s*charset=utf-8\s*)?$/.test(type)) stop("invalid", "E_CONTENT_TYPE");
    try {
      parsed = parseJson(bodyText(http.body, http.isBase64Encoded));
    } catch (err) {
      shapeStop(err);
    }
  }
  let req: ExplainRequest;
  try {
    req = validateRequest(parsed, { consent: evaluation ? "optional" : "required" });
  } catch (err) {
    return shapeStop(err);
  }
  line.rule = req.rule;
  line.rules = req.rules;
  // 3b. The consent the page showed must name the selected model, maker and route; a page opened
  //     before a model change gets "consent" (reload), before any table read, spend or call (314 M3).
  if (req.consent !== undefined || !evaluation) {
    if (req.consent !== consentFingerprint(config.modelId, model)) stop("consent", "E_CONSENT");
  }

  // 4. The rules version: one of the engines this bundle carries.
  const build = deps.engines.builds.get(req.rules);
  if (build === undefined) stop("rules", "E_RULES_VERSION");
  const engine = build;
  if (!engine.ruleIds.has(req.rule)) stop("invalid", "E_RULE_UNKNOWN");
  // The prompt names the move as the current site does; a rule the current site no longer names can't be explained.
  const move = deps.moves.get(req.rule);
  if (move === undefined) stop("rules", "E_RULE_RETIRED");

  // 5. Is it a real mark? The engine must find this rule at exactly this span.
  let marks;
  try {
    marks = engine.scan(req.sentence, req.domain);
  } catch {
    return stop("invalid", "E_ENGINE", 422);
  }
  if (!marks.some((m) => m.ruleId === req.rule && m.start === req.start && m.end === req.end)) {
    stop("invalid", "E_NOT_A_MARK", 422);
  }
  // A mark the server can't quote exactly, or one too long for any reviewed choice, gets the
  // same refusal the checker would give after the call (src/compose.ts), without spending.
  const mark = req.sentence.slice(req.start, req.end);
  if (pickLimits(req.rule, mark) === undefined) stop("no_answer", quotable(mark) ? "E_OUT_HOW" : "E_OUT_PLAIN_TEXT");
  if (evaluation) detail.bankHash = bankHash();
  line.model = model.key;
  const prompt = buildPrompt(deps.promptMode, move, req.sentence, req.start, req.end, req.rule);
  detail.promptBytes = prompt.bytes;
  detail.inputBoundTokens = prompt.bytes + model.inputTokenBound.framingTokens;
  detail.outputBoundTokens = model.billedMaxTokens;
  const worst = worstCaseMicros(prompt.bytes, model.billedMaxTokens, config, model.inputTokenBound.framingTokens);
  if (worst > config.dailyMicros || worst > config.capMicros) stop("paused", "E_TOO_COSTLY");

  const ddb = new Ddb(deps.transport, config.region, config.table);

  // 6. Spend headroom: two cheap reads, so a flood after the money is gone costs no writes.
  try {
    if (await billingPaused(ddb, now)) {
      state.pausedUntil = Number.POSITIVE_INFINITY;
      stop("paused", "E_BILLING_PAUSE");
    }
    if (!(await hasHeadroom(ddb, config, now, worst))) {
      state.pausedUntil = nextDayStart(now);
      stop("paused", "E_HEADROOM");
    }
  } catch (err) {
    if (err instanceof DdbError) stop("paused", "E_DDB");
    throw err;
  }

  // 7. Per-connection limits (skipped only for the evaluation's direct invoke).
  if (!evaluation) {
    const key = connectionKey(http.requestContext?.http?.sourceIp as string | undefined);
    if (key === undefined) stop("invalid", "E_ADDRESS");
    try {
      const salt = await todaysSalt(ddb, state, now, deps.randomBytes);
      const rate = await checkRate(ddb, state, config, now, connectionHash(salt, key));
      if (rate !== "ok") stop("limit", rate);
    } catch (err) {
      if (err instanceof DdbError) stop("paused", "E_DDB");
      if (err instanceof CodedError) stop("paused", err.code);
      throw err;
    }
  }

  // 8. Reserve the worst case on the month and the day.
  let reservation: Reservation;
  try {
    const r = await reserve(ddb, config, now, worst);
    if (!r.ok) {
      state.pausedUntil = r.which === "pause" ? Number.POSITIVE_INFINITY : nextDayStart(now);
      return stop("paused", r.which === "pause" ? "E_BILLING_PAUSE" : r.which === "month" ? "E_RESERVE_MONTH" : "E_RESERVE_DAY");
    }
    reservation = r.reservation;
  } catch (err) {
    if (err instanceof DdbError) return stop("paused", "E_DDB");
    throw err;
  }
  line.micros = reservation.micros;
  line.reservedMicros = reservation.micros;
  detail.reservedMicros = reservation.micros;

  const pause = async (code: Code, actual?: number): Promise<never> => {
    state.pausedUntil = Number.POSITIVE_INFINITY;
    const persisted = await persistBillingPause(ddb, { reason: code, nowMs: now, reservedMicros: reservation.micros,
      ...(actual === undefined ? {} : { actualMicros: actual }), event: reservation.event }, deadline);
    line.pausePersisted = persisted ? 1 : 0;
    detail.pausePersisted = persisted;
    return stop("paused", code);
  };

  // 9. The model call, with the reservation in hand, cut to leave time for the ledger and the stop
  //    records afterwards (314 M1). Too little time left: release the reservation and answer busy.
  const modelTimeout = Math.min(MODEL_TIMEOUT_MS, deadline.left() - POST_CALL_RESERVE_MS);
  if (modelTimeout < MIN_MODEL_TIMEOUT_MS) {
    if (!(await release(ddb, reservation, deadline))) return pause("E_SETTLE", 0);
    line.micros = 0;
    return stop("busy", "E_DEADLINE");
  }
  const outcome = await callModel(deps, config, reservation, prompt.system, prompt.user, model, modelTimeout);
  detail.modelCalled = outcome.modelCalled;
  detail.providerStopReason = outcome.providerStopReason;
  detail.providerText = outcome.providerText;
  detail.providerTextChars = outcome.providerTextChars;
  detail.providerTextTruncated = outcome.providerTextTruncated;
  if (evaluation) detail.raw = outcome.providerText;
  if (outcome.kind === "not-billed") {
    line.actualMicros = 0;
    detail.actualMicros = 0;
    if (!(await release(ddb, reservation, deadline))) return pause("E_SETTLE", 0);
    line.micros = 0;
    if (outcome.code === "E_BEDROCK_DENIED") return denied(ddb);
    if (outcome.pauseInstance) state.pausedUntil = now + SETTINGS_INTERVAL_MS;
    return stop(outcome.answer, outcome.code);
  }
  if (outcome.kind === "maybe-billed") {
    // Unknown usage cannot demonstrate the reservation covered billed reasoning.
    // Preserve its event as unresolved and stop further spend, including fresh instances.
    return pause(outcome.code);
  }

  // 11. Settle the real cost (before the checks, so a failed check still counts what it cost).
  const actual = actualMicros(outcome.inTok, outcome.outTok, config);
  line.inTok = outcome.inTok;
  line.outTok = outcome.outTok;
  line.actualMicros = actual;
  detail.actualMicros = actual;
  const violated = outcome.inTok > detail.inputBoundTokens || outcome.outTok > model.billedMaxTokens || actual > reservation.micros;
  detail.billedBoundViolated = violated;
  if (actual > reservation.micros) line.overrun = 1;
  if (violated) line.billedBoundViolated = 1;
  const pauseDetail = violated ? { reason: "E_PROVIDER_BOUND" as const, nowMs: now, reservedMicros: reservation.micros,
    actualMicros: actual, event: reservation.event } : undefined;
  if (!(await settle(ddb, reservation, actual, pauseDetail, deadline))) return pause("E_SETTLE", actual);
  line.micros = actual;
  if (violated) {
    // The settlement committed this event's debt row; the shared fence is written on its own.
    state.pausedUntil = Number.POSITIVE_INFINITY;
    const persisted = await persistPause(ddb, pauseDetail!, deadline);
    line.pausePersisted = persisted ? 1 : 0;
    detail.pausePersisted = persisted;
    return stop("paused", "E_PROVIDER_BOUND");
  }

  // 10. Check the answer.
  const checked = checkReply(outcome.reply, {
    mode: deps.promptMode,
    sentence: req.sentence,
    start: req.start,
    end: req.end,
    ruleId: req.rule,
    domain: req.domain,
    moveName: move.name,
    moveShort: move.short,
    engine,
    sentenceRuleIds: new Set(marks.map((m) => m.ruleId)),
    ruleSpans: marks.filter((m) => m.ruleId === req.rule).map((m) => ({ start: m.start, end: m.end })),
  });
  if (!checked.ok) return stop("no_answer", checked.code);
  line.plainer = checked.plainerState;
  return {
    kind: "ok",
    body: {
      v: 1,
      rule: req.rule,
      how: checked.how,
      plainer: checked.plainer,
      model: model.displayName,
      rules: req.rules,
    },
  };
}

/** The only path to the model. It takes a reservation, so the call can't be made without one. */
async function callModel(
  deps: Deps,
  config: Config,
  reservation: Reservation,
  system: string,
  user: string,
  model: ModelInfo,
  timeoutMs: number,
): Promise<ModelOutcome> {
  if (!(reservation.micros > 0)) throw new CodedError("E_INTERNAL");
  if (!modelReady(model) || model !== (deps.models ?? MODELS)[config.modelId]) throw new CodedError("E_CONFIG");
  return converseModel(deps.transport, config.region, config.modelId, modelRequest(system, user, model), model, timeoutMs);
}
