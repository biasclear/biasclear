// Behavior of scan() beyond golden parity. Mirrors tests/test_engine.py.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CITATION_REACH, compileEngine, scanWith } from "../src/engine.js";
import { DOMAINS, MAX_INPUT_CHARS, prepare, rulePack, scan } from "../src/index.js";
import type { RulePack, Tier } from "../src/types.js";
import { PACKAGE, SLOW, readPack } from "./helpers.js";

const TEXT = "Everyone agrees we must act now. Either we pass this bill or the economy collapses.";

describe("result shape", () => {
  it("has the Python fields, renamed to camelCase, in the same order", () => {
    const result = scan(TEXT);
    expect(Object.keys(result)).toEqual(["rulesVersion", "rulesHash", "moves", "counts"]);
    expect(result.rulesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rulesVersion).toBe(readPack().rules_version);
    expect(Object.keys(result.counts)).toEqual(["1", "2", "3"]);
    const total = result.counts["1"] + result.counts["2"] + result.counts["3"];
    expect(total).toBe(result.moves.length);
    expect(result.moves.length).toBeGreaterThan(0);
    for (const move of result.moves) {
      expect(Object.keys(move)).toEqual(["ruleId", "name", "tier", "domain", "severity", "start", "end", "match"]);
      expect(move.match).toBe(TEXT.slice(move.start, move.end));
      expect(result.counts[String(move.tier) as "1" | "2" | "3"]).toBeGreaterThan(0);
    }
  }, SLOW);

  it("prints what the README example shows", () => {
    // Like tests/test_readme.py: the js block's scan() call, then its text block.
    const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
    const m = /```js\n([\s\S]*?)```\s*```text\n([\s\S]*?)```/.exec(readme);
    expect(m).not.toBeNull();
    const [, code = "", output = ""] = m ?? [];
    const call = /scan\("([^"]*)"\)/.exec(code);
    expect(call?.[1]).toBe(TEXT);
    expect(code).toContain("console.log(move.tier, move.ruleId, JSON.stringify(move.match))");
    const lines = scan(TEXT).moves.map((mv) => `${mv.tier} ${mv.ruleId} ${JSON.stringify(mv.match)}\n`);
    expect(lines.join("")).toBe(output);
  });

  it("is deterministic and returns fresh objects", () => {
    const a = scan(TEXT, { domain: "all" });
    const b = scan(TEXT, { domain: "all" });
    expect(a).toEqual(b);
    expect(a.moves).not.toBe(b.moves);
  });

  it("sorts moves by start, then longest", () => {
    const keys = scan(TEXT, { domain: "all" }).moves.map((m) => [m.start, m.start - m.end]);
    const sorted = [...keys].sort((x, y) => (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number));
    expect(keys).toEqual(sorted);
  });

  it("returns a fresh copy of the rule pack", () => {
    const pack = rulePack();
    expect(pack).toEqual(readPack());
    pack.rules.length = 0;
    expect(rulePack().rules.length).toBe(readPack().rules.length);
  });
});

