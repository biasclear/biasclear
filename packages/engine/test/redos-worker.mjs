// The ReDoS guard's measuring process (test only). redos-guard.ts bundles this
// file with esbuild and runs it with plain Node, so no test framework is
// loaded while regexes are timed (Vitest's runtime changes regex speed on
// Node 22). It reads {regexes, ceilingMs?, deadlineMs?, fixtures?,
// clockTickMs?} as JSON on stdin and prints one JSON report on stdout. Exit
// code 0: every regex passed; 1: at least one failed (report.failures names
// each); 2: the guard itself could not run (report.error says why).
//
// It runs on two threads. A worker thread times the scans; redos-growth.ts
// decides each string. The main thread watches it: a scan still running
// after deadlineMs of CPU time is stopped, and the regex and fixture it was
// on are reported as a failure. A pattern with exponential backtracking
// never finishes a scan, so without this only the test's 120-second
// wall-clock watchdog would stop it, and that cannot say which regex hung.
import { writeSync } from "node:fs";
import process from "node:process";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { translate } from "../src/regex.ts";
import { adversarial, LENGTH, LIMIT_MS } from "./redos-fixtures.ts";
import {
  DEADLINE_FACTOR, DOUBLING_LIMIT, GROWTH_FLOOR_MS, GROWTH_LIMIT, MAX_RESOLUTION_MS, judgeString, measureResolution,
  sampleTarget,
} from "./redos-growth.ts";

const POLL_MS = 5; // how often the main thread checks the running scan
const MAX_FAILED_REGEXES = 10; // stop after this many failures; each can cost a second

// One Int32Array shared by the two threads: which scan is running.
const SEQ = 0; // incremented as each scan starts, so the deadline is per scan, never per timing
const BUSY = 1; // 1 while a scan runs
const REGEX = 2; // index of the regex being measured
const FIXTURE = 3; // index of its adversarial string
const CHARS = 4; // length of the text being scanned (prefixes during growth probes)
const SLOTS = 5;

const cpuClock = typeof process.threadCpuUsage === "function" ? "thread" : "process";
// CPU time of the measuring thread only, where Node has it (the Node 22 that
// CI uses does): a GC or compiler thread's work, or the main thread's
// polling, is then not counted. Otherwise the whole process's CPU time.
const cpuUsage = cpuClock === "thread"
  ? (previous) => process.threadCpuUsage(previous)
  : (previous) => process.cpuUsage(previous);
const cpuMs = (usage) => (usage.user + usage.system) / 1000;

function preview(text) {
  return `${JSON.stringify(text.slice(0, 32))}...`;
}

function scan(re, text) {
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    // No pack regex can match the empty string. If one ever does, step past
    // the empty match as the engine does, rather than spin until the deadline.
    if (m[0].length === 0) re.lastIndex = m.index + ((text.codePointAt(m.index) ?? 0) > 0xffff ? 2 : 1);
  }
}

// ---------------------------------------------------------------- measuring thread

