// How the ReDoS guard times and judges one adversarial string (test only).
// redos-worker.mjs runs this with the measuring thread's CPU clock and real
// scans; redos-growth.test.ts runs it with fake clocks and fake scans, so its
// decisions can be checked on coarse clocks without timing a regex.
//
// A CPU clock moves in steps. Where they are coarse (Linux counts a thread's
// CPU time in whole timer ticks, often 1 or 4 ms), one short scan can read as
// 0 or as a whole step, and a ratio of such readings can hide quadratic
// growth or invent it. So every timing that a growth decision uses repeats
// the scan until the timing spans at least MIN_SAMPLE_MS and at least
// RESOLUTION_MULTIPLE steps of the clock (and about as long as one whole
// scan), and the time per scan is the timing divided by the repetitions.
// That holds for timings that pass as well as for those that fail.

/** A scan under this many CPU ms (to within one step of the clock) gets no growth check. */
export const GROWTH_FLOOR_MS = 10;
/** 4x the input: a linear scan takes about 4x the CPU time, a quadratic one 16x. */
export const GROWTH_LIMIT = 10;
/** Each doubling of the input must also exceed this, so one noisy timing cannot fail. */
export const DOUBLING_LIMIT = 3;
/** A scan still running after this many times the ceiling is stopped. */
export const DEADLINE_FACTOR = 2;
// Each growth timing spans at least this many CPU ms. Fix round 1 found
// that a slowed core's speed jumps between two levels for short spells: a
// timing of a millisecond or less can catch one level while a longer one
// catches the other, so linear patterns read 12x to 15x. At 10 ms every
// length's timing spans about as long as one whole scan at the floor.
export const MIN_SAMPLE_MS = 10;
// ...and at least this many steps of the clock. A timing of n steps is off
// by less than one step, under 1/n of it, so a ratio of two timings of 20
// steps is off by less than about 10% (between 19/21 and 21/19 of the true
// ratio). A quadratic scan's doublings of 4x then read over 3.6x (limit 3x)
// and its 16x over 14.5x (limit 10x); a linear scan's 4x reads under 4.5x
// and its doublings under 2.3x. With 1-ms steps a timing spans 20 ms, with
// 4-ms steps 80 ms.
export const RESOLUTION_MULTIPLE = 20;
// A clock coarser than this would need timings of over 100 ms each (four to
// thirteen for each string the growth check times), which could push the
// guard past the test's watchdog; the guard then stops with an error instead.
export const MAX_RESOLUTION_MS = 5;
// The most scans in one timing. A timing that still spans less than the
// target at this count (scans of under 2.5 microseconds at a 10 ms target)
// is used as an upper bound, and counted as capped in the report.
export const MAX_REPS = 4096;
// Each growth timing also spans at least this share of one whole scan, so
// the three lengths' timings last about as long as each other. Under heavy
// load on a chip with fast and slow cores, a timing of one or two scheduler
// slices can land wholly on a slow core while a longer one averages several;
// with a quarter timed in 15 ms and the whole in 160 ms, the historical
// quadratic pattern read doublings under 3x in 8 of 120 runs. (Fix round 1
// found the same with short timings on slowed cores.)
export const EQUAL_SHARE = 0.75;
const ROUNDS = 3; // rounds of three timings; each ratio is the median round's
const HEADROOM = 1.1; // first guess of repetitions aims 10% over the target
const RESOLUTION_STEPS = 9; // clock steps observed to estimate its resolution
const RESOLUTION_SPIN_MS = 2000; // give up looking for steps after this wall time

/** Milliseconds: the measuring thread's CPU time so far, or wall time. */
export type Clock = () => number;
/** 0, 1, 2: the first quarter, the first half and the whole string. */
export type Length = 0 | 1 | 2;

export interface Timer {
  cpu: Clock;
  wall: Clock;
  /** One scan of the given length. The worker starts the per-scan deadline here. */
  scan: (length: Length) => void;
}

/** One timing: `reps` scans in a row. */
export interface Sample {
  reps: number;
  totalMs: number;
  /** CPU ms per scan. */
  cpuMs: number;
  /** Wall-clock ms per scan (reported only). */
  wallMs: number;
}