describe("domains", () => {
  it("treats a missing or null domain as general", () => {
    const general = scan(TEXT, { domain: "general" });
    expect(scan(TEXT)).toEqual(general);
    expect(scan(TEXT, {})).toEqual(general);
    expect(scan(TEXT, { domain: null })).toEqual(general);
    expect(scan(TEXT, { domain: undefined })).toEqual(general);
    expect(scan(TEXT, null)).toEqual(general);
  });

  it("runs a domain's rules only when asked", () => {
    const text = "It is well-settled law that this claim is plainly meritless.";
    expect(scan(text).moves).toEqual([]);
    const legal = new Set(scan(text, { domain: "legal" }).moves.map((m) => m.ruleId));
    expect(legal).toEqual(new Set(["LEGAL_SETTLED_DISMISSAL", "LEGAL_MERIT_DISMISSAL"]));
    expect(scan(text, { domain: "media" }).moves).toEqual([]);
    expect(new Set(scan(text, { domain: "all" }).moves.map((m) => m.ruleId))).toEqual(legal);
  });

  it("lists the same domains as Python", () => {
    expect(DOMAINS).toEqual(["general", "legal", "media", "financial", "all"]);
    expect(Object.isFrozen(DOMAINS)).toBe(true);
  });

  it.each([["auto"], ["General"], [""], [5], [true], [{}], [["legal"]]])(
    "rejects the unknown domain %j with a RangeError",
    (domain) => {
      expect(() => scan(TEXT, { domain: domain as never })).toThrow(RangeError);
      expect(() => scan(TEXT, { domain: domain as never })).toThrow(/unknown domain/);
    },
  );

  it("rejects options that are not an object", () => {
    expect(() => scan(TEXT, "legal" as never)).toThrow(TypeError);
  });
});

describe("README.md", () => {
  it("quotes the input cap and the citation reach the engine uses", () => {
    const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
    const pack = readPack();
    expect(readme).toContain(`(${MAX_INPUT_CHARS.toLocaleString("en-US")} code points, counted as Python counts them)`);
    expect(readme).toContain(`takes ${pack.citation_suppression.window} code points on each side`);
    expect(readme).toContain(`\`CITATION_REACH\`, ${CITATION_REACH.toLocaleString("en-US")} code points`);
  });
});

describe("input", () => {
  it("caps input at 200,000 code points", () => {
    expect(MAX_INPUT_CHARS).toBe(200_000);
    expect(scan("a".repeat(MAX_INPUT_CHARS)).moves).toEqual([]);
    expect(() => scan("a".repeat(MAX_INPUT_CHARS + 1))).toThrow(RangeError);
    expect(() => scan("a".repeat(MAX_INPUT_CHARS + 1))).toThrow(/200001 characters; the limit is 200000/);
  });

  it("counts code points, not UTF-16 units", () => {
    const emoji = "\u{1F600}"; // two UTF-16 units, one code point
    expect(scan(emoji.repeat(MAX_INPUT_CHARS)).moves).toEqual([]);
    expect(() => scan(emoji.repeat(MAX_INPUT_CHARS) + "a")).toThrow(RangeError);
    // A lone surrogate is one code point, as in Python.
    expect(scan("\uD800".repeat(MAX_INPUT_CHARS)).moves).toEqual([]);
    expect(() => scan("\uD800".repeat(MAX_INPUT_CHARS + 1))).toThrow(RangeError);
  }, SLOW);

  it.each([[undefined], [null], [5], [new Uint8Array([97])], [["text"]]])(
    "rejects the non-string %j with a TypeError",
    (text) => {
      expect(() => scan(text as never)).toThrow(TypeError);
    },
  );

  it("checks the text before the domain, as Python does", () => {
    expect(() => scan(5 as never, { domain: "auto" as never })).toThrow(TypeError);
    expect(() => scan("a".repeat(MAX_INPUT_CHARS + 1), { domain: "auto" as never })).toThrow(/characters/);
  });

  it("handles empty text", () => {
    expect(scan("").moves).toEqual([]);
    expect(scan("").counts).toEqual({ "1": 0, "2": 0, "3": 0 });
  });

  it("returns UTF-16 offsets", () => {
    const text = "\u{1F642} Everyone agrees.";
    const move = scan(text).moves[0];
    expect(move).toBeDefined();
    expect([move?.start, move?.end]).toEqual([3, 18]); // Python: (2, 17)
    expect(move?.match).toBe("Everyone agrees");
  });
});

