// ReDoS guard: every regex in the pack, as translated for JavaScript, must
// finish in under 50 ms on 20,000-character adversarial strings built from
// its own literals (its words and punctuation, repeated in the shapes that
// make backtracking engines slow). Each time is the best of three runs, so
// a slow CI machine's hiccup doesn't fail the build but a real blow-up does.

import { expect, it } from "vitest";
import { scan } from "../src/index.js";
import { translate } from "../src/regex.js";
import { readPack } from "./helpers.js";

const LENGTH = 20_000;
const LIMIT_MS = 50;
const EMOJI = "\u{1F642}";
// Sentence ends with a closing mark, quoted dialogue and bare whitespace: a
// pattern whose sentence start and sentence body read the same terminator
// differently starts again after every one of them (rules 2.0.0a4 fixed one
// in INSTITUTIONAL_POSITION_AS_SETTLED and one in MEDIA_EMOTIONAL_LEAD).
const SENTENCE_ENDS = [
  "A?\u201d ",
  "A.) ",
  "Dr.) ",
  "A.\" ",
  "\u201cWhy?\u201d \u201cYes.\u201d \u201cIs it done?\u201d ",
  // Rules 2.0.0a5: skip every following space before testing lowercase.
  "a.  a ",
  "a!  a ",
  "a.\t a ",
  "a.\u00a0 a ",
  " ",
  "\n",
  "\t",
  "\u00a0",
];

/** The words and punctuation a pattern contains, as literal text. */
function literals(pattern: string): { words: string[]; marks: string[] } {
  // Drop escapes that stand for classes or assertions, keep escaped punctuation.
  const plain = pattern.replace(/\\([bBdDsSwW])|\\(.)/gu, (_m, cls: string | undefined, ch: string | undefined) =>
    cls !== undefined ? " " : (ch ?? ""),
  );
  const words = [...new Set(plain.match(/[A-Za-z]{2,}/g) ?? [])];
  const marks = [...new Set(plain.replace(/[A-Za-z0-9\s(){}[\]|?*+^$\\.:=!<-]/gu, "").split(""))];
  return { words, marks };
}

function fill(unit: string): string {
  // A whitespace-only unit is kept as it is: a run of spaces or newlines is
  // itself an adversarial string (rules 2.0.0a4 fixed one).
  const u = unit === "" ? "a " : unit;
  return u.repeat(Math.ceil(LENGTH / u.length)).slice(0, LENGTH);
}

/** Adversarial strings for one pattern. */
function adversarial(pattern: string): string[] {
  const { words, marks } = literals(pattern);
  const out = [
    fill(words.join(" ") + " "),
    fill(words.join(", ") + ", "),
    fill(words.join("")),
    fill(words.join(` ${EMOJI} `) + " "),
    fill(words.map((w) => w.toUpperCase()).join("\n") + "\n"),
    "x".repeat(250) + fill(words.join(" ") + " ").slice(250),
  ];
  for (const w of words) {
    out.push(fill(`${w} `), fill(`${w}, `), fill(`${w} x `));
  }
  for (const m of marks) {
    out.push(fill(`${m}abc${m} `), fill(`${m}${words[0] ?? "a"} `), fill(m));
    // a bracket, then a chain of tokens joined by the mark: the shape of a
    // citation's list of names, where a mark that both joins tokens and sits
    // inside one splits the chain 2^n ways (rules 2.0.0a3 fixed one)
    out.push(`(${fill(`A${m}`)}`, `[${fill(`A${m}`)}`);
  }
  // a bracket, then a run of one non-ASCII letter, bare or spaced: a pattern
  // that can read such a letter by two alternatives (a word character, or
  // any non-ASCII character) reads the run 2^n ways (rules 2.0.0a3 fixed two)
  for (const ch of ["\u00e9", "\u738b"]) {
    out.push(`(${fill(ch)}`, `(${fill(`${ch} `)}`);
  }
  out.push(...SENTENCE_ENDS.map(fill));
  return out;
}

function bestOfThree(re: RegExp, text: string): number {
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    re.lastIndex = 0;
    while (re.exec(text) !== null) {
      // Every pack regex needs at least one character, so exec always moves on.
    }
    best = Math.min(best, performance.now() - start);
    if (best < LIMIT_MS / 5) break;
  }
  return best;
}

