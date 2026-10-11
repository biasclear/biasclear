// ReDoS guard. Every regex in the pack, as translated for JavaScript, is run
// over adversarial strings of 20,000 characters built from its own words and
// punctuation, repeated in the shapes that make backtracking slow
// (redos-fixtures.ts; the test prints how many strings).
//
// How it judges, in plain words:
// - It runs in a separate, plain Node process (redos-worker.mjs), so the test
//   framework does not change how fast the regexes run.
// - It counts CPU time, not wall-clock time: only the time the processor
//   spent on the scan counts, not time spent waiting while a busy runner
//   serves other jobs. A slower processor still takes longer; the limits
//   leave room for that.
// - Ceiling: one scan of a 20,000-character string must use under 150 CPU ms.
//   A run over the ceiling is timed once more to confirm, and the faster run
//   counts.
// - Growth (redos-growth.ts): for a scan of 10 CPU ms or more, it also times
//   the first quarter and the first half of the string, in three rounds, and
//   takes the median round. A linear scan takes about 4 times as long for 4
//   times the text, a quadratic one about 16 times. It fails at more than 10
//   times, with each doubling over 3 times.
// - Every growth timing repeats the scan until the timing spans at least
//   10 CPU ms and at least 20 steps of the CPU clock, whose step it measures
//   first (a microsecond or so on a Mac; Linux can count a thread's CPU time
//   in whole timer ticks of 1 or 4 ms), and about as long as one scan of the
//   whole string. The time per scan is the timing divided by the scans. A
//   single short scan can read as 0 or as a whole tick; 20 ticks are off by
//   under a twentieth. A scan that reads just under the floor, within one
//   step of it, is timed again the same way.
// - Deadline: a scan still running after 300 CPU ms (twice the ceiling) is
//   stopped and fails. Each scan in a timing has its own deadline.
//   Exponential backtracking never finishes a scan, so this is what catches
//   it.
// - The first line of a failure names each failing regex and why; the lines
//   after it give the numbers and the string. A 120-second wall-clock
//   watchdog is the last resort, and it names the last regex started.
// The ceiling catches slow patterns whose growth looks linear at these
// lengths; growth catches quadratic patterns that are still under the ceiling
// on a fast machine. It is a regression guard, not a proof for every input.
// redos-controls.test.ts sends known-bad regexes through the same process;
// redos-growth.test.ts checks the growth decision on fake coarse clocks.

import { afterAll, expect, it } from "vitest";
import { scan } from "../src/index.js";
import { adversarial, fill, LIMIT_MS, SENTENCE_ENDS } from "./redos-fixtures.js";
import { packRegexes, removeGuardScript, runGuard, summary, verdict } from "./redos-guard.js";

afterAll(removeGuardScript);

it("bounds CPU time and growth on every adversarial string", () => {
  const regexes = packRegexes();
  const run = runGuard({ regexes });
  if (run.report === undefined) throw new Error(run.problem);
  const { report } = run;
  // A failure's message ends with the same summary, so it is printed only on a pass.
  if (report.failures.length > 0) throw new Error(verdict(report));
  console.log(summary(report));
  expect(report.ceilingMs).toBe(LIMIT_MS);
  expect(report.measured).toBe(regexes.length);
  // Nothing is skipped: the parent counts the strings on its own.
  expect(report.strings).toBe(regexes.reduce((n, [, pattern]) => n + adversarial(pattern).length, 0));
}, 130_000);

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