export interface ClockResolution {
  /** The median step, in ms; Infinity if the clock did not move. */
  resolutionMs: number;
  steps: number[];
}

export interface GrowthReading {
  /** "screen": two rounds of the quarter and the whole string settled a pass; "full": all three lengths. */
  stage: "screen" | "full";
  rounds: number;
  /** Scans per timing at the end, for each length (0: not timed). */
  reps: [number, number, number];
  /** CPU ms per scan in each round, for each length. */
  perScanMs: [number[], number[], number[]];
  /** Median CPU ms per scan, for each length (NaN: not timed). */
  samplesMs: [number, number, number];
  /** Whole over quarter, median of the rounds. */
  growth: number;
  /** Half over quarter and whole over half, medians of the rounds (NaN: not timed). */
  doublings: [number, number];
  fails: boolean;
  /** The whole-string timings. */
  whole: Sample[];
  scans: number;
  /** Timings taken again with twice the scans, because they spanned less than the target. */
  retakes: number;
  capped: number;
  longestMs: number;
}

export interface Judgement {
  kind: "pass" | "ceiling" | "growth";
  /** under: no growth check; rechecked: timed again near the floor, then under it; probed: growth checked. */
  gate: "ceiling" | "under" | "rechecked" | "probed";
  /** The fastest whole-string timing (per scan). */
  best: Sample;
  /** Single whole-string runs before the growth check: 1, or 2 when over the ceiling. */
  runs: number;
  /** The slowest whole-string timing (per scan). */
  maxSampleMs: number;
  /** The longest timing, in total CPU ms. */
  longestMs: number;
  /** The batched whole-string timing taken near the floor, if any. */
  recheck: Sample | null;
  reading: GrowthReading | null;
  /** Scans in growth timings, retakes and capped timings (the near-floor recheck included). */
  scans: number;
  retakes: number;
  capped: number;
}

/** The middle value; of two values, the larger (two rounds are used only when they agree). */
export function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[values.length >> 1] ?? NaN;
}

/** The target length of a growth timing, in CPU ms, for a clock of this resolution. */
export function sampleTarget(resolutionMs: number): number {
  return Math.max(MIN_SAMPLE_MS, RESOLUTION_MULTIPLE * resolutionMs);
}

/**
 * The clock's resolution: spin until its reading changes, several times, and
 * take the median step. A clock that counts whole ticks moves a tick at a
 * time; a fine clock moves by a microsecond or so per reading.
 */
export function measureResolution(cpu: Clock, wall: Clock): ClockResolution {
  const steps: number[] = [];
  const start = wall();
  let last = cpu();
  while (steps.length < RESOLUTION_STEPS && wall() - start < RESOLUTION_SPIN_MS) {
    const now = cpu();
    if (now !== last) {
      if (now > last) steps.push(now - last);
      last = now;
    }
  }
  return { resolutionMs: steps.length === 0 ? Infinity : median(steps), steps };
}

/** One timing of `reps` scans. The clock is read only before and after them. */
export function timeScans(timer: Timer, length: Length, reps: number): Sample {
  const wall = timer.wall();
  const cpu = timer.cpu();
  for (let rep = 0; rep < reps; rep++) timer.scan(length);
  const totalMs = timer.cpu() - cpu;
  return { reps, totalMs, cpuMs: totalMs / reps, wallMs: (timer.wall() - wall) / reps };
}

function firstReps(perScanMs: number, targetMs: number): number {
  return Math.min(MAX_REPS, Math.max(1, Math.ceil((HEADROOM * targetMs) / Math.max(perScanMs, 1e-3))));
}

interface Resolved {
  sample: Sample;
  scans: number;
  retakes: number;
  capped: boolean;
  longestMs: number;
}

/**
 * A timing that spans at least `aimMs` (at least the target): doubles the
 * scans until it does, up to MAX_REPS. Capped: still under the target.
 */
