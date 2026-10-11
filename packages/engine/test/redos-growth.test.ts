// The ReDoS guard's growth decision (redos-growth.ts) on fake clocks. No
// regex is timed: a fake scan adds a set number of milliseconds to a fake
// CPU time, and the fake clock reads that time rounded down to whole ticks,
// Q(t) = q * floor(t / q), the way Linux can count a thread's CPU time. The
// path is the guard's own: measureResolution, sampleTarget and judgeString,
// as redos-worker.mjs calls them for every string.
import { describe, expect, it } from "vitest";
import {
  DOUBLING_LIMIT, EQUAL_SHARE, GROWTH_FLOOR_MS, GROWTH_LIMIT, judgeString, MAX_RESOLUTION_MS, measureResolution, median,
  MIN_SAMPLE_MS, RESOLUTION_MULTIPLE, sampleTarget, timeScans, type Length, type Timer,
} from "./redos-growth.js";

type PerScan = readonly [quarter: number, half: number, whole: number];
const LENGTHS = [5_000, 10_000, 20_000] as const;
const CEILING_MS = 150;
// Each clock reading costs a little fake CPU time, so the resolution spin
// ends. A power of two keeps every fake time exact in floating point.
const READ_MS = 2 ** -10;

interface FakeTimer extends Timer {
  readonly scans: number[];
  readonly reads: number;
}

/** A spell of fake CPU time in which every scan that starts takes `factor` times as long. */
interface Spell {
  fromMs: number;
  toMs: number;
  factor: number;
}

function fakeTimer(tickMs: number, startMs: number, perScanMs: PerScan, spell?: Spell): FakeTimer {
  let t = startMs;
  let reads = 0;
  const scans = [0, 0, 0];
  return {
    cpu: () => {
      reads++;
      t += READ_MS;
      return tickMs * Math.floor(t / tickMs);
    },
    wall: () => t,
    scan: (length: Length) => {
      const inSpell = spell !== undefined && t >= spell.fromMs && t < spell.toMs;
      t += perScanMs[length] * (inSpell ? spell.factor : 1);
      scans[length]!++;
    },
    scans,
    get reads() {
      return reads;
    },
  };
}

/** The guard's path for one string on a fake clock of `tickMs` ticks, starting at `startMs`. */
function judge(tickMs: number, startMs: number, perScanMs: PerScan, spell?: Spell) {
  const { resolutionMs } = measureResolution(fakeTimer(tickMs, 0, perScanMs).cpu, () => 0);
  const targetMs = sampleTarget(resolutionMs);
  const timer = fakeTimer(tickMs, startMs, perScanMs, spell);
  return { resolutionMs, targetMs, timer, ...judgeString(timer, { lengths: LENGTHS, ceilingMs: CEILING_MS, resolutionMs, targetMs }) };
}

// Phases: where the fake CPU time starts within a tick, in eighths of a tick.
const phases = (tickMs: number) => Array.from({ length: 8 }, (_, i) => (i * tickMs) / 8);
// A fine clock (about a microsecond, like a Mac's), 1-ms and 4-ms ticks.
const TICKS = [2 ** -10, 1, 4];

describe("clock resolution", () => {
  it.each([[1], [4], [2 ** -10]])("reads a clock of %s-ms ticks as that resolution", (tickMs) => {
    const { resolutionMs, steps } = measureResolution(fakeTimer(tickMs, 0.3, [1, 1, 1]).cpu, () => 0);
    expect(resolutionMs).toBe(tickMs);
    expect(steps.length).toBeGreaterThanOrEqual(5);
  });

  it("aims each growth timing at 10 CPU ms, or 20 clock steps on a coarse clock", () => {
    expect([MIN_SAMPLE_MS, RESOLUTION_MULTIPLE, MAX_RESOLUTION_MS, EQUAL_SHARE]).toEqual([10, 20, 5, 0.75]);
    expect([sampleTarget(0.001), sampleTarget(1), sampleTarget(4)]).toEqual([10, 20, 80]);
  });

  it("reports a clock that does not move", () => {
    let wall = 0;
    expect(measureResolution(() => 7, () => (wall += 100)).resolutionMs).toBe(Infinity);
  });
});

describe("timings", () => {
  it("reads the clock only before and after a timing, and scans once per repetition", () => {
    // Each scan goes through timer.scan, where the worker starts that scan's
    // deadline, so a timing of many scans never runs against one deadline.
    const timer = fakeTimer(1, 0, [0.5, 1, 2]);
    const sample = timeScans(timer, 0, 37);
    expect([timer.scans, timer.reads, sample.reps]).toEqual([[37, 0, 0], 2, 37]);
    expect(sample.totalMs).toBe(18);
    expect(sample.cpuMs).toBeCloseTo(18 / 37, 12);
  });
});