describe("citation suppression", () => {
  it("drops a rule when every match has a citation nearby", () => {
    expect(scan("Studies show that sleep helps.").moves.map((m) => m.ruleId)).toEqual(["CLAIM_WITHOUT_CITATION"]);
    expect(scan("Studies show (Smith et al., 2024) that sleep helps.").moves).toEqual([]);
  });

  it("looks around the first occurrence of the matched text (v1 quirk)", () => {
    const filler = " Filler text that keeps the second copy far away from the citation.".repeat(4);
    const text = `Studies show (Smith, 2024) a small effect.${filler} Studies show a large effect.`;
    expect(scan(text).moves).toEqual([]);
  });

  it("counts a citation when any part of it is in reach", () => {
    // Same texts as tests/test_engine.py: a long name inside the citation
    // does not push it out of the 120-code-point window.
    const name = `${"Center for ".repeat(20)}Studies`;
    const sleep = (n: number) => "sleep ".repeat(n);
    expect(scan(`Studies show that ${sleep(17)}(${name}, 2020).`).moves).toEqual([]);
    expect(scan(`(${name}, 2020) ${sleep(17)}and studies show that sleep helps.`).moves).toEqual([]);
    expect(scan(`Studies show that ${sleep(21)}(${name}, 2020).`).moves.map((m) => m.ruleId)).toEqual([
      "CLAIM_WITHOUT_CITATION",
    ]);
    expect(scan(`(${name}, 2020) ${sleep(21)}and studies show that sleep helps.`).moves.map((m) => m.ruleId)).toEqual([
      "CLAIM_WITHOUT_CITATION",
    ]);
  });

  it("counts the window in code points", () => {
    // 100 emoji between the fragment and the citation: 106 code points but
    // 206 UTF-16 units, so only a code point window reaches the citation.
    const text = `Studies show that ${"\u{1F642}".repeat(100)} (Smith, 2020).`;
    expect(scan(text).moves).toEqual([]);
  });
});

describe("min_matches", () => {
  it("counts matches across indicators before overlap removal", () => {
    expect(scan("Critics claimed it was late.", { domain: "media" }).moves).toEqual([]);
    const moves = scan("Critics claimed it was late, and they insisted it was rushed.", { domain: "media" }).moves;
    expect(moves.map((m) => m.ruleId)).toEqual(["MEDIA_ASYMMETRIC_ATTRIBUTION", "MEDIA_ASYMMETRIC_ATTRIBUTION"]);
  });
});

/** An engine with made-up rules, like the monkeypatched engine in tests/test_engine.py. */
function fakeEngine(rules: Array<[string, Tier, string[]]>, flags: "" | "is" = "") {
  const real = readPack();
  const pack: RulePack = {
    ...real,
    rules: rules.map(([id, tier, indicators]) => ({
      id,
      name: id,
      description: id,
      pit_tier: tier,
      domain: "general",
      severity: "low",
      principle: "Truth",
      indicators,
      min_matches: 1,
      suppress_if_cited: false,
      flags,
    })),
  };
  return compileEngine(pack, "fake");
}

function spans(engine: ReturnType<typeof fakeEngine>, text: string) {
  return scanWith(engine, text).moves.map((m) => [m.ruleId, m.start, m.end]);
}

