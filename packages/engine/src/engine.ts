/**
 * The rule engine: a port of src/biasclear/_engine.py with the same results.
 *
 * Deterministic and synchronous. No network, no storage, no globals beyond
 * ECMAScript itself, no eval. The rule pack is compiled into the bundle.
 *
 * The bundled rules are compiled when a scan first needs them, one rule at a
 * time. `prepare()` does the same work ahead of time, one pattern per call, so
 * a page can spread it over several short tasks instead of one long one.
 */

import { PACK_JSON, RULES_HASH } from "./generated/pack.js";
import { translate } from "./regex.js";
import { Offsets, codePointLength, findCodePoints, nextCodePoint } from "./text.js";
import type {
  Domain,
  Move,
  RegexFlags,
  RuleDomain,
  RulePack,
  ScanOptions,
  ScanResult,
  Severity,
  Tier,
  TierCounts,
} from "./types.js";

/** Longest accepted input, in characters (Unicode code points), as in Python. */
export const MAX_INPUT_CHARS = 200_000;

/** Accepted `domain` values. `undefined` or `null` means `"general"`. */
export const DOMAINS: readonly Domain[] = Object.freeze([
  "general",
  "legal",
  "media",
  "financial",
  "all",
] as const);

interface Indicator {
  /** The translated pattern with the `g` flag, for finding every match. */
  readonly all: RegExp;
  /**
   * Only for a pattern that can match the empty string: finds, at one
   * position, the first match (in backtracking order) that isn't empty.
   * `(?=([^]*))` captures the rest of the input; `(?!\1)` then fails unless
   * the match moved past its start.
   */
  readonly nonEmpty: RegExp | undefined;
}

/** Something `prepare` can ready one step at a time. */
interface Warmable {
  readonly warm: boolean;
  warmNext(): void;
}

/** Patterns in the pack's syntax, each translated and compiled on first use. */
class Patterns<T> implements Warmable {
  private readonly compiled: Array<T | undefined>;
  private all: readonly T[] | undefined;
  /** How many patterns `warmNext` has readied, in order. */
  private warmed = 0;

  constructor(
    private readonly sources: readonly string[],
    private readonly flags: RegexFlags,
    private readonly compileOne: (pattern: string, flags: RegexFlags) => T,
    private readonly regexesOf: (item: T) => ReadonlyArray<RegExp | undefined>,
  ) {
    this.compiled = new Array<T | undefined>(sources.length);
  }

  private at(i: number): T {
    let item = this.compiled[i];
    if (item === undefined) {
      item = this.compileOne(this.sources[i] as string, this.flags);
      this.compiled[i] = item;
    }
    return item;
  }

  get(): readonly T[] {
    if (this.all === undefined) {
      const items: T[] = [];
      for (let i = 0; i < this.sources.length; i++) items.push(this.at(i));
      this.all = items;
    }
    return this.all;
  }

  get warm(): boolean {
    return this.warmed === this.sources.length;
  }

  /** Compile the next pattern not yet readied and run it on the warm-up texts. */
  warmNext(): void {
    for (const re of this.regexesOf(this.at(this.warmed))) if (re !== undefined) warmRegex(re);
    this.warmed++;
  }
}

interface Rule {
  readonly order: number;
  readonly id: string;
  readonly name: string;
  readonly tier: Tier;
  readonly domain: RuleDomain;
  readonly severity: Severity;
  readonly indicators: Patterns<Indicator>;
  readonly minMatches: number;
  readonly suppressIfCited: boolean;
}

/** A compiled rule pack. Exported for tests; use `scan`. */
export interface Engine {
  readonly rulesVersion: string;
  readonly rulesHash: string;
  readonly rules: readonly Rule[];
  /** Global (`g`) regexes: `isCited` walks every match with `exec`. */
  readonly citationPatterns: Patterns<RegExp>;
  readonly citationWindow: number;
}

function compileIndicator(pattern: string, flags: string): Indicator {
  const { source, minWidth } = translate(pattern, flags);
  return {
    all: new RegExp(source, "gu"),
    nonEmpty: minWidth === 0 ? new RegExp(`(?=([^]*))(?:${source})(?!\\1)`, "yu") : undefined,
  };
}

function compileCitation(pattern: string, flags: string): RegExp {
  return new RegExp(translate(pattern, flags).source, "gu");
}

/**
 * Compile a rule pack. Exported for tests; `scan` uses the bundled pack.
 * With `lazy`, each rule's regexes are translated and compiled when a scan
 * first needs them; otherwise all of them now, so a bad pattern throws here.
 */
export function compileEngine(pack: RulePack, rulesHash: string, { lazy = false } = {}): Engine {
  const cs = pack.citation_suppression;
  const engine: Engine = {
    rulesVersion: pack.rules_version,
    rulesHash,
    rules: pack.rules.map((r, order) => ({
      order,
      id: r.id,
      name: r.name,
      tier: r.pit_tier,
      domain: r.domain,
      severity: r.severity,
      indicators: new Patterns(r.indicators, r.flags, compileIndicator, (i) => [i.all, i.nonEmpty]),
      minMatches: r.min_matches,
      suppressIfCited: r.suppress_if_cited,
    })),
    citationPatterns: new Patterns(cs.patterns, cs.flags, compileCitation, (re) => [re]),
    citationWindow: cs.window,
  };
  if (!lazy) {
    for (const rule of engine.rules) rule.indicators.get();
    engine.citationPatterns.get();
  }
  return engine;
}