function resolvedSample(timer: Timer, length: Length, reps: number, targetMs: number, aimMs = targetMs): Resolved {
  let sample = timeScans(timer, length, reps);
  let scans = sample.reps;
  let retakes = 0;
  let longestMs = sample.totalMs;
  while (sample.totalMs < aimMs && sample.reps < MAX_REPS) {
    retakes++;
    sample = timeScans(timer, length, Math.min(MAX_REPS, sample.reps * 2));
    scans += sample.reps;
    longestMs = Math.max(longestMs, sample.totalMs);
  }
  return { sample, scans, retakes, capped: sample.totalMs < targetMs, longestMs };
}

const CONDITIONS = [[2, 0, GROWTH_LIMIT], [1, 0, DOUBLING_LIMIT], [2, 1, DOUBLING_LIMIT]] as const;

/**
 * After two rounds of the full probe: true if a third round could not change
 * the verdict. A condition that holds in both rounds holds in the median of
 * three, and one that fails in both fails in it.
 */
function settled(perScanMs: readonly number[][]): boolean {
  const both = CONDITIONS.map(([a, b, limit]) =>
    [0, 1].map((round) => (perScanMs[a]?.[round] ?? NaN) / (perScanMs[b]?.[round] ?? NaN) > limit));
  return both.some(([x, y]) => !x && !y) || both.every(([x, y]) => x && y);
}

/**
 * The growth probe: the first quarter and the first half of the string
 * (keeping its opening bracket) and the whole string, in up to three rounds
 * of alternating order so warm-up or clock drift favours no length. Each
 * ratio is taken within a round and the median round is used, so one odd
 * round cannot decide. Every timing spans at least `targetMs`, and at least
 * EQUAL_SHARE of one whole scan (`estimateMs`).
 *
 * It is evaluated lazily, with the same verdict as timing everything:
 * - First, up to two rounds of the quarter and the whole string. If both
 *   read 10x or less, the median of three rounds could not read more, so
 *   the string passes without timing the half.
 * - Otherwise the full probe times all three lengths, and stops after two
 *   rounds if a third could not change the verdict.
 */
export function probe(
  timer: Timer, lengths: readonly [number, number, number], estimateMs: number, resolutionMs: number, targetMs: number,
): GrowthReading {
  const aimMs = Math.max(targetMs, EQUAL_SHARE * estimateMs);
  const reps: [number, number, number] = [0, 1, 2].map((i) =>
    firstReps((estimateMs * lengths[i as Length]) / lengths[2], aimMs)) as [number, number, number];
  const whole: Sample[] = [];
  let scans = 0;
  let retakes = 0;
  let capped = 0;
  let longestMs = 0;
  const time = (i: Length): number => {
    const r = resolvedSample(timer, i, reps[i], targetMs, aimMs);
    reps[i] = r.sample.reps;
    scans += r.scans;
    retakes += r.retakes;
    longestMs = Math.max(longestMs, r.longestMs);
    if (i === 2) whole.push(r.sample);
    if (!r.capped) return r.sample.cpuMs;
    // A capped timing's true time is under its reading plus one clock step.
    capped++;
    return Math.max(r.sample.totalMs, resolutionMs) / r.sample.reps;
  };
  const reading = (stage: GrowthReading["stage"], perScanMs: [number[], number[], number[]]): GrowthReading => {
    const ratio = (a: Length, b: Length) => perScanMs[a].length === 0 || perScanMs[b].length === 0
      ? NaN
      : median(perScanMs[a].map((ms, round) => ms / (perScanMs[b][round] ?? NaN)));
    const growth = ratio(2, 0);
    const doublings: [number, number] = [ratio(1, 0), ratio(2, 1)];
    // With two rounds, median() takes the larger; the rounds agree on each deciding condition (settled).
    const fails = stage === "full" && growth > GROWTH_LIMIT && doublings[0] > DOUBLING_LIMIT && doublings[1] > DOUBLING_LIMIT;
    return {
      stage, rounds: perScanMs[0].length,
      reps: reps.map((n, i) => (perScanMs[i as Length].length === 0 ? 0 : n)) as [number, number, number],
      perScanMs, samplesMs: perScanMs.map((v) => (v.length === 0 ? NaN : median(v))) as [number, number, number],
      growth, doublings, fails, whole, scans, retakes, capped, longestMs,
    };
  };

  const screen: [number[], number[], number[]] = [[], [], []];
  for (let round = 0; round < 2; round++) {
    for (const i of (round === 0 ? [0, 2] : [2, 0]) as Length[]) screen[i].push(time(i));
    if ((screen[2][round] ?? NaN) / (screen[0][round] ?? NaN) > GROWTH_LIMIT) break;
  }
  if (screen[0].length === 2 && screen[0].every((ms, round) => (screen[2][round] ?? NaN) / ms <= GROWTH_LIMIT)) {
    return reading("screen", screen);
  }

  const full: [number[], number[], number[]] = [[], [], []];
  for (let round = 0; round < ROUNDS; round++) {
    for (const i of (round % 2 === 0 ? [0, 1, 2] : [2, 1, 0]) as Length[]) full[i].push(time(i));
    if (round === 1 && settled(full)) break;
  }
  return reading("full", full);
}

