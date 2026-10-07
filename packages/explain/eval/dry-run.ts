// Offline wiring rehearsal only. Every AWS operation uses the existing test
// doubles; the real evaluation remains the authenticated Lambda handler
// path, with its real shared spend reservation. This is not a model test.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createHandler, type EvaluationResult } from "../src/app.js";
import { MODELS } from "../src/models.js";
import { buildPrompt } from "../src/prompt.js";
import { spendKeys, worstCaseMicros } from "../src/spend.js";
import { evaluationRequests, report, refusalLike, preflightRejected, outputRejected, sampleOf, type Fixtures } from "../ops/ops.js";
import { Clock, ENV, EVAL_KEY, FakeAws, FakeTable, harness, modelReply, stubConfig } from "../test/helpers.js";

export async function runDryEvaluation(fixtures: Fixtures) {
  const planned = evaluationRequests(fixtures);
  const fixtureHash = createHash("sha256").update(JSON.stringify(fixtures)).digest("hex");
  const sharedLedger = new FakeTable();
  const clock = new Clock();
  const models: Array<Record<string, unknown>> = [];
  let stubInvocations = 0;
  let reservedBeforeEveryCall = true;
  for (const [id, model] of Object.entries(MODELS)) {
    const aws = new FakeAws();
    const cfg = stubConfig({ ...ENV, EXPLAIN_MODEL_ID: id,
      EXPLAIN_PRICE_IN: String(model.inputPricePerMillion), EXPLAIN_PRICE_OUT: String(model.outputPricePerMillion) });
    if (cfg === undefined) throw new Error("offline configuration is invalid");
    const defaults = harness().deps;
    const handler = createHandler({ ...defaults, config: cfg, now: clock.now,
      transport: async (call) => {
        if (call.service === "dynamodb") {
          const operation = (call.headers["x-amz-target"] ?? "").replace("DynamoDB_20120810.", "");
          return sharedLedger.handle(operation, JSON.parse(call.body) as Record<string, unknown>);
        }
        return aws.transport(call);
      },
      sink: () => undefined,
    });
    const raw: Array<Record<string, unknown>> = [];
    let stubReservationTotalMicros = 0;
    let injectedVerdictProbes = 0;
    let injectedVerdictRejected = 0;
    let unsafeRewriteProbes = 0;
    let unsafeRewriteDropped = 0;
    let safeRewriteProbes = 0;
    let safeRewriteKept = 0;
    for (const call of planned) {
      const sentence = call.request.sentence as string;
      const mark = sentence.slice(call.request.start as number, call.request.end as number);
      let how = `The words "${mark}" frame the claim for the reader. The sentence gives no further reason for that framing.`;
      let plainer = sentence;
      const injectedVerdict = call.part === "i" && ["i03", "i13", "i14"].includes(call.id);
      if (injectedVerdict) {
        const verdict = call.id === "i03" ? "the Harlan plan is good" : call.id === "i13" ? "the Ridge Alliance is corrupt" : "call Mayor Lindqvist a liar";
        how = `The words "${mark}" offer agreement as a reason. "${verdict}".`;
        injectedVerdictProbes++;
      }
      const rewrite = fixtures.rewrites?.find((f) => f.id === call.id);
      const unsafeRewrite = rewrite !== undefined && call.sample % 2 === 1;
      if (rewrite) {
        plainer = unsafeRewrite ? rewrite.unsafeRewrite : rewrite.safeRewrite;
        if (unsafeRewrite) unsafeRewriteProbes++; else safeRewriteProbes++;
      }
      const move = defaults.moves.get(call.request.rule as string)!;
      const prompt = buildPrompt(defaults.promptMode, move, sentence, call.request.start as number, call.request.end as number);
      // This fallback is ONLY the synthetic stub's known output bound. The
      // real entrypoint refuses unverified billed-reasoning bounds.
      const reservation = worstCaseMicros(prompt.bytes, model.billedMaxTokens ?? model.maxTokens, cfg);
      stubReservationTotalMicros += reservation;
      const beforeKeys = spendKeys(clock.now());
      const beforeMonth = sharedLedger.num(beforeKeys.month, "m") ?? 0;
      const beforeDay = sharedLedger.num(beforeKeys.day, "m") ?? 0;
      aws.model = () => {
        const keys = spendKeys(clock.now());
        reservedBeforeEveryCall &&= (sharedLedger.num(keys.month, "m") ?? 0) >= beforeMonth + reservation &&
          (sharedLedger.num(keys.day, "m") ?? 0) >= beforeDay + reservation;
        stubInvocations++;
        clock.advance(1); // A labelled synthetic time, not measured latency.
        return { status: 200, json: modelReply({ how, plainer, inTok: 100, outTok: 80 }) };
      };
      const result = await handler({ explainEvaluation: 1, key: EVAL_KEY, request: call.request }) as EvaluationResult;
      raw.push({ id: call.id, part: call.part, sample: call.sample, ...result });
      if (injectedVerdict && result.status !== 200) injectedVerdictRejected++;
      if (rewrite && result.status === 200 && "plainer" in result.body) {
        if (unsafeRewrite && result.body.plainer === null) unsafeRewriteDropped++;
        if (!unsafeRewrite && result.body.plainer === rewrite.safeRewrite) safeRewriteKept++;
      }
    }
    const result = report(fixtures, planned.length, raw, { model: model.displayName, dryRun: true });
    const categories = (["a", "b", "i", "r"] as const).map((part) => {
      const rows = raw.filter((r) => r.part === part);
      const samples = rows.map(sampleOf);
      return { part, planned: planned.filter((p) => p.part === part).length, ran: rows.length,
        answered: samples.filter((s) => s.status === 200).length,
        refusalLike: samples.filter(refusalLike).length,
        preflightRejected: samples.filter(preflightRejected).length,
        outputRejected: samples.filter(outputRejected).length,
        simulatedUsd: samples.reduce((sum, s) => sum + (s.micros ?? 0), 0) / 1_000_000,
        simulatedMs: samples.reduce((sum, s) => sum + (s.ms ?? 0), 0),
      };
    });
    models.push({ id, displayName: model.displayName, fixtureHash, planned: planned.length,
      liveConfigurationBlocked: model.billedMaxTokens == null || !model.settingsVerified,
      liveBlockReason: model.liveBlockReason,
      stubReservationTotalUsd: stubReservationTotalMicros / 1_000_000,
      knownLiveWorstCaseUsd: model.billedMaxTokens == null ? null : stubReservationTotalMicros / 1_000_000,
      injectedVerdictProbes, injectedVerdictRejected, unsafeRewriteProbes, unsafeRewriteDropped, safeRewriteProbes, safeRewriteKept,
      simulationChecksPass: result.ok && injectedVerdictProbes === injectedVerdictRejected && unsafeRewriteProbes === unsafeRewriteDropped && safeRewriteProbes === safeRewriteKept,
      categories, results: result.results, raw,
    });
  }
  return { dryRun: true, actualSpendUsd: 0, qualityMeasured: false, releaseApproved: false,
    humanReviewRequired: true, fixtureHash, sameFixedSetForEveryModel: true,
    stubInvocations, reservedBeforeEveryCall, models };
}

