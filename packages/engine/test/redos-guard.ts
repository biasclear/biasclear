// Runs the ReDoS guard's measuring process (redos-worker.mjs) for the tests
// in redos.test.ts and redos-controls.test.ts, and words its report.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { PACKAGE, readPack } from "./helpers.js";

export type GuardRegex = readonly [where: string, pattern: string, flags: string];
export interface GuardRequest {
  regexes: readonly GuardRegex[];
  ceilingMs?: number;
  deadlineMs?: number;
  /** Test controls only: measure just these strings of each regex. */
  fixtures?: number[];
  /** Test controls only: round the CPU clock down to whole ticks of this many ms. */
  clockTickMs?: number;
}
export interface GuardFailure {
  kind: "ceiling" | "growth" | "deadline";
  where: string;
  fixture: number;
  short: string;
  detail: string;
  growth?: number;
  doublings?: [number, number];
  reps?: [number, number, number];
}
export interface GuardReport {
  regexes: number;
  measured: number;
  unmeasured: number;
  strings: number;
  failures: GuardFailure[];
  timings: Array<[cpuMs: number, where: string, wallMs: number | null]>;
  /** Strings whose growth was checked, those that needed all three lengths, and strings timed again near the floor. */
  probed: number;
  fullProbes: number;
  rechecked: number;
  scans: number;
  retakes: number;
  capped: number;
  /** Fewest and most scans per growth timing: quarter, half, whole (null: not timed). */
  reps: Array<[number, number] | null>;
  worstGrowth: number;
  worstGrowthWhere: string | null;
  /** The growth reading of that string: per-scan CPU ms in each round, for the quarter, half and whole. */
  worstReading: {
    fixture: number; stage: string; rounds: number; reps: number[]; perScanMs: number[][]; growth: number; doublings: number[];
  } | null;
  maxSampleMs: number;
  longestSampleMs: number;
  cpuClock: string;
  clockTickMs: number;
  resolutionMs: number;
  resolutionSteps: number[];
  sampleTargetMs: number;
  ceilingMs: number;
  deadlineMs: number;
  growthLimit: number;
  elapsedMs: number;
}
export interface GuardRun {
  report: GuardReport | undefined;
  problem: string | undefined;
  timedOut: boolean;
  wallMs: number;
}

// The measuring process is bundled once per test file into a temporary
// file: the translator, the fixtures, the growth check and the worker, and
// no test framework.
let scriptDir: string | undefined;
let script: string | undefined;
function guardScript(): string {
  if (script === undefined) {
    scriptDir ??= mkdtempSync(join(tmpdir(), "biasclear-redos-"));
    const outfile = join(scriptDir, "redos-guard.mjs");
    buildSync({
      entryPoints: [join(PACKAGE, "test", "redos-worker.mjs")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile,
      logLevel: "silent",
    });
    script = outfile;
  }
  return script;
}

/** Deletes the bundled script (call from afterAll). */
export function removeGuardScript(): void {
  if (scriptDir !== undefined) rmSync(scriptDir, { recursive: true, force: true });
}

export function runGuard(request: GuardRequest, timeout = 120_000): GuardRun {
  const start = performance.now();
  const result = spawnSync(process.execPath, [guardScript()], {
    input: JSON.stringify(request),
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 1_048_576,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const wallMs = performance.now() - start;
  const timedOut = result.error?.code === "ETIMEDOUT";
  let parsed: (GuardReport & { error?: string }) | undefined;
  try {
    parsed = JSON.parse(result.stdout) as GuardReport & { error?: string };
  } catch {
    parsed = undefined;
  }
  let problem: string | undefined;
  if (timedOut) {
    const last = result.stderr.match(/^MEASUREMENT .*$/gm)?.at(-1)?.slice("MEASUREMENT ".length);
    problem = `ReDoS guard: the measuring process did not finish within ${timeout / 1000} s and was killed; ` +
      (last === undefined ? "it had not started measuring." : `the last regex it started was ${last}.`);
  } else if (parsed?.error !== undefined) {
    problem = `ReDoS guard could not run: ${parsed.error}`;
  } else if (parsed === undefined || (result.status !== 0 && result.status !== 1)) {
    const tail = result.stderr.split("\n").filter((line) => line !== "" && !line.startsWith("MEASUREMENT "));
    problem = `ReDoS guard: the measuring process ended without a report ` +
      `(status ${result.status}, signal ${result.signal}${result.error ? `, ${result.error.message}` : ""})` +
      (tail.length > 0 ? `\n${tail.slice(-5).join("\n").slice(0, 1000)}` : "");
  }
  return { report: problem === undefined ? parsed : undefined, problem, timedOut, wallMs };
}

/** The CPU clock and how growth was timed, for the summary line (CI logs show the clock's behaviour). */
function clockLine(report: GuardReport): string {
  const clock = `${report.cpuClock} CPU clock` + (report.clockTickMs > 0 ? ` rounded to ${report.clockTickMs}-ms ticks` : "");
  const steps = report.resolutionSteps.length;
  const reps = `scans per growth timing: ` + ["quarter", "half", "whole"]
    .map((name, i) => `${name} ${report.reps[i]?.join("-") ?? "none"}`).join(", ");
  return `${clock}, resolution ${report.resolutionMs.toFixed(3)} ms (median of ${steps} step${steps === 1 ? "" : "s"}), ` +
    `each growth timing at least ${report.sampleTargetMs} CPU ms; ${reps}; ${report.retakes} retake` +
    `${report.retakes === 1 ? "" : "s"}${report.capped > 0 ? `, ${report.capped} capped` : ""}`;
}

export function summary(report: GuardReport): string {
  return `ReDoS guard: ${report.regexes} regexes, ${report.strings} strings; slowest: ` +
    report.timings.slice(0, 3).map(([ms, w]) => `${w} ${ms.toFixed(1)} CPU ms`).join(", ") +
    `; slowest single run ${report.maxSampleMs.toFixed(1)} CPU ms; growth checked on ${report.probed} ` +
    `string${report.probed === 1 ? "" : "s"} (${report.fullProbes} needing all three lengths, ${report.rechecked} ` +
    `timed again near the floor), worst ` +
    `${report.worstGrowth.toFixed(2)}x (${report.worstGrowthWhere ?? "none"}), limit ${report.growthLimit}x; ` +
    `${clockLine(report)}; ceiling ${report.ceilingMs} CPU ms, deadline ${report.deadlineMs} CPU ms; ` +
    `${(report.elapsedMs / 1000).toFixed(1)} s`;
}

/** A failed guard's message: one line naming each regex and why, then details. */
export function verdict(report: GuardReport): string {
  const lines = [
    `ReDoS guard failed: ${report.failures.map((f) => `${f.where} (${f.short})`).join("; ")}`,
    ...report.failures.map((f) => `  ${f.detail}`),
  ];
  if (report.unmeasured > 0) {
    lines.push(`  ${report.unmeasured} regexes were not measured: the guard stops after ${report.failures.length} failures.`);
  }
  lines.push(`  ${summary(report)}`);
  return lines.join("\n");
}

export function packRegexes(): GuardRegex[] {
  const pack = readPack();
  return [
    ...pack.rules.flatMap((r) => r.indicators.map((p, i) => [`${r.id}[${i}]`, p, r.flags] as const)),
    ...pack.citation_suppression.patterns.map((p, i) => [`citation[${i}]`, p, pack.citation_suppression.flags] as const),
  ];
}