function measureAll({ regexes, start, ceilingMs, state, fixtures, clockTickMs }) {
  const shared = new Int32Array(state);
  const wall = () => performance.now();
  // clockTickMs (test controls only) rounds the CPU clock down to whole
  // ticks, as a kernel that counts CPU time in timer ticks does.
  const cpu = clockTickMs > 0
    ? () => clockTickMs * Math.floor(cpuMs(cpuUsage()) / clockTickMs)
    : () => cpuMs(cpuUsage());
  const { resolutionMs, steps } = measureResolution(cpu, wall);
  if (!(resolutionMs <= MAX_RESOLUTION_MS)) {
    parentPort.postMessage({
      type: "fatal",
      message: steps.length === 0
        ? "the measuring thread's CPU clock did not move in 2 s of busy work"
        : `the measuring thread's CPU clock moves in steps of ${resolutionMs} ms, too coarse to time growth ` +
          `(at most ${MAX_RESOLUTION_MS} ms)`,
    });
    return;
  }
  const targetMs = sampleTarget(resolutionMs);
  parentPort.postMessage({ type: "clock", resolutionMs, steps, targetMs });
  const only = fixtures === undefined ? null : new Set(fixtures);

  for (let index = start; index < regexes.length; index++) {
    const [where, pattern, flags] = regexes[index];
    Atomics.store(shared, REGEX, index);
    // Read by the test only if its wall-clock watchdog has to kill this process.
    writeSync(2, `MEASUREMENT ${where}\n`);
    const re = new RegExp(translate(pattern, flags).source, "gu");
    // Compile both V8 string widths outside the timed scans.
    for (let warm = 0; warm < 2; warm++) {
      scan(re, "a ");
      scan(re, "王 ");
    }
    const stats = {
      strings: 0, probed: 0, fullProbes: 0, rechecked: 0, scans: 0, retakes: 0, capped: 0, worstMs: 0, worstWallMs: 0,
      maxSampleMs: 0, longestMs: 0, worstGrowth: 0, worstReading: null, reps: [],
    };
    let failure = null;

    for (const [fixture, text] of adversarial(pattern).entries()) {
      if (only !== null && !only.has(fixture)) continue;
      if (text.length < LENGTH) throw new Error(`${where}: fixture ${fixture} is shorter than ${LENGTH} characters`);
      stats.strings++;
      // The first quarter and the first half keep the string's opening bracket.
      const texts = [text.slice(0, Math.floor(text.length / 4)), text.slice(0, Math.floor(text.length / 2)), text];
      const timer = {
        cpu,
        wall,
        // Each scan is marked on its own, so the main thread's deadline
        // applies to one scan, never to a timing of many.
        scan: (length) => {
          Atomics.store(shared, FIXTURE, fixture);
          Atomics.store(shared, CHARS, texts[length].length);
          Atomics.add(shared, SEQ, 1);
          Atomics.store(shared, BUSY, 1);
          scan(re, texts[length]);
          Atomics.store(shared, BUSY, 0);
        },
      };
      const j = judgeString(timer, { lengths: texts.map((t) => t.length), ceilingMs, resolutionMs, targetMs });
      stats.scans += j.scans;
      stats.retakes += j.retakes;
      stats.capped += j.capped;
      stats.maxSampleMs = Math.max(stats.maxSampleMs, j.maxSampleMs);
      stats.longestMs = Math.max(stats.longestMs, j.longestMs);
      stats.worstMs = Math.max(stats.worstMs, j.best.cpuMs);
      stats.worstWallMs = Math.max(stats.worstWallMs, j.best.wallMs);
      if (j.recheck !== null) stats.rechecked++;
      if (j.reading !== null) {
        stats.probed++;
        if (j.reading.stage === "full") stats.fullProbes++;
        stats.reps.push(j.reading.reps);
        if (stats.worstReading === null || j.reading.growth > stats.worstGrowth) {
          const { stage, rounds, reps, perScanMs, growth, doublings } = j.reading;
          stats.worstGrowth = growth;
          stats.worstReading = { fixture, stage, rounds, reps, perScanMs, growth, doublings };
        }
      }
      if (j.kind === "ceiling") {
        failure = {
          kind: "ceiling", where, fixture, cpuMs: j.best.cpuMs, ceilingMs,
          short: `${j.best.cpuMs.toFixed(1)} CPU ms on one scan, over the ${ceilingMs} ms ceiling`,
          detail: `${where}: ${j.best.cpuMs.toFixed(1)} CPU ms to scan ${text.length.toLocaleString("en-US")} characters ` +
            `(${j.runs === 1 ? "one run" : "the faster of two runs"}), over the ${ceilingMs} CPU-ms ceiling; ` +
            `fixture ${fixture}, ${preview(text)}`,
        };
      } else if (j.kind === "growth") {
        const { samplesMs: [smallMs, mediumMs, fullMs], growth, doublings, reps, rounds } = j.reading;
        const at = texts.map((t) => t.length.toLocaleString("en-US")).join(", ");
        failure = {
          kind: "growth", where, fixture, growth, doublings, samplesMs: j.reading.samplesMs, reps,
          short: `${growth.toFixed(1)}x the CPU time for 4x the input, over the ${GROWTH_LIMIT}x limit`,
          detail: `${where}: ${smallMs.toFixed(2)}, ${mediumMs.toFixed(2)} and ${fullMs.toFixed(2)} CPU ms per scan at ` +
            `${at} characters (medians of ${rounds} rounds; each timing at least ${targetMs} CPU ms, the lengths scanned ` +
            `${reps.join(", ")} times), ${growth.toFixed(1)}x for 4x the input, doublings ${doublings[0].toFixed(1)}x and ` +
            `${doublings[1].toFixed(1)}x (limit ${GROWTH_LIMIT}x, each doubling over ${DOUBLING_LIMIT}x); ` +
            `fixture ${fixture}, ${preview(text)}`,
        };
      }
      if (failure !== null) break;
    }
    parentPort.postMessage({ type: "regex", index, where, failure, ...stats });
  }
  parentPort.postMessage({ type: "done" });
}

