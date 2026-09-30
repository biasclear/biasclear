// Parity with the golden files in tests/golden/ (the same files the Python
// tests read). Offsets there are code points; the engine returns UTF-16
// indices, so each expected offset is converted before comparing.
// v1_parity.json records the retired v1 engine; the rules E3 changed on
// purpose (v2_parity.json's changed_rules) are left out of that comparison
// and checked against v2_parity.json instead, like tests/test_parity.py.
// scripts/parity.mjs goes further and compares with the live Python engine.

import { describe, expect, it } from "vitest";
import { CITATION_REACH } from "../src/engine.js";
import { scan } from "../src/index.js";
import type { Domain, RulePack } from "../src/types.js";
import { GOLDEN_DIR, PACKAGE, SLOW, codePointToUnit, goldenFiles, readJson, readPack } from "./helpers.js";
import type { GoldenCase } from "./helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pack = readPack();
const ruleDomain = new Map(pack.rules.map((r) => [r.id, r.domain]));
const files = goldenFiles();
const changed = new Set(readJson<{ changed_rules: string[] }>(join(GOLDEN_DIR, "v2_parity.json")).changed_rules);
/** Rules compared in each file: v1_parity.json holds v1, so only the rules E3 left alone. */
const compared = (file: string, id: string): boolean => file !== "v1_parity.json" || !changed.has(id);

function expected(c: GoldenCase, domain: Domain | undefined, file: string): Array<[string, number, number]> {
  const units = codePointToUnit(c.text);
  const wanted = new Set(["general", domain ?? "general"]);
  return c.moves
    .filter(([id]) => compared(file, id))
    .filter(([id]) => domain === "all" || wanted.has(ruleDomain.get(id) ?? ""))
    .map(([id, s, e]) => [id, units[s] as number, units[e] as number]);
}

function got(text: string, domain: Domain | undefined, file: string): Array<[string, number, number]> {
  const result = domain === undefined ? scan(text) : scan(text, { domain });
  for (const m of result.moves) expect(m.match).toBe(text.slice(m.start, m.end));
  return result.moves.filter((m) => compared(file, m.ruleId)).map((m) => [m.ruleId, m.start, m.end]);
}

it("reads the three golden files", () => {
  expect(files.map((f) => f.name)).toEqual(["unicode_parity.json", "v1_parity.json", "v2_parity.json"]);
  const v1 = files.find((f) => f.name === "v1_parity.json");
  const v2 = files.find((f) => f.name === "v2_parity.json");
  expect(v1?.cases.length).toBeGreaterThanOrEqual(500);
  expect(v2?.cases.length).toBeGreaterThanOrEqual(v1?.cases.length ?? Infinity);
  const ids = new Set(pack.rules.map((r) => r.id));
  const v1Exercised = new Set(v1?.cases.flatMap((c) => c.moves.map((m) => m[0])).filter((id) => !changed.has(id)));
  expect(v1Exercised).toEqual(new Set([...ids].filter((id) => !changed.has(id))));
  expect(new Set(v2?.cases.flatMap((c) => c.moves.map((m) => m[0])))).toEqual(ids);
  for (const id of changed) expect(ids.has(id)).toBe(true);
});

for (const file of files) {
  describe(file.name, () => {
    it.each(["all", undefined, "general", "legal", "media", "financial"] as const)(
      "matches every case for domain %s",
      (domain) => {
        const failures: string[] = [];
        for (const c of file.cases) {
          const want = expected(c, domain, file.name);
          const have = got(c.text, domain, file.name);
          if (JSON.stringify(have) !== JSON.stringify(want)) {
            failures.push(`${c.src}: got ${JSON.stringify(have)}, expected ${JSON.stringify(want)}`);
          }
        }
        expect(failures.slice(0, 5)).toEqual([]);
      },
      SLOW,
    );
  });
}

/**
 * The engine as it would be without the Unicode work: the pack's regexes run
 * as plain JavaScript RegExps, and everything counts UTF-16 units. Returns
 * moves with code point offsets, like the golden files.
 */
function naiveScan(p: RulePack, text: string): Array<[string, number, number]> {
  const cs = p.citation_suppression;
  const citations = cs.patterns.map((s) => new RegExp(s, `${cs.flags}g`));
  const lower = text.toLowerCase();
  const cited = (fragment: string): boolean => {
    const idx = lower.indexOf(fragment.toLowerCase());
    if (idx === -1) return false;
    // A citation counts when any part of it is in the window (CITATION_REACH).
    const start = Math.max(0, idx - cs.window);
    const end = Math.min(text.length, idx + fragment.length + cs.window);
    const base = Math.max(0, start - CITATION_REACH);
    const context = text.slice(base, end + CITATION_REACH);
    return citations.some((re) =>
      [...context.matchAll(re)].some((m) => m.index < end - base && m.index + m[0].length > start - base),
    );
  };
  const found: Array<[number, number, number, string]> = [];
  p.rules.forEach((rule, order) => {
    const spans: Array<[number, number]> = [];
    for (const source of rule.indicators) {
      for (const m of text.matchAll(new RegExp(source, rule.flags + "g"))) {
        if (m[0].length > 0) spans.push([m.index, m.index + m[0].length]);
      }
    }
    if (spans.length < rule.min_matches) return;
    if (rule.suppress_if_cited && spans.every(([s, e]) => cited(text.slice(s, e)))) return;
    let lastEnd = -1;
    for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
      if (s >= lastEnd) {
        found.push([s, e, order, rule.id]);
        lastEnd = e;
      }
    }
  });
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2]);
  const toPoint = (unit: number) => [...text.slice(0, unit)].length;
  return found.map(([s, e, , id]) => [id, toPoint(s), toPoint(e)]);
}

describe("the Unicode golden cases", () => {
  const unicode = files.find((f) => f.name === "unicode_parity.json");

  it("separate Python's reading from plain JavaScript's where they say so", () => {
    expect(unicode).toBeDefined();
    const wrong: string[] = [];
    for (const c of unicode?.cases ?? []) {
      const differs = JSON.stringify(naiveScan(pack, c.text)) !== JSON.stringify(c.moves);
      if (differs !== c.native_js_differs) wrong.push(`${c.src}: native_js_differs should be ${differs}`);
    }
    expect(wrong).toEqual([]);
    expect(unicode?.cases.filter((c) => c.native_js_differs).length).toBeGreaterThanOrEqual(15);
  }, SLOW);

  it("are counted as README.md says", () => {
    const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
    const cases = unicode?.cases ?? [];
    const differ = cases.filter((c) => c.native_js_differs).length;
    expect(readme).toContain(`pins this with ${cases.length} cases`);
    expect(readme).toContain(`${differ} of them come out differently with plain JavaScript regexes`);
  });

  it("agree with plain JavaScript on the v2 golden file", () => {
    // Why parity alone was not enough: the ASCII-heavy v1 texts can't tell the two apart.
    const v2 = files.find((f) => f.name === "v2_parity.json");
    expect(v2?.cases.length).toBeGreaterThanOrEqual(500);
    const differing = (v2?.cases ?? []).filter((c) => JSON.stringify(naiveScan(pack, c.text)) !== JSON.stringify(c.moves));
    expect(differing.map((c) => c.src)).toEqual([]);
  }, SLOW);
});