let bundled: Engine | undefined;

function bundledEngine(): Engine {
  bundled ??= compileEngine(JSON.parse(PACK_JSON) as RulePack, RULES_HASH, { lazy: true });
  return bundled;
}

/** Whether a scan in `domain` runs `rule`. */
function runs(rule: Rule, domain: Domain): boolean {
  return domain === "all" || rule.domain === "general" || rule.domain === domain;
}

// Short texts, one of Latin-1 characters only and one with a character
// outside it: a JavaScript engine may compile a regex separately for each
// kind of string, and again, faster, once it has run a few times.
const WARM_TEXTS = [
  "Everyone knows it works. Studies show (Smith, 2024) it is so.",
  "Everyone knows it works. Studies show (Smith, 2024) it is \u201cso\u201d.",
];

function warmRegex(re: RegExp): void {
  for (const text of WARM_TEXTS) {
    for (let run = 0; run < 2; run++) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        if (m[0].length === 0) re.lastIndex = nextCodePoint(text, m.index);
        if (re.lastIndex >= text.length) break;
      }
    }
  }
  re.lastIndex = 0;
}

/**
 * Get the rules a scan with `options` runs ready ahead of time, one pattern
 * per call: translate it, compile it and run it on two short texts, so that
 * the first real `scan` is fast. The citation patterns come last.
 *
 * Optional: `scan` compiles whatever it needs by itself, and gives the same
 * result either way. A page calls this in idle time, one call per task,
 * until it returns `true`, to spread the work over short tasks.
 *
 * @returns `true` once every rule for these options is ready (the call that
 *   readies the last one returns `true`); `false` while any remain.
 * @throws RangeError if `domain` is unknown.
 */
export function prepare(options?: ScanOptions | null): boolean {
  const domain = checkDomain(options);
  const engine = bundledEngine();
  const next = (): Warmable | undefined => {
    const rule = engine.rules.find((r) => runs(r, domain) && !r.indicators.warm);
    if (rule !== undefined) return rule.indicators;
    return engine.citationPatterns.warm ? undefined : engine.citationPatterns;
  };
  const patterns = next();
  if (patterns === undefined) return true;
  patterns.warmNext();
  return next() === undefined;
}

/** A fresh copy of the bundled rule pack (keys in canonical order). */
export function rulePack(): RulePack {
  return JSON.parse(PACK_JSON) as RulePack;
}

/**
 * Every non-empty match of one indicator, appended to `spans` as
 * [start, end] pairs of UTF-16 indices. Iterates as Python's `finditer`
 * does: after an empty match at p, the next match may still start at p if
 * it is not empty.
 */
function collect(indicator: Indicator, text: string, spans: number[]): void {
  const { all, nonEmpty } = indicator;
  all.lastIndex = 0;
  for (;;) {
    const m = all.exec(text);
    if (m === null) return;
    const start = m.index;
    const end = start + m[0].length;
    if (end > start) {
      spans.push(start, end); // lastIndex is already `end`
      continue;
    }
    // An empty match: never reported or counted.
    if (nonEmpty !== undefined) {
      nonEmpty.lastIndex = start;
      const n = nonEmpty.exec(text);
      if (n !== null) {
        spans.push(start, start + n[0].length);
        all.lastIndex = start + n[0].length;
        continue;
      }
    }
    if (start >= text.length) return;
    all.lastIndex = nextCodePoint(text, start);
  }
}

/** Sort by start, then longest first; keep a span only if it starts at or after the last kept end. */
function dropOverlaps(spans: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < spans.length; k += 2) pairs.push([spans[k] as number, spans[k + 1] as number]);
  pairs.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const kept: Array<[number, number]> = [];
  let lastEnd = -1;
  for (const pair of pairs) {
    if (pair[0] >= lastEnd) {
      kept.push(pair);
      lastEnd = pair[1];
    }
  }
  return kept;
}

/**
 * How far past the citation window a citation that starts or ends inside it
 * may run, in code points. Python's `CITATION_REACH`.
 */
export const CITATION_REACH = 1000;

/**
 * Port of Python's `_has_nearby_citation`, in code points.
 *
 * As in v1, it finds the *first* case-insensitive occurrence of the fragment
 * in the whole text (lowercase both, then a plain substring search), which
 * can be an earlier copy than the match itself, and takes `window` code
 * points on each side. As in Python, the index found in the lowercased text
 * is used as an index into the original text, even where lowercasing changed
 * the length (U+0130 lowercases to two code points). Since rules version
 * 2.0.0a2 (E3) a citation counts when any part of it falls inside that
 * window: the search runs over the window plus `CITATION_REACH` code points
 * on each side, so a long name inside a citation does not push it out.
 */