// ---------------------------------------------------------------- main thread

class GuardError extends Error {}

async function readRequest() {
  // A piped stdin can be nonblocking, and a synchronous read of a large pack
  // can fail with EAGAIN before the parent has finished writing it.
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  const { regexes, fixtures } = request;
  if (!Array.isArray(regexes) || regexes.length === 0 ||
      !regexes.every((r) => Array.isArray(r) && r.length === 3 && r.every((v) => typeof v === "string"))) {
    throw new GuardError("regexes must be a non-empty list of [where, pattern, flags]");
  }
  // The test's controls pass their own settings to isolate one path; the
  // full-pack test passes none and gets the defaults. fixtures limits each
  // regex to the strings at those indices; clockTickMs rounds the CPU clock
  // to whole ticks of that many ms.
  const ceilingMs = request.ceilingMs ?? LIMIT_MS;
  const deadlineMs = request.deadlineMs ?? DEADLINE_FACTOR * ceilingMs;
  const clockTickMs = request.clockTickMs ?? 0;
  for (const [name, value] of [["ceilingMs", ceilingMs], ["deadlineMs", deadlineMs]]) {
    if (typeof value !== "number" || !(value > 0)) throw new GuardError(`${name} must be a positive number`);
  }
  if (typeof clockTickMs !== "number" || !(clockTickMs >= 0)) throw new GuardError("clockTickMs must be 0 or more");
  if (fixtures !== undefined && !(Array.isArray(fixtures) && fixtures.every((f) => Number.isInteger(f) && f >= 0))) {
    throw new GuardError("fixtures must be a list of string indices");
  }
  return { regexes, ceilingMs, deadlineMs, fixtures, clockTickMs };
}

