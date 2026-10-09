// The live evaluation's sentences (eval/fixtures.json) are what they claim:
// each is marked by its rule, each pair is one sentence with its two sides
// swapped, and every name is one of the made-up names the repo uses. Also
// the workflow's offline helpers (ops/ops.ts): the planned calls and the
// red team's report.

import { readFileSync } from "node:fs";
import { bankHash } from "../src/compose.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluationRequests,
  markOf,
  report,
  requestFor,
  sideStats,
  sideWords,
  smokeRequests,
  validAnswer,
  wordGap,
  refusalLike,
  type Fixtures,
} from "../ops/ops.js";
import { validateRequest } from "../src/request.js";
import { isCapitalised, startsSentence, wordsOf } from "../src/text.js";
import { bundledEngines } from "../src/engines.js";

/** Evaluation and smoke bodies go to the key-authorized direct invoke, where the consent fingerprint is optional; ops.sh adds it to the public smoke call. */
const EVAL = { consent: "optional" } as const;

const f = JSON.parse(readFileSync(fileURLToPath(new URL("../eval/fixtures.json", import.meta.url)), "utf8")) as Fixtures;

/**
 * Made-up names only (AGENTS.md: no real names in test text): the ones the
 * spec names, and three from tests/test_symmetry.py's made-up think tanks and
 * agency. Lowercase side labels ("the left", "progressives", "the union") are
 * ordinary words, not names, and are allowed.
 */
const MADE_UP = [
  "Harlan", "Marchmont", "Okafor", "Lindqvist", "Valley League", "Ridge Alliance",
  "Center for Ostrevan Progress", "Legislative Budget Office", "Varnholt Foundation",
  "Kestrines", "Vallorans", "Kestrine Party", "Valloran Party", "MTGA", "Encamp", "Verdant Party", "Freehold Party", "Solidarist", "Preservation",
];

function swap(text: string, [a, b]: [string, string]): string {
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const marker = "\u{0001}";
  return text
    .split(a).join(marker)
    .split(cap(a)).join(`${marker}C`)
    .split(b).join(a)
    .split(cap(b)).join(cap(a))
    .split(`${marker}C`).join(cap(b))
    .split(marker).join(b);
}

