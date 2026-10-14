// Controls for the ReDoS guard (redos.test.ts): real regexes sent through the
// same measuring process and judging code, each with settings that leave only
// one way to fail. They run in their own file, so Vitest runs them alongside
// the full-pack guard instead of after it.
import { afterAll, expect, it } from "vitest";
import { adversarial, fill, LIMIT_MS } from "./redos-fixtures.js";
import { readPack } from "./helpers.js";
import { removeGuardScript, runGuard, verdict } from "./redos-guard.js";

afterAll(removeGuardScript);

function indicator(id: string, index: number): { pattern: string; flags: string } {
  const rule = readPack().rules.find((r) => r.id === id);
  const pattern = rule?.indicators[index];
  if (rule === undefined || pattern === undefined) throw new Error(`no ${id}[${index}] in the pack`);
  return { pattern, flags: rule.flags };
}

/** The index of `text` among a pattern's adversarial strings. */
function fixtureOf(pattern: string, text: string): number {
  const index = adversarial(pattern).indexOf(text);
  if (index < 0) throw new Error(`the pattern has no adversarial string ${JSON.stringify(text.slice(0, 20))}...`);
  return index;
}

// CREDENTIAL_AS_PREMISE[1] as rules 2.0.0a2 had it: a run of name characters
// before "-winning" was unbounded ("+"), so after a bracket a long run of
// "A'" was rescanned from every start, about 16 times the CPU time for 4
// times the text. Rules 2.0.0a3 bounded it to 40 ("{1,40}"). The control
// puts the unbounded run back into today's pattern.
const BOUNDED = "{1,40}-[Ww][Ii][Nn][Nn][Ii][Nn][Gg]";

it.each([0, 4])("fails the historical quadratic CREDENTIAL_AS_PREMISE[1] by growth (clock ticks: %s ms)", (clockTickMs) => {
  // 0: the machine's own CPU clock. 4: the same clock rounded down to 4-ms
  // ticks, as a Linux kernel counting 250 ticks a second reports it. A
  // test-only ceiling of 5 s keeps the ceiling from catching it first on a
  // slow machine; one string (about 0.1 s a scan on an Apple M3 Pro) keeps
  // the control near a second.
  const { pattern, flags } = indicator("CREDENTIAL_AS_PREMISE", 1);
  expect(pattern.split(BOUNDED).length).toBe(3);
  const historical = pattern.replaceAll(BOUNDED, BOUNDED.replace("{1,40}", "+"));
  const fixture = fixtureOf(historical, `[${fill("A'")}`);
  const run = runGuard({
    regexes: [["CREDENTIAL_AS_PREMISE[1] (rules 2.0.0a2)", historical, flags]],
    ceilingMs: 5000, fixtures: [fixture], clockTickMs,
  }, 60_000);
  expect(run.problem).toBeUndefined();
  const report = run.report!;
  expect(report.failures, JSON.stringify(report.worstReading)).toMatchObject([{ kind: "growth", where: "CREDENTIAL_AS_PREMISE[1] (rules 2.0.0a2)", fixture }]);
  const [failure] = report.failures;
  expect(Math.min(...failure!.doublings!)).toBeGreaterThan(3);
  if (clockTickMs > 0) {
    // The guard measured the 4-ms steps and batched the short lengths to 80 ms timings.
    expect([report.resolutionMs, report.sampleTargetMs]).toEqual([4, 80]);
    expect(failure!.reps![0]).toBeGreaterThan(1);
  }
  expect(verdict(report).split("\n")[0]).toMatch(
    /^ReDoS guard failed: CREDENTIAL_AS_PREMISE\[1\] \(rules 2\.0\.0a2\) \(\d+\.\dx the CPU time for 4x the input, over the 10x limit\)$/,
  );
}, 65_000);

it("fails a scan over the ceiling by name", () => {
  // The pack's slowest string, VAGUE_INSTITUTIONAL_APPEAL[0] on "TOP TOP ...",
  // about 19 CPU ms and linear, against a test-only ceiling of 1 CPU ms (even
  // a clock of 4-ms ticks reads it over 1 ms).
  const { pattern, flags } = indicator("VAGUE_INSTITUTIONAL_APPEAL", 0);
  const fixture = fixtureOf(pattern, fill("TOP "));
  const run = runGuard({
    regexes: [["ceiling-control", pattern, flags]], ceilingMs: 1, deadlineMs: 60_000, fixtures: [fixture],
  }, 30_000);
  expect(run.problem).toBeUndefined();
  expect(run.report?.failures).toMatchObject([{ kind: "ceiling", where: "ceiling-control", fixture }]);
}, 35_000);

it("stops an exponential scan at the deadline and fails it by name", () => {
  // The third string, a run of "a", has 2^n readings and no final "z", so
  // its scan never finishes. The default ceiling and deadline apply. The
  // regex after it is measured on a fresh thread, and passes.
  const run = runGuard({ regexes: [["exponential-control", "(?:aa|aaaa)+z", ""], ["after-control", "zzqq", ""]] }, 30_000);
  expect(run.problem).toBeUndefined();
  expect(run.report?.failures).toMatchObject([{ kind: "deadline", where: "exponential-control", fixture: 2 }]);
  expect([run.report?.measured, run.report?.unmeasured]).toEqual([2, 0]);
  expect(run.report?.timings.map(([, where]) => where).sort()).toEqual(["after-control", "exponential-control"]);
  expect(verdict(run.report!).split("\n")[0]).toBe(
    `ReDoS guard failed: exponential-control (still running after ${2 * LIMIT_MS} CPU ms on one scan, so it was stopped)`,
  );
  expect(run.wallMs).toBeLessThan(20_000);
}, 35_000);

it("names the last regex started if the wall-clock watchdog has to stop the process", () => {
  // With the deadline out of reach, only the watchdog can stop this scan.
  const run = runGuard({ regexes: [["stuck-control", "(?:aa|aaaa)+z", ""]], deadlineMs: 3_600_000 }, 500);
  expect(run.timedOut).toBe(true);
  expect(run.problem).toMatch(/^ReDoS guard: the measuring process did not finish within 0.5 s and was killed; /);
  expect(run.problem!.length).toBeLessThan(300);
});

it("refuses a CPU clock too coarse to time growth", () => {
  const run = runGuard({ regexes: [["coarse-clock-control", "zzqq", ""]], clockTickMs: 6 }, 30_000);
  expect(run.problem).toBe(
    "ReDoS guard could not run: the measuring thread's CPU clock moves in steps of 6 ms, too coarse to time growth (at most 5 ms)",
  );
}, 35_000);
