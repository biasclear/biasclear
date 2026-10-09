import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { scan, MAX_INPUT_CHARS, DOMAINS } from "../../engine/dist/index.js";
import { bytesDigest, canonical, digest, exact, frozenCopy, object, refuse,
  runBinding, userOnlyRequest, validateApproval, validateQuestionSet, validateRegistry } from "./contracts.mjs";
import { prepareArtifactDirectory, writeArtifacts } from "./artifacts.mjs";

export const MONTHLY_CAP_MICROS = 25_000_000;
export const DAILY_CAP_MICROS = 2_500_000;
export const ENGINE_BASE_REVISION = "2b39303652d54607ee6837743f9801e3aecf5ce4";
const SIMULATED_FRAMING_TOKENS = 50; // Fixture arithmetic only, never provider-bound evidence.

export class OfflineLedger {
  #months = new Map(); #days = new Map(); #reservations = new Map(); #next = 0; #paused = false;
  constructor(seed = { months: {}, days: {} }) {
    if (!exact(seed, ["months", "days"])) refuse("E_FAKE_LEDGER");
    for (const [input, map, pattern, cap] of [[seed.months, this.#months, /^\d{4}-\d{2}$/, MONTHLY_CAP_MICROS],
      [seed.days, this.#days, /^\d{4}-\d{2}-\d{2}$/, DAILY_CAP_MICROS]]) {
      if (!object(input)) refuse("E_FAKE_LEDGER");
      for (const [key, value] of Object.entries(input)) {
        if (!pattern.test(key) || !Number.isSafeInteger(value) || value < 0 || value > cap) refuse("E_FAKE_LEDGER");
        map.set(key, value);
      }
    }
  }
  reserve(isoDate, micros) {
    if (!Number.isSafeInteger(micros) || micros <= 0) refuse("E_FAKE_RESERVATION");
    if (this.#paused) return { ok: false, code: "E_SIMULATED_LEDGER_PAUSE" };
    const month = isoDate.slice(0, 7), day = isoDate.slice(0, 10);
    // A cap refusal ends this run's admissions, even after a cheaper row, refund or calendar rollover.
    // Keep the first refusal specific; the shared pause latch preserves all later rows as not-called.
    if ((this.#months.get(month) ?? 0) + micros > MONTHLY_CAP_MICROS) {
      this.#paused = true;
      return { ok: false, code: "E_SIMULATED_MONTH_CAP" };
    }
    if ((this.#days.get(day) ?? 0) + micros > DAILY_CAP_MICROS) {
      this.#paused = true;
      return { ok: false, code: "E_SIMULATED_DAY_CAP" };
    }
    this.#months.set(month, (this.#months.get(month) ?? 0) + micros);
    this.#days.set(day, (this.#days.get(day) ?? 0) + micros);
    const r = frozenCopy({ token: `offline-${++this.#next}`, month, day, micros });
    this.#reservations.set(r.token, { ...r, state: "reserved" });
    return { ok: true, reservation: r };
  }
  isReserved(token) { return this.#reservations.get(token)?.state === "reserved"; }
  unresolved(token) {
    if (!this.isReserved(token)) refuse("E_FAKE_RESERVATION");
    this.#paused = true;
  }
  pause() { this.#paused = true; }
  settle(token, actual) {
    const r = this.#reservations.get(token);
    if (!r || r.state !== "reserved" || !Number.isSafeInteger(actual) || actual < 0) refuse("E_FAKE_SETTLEMENT");
    this.#months.set(r.month, this.#months.get(r.month) + actual - r.micros);
    this.#days.set(r.day, this.#days.get(r.day) + actual - r.micros);
    r.state = "settled"; r.actualMicros = actual;
    if (actual > r.micros) this.#paused = true;
  }
  snapshot() { return frozenCopy({ kind: "simulation-only", monthlyCapMicros: MONTHLY_CAP_MICROS,
    dailyCapMicros: DAILY_CAP_MICROS, paused: this.#paused, months: Object.fromEntries(this.#months),
    days: Object.fromEntries(this.#days), reservations: [...this.#reservations.values()] }); }
}

const STUBS = new WeakMap();
/** The public adapter accepts JSON fixture data only. No executable module/callback is loaded. */
export function createReplayStub(data) {
  if (!exact(data, ["schema", "kind", "replies"]) || data.schema !== 1 || data.kind !== "offline-replay-fixtures" || !object(data.replies)) refuse("E_STUB_DATA");
  const fixture = frozenCopy(data);
  const calls = [];
  const adapter = Object.freeze({ kind: "trusted-offline-stub", name: "built-in-replay",
    fixtureHash: digest(fixture), get calls() { return frozenCopy(calls); } });
  STUBS.set(adapter, async (request, context) => {
    if (!context.ledger.isReserved(context.reservation.token)) refuse("E_CALL_WITHOUT_RESERVATION");
    calls.push({ modelId: context.modelId, questionId: context.questionId, request,
      reservation: context.reservation, reservedBeforeCall: true });
    const reply = fixture.replies[context.modelId]?.[context.questionId];
    if (reply === undefined || object(reply) && Object.hasOwn(reply, "fixtureError")) refuse("E_OFFLINE_STUB_FAILURE");
    return frozenCopy(reply);
  });
  return adapter;
}

export function simulatedMicros(inputTokens, outputTokens, model) {
  const nanos = inputTokens * Math.round(model.inputPricePerMillion * 1000) +
    outputTokens * Math.round(model.outputPricePerMillion * 1000);
  if (!Number.isSafeInteger(nanos) || nanos < 0) refuse("E_SIMULATED_COST");
  return Math.ceil(nanos / 1000);
}

function inspectReply(reply) {
  const content = reply?.output?.message?.content;
  const finalTextBlocks = [];
  let unsupported = false;
  if (Array.isArray(content)) content.forEach((block, blockIndex) => {
    if (exact(block, ["text"]) && typeof block.text === "string") finalTextBlocks.push({ blockIndex, text: block.text });
    else {
      const r = block?.reasoningContent;
      const recognized = exact(block, ["reasoningContent"]) &&
        (exact(r, ["redactedContent"]) && typeof r.redactedContent === "string" ||
          exact(r, ["reasoningText"]) && (exact(r.reasoningText, ["text"]) || exact(r.reasoningText, ["text", "signature"])) &&
          typeof r.reasoningText.text === "string" && (r.reasoningText.signature === undefined || typeof r.reasoningText.signature === "string"));
      if (!recognized) unsupported = true;
    }
    // Reasoning blocks are excluded; neither their bytes nor invented separators enter artifacts.
  });
  const shape = object(reply) && reply.output?.message?.role === "assistant" && Array.isArray(content) && !unsupported;
  const usage = reply?.usage;
  const reportedUsage = object(usage) && Object.keys(usage).every(k => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)) &&
    Object.values(usage).every(n => typeof n === "number" && Number.isFinite(n)) ? frozenCopy(usage) : null;
  const validUsage = object(usage) && Object.keys(usage).every(k => ["inputTokens", "outputTokens", "totalTokens", "cacheReadInputTokens", "cacheWriteInputTokens"].includes(k)) &&
    Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 &&
    Object.values(usage).every(n => Number.isSafeInteger(n) && n >= 0) &&
    Number.isSafeInteger(usage.inputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0)) &&
    (usage.totalTokens === undefined || usage.totalTokens >= usage.inputTokens + usage.outputTokens &&
      usage.totalTokens <= usage.inputTokens + usage.outputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0));
  const stopReason = typeof reply?.stopReason === "string" ? reply.stopReason : null;
  let status = !shape ? "invalid-reply" : finalTextBlocks.length === 0 ? "no-final-text" :
    finalTextBlocks.every(b => b.text.replace(/[\p{Cf}\s]/gu, "").length === 0) ? "empty-answer" :
      stopReason !== "end_turn" ? "incomplete-response" : "answer";
  if (status === "answer" && finalTextBlocks.some(b => /^\s*(?:i (?:cannot|can't|won't|am unable to)|unable to (?:help|assist|provide)|cannot (?:help|assist|provide))\b/iu.test(b.text.replace(/[’ʼ]/gu, "'")))) status = "refusal-like";
  return { finalTextBlocks, status, stopReason, usage: validUsage ? frozenCopy(usage) : null, reportedUsage,
    usageStatus: validUsage ? "reported-synthetic" : usage === undefined ? "unknown" :
      reportedUsage && Object.keys(reportedUsage).some(k => !["inputTokens", "outputTokens", "totalTokens", "cacheReadInputTokens", "cacheWriteInputTokens"].includes(k)) ? "unverified-fields" : "malformed" };
}

function analyzeBlocks(blocks, domain, responseStatus) {
  return blocks.map(({ blockIndex, text }) => {
    if (text.length > MAX_INPUT_CHARS && [...text].length > MAX_INPUT_CHARS) return { blockIndex, status: "scan-too-long", moves: null };
    try {
      const result = scan(text, { domain });
      if (result.moves.some(m => text.slice(m.start, m.end) !== m.match)) refuse("E_OFFSET_ROUND_TRIP");
      return { blockIndex, status: responseStatus === "answer" ? "scanned" : "scanned-incomplete-response",
        rulesVersion: result.rulesVersion, rulesHash: result.rulesHash, moves: result.moves,
        counts: result.counts, interpretation: result.moves.length ? "structural-marks" : "no-structural-marks" };
    } catch { return { blockIndex, status: "scan-failed", moves: null }; }
  });
}

/** Runs only the branded built-in stub. Every startup gate precedes directory creation and calls. */
export async function runModelCheck({ mode = "offline", registry, modelIds, questionSet, approval,
  adapter, artifactDirectory, domain = "general", ledger = new OfflineLedger() }) {
  if (mode !== "offline") refuse("E_OFFLINE_ONLY");
  if (!STUBS.has(adapter)) refuse("E_TRUSTED_OFFLINE_STUB_REQUIRED");
  if (!(ledger instanceof OfflineLedger) || !DOMAINS.includes(domain)) refuse("E_RUN_SETTINGS");
  const selected = frozenCopy(modelIds);
  const reviewed = validateRegistry(registry, selected);
  const questions = validateQuestionSet(questionSet);
  const runHash = runBinding(questions.hash, reviewed.hash, selected, domain);
  const permission = validateApproval(questions.set, runHash, approval);
  const startedAt = new Date().toISOString();
  if (permission.kind === "owner-approval" && permission.approvedAt > startedAt) refuse("E_OWNER_APPROVAL_REQUIRED");
  const engine = scan("", { domain });
  const engineBundle = await readFile(new URL("../../engine/dist/index.js", import.meta.url));
  const engineFingerprint = { declaredBaseRevision: ENGINE_BASE_REVISION, bundleSha256: bytesDigest(engineBundle),
    rulesVersion: engine.rulesVersion, rulesHash: engine.rulesHash, domain, spanCoordinates: "UTF-16 string offsets" };
  // Detect every arithmetic overflow before any directory, reservation or replay is created.
  const reservationAmounts = new Map(selected.map(modelId => [modelId, new Map(questions.set.questions.map(question =>
    [question.id, simulatedMicros(Buffer.byteLength(question.text, "utf8") + SIMULATED_FRAMING_TOKENS,
      reviewed.document.table.models[modelId].maxTokens, reviewed.document.table.models[modelId])]))]));
  await prepareArtifactDirectory(artifactDirectory);
  const initialLedger = ledger.snapshot();
  const rows = [];
  for (const modelId of selected) {
    const model = reviewed.document.table.models[modelId];
    for (const question of questions.set.questions) {
      const request = userOnlyRequest(question.text, model);
      const plannedAt = new Date().toISOString();
      const row = { modelId, question, questionSha256: bytesDigest(question.text), setHash: questions.hash,
        registryHash: reviewed.hash, plannedAt, requestedAt: null, respondedAt: null, elapsedMs: null, processingElapsedMs: null,
        settings: request, requestSha256: digest(request), route: { region: model.region, route: model.route, destinationRegions: model.destinationRegions },
        engine: engineFingerprint, responseStatus: "not-called", finalTextBlocks: [], scans: [], usage: null,
        usageStatus: "not-returned", actualCostUsd: 0, simulatedCost: { kind: "not-called", reservedMicros: 0, measuredMicros: null },
        billingEvidence: { billedMaxTokens: model.billedMaxTokens, inputTokenBound: model.inputTokenBound,
          reasoningAccounting: model.reasoningAccounting, liveBlockReason: model.liveBlockReason } };
      rows.push(row);
      const reserveMicros = reservationAmounts.get(modelId).get(question.id);
      // One rehearsal uses its start's accounting periods, even across UTC rollover.
      const reserved = ledger.reserve(startedAt, reserveMicros);
      if (!reserved.ok) { row.code = reserved.code; continue; }
      row.reservation = reserved.reservation;
      row.simulatedCost = { kind: "reserved", reservedMicros: reserveMicros, measuredMicros: null,
        boundSource: "synthetic question-byte plus 50 framing, 400 output-token fixture allowance; no provider bound" };
      const start = performance.now();
      row.requestedAt = new Date().toISOString();
      let reply;
      try {
        reply = await STUBS.get(adapter)(request, { ledger, reservation: reserved.reservation, modelId, questionId: question.id });
      } catch {
        row.respondedAt = new Date().toISOString();
        row.elapsedMs = Math.max(0, performance.now() - start);
        ledger.unresolved(reserved.reservation.token);
        row.responseStatus = "stub-failed"; row.code = "E_OFFLINE_STUB_FAILURE";
        row.simulatedCost.kind = "unknown-retained-reservation";
        continue;
      }
      row.respondedAt = new Date().toISOString();
      row.elapsedMs = Math.max(0, performance.now() - start);
      const processingStart = performance.now();
      try {
        const parsed = inspectReply(reply);
        Object.assign(row, parsed);
        row.responseStatus = parsed.status;
        delete row.status;
        row.scans = analyzeBlocks(parsed.finalTextBlocks, domain, row.responseStatus);
        if (parsed.usage) {
          const usageInput = parsed.usage.inputTokens + (parsed.usage.cacheReadInputTokens ?? 0) + (parsed.usage.cacheWriteInputTokens ?? 0);
          let actual;
          try { actual = simulatedMicros(usageInput, parsed.usage.outputTokens, model); }
          catch {
            ledger.unresolved(reserved.reservation.token);
            row.simulatedCost.kind = "synthetic-bound-breach-retained-reservation";
            row.code = "E_SIMULATED_BOUND_BREACH";
            continue;
          }
          ledger.settle(reserved.reservation.token, actual);
          const boundViolated = actual > reserveMicros || parsed.usage.outputTokens > model.maxTokens ||
            usageInput > Buffer.byteLength(question.text, "utf8") + SIMULATED_FRAMING_TOKENS;
          row.simulatedCost.kind = boundViolated ? "synthetic-bound-breach" : "synthetic-usage-estimate";
          row.simulatedCost.measuredMicros = actual;
          if (boundViolated) { ledger.pause(); row.code = "E_SIMULATED_BOUND_BREACH"; }
        } else { ledger.unresolved(reserved.reservation.token); row.simulatedCost.kind = "unknown-retained-reservation"; row.code = "E_SYNTHETIC_USAGE_UNKNOWN"; }
      } catch {
        ledger.unresolved(reserved.reservation.token);
        row.responseStatus = "processing-failed"; row.code = "E_OFFLINE_PROCESSING_FAILURE";
        row.simulatedCost.kind = "unknown-retained-reservation";
      } finally {
        row.processingElapsedMs = Math.max(0, performance.now() - processingStart);
      }
    }
  }
  const report = { schema: 1, mode: "offline", source: "synthetic replay fixtures", actualCostUsd: 0,
    warning: "Synthetic plumbing evidence only. Structural marks do not establish truth, neutrality, factual quality, or a model ranking.",
    runHash, setHash: questions.hash, registryHash: reviewed.hash, registry: reviewed.document,
    questionSet: questions.set, approval: { ...permission, authenticated: false,
      verificationNote: permission.kind === "owner-approval" ? "Unauthenticated local receipt; operator must verify the referenced owner approval independently." :
        "Built-in neutral fixtures; no human approval is claimed." },
    sourceDraftStatusMeaning: "Any sourceDraft metadata describes its historical preparation only; this run's separate approval and rows describe execution.",
    modelIds: selected,
    modelOrder: "model-major; questions in approved input order; no retries or fallback", engine: engineFingerprint,
    startedAt, finishedAt: new Date().toISOString(), adapter: { name: adapter.name, fixtureHash: adapter.fixtureHash },
    complete: rows.every(r => r.responseStatus === "answer" && r.usageStatus === "reported-synthetic" &&
      !r.code && r.scans.length > 0 && r.scans.every(s => s.status === "scanned")),
    initialLedger, finalLedger: ledger.snapshot(), rows };
  await writeArtifacts(artifactDirectory, report);
  return frozenCopy(report);
}