// The old guard's growth reading (commit 80f315e), kept here only to show the
// failure Jarvis found (352-jarvis-to-claude-guard-fix-review.md): one scan
// per timing, three rounds in alternating order, the median round, and a
// smallest divisor of 0.25 ms.
function oldReading(tickMs: number, startMs: number, perScanMs: PerScan) {
  const timer = fakeTimer(tickMs, startMs, perScanMs);
  const read = () => tickMs * Math.floor((timer.wall() - 0) / tickMs); // no read cost, as in Jarvis's model
  const runs: [number[], number[], number[]] = [[], [], []];
  for (let round = 0; round < 3; round++) {
    for (const i of (round % 2 === 0 ? [0, 1, 2] : [2, 1, 0]) as Length[]) {
      const before = read();
      timer.scan(i);
      runs[i].push(read() - before);
    }
  }
  const ratio = (a: Length, b: Length) => median(runs[a].map((ms, r) => ms / Math.max(0.25, runs[b][r]!)));
  const fails = median(runs[2]) >= GROWTH_FLOOR_MS && ratio(2, 0) > GROWTH_LIMIT &&
    ratio(1, 0) > DOUBLING_LIMIT && ratio(2, 1) > DOUBLING_LIMIT;
  return { runs, growth: ratio(2, 0), doublings: [ratio(1, 0), ratio(2, 1)], fails };
}

describe("Jarvis's two counterexamples (352), verbatim", () => {
  const cases = [
    // 4-ms ticks, quadratic 0.875, 3.5 and 14 ms per scan, from 0.25 ms.
    { tickMs: 4, startMs: 0.25, perScanMs: [0.875, 3.5, 14] as PerScan, old: [[0, 0, 0], [4, 4, 4], [12, 16, 12]] },
    // 1-ms ticks, quadratic 0.625, 2.5 and 10 ms per scan, from 0.25 ms.
    { tickMs: 1, startMs: 0.25, perScanMs: [0.625, 2.5, 10] as PerScan, old: [[0, 1, 1], [3, 2, 2], [10, 10, 10]] },
  ];

  it.each(cases)("the old guard read $old on $tickMs-ms ticks and passed", ({ tickMs, startMs, perScanMs, old }) => {
    const reading = oldReading(tickMs, startMs, perScanMs);
    expect(reading.runs).toEqual(old);
    expect(reading.fails).toBe(false);
  });

  it.each(cases)("the guard fails $perScanMs ms per scan on $tickMs-ms ticks by growth", ({ tickMs, startMs, perScanMs }) => {
    const j = judge(tickMs, startMs, perScanMs);
    expect([j.resolutionMs, j.targetMs]).toEqual([tickMs, RESOLUTION_MULTIPLE * tickMs]);
    expect(j.kind).toBe("growth");
    expect(j.reading!.growth).toBeGreaterThan(14);
    expect(Math.min(...j.reading!.doublings)).toBeGreaterThan(3.5);
  });
});