async function supervise() {
  const started = performance.now();
  const { regexes, ceilingMs, deadlineMs, fixtures, clockTickMs } = await readRequest();
  const state = new SharedArrayBuffer(SLOTS * Int32Array.BYTES_PER_ELEMENT);
  const shared = new Int32Array(state);
  const report = {
    regexes: regexes.length, measured: 0, strings: 0, failures: [], timings: [],
    probed: 0, fullProbes: 0, rechecked: 0, scans: 0, retakes: 0, capped: 0, reps: [null, null, null],
    worstGrowth: 0, worstGrowthWhere: null, worstReading: null, maxSampleMs: 0, longestSampleMs: 0,
    cpuClock, clockTickMs, resolutionMs: null, resolutionSteps: [], sampleTargetMs: null,
    ceilingMs, deadlineMs, growthLimit: GROWTH_LIMIT, doublingLimit: DOUBLING_LIMIT, floorMs: GROWTH_FLOOR_MS,
    unmeasured: 0, elapsedMs: 0,
  };

  // Measure regexes from `start` on one worker thread. Resolves with the index
  // to continue from: past the end when all are done, or just past a regex
  // whose scan was stopped at the deadline (the thread is then terminated).
  const measureFrom = (start) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { regexes, start, ceilingMs, state, fixtures, clockTickMs },
    });
    let settled = false;
    let stopAt = Infinity; // ignore results from this regex on, once stopping
    let watchedSeq = -1;
    let cpuAtStart = null;
    const finish = (next) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      worker.terminate().then(() => {
        // A thread stopped at the deadline leaves its scan marked as running.
        // Clear the mark, so the next thread's watcher does not count that
        // thread's start-up as the stopped scan and stop it again.
        Atomics.store(shared, BUSY, 0);
        Atomics.add(shared, SEQ, 1);
        resolve(next);
      }, reject);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      worker.terminate().then(() => reject(error), () => reject(error));
    };
    const watch = setInterval(() => {
      const seq = Atomics.load(shared, SEQ);
      if (Atomics.load(shared, BUSY) !== 1 || Atomics.load(shared, SEQ) !== seq) {
        watchedSeq = -1;
        return;
      }
      if (seq !== watchedSeq) {
        // First sight of this scan: count CPU time from here.
        watchedSeq = seq;
        cpuAtStart = process.cpuUsage();
        return;
      }
      // The measuring thread is the only busy one, so the process's CPU time
      // is, to within a few milliseconds, that scan's.
      const used = cpuMs(process.cpuUsage(cpuAtStart));
      if (used < deadlineMs) return;
      const index = Atomics.load(shared, REGEX);
      const fixture = Atomics.load(shared, FIXTURE);
      const chars = Atomics.load(shared, CHARS);
      if (Atomics.load(shared, SEQ) !== seq || Atomics.load(shared, BUSY) !== 1) return; // it just finished
      if (index < start) return; // left by an earlier thread, not this one's scan
      stopAt = index;
      const [where, pattern] = regexes[index];
      const text = adversarial(pattern)[fixture] ?? "";
      report.failures.push({
        kind: "deadline", where, fixture, cpuMs: used, deadlineMs,
        short: `still running after ${deadlineMs} CPU ms on one scan, so it was stopped`,
        detail: `${where}: a scan of ${chars.toLocaleString("en-US")} characters was still running after ` +
          `${used.toFixed(0)} CPU ms and was stopped (deadline ${deadlineMs} CPU ms` +
          `${deadlineMs === DEADLINE_FACTOR * ceilingMs ? ", twice the ceiling" : ""}; ` +
          `exponential backtracking never finishes); fixture ${fixture}, ${preview(text)}`,
      });
      report.timings.push([used, where, NaN]);
      report.measured++;
      finish(index + 1);
    }, POLL_MS);
    worker.on("message", (message) => {
      if (message.type === "done") {
        finish(regexes.length);
        return;
      }
      if (message.type === "fatal") {
        fail(new GuardError(message.message));
        return;
      }
      if (message.type === "clock") {
        // Each thread measures the clock when it starts; the report keeps the coarsest.
        if (report.resolutionMs === null || message.resolutionMs > report.resolutionMs) {
          report.resolutionMs = message.resolutionMs;
          report.resolutionSteps = message.steps;
          report.sampleTargetMs = message.targetMs;
        }
        return;
      }
      if (message.index >= stopAt) return;
      report.measured++;
      for (const key of ["strings", "probed", "fullProbes", "rechecked", "scans", "retakes", "capped"]) report[key] += message[key];
      report.maxSampleMs = Math.max(report.maxSampleMs, message.maxSampleMs);
      report.longestSampleMs = Math.max(report.longestSampleMs, message.longestMs);
      if (message.worstReading !== null && (report.worstReading === null || message.worstGrowth > report.worstGrowth)) {
        // The reading of the string with the most growth, for a log or a control.
        report.worstGrowth = message.worstGrowth;
        report.worstGrowthWhere = message.where;
        report.worstReading = message.worstReading;
      }
      for (const reps of message.reps) {
        // Fewest and most scans per growth timing, for the quarter, half and whole string (0: not timed).
        reps.forEach((n, i) => {
          if (n > 0) report.reps[i] = report.reps[i] === null ? [n, n] : [Math.min(report.reps[i][0], n), Math.max(report.reps[i][1], n)];
        });
      }
      report.timings.push([message.worstMs, message.where, message.worstWallMs]);
      if (message.failure !== null) {
        report.failures.push(message.failure);
        if (report.failures.length >= MAX_FAILED_REGEXES) {
          stopAt = message.index + 1;
          finish(regexes.length);
        }
      }
    });
    worker.on("error", (error) => {
      const where = regexes[Atomics.load(shared, REGEX)]?.[0] ?? "?";
      fail(new GuardError(`measuring thread failed at ${where}: ${error?.message ?? error}`));
    });
    worker.on("exit", (code) => {
      fail(new GuardError(`measuring thread exited early with code ${code}`));
    });
  });

  let next = 0;
  while (next < regexes.length && report.failures.length < MAX_FAILED_REGEXES) {
    next = await measureFrom(next);
  }
  report.unmeasured = regexes.length - report.measured;
  report.timings.sort((a, b) => b[0] - a[0]);
  report.elapsedMs = performance.now() - started;
  return report;
}

if (isMainThread) {
  let exitCode;
  try {
    const report = await supervise();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    exitCode = report.failures.length === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof GuardError ? error.message : String(error?.stack ?? error);
    process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    exitCode = 2;
  }
  // Exit once stdout is flushed. Every thread has stopped by now; the timer
  // only guards against a stray handle keeping the process alive.
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 5000).unref();
} else {
  measureAll(workerData);
}
