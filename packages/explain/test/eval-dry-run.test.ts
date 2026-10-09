import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { dryMarkdown, runDryEvaluation } from "../eval/dry-run.js";
import type { Fixtures } from "../ops/ops.js";
import { MODELS } from "../src/models.js";

const all = JSON.parse(readFileSync(fileURLToPath(new URL("../eval/fixtures.json", import.meta.url)), "utf8")) as Fixtures;

describe("offline Explain evaluation", () => {
  it("uses the same fixed cases for every model, with reservations and zero network", async () => {
    const network = vi.fn(() => { throw new Error("network forbidden in offline test"); });
    vi.stubGlobal("fetch", network);
    try {
      const small: Fixtures = { ...all, samples: { pairs: 1, injections: 1, rewrites: 3 },
        controls: [], pairs: all.pairs.filter((p) => p.id === "p41"), injections: all.injections.filter((p) => ["i03", "i13", "i14"].includes(p.id)) };
      const run = await runDryEvaluation(small);
      expect(network).not.toHaveBeenCalled();
      expect(run).toMatchObject({ actualSpendUsd: 0, qualityMeasured: false, releaseApproved: false,
        reservedBeforeEveryCall: true, sameFixedSetForEveryModel: true });
      expect(run.models).toHaveLength(Object.keys(MODELS).length);
      expect(new Set(run.models.map((m) => m.fixtureHash)).size).toBe(1);
      for (const model of run.models) {
        expect(model.syntheticBound).toMatchObject({ billedMaxTokens: 400, framingTokens: 50 });
        expect(model.liveConfigurationBlocked).toBe(true);
        expect(model.knownLiveWorstCaseUsd).toBeNull();
        expect(model).toMatchObject({ planned: 23, simulationChecksPass: true, injectedVerdictProbes: 3,
          injectedVerdictRejected: 3, unsafeRewriteProbes: 6, unsafeRewriteDropped: 6, safeRewriteProbes: 12, safeRewriteKept: 12 });
        expect(model.results).toMatchObject({ releaseApproved: false, qualityMeasured: false, actualSpendUsd: 0, complete: true });
      }
      const markdown = dryMarkdown(run);
      for (const model of Object.values(MODELS)) expect(markdown).toContain(`## ${model.displayName}`);
      expect(markdown).toContain("This is not a model pass.");
    } finally { vi.unstubAllGlobals(); }
  });
});