export interface JudgeOptions {
  /** Lengths of the quarter, half and whole string. */
  lengths: readonly [number, number, number];
  ceilingMs: number;
  resolutionMs: number;
  targetMs: number;
}

/**
 * One string, start to finish. One run of the whole string; a run over the
 * ceiling is timed once more to confirm, unless it is already twice the
 * ceiling (the deadline normally stops such a scan first), and the faster
 * run counts. A scan that may take GROWTH_FLOOR_MS or more, to within the
 * clock's resolution, then gets the growth probe.
 */
export function judgeString(timer: Timer, { lengths, ceilingMs, resolutionMs, targetMs }: JudgeOptions): Judgement {
  let best = timeScans(timer, 2, 1);
  let runs = 1;
  let maxSampleMs = best.cpuMs;
  let longestMs = best.totalMs;
  let scans = 0;
  let retakes = 0;
  let capped = 0;
  if (best.cpuMs >= ceilingMs && best.cpuMs < DEADLINE_FACTOR * ceilingMs) {
    const again = timeScans(timer, 2, 1);
    runs++;
    maxSampleMs = Math.max(maxSampleMs, again.cpuMs);
    longestMs = Math.max(longestMs, again.totalMs);
    if (again.cpuMs < best.cpuMs) best = again;
  }
  const result = (kind: Judgement["kind"], gate: Judgement["gate"], recheck: Sample | null, reading: GrowthReading | null): Judgement =>
    ({ kind, gate, best, runs, maxSampleMs, longestMs, recheck, reading, scans, retakes, capped });
  if (best.cpuMs >= ceilingMs) return result("ceiling", "ceiling", null, null);

  // One run's reading is within one clock step of its true time. A reading
  // at least a step under the floor is under it. A reading nearer the floor
  // is timed again with repeated scans, like a growth timing, and the string
  // is probed unless that timing shows it under the floor.
  let estimateMs = best.cpuMs;
  let recheck: Sample | null = null;
  if (best.cpuMs < GROWTH_FLOOR_MS) {
    if (best.cpuMs + resolutionMs <= GROWTH_FLOOR_MS) return result("pass", "under", null, null);
    const r = resolvedSample(timer, 2, firstReps(best.cpuMs, targetMs), targetMs);
    recheck = r.sample;
    scans += r.scans;
    retakes += r.retakes;
    if (r.capped) capped++;
    longestMs = Math.max(longestMs, r.longestMs);
    maxSampleMs = Math.max(maxSampleMs, recheck.cpuMs);
    if (recheck.cpuMs < best.cpuMs) best = recheck;
    // The timing spans at least the target, so it is off by under resolution/target of itself.
    if (recheck.cpuMs * (1 + resolutionMs / targetMs) <= GROWTH_FLOOR_MS) return result("pass", "rechecked", recheck, null);
    estimateMs = recheck.cpuMs;
  }

  const reading = probe(timer, lengths, estimateMs, resolutionMs, targetMs);
  scans += reading.scans;
  retakes += reading.retakes;
  capped += reading.capped;
  longestMs = Math.max(longestMs, reading.longestMs);
  for (const s of reading.whole) {
    maxSampleMs = Math.max(maxSampleMs, s.cpuMs);
    if (s.cpuMs < best.cpuMs) best = s;
  }
  return result(reading.fails ? "growth" : "pass", "probed", recheck, reading);
}
