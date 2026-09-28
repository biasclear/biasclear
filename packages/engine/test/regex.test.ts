// The Python-to-JavaScript regex translation. Every match expectation here
// is what Python's `re` does on the same pattern and text (checked with
// Python 3.10 to 3.13). The rejections are constructs the translation leaves
// out on purpose, so a pack that uses one fails the build. scripts/parity.mjs
// also checks the character classes against Python for every code point.

import { describe, expect, it } from "vitest";
import { PatternError, translate } from "../src/regex.js";
import { goldenFiles, readPack } from "./helpers.js";

/** Python's `[m.span() for m in re.finditer(pattern, text, flags)]`, as UTF-16 spans. */
function finditer(pattern: string, text: string, flags = ""): Array<[number, number]> {
  const re = new RegExp(translate(pattern, flags).source, "gu");
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}

/** Python's `bool(re.fullmatch(pattern, text, flags))`. */
function fullmatch(pattern: string, text: string, flags = ""): boolean {
  return new RegExp(`^(?:${translate(pattern, flags).source})$`, "u").test(text);
}

describe("character classes follow Python", () => {
  it("\\w is any letter or number, plus _", () => {
    for (const ch of ["a", "Z", "_", "7", "\u00e9", "\u00df", "\u03a9", "\u0436", "\u4e2d", "\u0663", "\u216b", "\u00bd", "\u{1D400}", "\u{10400}"]) {
      expect(fullmatch("\\w", ch), ch).toBe(true);
      expect(fullmatch("\\W", ch), ch).toBe(false);
    }
    for (const ch of [" ", "-", "'", "\u0301", "\u200d", "\u{1F642}", "\u00a0", "\uD800"]) {
      expect(fullmatch("\\w", ch), ch).toBe(false);
      expect(fullmatch("\\W", ch), ch).toBe(true);
    }
  });

  it("\\d is any decimal digit (Nd)", () => {
    for (const ch of ["0", "9", "\u0663", "\u06f5", "\u096b", "\u{1D7CE}"]) expect(fullmatch("\\d", ch), ch).toBe(true);
    for (const ch of ["a", "\u00bd", "\u216b", "\u00b2"]) expect(fullmatch("\\d", ch), ch).toBe(false);
    expect(fullmatch("\\D", "a")).toBe(true);
    expect(fullmatch("\\D", "\u0663")).toBe(false);
  });

  it("\\s is str.isspace()", () => {
    const space = ["\t", "\n", "\v", "\f", "\r", "\x1c", "\x1d", "\x1e", "\x1f", " ", "\x85", "\xa0", "\u1680", "\u2000", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000"];
    for (const ch of space) expect(fullmatch("\\s", ch), JSON.stringify(ch)).toBe(true);
    for (const ch of ["\ufeff", "\u200b", "\u180e", "a", "\x1b"]) {
      expect(fullmatch("\\s", ch), JSON.stringify(ch)).toBe(false);
      expect(fullmatch("\\S", ch), JSON.stringify(ch)).toBe(true);
    }
  });

  it("\\b and \\B use the Unicode \\w", () => {
    expect(finditer("\\bagrees\\b", "agrees")).toEqual([[0, 6]]);
    expect(finditer("\\bagrees\\b", "agrees\u00e9")).toEqual([]);
    expect(finditer("\\bagrees\\b", "\u00e9agrees")).toEqual([]);
    expect(finditer("\\bagrees\\b", "agrees\u0301")).toEqual([[0, 6]]); // a combining mark is not \w
    expect(finditer("\\bagrees\\b", "\u{1F642}agrees\u{1F642}")).toEqual([[2, 8]]);
    expect(finditer("\\bagrees\\b", "\u{1D400}agrees")).toEqual([]); // a letter outside the BMP
    expect(finditer("a\\B", "ab a")).toEqual([[0, 1]]);
  });

  it(". counts code points and follows the s flag", () => {
    expect(finditer("x.{2}y", "x\u{1F642}\u{1F642}y", "s")).toEqual([[0, 6]]);
    expect(finditer("x.y", "x\ny", "s")).toEqual([[0, 3]]);
    expect(finditer("x.y", "x\ny")).toEqual([]);
    // Without s, Python's . still matches \r, U+2028 and U+2029 (JavaScript's doesn't).
    expect(finditer("x.y", "x\ry x\u2028y")).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(finditer("(?<=.{3})z", "\u{1F642}\u{1F642}z \u{1F642}\u{1F642}\u{1F642}z", "s")).toEqual([[12, 13]]);
  });

  it("$ also matches before a final newline", () => {
    expect(finditer("a$", "a\n")).toEqual([[0, 1]]);
    expect(finditer("a$", "a\n\n")).toEqual([]);
    expect(finditer("a$", "ba")).toEqual([[1, 2]]);
  });
});

describe("short literals", () => {
  it("writes letters and digits as themselves, and escapes the rest", () => {
    expect(translate("[Aa]", "", { optimize: false }).source).toBe("[Aa]");
    expect(translate("[\\u0100\\u0102\\u00e9]", "", { optimize: false }).source).toBe("[éĀĂ]");
    expect(translate("[\\u0663-\\u0669]", "", { optimize: false }).source).toBe("[٣-٩]");
    expect(translate("[ \\-\\]]", "", { optimize: false }).source).toBe("[\\x20\\x2d\\x5d]");
    expect(translate("[\\u2019\\u00a0]", "", { optimize: false }).source).toBe("[\\xa0\\u2019]");
    expect(translate("\\u0301", "", { optimize: false }).source).toBe("\\u0301"); // a combining mark
  });

  it("keeps surrogates apart, so two escapes never read as one code point", () => {
    // In Python, [😀] holds two lone surrogates, not U+1F600.
    expect(fullmatch("[\\ud83d\\ude00]", "\uD83D")).toBe(true);
    expect(fullmatch("[\\ud83d\\ude00]", "\uDE00")).toBe(true);
    expect(fullmatch("[\\ud83d\\ude00]", "\u{1F600}")).toBe(false);
    expect(translate("[\\ud83d\\ude00]", "", { optimize: false }).source).toBe("[\\u{d83d}\\u{de00}]");
  });
});

describe("the i flag follows Python", () => {
  it("matches both ASCII cases", () => {
    expect(fullmatch("everyone", "EveryONE", "i")).toBe(true);
    expect(fullmatch("[a-z]+", "ABCxyz", "i")).toBe(true);
    expect(fullmatch("[ey]", "Y", "i")).toBe(true);
  });

  it("adds the characters Python treats as equal", () => {
    expect(fullmatch("i", "\u0130", "i")).toBe(true); // capital I with dot above
    expect(fullmatch("i", "\u0131", "i")).toBe(true); // dotless i
    expect(fullmatch("I", "\u0131", "i")).toBe(true);
    expect(fullmatch("s", "\u017f", "i")).toBe(true); // long s
    expect(fullmatch("k", "\u212a", "i")).toBe(true); // Kelvin sign
    expect(fullmatch("[a-z]", "\u0130", "i")).toBe(true);
    expect(fullmatch("[A-Z0-9]", "\u212a", "i")).toBe(true);
    expect(fullmatch("[^a-z]", "\u0131", "i")).toBe(false);
  });

  it("does not add anything else", () => {
    expect(fullmatch("e", "\u00e9", "i")).toBe(false);
    expect(fullmatch("x", "\u0130", "i")).toBe(false);
    expect(fullmatch("i", "\u0130")).toBe(false);
    expect(fullmatch("s", "\u017f")).toBe(false);
  });

  it("leaves caseless non-ASCII characters alone and rejects cased ones", () => {
    expect(fullmatch("[\"\u201c]x[\"\u201d]", "\u201cx\u201d", "i")).toBe(true);
    expect(fullmatch("\u00a7", "\u00a7", "i")).toBe(true);
    expect(() => translate("\u00e9", "i")).toThrow(PatternError);
    expect(() => translate("[\u00e0-\u00ff]", "i")).toThrow(PatternError);
    expect(fullmatch("\u00e9", "\u00e9")).toBe(true);
  });
});

describe("syntax follows Python", () => {
  it("reads { as a quantifier only in Python's quantifier shapes", () => {
    expect(fullmatch("a{2}", "aa")).toBe(true);
    expect(fullmatch("a{,2}", "")).toBe(true);
    expect(fullmatch("a{,2}", "aa")).toBe(true);
    expect(fullmatch("a{2,}", "aaaa")).toBe(true);
    expect(fullmatch("a{}", "a{}")).toBe(true);
    expect(fullmatch("a{x}", "a{x}")).toBe(true);
    expect(fullmatch("a{1,2}?b", "ab")).toBe(true);
    expect(fullmatch("a}", "a}")).toBe(true);
  });

  it("reads ] first in a class as a literal", () => {
    expect(fullmatch("[]a]+", "]a]")).toBe(true);
    expect(fullmatch("[^]a]", "b")).toBe(true);
    expect(fullmatch("[^]a]", "]")).toBe(false);
    expect(fullmatch("a]", "a]")).toBe(true);
  });

  it("reads hyphens and escapes in classes as Python does", () => {
    expect(fullmatch("[\\d-]+", "12-3")).toBe(true);
    expect(fullmatch("[- ]", "-")).toBe(true);
    expect(fullmatch("[a-]", "-")).toBe(true);
    expect(fullmatch("[\\w\\s.']+", "Smith et al.'s")).toBe(true);
    expect(fullmatch("[\\b]", "\b")).toBe(true);
    expect(fullmatch("[\\-\\]\\\\]+", "-]\\")).toBe(true);
    expect(fullmatch("[\\u0041-\\x43]+", "ABC")).toBe(true);
  });

  it("supports \\W and \\S inside a class", () => {
    expect(fullmatch("[\\Wx]", " ")).toBe(true);
    expect(fullmatch("[\\Wx]", "x")).toBe(true);
    expect(fullmatch("[\\Wx]", "y")).toBe(false);
    expect(fullmatch("[^\\Wx]", "y")).toBe(true);
    expect(fullmatch("[^\\Wx]", "x")).toBe(false);
    expect(fullmatch("[^\\Wx]", " ")).toBe(false);
    expect(fullmatch("[^\\S]", "\x1c")).toBe(true);
  });

  it("keeps a capturing group's meaning without a capture", () => {
    expect(translate("(ab)+", "", { optimize: false }).source).toBe("(?:ab)+");
    expect(fullmatch("(ab)+", "abab")).toBe(true);
  });

  it("escapes \\-, \\/ and other punctuation to themselves outside classes", () => {
    expect(fullmatch("a\\-b\\/c\\.", "a-b/c.")).toBe(true);
  });

  it.each([
    ["(?i)abc", "group syntax"],
    ["(?P<x>a)", "group syntax"],
    ["(?>ab)", "group syntax"],
    ["(?#note)", "group syntax"],
    ["a++", "possessive"],
    ["a{2}+", "possessive"],
    ["a**", "multiple repeat"],
    ["(a)\\1", "not supported"],
    ["\\p{L}", "not supported"],
    ["\\N{DASH}", "not supported"],
    ["\\q", "not supported"],
    ["[a", "unterminated"],
    ["(a", "missing )"],
    ["a)", "unbalanced"],
    ["*a", "nothing to repeat"],
    ["{2}", "nothing to repeat"],
    ["\\b+", "assertion"],
    ["[z-a]", "bad character range"],
    ["[\\w-z]", "bad character range"],
    ["a{3,2}", "min repeat"],
    ["\\x4", "incomplete escape"],
  ])("rejects %j", (pattern, message) => {
    expect(() => translate(pattern, "")).toThrow(PatternError);
    expect(() => translate(pattern, "")).toThrow(message);
  });

  it("rejects unknown flags", () => {
    expect(() => translate("a", "m")).toThrow(PatternError);
  });
});

describe("minimum width", () => {
  it.each([
    ["abc", 3],
    ["a|bc", 1],
    ["(?:ab)?c", 1],
    ["x*", 0],
    ["\\b", 0],
    ["(?<=.{200})\\bx", 1],
    ["(?:\\w+\\s+){0,5}?y", 1],
    ["a{2,5}", 2],
    ["[ab]{3}", 3],
    ["(?=ab)", 0],
    ["(?:)|abc", 0],
  ])("of %j is %i", (pattern, width) => {
    expect(translate(pattern, "s").minWidth).toBe(width);
  });
});

describe("the rule pack", () => {
  const pack = readPack();
  const regexes = [
    ...pack.rules.flatMap((r) => r.indicators.map((p, i) => [`${r.id}[${i}]`, p, r.flags] as const)),
    ...pack.citation_suppression.patterns.map((p, i) => [`citation[${i}]`, p, pack.citation_suppression.flags] as const),
  ];

  it("translates and compiles every regex", () => {
    expect(regexes.length).toBeGreaterThan(60);
    for (const [, pattern, flags] of regexes) {
      expect(() => new RegExp(translate(pattern, flags).source, "gu")).not.toThrow();
    }
  });

  it("finds the same matches with and without the speed rewrites", () => {
    const texts = goldenFiles().flatMap((f) => f.cases.map((c) => c.text));
    texts.push(
      "\u{1F642}".repeat(300) + " Everyone agrees. " + "\u{1F642}".repeat(300),
      "\u00e9Everyone agrees\u00e9; Everyone agrees\u0301 and \u{1D400}studies show",
      "x".repeat(250) + " However, the claim " + "\u{1F642}".repeat(20) + " could not be verified.",
    );
    expect(texts.length).toBeGreaterThan(500);
    for (const [where, pattern, flags] of regexes) {
      const fast = new RegExp(translate(pattern, flags).source, "gu");
      const plain = new RegExp(translate(pattern, flags, { optimize: false }).source, "gu");
      for (const text of texts) {
        const a = [...text.matchAll(fast)].map((m) => [m.index, m[0].length]);
        const b = [...text.matchAll(plain)].map((m) => [m.index, m[0].length]);
        expect(a, where).toEqual(b);
      }
    }
    // Every regex, twice, on every golden text: several seconds in all.
  }, 120_000);

  it("has no regex that can match the empty string", () => {
    // Mirrors tests/test_regex_subset.py for the indicators, so the engine's
    // slower path for empty matches never runs on the real pack.
    for (const [where, pattern, flags] of regexes) {
      expect(translate(pattern, flags).minWidth, where).toBeGreaterThan(0);
    }
  });
});