describe("overlaps and empty matches (fake rules)", () => {
  it("keeps the earliest, then longest, span within a rule", () => {
    const engine = fakeEngine([["R", 1, ["ab", "abc", "bcd", "d"]]]);
    expect(spans(engine, "abcd")).toEqual([
      ["R", 0, 3],
      ["R", 3, 4],
    ]);
  });

  it("lets different rules overlap", () => {
    const engine = fakeEngine([
      ["R1", 1, ["abc"]],
      ["R2", 2, ["bc"]],
    ]);
    expect(spans(engine, "abcd")).toEqual([
      ["R1", 0, 3],
      ["R2", 1, 3],
    ]);
    expect(scanWith(engine, "abcd").counts).toEqual({ "1": 1, "2": 1, "3": 0 });
  });

  it("breaks ties by pack order", () => {
    const engine = fakeEngine([
      ["B", 1, ["bc"]],
      ["A", 1, ["bc"]],
    ]);
    expect(spans(engine, "abcd")).toEqual([
      ["B", 1, 3],
      ["A", 1, 3],
    ]);
  });

  it("never reports or counts a zero-length match", () => {
    const engine = fakeEngine([["EMPTY", 1, ["\\b", "x*"]]]);
    expect(scanWith(engine, "some words here").moves).toEqual([]);
  });

  it("iterates like Python's finditer after an empty match", () => {
    // Python: [m.span() for m in re.finditer(r"(?:)|abc", "abc")] == [(0, 0), (0, 3), (3, 3)]
    expect(spans(fakeEngine([["R", 1, ["(?:)|abc"]]]), "abc")).toEqual([["R", 0, 3]]);
    // Python: re.finditer(r"a|(?=b)|bc", "abcbc") gives (0, 1), (1, 1), (1, 3), (3, 3), (3, 5)
    expect(spans(fakeEngine([["R", 1, ["a|(?=b)|bc"]]]), "abcbc")).toEqual([
      ["R", 0, 1],
      ["R", 1, 3],
      ["R", 3, 5],
    ]);
    // Python: re.finditer(r"x*", "axxb") gives (0, 0), (1, 3), (3, 3), (4, 4)
    expect(spans(fakeEngine([["R", 1, ["x*"]]]), "axxb")).toEqual([["R", 1, 3]]);
    // An empty match right before an emoji steps over the whole code point.
    expect(spans(fakeEngine([["R", 1, ["(?:)|\\u2603"]]]), "\u{1F642}\u2603")).toEqual([["R", 2, 3]]);
  });
});

describe("pathological input", () => {
  it.each([
    ["some say", "some say ".repeat(30000).slice(0, MAX_INPUT_CHARS)],
    ["however", ("x".repeat(250) + "however, ".repeat(30000)).slice(0, MAX_INPUT_CHARS)],
    ["quotes", '"abc" '.repeat(40000).slice(0, MAX_INPUT_CHARS)],
  ])("finishes a full scan of %s quickly", (_name, text) => {
    const start = performance.now();
    scan(text, { domain: "all" });
    expect(performance.now() - start).toBeLessThan(10_000);
  });
});

describe("prepare", () => {
  it("readies one pattern per call, general rules first, and changes no result", () => {
    const pack = readPack();
    const texts = [TEXT, "Studies show (Smith, 2024) it works. \u201cExperts\u201d say it is \u2014 settled."];
    const before = texts.map((t) => scan(t, { domain: "all" }));
    const general = pack.rules.filter((r) => r.domain === "general").reduce((n, r) => n + r.indicators.length, 0);
    const citations = pack.citation_suppression.patterns.length;
    let steps = 0;
    while (!prepare()) steps++;
    // the call that readies the last pattern returns true, and so does every call after it
    expect(steps + 1).toBeLessThanOrEqual(general + citations);
    expect(prepare()).toBe(true);
    const all = pack.rules.reduce((n, r) => n + r.indicators.length, 0);
    let more = 0;
    while (!prepare({ domain: "all" })) more++;
    expect(more + 1).toBeLessThanOrEqual(all - general);
    expect(prepare({ domain: "all" })).toBe(true);
    expect(texts.map((t) => scan(t, { domain: "all" }))).toEqual(before);
  });

  it("checks the domain like scan", () => {
    expect(() => prepare({ domain: "sports" as never })).toThrow(RangeError);
  });

  it("compiles lazily with the same results as eagerly", () => {
    const pack = readPack();
    const eager = compileEngine(pack, "h");
    const lazy = compileEngine(pack, "h", { lazy: true });
    for (const text of [TEXT, "Leading experts agree. Act now, before it is too late (Smith, 2020)."]) {
      for (const domain of DOMAINS) expect(scanWith(lazy, text, { domain })).toEqual(scanWith(eager, text, { domain }));
    }
  }, SLOW);
});