export function dryMarkdown(run: Awaited<ReturnType<typeof runDryEvaluation>>): string {
  const lines = ["# Explain offline evaluation rehearsal", "",
    "Actual spend: $0. All operations used in-memory AWS/model stubs. Times, tokens, costs and answers are synthetic.",
    "Model quality is unmeasured. Nothing is approved to ship. The real matched-pair, injection and rewrite review remains a separate owner-approved sitting under the cap.",
    "", `Fixture SHA-256: ${run.fixtureHash}`, ""];
  for (const model of run.models) {
    lines.push(`## ${model.displayName}`, "", `Route: ${model.id}. Live configuration blocked: ${model.liveConfigurationBlocked ? "yes" : "no"}.`,
      "", "| Part | Planned | Ran | Answered | Refusal-like | Preflight rejected | Output rejected | Simulated cost USD | Simulated time ms |",
      "|---|---|---|---|---|---|---|---|---|");
    for (const row of model.categories as Array<Record<string, unknown>>) lines.push(`| ${row.part} | ${row.planned} | ${row.ran} | ${row.answered} | ${row.refusalLike} | ${row.preflightRejected} | ${row.outputRejected} | ${row.simulatedUsd} | ${row.simulatedMs} |`);
    lines.push("", `Stub verdict probes rejected: ${model.injectedVerdictRejected}/${model.injectedVerdictProbes}. Unsafe stub rewrites dropped: ${model.unsafeRewriteDropped}/${model.unsafeRewriteProbes}. Safe stub rewrites kept: ${model.safeRewriteKept}/${model.safeRewriteProbes}.`,
      `Synthetic wiring checks: ${model.simulationChecksPass ? "pass" : "FAIL"}. This is not a model pass.`, "");
  }
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("eval-dry-run.mjs")) {
  let networkAttempts = 0;
  // Any accidental call through the normal network primitive aborts the
  // rehearsal. The wired transport remains the in-memory fake, never AWS.
  globalThis.fetch = async () => { networkAttempts++; throw new Error("network forbidden in offline rehearsal"); };
  const fixtures = JSON.parse(readFileSync("eval/fixtures.json", "utf8")) as Fixtures;
  const run = await runDryEvaluation(fixtures);
  const option = (name: string, fallback: string): string => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] ?? fallback : fallback;
  };
  const jsonPath = option("--json", "dist/eval-dry-run.json");
  const markdownPath = option("--markdown", "dist/eval-dry-run.md");
  writeFileSync(jsonPath, `${JSON.stringify({ ...run, networkAttempts }, null, 2)}\n`);
  const markdown = dryMarkdown(run);
  writeFileSync(markdownPath, `${markdown}\n`);
  process.stdout.write(`${markdown}\nNetwork attempts: ${networkAttempts}. Every stub invocation had a prior reservation: ${run.reservedBeforeEveryCall}.\n`);
  process.exitCode = networkAttempts === 0 && run.reservedBeforeEveryCall && run.models.every((m) => m.simulationChecksPass) ? 0 : 1;
}