class CitationLookup {
  private readonly lower: string;
  private readonly lowerOffsets: Offsets;
  private readonly textOffsets: Offsets;

  constructor(
    private readonly engine: Engine,
    private readonly text: string,
  ) {
    this.lower = text.toLowerCase();
    this.lowerOffsets = new Offsets(this.lower);
    this.textOffsets = new Offsets(text);
  }

  isCited(fragment: string): boolean {
    const found = findCodePoints(this.lower, fragment.toLowerCase());
    if (found === -1) return false;
    const idx = this.lowerOffsets.codePoints(found);
    const reach = this.engine.citationWindow;
    const length = this.textOffsets.length;
    const start = Math.max(0, idx - reach);
    const end = Math.min(length, idx + codePointLength(fragment) + reach);
    const base = this.textOffsets.units(Math.max(0, start - CITATION_REACH));
    const context = this.text.slice(base, this.textOffsets.units(Math.min(length, end + CITATION_REACH)));
    // UTF-16 offsets into `context`; comparing them orders code points the same way.
    const lo = this.textOffsets.units(start) - base;
    const hi = this.textOffsets.units(end) - base;
    for (const p of this.engine.citationPatterns.get()) {
      p.lastIndex = 0;
      for (let m = p.exec(context); m !== null; m = p.exec(context)) {
        if (m.index >= hi) break;
        if (m.index + m[0].length > lo) return true;
        if (m[0].length === 0) p.lastIndex = nextCodePoint(context, m.index);
      }
    }
    return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" || typeof value === "function") return typeof value;
  return String(value);
}

function checkDomain(options: ScanOptions | null | undefined): Domain {
  if (options === undefined || options === null) return "general";
  if (typeof options !== "object") {
    throw new TypeError(`options must be an object, not ${typeof options}`);
  }
  const domain: unknown = options.domain;
  if (domain === undefined || domain === null) return "general";
  if (typeof domain !== "string" || !(DOMAINS as readonly string[]).includes(domain)) {
    throw new RangeError(`unknown domain ${describe(domain)}; expected one of ${DOMAINS.join(", ")}`);
  }
  return domain as Domain;
}

interface Found {
  readonly start: number;
  readonly end: number;
  readonly rule: Rule;
}

/** `scan` against a given engine. Exported for tests; use `scan`. */
export function scanWith(engine: Engine, text: string, options?: ScanOptions | null): ScanResult {
  if (typeof text !== "string") {
    throw new TypeError(`text must be a string, not ${describe(text)}`);
  }
  // A code point is one or two UTF-16 units, so only a string between the
  // limit and twice the limit needs counting.
  if (text.length > MAX_INPUT_CHARS) {
    const n = codePointLength(text);
    if (n > MAX_INPUT_CHARS) {
      throw new RangeError(`text is ${n} characters; the limit is ${MAX_INPUT_CHARS}`);
    }
  }
  const domain = checkDomain(options);

  let citations: CitationLookup | undefined;
  const found: Found[] = [];
  for (const rule of engine.rules) {
    if (!runs(rule, domain)) continue;
    const spans: number[] = [];
    for (const indicator of rule.indicators.get()) collect(indicator, text, spans);
    // min_matches counts every match from every indicator, as v1 did.
    if (spans.length / 2 < rule.minMatches) continue;
    if (rule.suppressIfCited) {
      citations ??= new CitationLookup(engine, text);
      let allCited = true;
      for (let k = 0; k < spans.length && allCited; k += 2) {
        allCited = citations.isCited(text.slice(spans[k], spans[k + 1]));
      }
      if (allCited) continue;
    }
    for (const [start, end] of dropOverlaps(spans)) found.push({ start, end, rule });
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end || a.rule.order - b.rule.order);
  const counts: TierCounts = { "1": 0, "2": 0, "3": 0 };
  const moves: Move[] = found.map(({ start, end, rule }) => {
    counts[String(rule.tier) as keyof TierCounts] += 1;
    return {
      ruleId: rule.id,
      name: rule.name,
      tier: rule.tier,
      domain: rule.domain,
      severity: rule.severity,
      start,
      end,
      match: text.slice(start, end),
    };
  });
  return { rulesVersion: engine.rulesVersion, rulesHash: engine.rulesHash, moves, counts };
}

/**
 * Scan `text` and name the structural moves it makes.
 *
 * @param text At most `MAX_INPUT_CHARS` code points.
 * @param options `domain`: `"general"` (the default) for the general rules
 *   only; `"legal"`, `"media"` or `"financial"` to add that domain's rules;
 *   `"all"` for every rule.
 * @returns The rules version and hash, the moves (with UTF-16 `start` and
 *   `end`, so `match === text.slice(start, end)`), and per-tier counts.
 * @throws TypeError if `text` is not a string or `options` is not an object.
 * @throws RangeError if `text` is too long or `domain` is unknown.
 */
export function scan(text: string, options?: ScanOptions | null): ScanResult {
  return scanWith(bundledEngine(), text, options);
}