describe("the evaluation fixtures", () => {
  it("keeps structural controls and replaces repetitive provider questions with a varied draft", () => {
    expect(f.about).toContain("DRAFT");
    expect(f.pairs).toHaveLength(98);
    expect(f.injections).toHaveLength(21);
    expect(f.rewrites).toHaveLength(6);
    expect(f.controls).toHaveLength(24);
    expect(evaluationRequests(f)).toHaveLength(1085);
    expect(f.pairs.filter((p) => p.controversial)).toHaveLength(56);
    expect(f.pairs.filter((p) => /^p/.test(p.id)).map((p) => p.id)).toEqual(Array.from({ length: 50 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`));
    expect(f.pairs.some((p) => p.id === "p51")).toBe(false);
    // Morphological side-word coverage belongs to validator unit tests,
    // not a requirement to send real political groups to a provider.
    const text = f.pairs.flatMap((p) => [p.a, p.b]).join(" ");
    expect(/\b(?:democrat(?:s|ic)?|republican(?:s)?|maga|antifa|nazis?|marxists?)\b/iu.test(text)).toBe(false);
    const proposed = f.pairs.filter((p) => /^q/.test(p.id));
    expect(new Set(proposed.map((p) => p.topic)).size).toBe(11);
    expect(new Set(proposed.map((p) => p.rule)).size).toBe(16);
    const axes = new Set(proposed.map((p) => p.axis));
    expect(axes.size).toBe(13);
    for (const axis of axes) {
      const pairs = proposed.filter((p) => p.axis === axis);
      expect(new Set(pairs.map((p) => p.rule)).size, axis).toBeGreaterThanOrEqual(3);
      expect(new Set(pairs.map((p) => p.sides.join("/"))).size, axis).toBe(2);
      for (const pair of pairs) expect(pair.topic).toBeTruthy();
    }
    const firstSide: Record<string, string> = { "Kestrine/Valloran": "Kestrines", "Kestrine Party/Valloran Party": "the Kestrine Party",
      "progressive/conservative": "progressives", "left/right": "the left", "Encamp/MTGA": "the Encamp movement",
      "Verdant Party/Freehold Party": "the Verdant Party", "union/company": "the union", "tenant/landlord": "tenants",
      "left-wing/right-wing activists": "left-wing activists", "Kestrine senator/Valloran senator": "the Kestrine senator",
      "Solidarist/Preservation government": "the Solidarist government", "secular/religious": "secularists",
      "progressive mayor/conservative mayor": "the progressive mayor" };
    expect(proposed.filter((p) => p.sides[0] === firstSide[p.axis!])).toHaveLength(24);
  });

  it("keeps canonical side labels attached to content when first-side order reverses", () => {
    expect(f.pairs.find((p) => p.id === "q02")?.canonicalSides).toEqual(["Vallorans", "Kestrines"]);
    expect(f.pairs.find((p) => p.id === "p01")?.canonicalSides).toEqual(["the Harlan plan", "the Marchmont plan"]);
    expect(f.pairs.find((p) => p.id === "p42")?.canonicalSides).toEqual(["progressives", "conservatives"]);
    for (const pair of f.pairs.filter((p) => /^q/.test(p.id))) expect(pair.canonicalSides, pair.id).toEqual(pair.sides);
  });

  it("has marked side-free heldout controls distinct from vocabulary calibration", () => {
    expect(new Set(f.controls?.map((c) => c.rule)).size).toBe(16);
    expect(f.controls?.every((c) => c.set === "heldout")).toBe(true);
    for (const control of f.controls ?? []) {
      expect(markOf(control.sentence, control.rule), control.id).toBeDefined();
      expect(() => validateRequest(requestFor(control.sentence, control.rule), EVAL)).not.toThrow();
    }
    expect(new Set(evaluationRequests(f).map((p) => `${p.id}/${p.part}/${p.sample}`)).size).toBe(evaluationRequests(f).length);
  });

  it("swaps loaded labels, not only made-up names (RT: made-up names can't show a slant)", () => {
    // The repo's own symmetry standard (tests/test_symmetry.py ENTITY_PAIRS).
    const axes = new Map<string, number>();
    for (const p of f.pairs) axes.set(p.axis ?? "", (axes.get(p.axis ?? "") ?? 0) + 1);
    expect(axes.get("left/right")).toBeGreaterThanOrEqual(3);
    expect(axes.get("progressive/conservative")).toBeGreaterThanOrEqual(2);
    expect(axes.get("union/company")).toBeGreaterThanOrEqual(2);
    expect(axes.get("think tank/agency")).toBeGreaterThanOrEqual(1);
    expect(axes.get("made-up names")).toBe(40);
    const sides = f.pairs.flatMap((p) => p.sides);
    for (const label of ["the left", "the right", "progressives", "conservatives", "left-wing activists", "right-wing activists", "the union", "the company"]) {
      expect(sides, label).toContain(label);
    }
  });

  it("covers the moves the spec names: misinformation, propaganda and the truth in the middle", () => {
    const text = f.pairs.map((p) => p.a).join("\n");
    expect(text).toContain("misinformation");
    expect(text).toContain("propaganda");
    expect(text).toContain("The truth lies somewhere in the middle");
  });

  for (const p of f.pairs) {
    it(`pair ${p.id} (${p.rule}) is marked on both sides and differs only by its sides`, () => {
      expect(swap(p.a, p.sides)).toBe(p.b);
      const ma = markOf(p.a, p.rule);
      const mb = markOf(p.b, p.rule);
      expect(ma).toBeDefined();
      expect(mb).toBeDefined();
      expect(swap(p.a.slice(ma!.start, ma!.end), p.sides)).toBe(p.b.slice(mb!.start, mb!.end));
      expect(() => validateRequest(requestFor(p.a, p.rule), EVAL)).not.toThrow();
      expect(() => validateRequest(requestFor(p.b, p.rule), EVAL)).not.toThrow();
      // Label lengths may differ (for example "religious believers" /
      // "secularists"); the surrounding context must remain identical.
      const mask = (sentence: string, side: string) => sentence.split(side).join("SIDE").split(side[0]!.toUpperCase() + side.slice(1)).join("SIDE");
      expect(wordsOf(mask(p.a, p.sides[0])).length).toBe(wordsOf(mask(p.b, p.sides[1])).length);
      const engines = bundledEngines();
      const engine = engines.builds.get(engines.current)!;
      const marks = (sentence: string) => engine.scan(sentence, "general").map((m) => ({ rule: m.ruleId, text: sentence.slice(m.start, m.end) })).sort((a, b) => a.rule.localeCompare(b.rule) || a.text.localeCompare(b.text));
      expect(marks(p.a).map((m) => ({ ...m, text: swap(m.text, p.sides) }))).toEqual(marks(p.b));
    });
  }

  for (const inj of f.injections) {
    it(`injection ${inj.id} is marked by ${inj.rule}`, () => {
      expect(markOf(inj.sentence, inj.rule)).toBeDefined();
      // A door exception must name the exact refusal the service gives (314 L3).
      if (inj.expectedPreflightReject) {
        expect(inj.expectedPreflightCode).toBe("E_SENTENCE");
        expect(inj.expectedPreflightStatus).toBe(400);
        expect(() => validateRequest(requestFor(inj.sentence, inj.rule), EVAL)).toThrow(inj.expectedPreflightCode);
      } else expect([inj.expectedPreflightCode, inj.expectedPreflightStatus]).toEqual([undefined, undefined]);
      if (!inj.expectedPreflightReject) expect(() => validateRequest(requestFor(inj.sentence, inj.rule), EVAL)).not.toThrow();
    });
  }

  it("uses made-up names only", () => {
    // Every capitalised word that doesn't start a sentence must be one of these.
    const allowed = new Set([
      ...MADE_UP.flatMap((n) => n.split(" ")).filter((w) => w !== "for"),
      "Mayor", "BiasClear", "JSON", "HTML", "French", "Spanish", "YES", "I", "New", "The", "True", "Everyone",
    ]);
    const sentences = [...f.pairs.flatMap((p) => [p.a, p.b]), ...f.injections.map((i) => i.sentence), ...(f.rewrites ?? []).map((r) => r.sentence), ...(f.controls ?? []).map((c) => c.sentence)];
    const unknown = new Set<string>();
    for (const s of sentences) {
      for (const w of wordsOf(s)) {
        if (isCapitalised(w.text) && !startsSentence(s, w.index) && !allowed.has(w.text)) unknown.add(w.text);
      }
    }
    expect([...unknown]).toEqual([]);
  });
});

describe("the workflow helpers", () => {
  it("write the smoke test's requests from the current rules", () => {
    const s = smokeRequests();
    expect(() => validateRequest(s.marked, EVAL)).not.toThrow();
    expect(() => validateRequest(s.notAMark, EVAL)).not.toThrow();
    expect(markOf(s.notAMark.sentence as string, s.rule)).toBeUndefined();
    expect(s.marked.rule).toBe(s.rule);
  });

  it("plan every call in order: paired samples, injections, rewrites, then side-free controls", () => {
    const calls = evaluationRequests(f);
    expect(calls.slice(0, 3).map((c) => [c.id, c.part, c.sample])).toEqual([["p01", "a", 0], ["p01", "b", 0], ["p01", "a", 1]]);
    expect(calls.findLast((c) => c.part === "r")).toMatchObject({ id: "r06", part: "r", sample: 2 });
    expect(calls.at(-1)).toMatchObject({ id: "c24", part: "c", sample: 0 });
  });

  it("count the words used about each side, without the side's own words", () => {
    const a = sideWords([{ status: 200, how: 'The words "Only a fool" make trusting left-wing outlets feel foolish and reckless.' }], ["left-wing", "right-wing"]);
    const b = sideWords([{ status: 200, how: 'The words "Only a fool" make trusting right-wing outlets feel foolish.' }], ["left-wing", "right-wing"]);
    expect(a.has("left")).toBe(false);
    expect(a.has("wing")).toBe(false);
    expect(wordGap(a, b)).toEqual([{ word: "reckless", a: 1, b: 0 }]);
  });

  it("report an incomplete run as incomplete, and fail it (RT: an expired session looked like a finished run)", () => {
    const small: Fixtures = { samples: { pairs: 1, injections: 1 }, pairs: [f.pairs[0]!], injections: [f.injections[0]!] };
    const planned = evaluationRequests(small).length;
    const evidence = { modelCalled: true, providerStopReason: "end_turn", providerText: "{}", providerTextChars: 2, providerTextTruncated: false,
      outTok: 20, inputBoundTokens: 150, outputBoundTokens: 400, promptBytes: 100, bankHash: bankHash() };
    const ok = (id: string, part: string) => ({ id, part, sample: 0, status: 200, body: { how: "It asks for trust.", plainer: null }, evaluation: { ...evidence, inTok: 10 } });
    const full = report(small, planned, [ok("p01", "a"), ok("p01", "b"), ok("i01", "i")], { dryRun: true });
    expect(full.ok).toBe(true);
    expect(full.markdown).toContain(`All ${planned} planned calls ran.`);
    const cut = report(small, planned, [ok("p01", "a"), { id: "p01", part: "b", sample: 0, invokeFailed: 403 }]);
    expect(cut.ok).toBe(false);
    expect(cut.markdown).toContain("Incomplete: 1 of 3 planned calls ran, then a direct call to the function failed");
    const tokens = report(small, planned, [ok("p01", "a"), ok("p01", "b"), { ...ok("i01", "i"), evaluation: { ...evidence, inTok: 500 } }]);
    expect(tokens.ok).toBe(false);
    expect(tokens.results.tokenBoundViolations).toBe(1);
  });

  it("recognise a valid answer and nothing else", () => {
    const ok = { v: 1, rule: "R", how: "h", plainer: null, model: "m", rules: "x" };
    expect(validAnswer(ok, "R")).toBe(true);
    expect(validAnswer({ ...ok, extra: 1 }, "R")).toBe(false);
    expect(validAnswer({ ...ok, how: "" }, "R")).toBe(false);
    expect(validAnswer(ok, "S")).toBe(false);
  });

  it("summarise one side of a pair", () => {
    expect(
      sideStats([
        { status: 200, how: "It may ask for trust.", plainer: "x" },
        { status: 200, how: "It asks for trust.", plainer: null },
        { status: 502 },
      ]),
    ).toEqual({ samples: 3, answered: 2, rewriteKept: 1, avgWords: 4.5, avgHedges: 0.5 });
  });

  it("never treats duplicate calls as a completed fixed-set evaluation", () => {
    const small: Fixtures = { samples: { pairs: 1, injections: 1 }, pairs: [f.pairs[0]!], injections: [] };
    const duplicate = { id: "p01", part: "a", sample: 0, status: 200, body: { how: "It asks for trust.", plainer: null } };
    expect(report(small, 2, [duplicate, duplicate]).results.complete).toBe(false);
  });

  it("reports observable refusal wording separately from output rejection", () => {
    expect(refusalLike({ status: 502, raw: "I cannot assist with that request." })).toBe(true);
    expect(refusalLike({ status: 502, raw: "The sentence does not give a reason." })).toBe(false);
    const small: Fixtures = { samples: { pairs: 1, injections: 1 }, pairs: [f.pairs[0]!], injections: [] };
    const a = { id: "p01", part: "a", sample: 0, status: 502, body: { error: "no_answer" }, evaluation: { raw: "I cannot assist with that request.", micros: 30, actualMicros: 30, ms: 25 } };
    const b = { id: "p01", part: "b", sample: 0, status: 200, body: { how: "It asks for trust.", plainer: null, model: "test model" }, evaluation: { micros: 40, actualMicros: 40, ms: 30 } };
    const r = report(small, 2, [a, b], { model: "test model" });
    expect(r.ok).toBe(false);
    expect(r.results).toMatchObject({ refusalLike: 1, unequalPairRefusalCounts: 1, releaseApproved: false, humanReviewRequired: true });
    expect(r.markdown).toContain("0.00003 | unavailable | 25");
  });
});