it("runs every regex in under 50 ms on 20,000-character adversarial strings", () => {
  const pack = readPack();
  const regexes = [
    ...pack.rules.flatMap((r) => r.indicators.map((p, i) => [`${r.id}[${i}]`, p, r.flags] as const)),
    ...pack.citation_suppression.patterns.map((p, i) => [`citation[${i}]`, p, pack.citation_suppression.flags] as const),
  ];
  const slow: string[] = [];
  const timings: Array<[number, string]> = [];
  let strings = 0;
  for (const [where, pattern, flags] of regexes) {
    const re = new RegExp(translate(pattern, flags).source, "gu");
    let worst = 0;
    for (const text of adversarial(pattern)) {
      expect(text.length).toBeGreaterThanOrEqual(LENGTH);
      strings++;
      const ms = bestOfThree(re, text);
      worst = Math.max(worst, ms);
      if (ms >= LIMIT_MS) slow.push(`${where}: ${ms.toFixed(1)} ms on ${JSON.stringify(text.slice(0, 40))}...`);
    }
    timings.push([worst, where]);
  }
  timings.sort((a, b) => b[0] - a[0]);
  console.log(
    `ReDoS guard: ${regexes.length} regexes, ${strings} strings; slowest: ` +
      timings.slice(0, 3).map(([ms, where]) => `${where} ${ms.toFixed(1)} ms`).join(", "),
  );
  expect(slow).toEqual([]);
  // The whole sweep (every regex on about 32,000 strings) takes several
  // seconds; the limit that matters is the 50 ms per regex above.
}, 120_000);

it.each(["  ", "\t ", "\u00a0 "])("reads an institutional sentence boundary across %j", (separator) => {
  const prefix = "The meeting ended." + separator;
  const moves = scan(prefix + "The agency has concluded that it works.").moves
    .filter((m) => m.ruleId === "INSTITUTIONAL_POSITION_AS_SETTLED");
  expect(moves.map((m) => [m.start, m.match])).toEqual([
    [prefix.length - 1, " The agency has concluded that"],
  ]);
  expect(scan(prefix + "the agency has concluded that it works.").moves
    .filter((m) => m.ruleId === "INSTITUTIONAL_POSITION_AS_SETTLED")
    .map((m) => [m.start, m.match])).toEqual([[0, prefix + "the agency has concluded that"]]);
  expect(scan(prefix + "The agency has concluded that it works, based on research.").moves
    .filter((m) => m.ruleId === "INSTITUTIONAL_POSITION_AS_SETTLED")).toEqual([]);
});

it("reads a citation's dash-joined names in linear time", () => {
  // Rules 2.0.0a3: the token class of the author-year citation pattern held
  // the en and em dash that also join names, so "(A—A—A…" after a claim that
  // citations quiet took exponential time (30 tokens, about 40 s).
  // compile the rules first, for strings of both widths (a JavaScript engine
  // compiles a regex separately for Latin-1 and for wider strings)
  scan("Studies show it works (Smith, 2024).");
  scan("Studies show it works (Smith\u2014Jones, 2024).");
  for (const dash of ["\u2014", "\u2013"]) {
    for (const claim of ["Studies show it works (", "Experts say it works ("]) {
      const text = claim + Array(2000).fill("A").join(dash);
      const start = performance.now();
      const moves = scan(text).moves.map((m) => m.ruleId);
      expect(performance.now() - start).toBeLessThan(200);
      expect(moves).toEqual(["CLAIM_WITHOUT_CITATION"]);
    }
    expect(scan(`Studies show it works (Smith${dash}Jones, 2024).`).moves).toEqual([]);
  }
});

it("reads a citation's non-ASCII names in linear time", () => {
  // Rules 2.0.0a3, merged with the red team's fifth round: a citation's name
  // may hold any character outside ASCII, and each one has one way to be
  // read. In the fifth round's patterns a non-ASCII letter or a curly quote
  // could be read by either of two alternatives (2^n readings of a run).
  // compile the rules first, for strings of both widths
  scan("Studies show it works (\u00c9lan Voss 2019).");
  scan("Studies show it works (\u738b\u2019s team, 12).");
  for (const unit of ["\u00e9", "\u00e9 ", "\u00e9, ", "A\u2019", "A\u2018", "\u738b "]) {
    for (const claim of ["Studies show it works (", "Experts say it works ("]) {
      const text = claim + unit.repeat(2000);
      const start = performance.now();
      const moves = scan(text).moves.map((m) => m.ruleId);
      expect(performance.now() - start).toBeLessThan(200);
      expect(moves).toEqual(["CLAIM_WITHOUT_CITATION"]);
    }
  }
  expect(scan("Studies show it works (\u00c9lan Voss 2019).").moves).toEqual([]);
  expect(scan("Studies show it works (\u738b\u2019s team, 12).").moves).toEqual([]);
});

it("scans sentence ends with closing marks, dialogue and whitespace in linear time", () => {
  // Rules 2.0.0a4: INSTITUTIONAL_POSITION_AS_SETTLED started a sentence after
  // "?\u201d " while its body read the same "?" as mid-sentence, and
  // MEDIA_EMOTIONAL_LEAD split leading whitespace two ways. Each took seconds
  // at 20,000 characters.
  scan("The agency has concluded that it works.", { domain: "all" });
  for (const unit of SENTENCE_ENDS) {
    const text = fill(unit);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      scan(text, { domain: "all" });
      best = Math.min(best, performance.now() - start);
    }
    expect(best, JSON.stringify(unit)).toBeLessThan(1000);
  }
  const lead = " ".repeat(15_000) + "The plan is sound and people like it. ".repeat(100);
  const start = performance.now();
  scan(lead, { domain: "all" });
  expect(performance.now() - start).toBeLessThan(1000);
});
