// The one module that writes log lines, and the only file in src/ allowed to
// use `console` (test/lint.test.ts checks this).
//
// A log line holds a fixed set of fields: numbers, and strings from fixed
// lists. The sentence, the answer, the IP address, its hash, the user agent,
// error messages and stacks never appear. Values that come from a request
// (the rule id and the rules version) are logged only when they equal a value
// the function already knows; anything else is logged as "other".

import { CODES, OUTCOMES, PLAINER_STATES, type Code, type Outcome, type PlainerState } from "./codes.js";

export interface LogLine {
  outcome: Outcome;
  status: number;
  ms: number;
  code?: Code | undefined;
  rule?: string | undefined;
  rules?: string | undefined;
  model?: string | undefined;
  inTok?: number | undefined;
  outTok?: number | undefined;
  micros?: number | undefined;
  overrun?: 0 | 1 | undefined;
  reservedMicros?: number | undefined;
  actualMicros?: number | undefined;
  pausePersisted?: 0 | 1 | undefined;
  billedBoundViolated?: 0 | 1 | undefined;
  plainer?: PlainerState | undefined;
  evaluation?: 1 | undefined;
}

export type LogSink = (line: string) => void;

/** Names the logger will write as they are; anything else becomes "other". */
export interface KnownValues {
  rules: ReadonlySet<string>;
  rulesVersions: ReadonlySet<string>;
  models: ReadonlySet<string>;
}

const OUTCOME_SET: ReadonlySet<string> = new Set(OUTCOMES);
const CODE_SET: ReadonlySet<string> = new Set(CODES);
const PLAINER_SET: ReadonlySet<string> = new Set(PLAINER_STATES);

function count(n: number | undefined): number | undefined {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= -1e12 && n <= 1e12 ? n : undefined;
}

function known(value: string | undefined, set: ReadonlySet<string>): string | undefined {
  if (value === undefined) return undefined;
  return set.has(value) ? value : "other";
}

/** The JSON text of one log line, with every field checked against its fixed list. */
export function formatLine(line: LogLine, knownValues: KnownValues): string {
  const out: Record<string, string | number> = {
    outcome: OUTCOME_SET.has(line.outcome) ? line.outcome : "other",
    status: count(line.status) ?? 0,
    ms: count(line.ms) ?? 0,
  };
  if (line.code !== undefined) out.code = CODE_SET.has(line.code) ? line.code : "E_INTERNAL";
  const rule = known(line.rule, knownValues.rules);
  if (rule !== undefined) out.rule = rule;
  const rules = known(line.rules, knownValues.rulesVersions);
  if (rules !== undefined) out.rules = rules;
  const model = known(line.model, knownValues.models);
  if (model !== undefined) out.model = model;
  for (const key of ["inTok", "outTok", "micros", "actualMicros", "reservedMicros"] as const) {
    const v = count(line[key]);
    if (v !== undefined) out[key] = v;
  }
  if (line.overrun === 1) out.overrun = 1;
  if (line.billedBoundViolated === 1) out.billedBoundViolated = 1;
  if (line.pausePersisted === 0 || line.pausePersisted === 1) out.pausePersisted = line.pausePersisted;
  if (line.plainer !== undefined && PLAINER_SET.has(line.plainer)) out.plainer = line.plainer;
  if (line.evaluation === 1) out.evaluation = 1;
  return JSON.stringify(out);
}

/** Writes one line to the function's log group. Never throws. */
export const consoleSink: LogSink = (text) => {
  try {
    console.log(text);
  } catch {
    // A log line is not worth failing a request over.
  }
};

export function makeLogger(sink: LogSink, knownValues: KnownValues): (line: LogLine) => void {
  return (line) => {
    try {
      sink(formatLine(line, knownValues));
    } catch {
      // Never let logging throw into the request path.
    }
  };
}