describe("quantized clocks, every phase", () => {
  const quadratic: PerScan[] = [
    [0.625, 2.5, 10], // at the floor
    [0.6328125, 2.53125, 10.125], // just over it: a batched whole timing can read 9.8 ms
    [0.875, 3.5, 14],
    [0.71875, 2.78125, 10.71875], // doublings of 3.87x and 3.85x, like the historical CREDENTIAL_AS_PREMISE[1]
    [2, 8, 32],
    [7.5, 30, 120], // under the ceiling
  ];
  const linear: PerScan[] = [
    [2.5, 5, 10],
    [3.5, 7, 14],
    [2.75, 5.25, 10.25], // a fixed cost plus a linear one
    [5, 10, 20],
    [30, 60, 120],
    [1.25, 3.5, 10], // 8x for 4x the input: faster than linear, under the limit
    [1, 1.25, 12], // 12x, but one doubling is 1.25x: the doubling limit passes it
  ];

  for (const tickMs of TICKS) {
    for (const perScanMs of quadratic) {
      it(`fails ${perScanMs.join("/")} ms per scan by growth on ${tickMs}-ms ticks`, () => {
        for (const startMs of phases(tickMs)) {
          const j = judge(tickMs, startMs, perScanMs);
          expect({ startMs, kind: j.kind, gate: j.gate }).toEqual({ startMs, kind: "growth", gate: "probed" });
          // Every length was timed in runs of at least the target, and of at
          // least three quarters of one whole scan, give or take a tick.
          j.reading!.reps.forEach((reps, i) => {
            expect(reps * perScanMs[i]!).toBeGreaterThanOrEqual(Math.max(j.targetMs, 0.75 * perScanMs[2]) - tickMs);
          });
        }
      });
    }
    for (const perScanMs of linear) {
      it(`passes ${perScanMs.join("/")} ms per scan on ${tickMs}-ms ticks`, () => {
        for (const startMs of phases(tickMs)) {
          const j = judge(tickMs, startMs, perScanMs);
          expect({ startMs, kind: j.kind, gate: j.gate }).toEqual({ startMs, kind: "pass", gate: "probed" });
        }
      });
    }
    it(`gives no growth check to a scan under the floor on ${tickMs}-ms ticks`, () => {
      for (const startMs of phases(tickMs)) {
        const j = judge(tickMs, startMs, [2, 4, 8]);
        expect(j.kind).toBe("pass");
        expect(j.reading).toBeNull();
      }
    });
    it(`fails a scan over the ceiling on ${tickMs}-ms ticks`, () => {
      for (const startMs of phases(tickMs)) expect(judge(tickMs, startMs, [40, 80, 160]).kind).toBe("ceiling");
    });
  }

  it("settles a linear scan from the quarter and the whole string, and times all three lengths for a quadratic one", () => {
    const linear = judge(4, 0.5, [2.5, 5, 10]);
    expect([linear.reading!.stage, linear.reading!.rounds, linear.timer.scans[1]]).toEqual(["screen", 2, 0]);
    const quadratic = judge(4, 0.5, [0.625, 2.5, 10]);
    expect(quadratic.reading!.stage).toBe("full");
    expect(quadratic.timer.scans[1]).toBeGreaterThan(0);
  });

  it("cannot pass a quadratic scan on one slow spell", () => {
    // The first quarter timing (fake CPU time 14 to 24.5 ms on this fine
    // clock) runs three times slower, so the first round reads 5x. The second
    // round reads 16x, so the quarter and whole alone settle nothing; the
    // full probe then fails it.
    const j = judge(2 ** -10, 0, [0.875, 3.5, 14], { fromMs: 14, toMs: 24, factor: 3 });
    expect(j.reading!.stage).toBe("full");
    expect(j.kind).toBe("growth");
    // A slow spell over the full probe's first quarter timing (from 52 ms):
    // its first round passes (9x), the next two fail, and the median round fails.
    const k = judge(2 ** -10, 0, [0.875, 3.5, 14], { fromMs: 52, toMs: 66, factor: 3 });
    expect([k.reading!.stage, k.reading!.rounds]).toEqual(["full", 3]);
    expect(k.reading!.perScanMs[2][0]! / k.reading!.perScanMs[0][0]!).toBeLessThan(GROWTH_LIMIT);
    expect(k.kind).toBe("growth");
  });

  it("judges growth by its ratios, not by the floor a second time", () => {
    // A quadratic scan reads 10 ms once (on the floor), then runs 10% faster
    // through the growth check, so its whole-string timings read 9 ms.
    const j = judge(2 ** -10, 0, [0.625, 2.5, 10], { fromMs: 10.5, toMs: Infinity, factor: 0.9 });
    expect(j.gate).toBe("probed");
    expect(j.reading!.samplesMs[2]).toBeLessThan(GROWTH_FLOOR_MS);
    expect(j.kind).toBe("growth");
  });

  it("cannot fail a linear scan on one fast spell", () => {
    // The first quarter timing (10 to 39 ms) runs three times faster: the
    // first round reads 12x, so the full probe runs, and its rounds read 4x.
    const j = judge(2 ** -10, 0, [2.5, 5, 10], { fromMs: 10, toMs: 39, factor: 1 / 3 });
    expect(j.reading!.stage).toBe("full");
    expect(j.kind).toBe("pass");
  });

  it("times a reading just under the floor again before skipping it", () => {
    // 10 ms per scan reads 8 on 4-ms ticks from some phases: within a tick of the floor.
    const rechecked = phases(4).map((startMs) => judge(4, startMs, [0.625, 2.5, 10])).filter((j) => j.recheck !== null);
    expect(rechecked.length).toBeGreaterThan(0);
    for (const j of rechecked) expect(j.kind).toBe("growth");
    // 9 ms per scan is under the floor. It reads 8 (timed again, then not
    // probed) or 12 (probed, and linear, so it passes).
    const under = phases(4).map((startMs) => judge(4, startMs, [2.25, 4.5, 9]));
    for (const j of under) expect(j.kind).toBe("pass");
    expect(under.some((j) => j.recheck !== null && j.reading === null)).toBe(true);
  });
});
