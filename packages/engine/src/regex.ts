/**
 * Translate a rule-pack regex into a JavaScript RegExp source that behaves
 * like Python's `re` does on the same pattern and text.
 *
 * The pack's regexes are written in Python `re` syntax, restricted to the
 * subset that tests/test_regex_subset.py checks. The syntax is shared with
 * JavaScript, but a few meanings are not, so this module rewrites them:
 *
 * - `\w`, `\b`, `\B` and `\d` are Unicode-aware in Python (`\w` is any
 *   letter or number, plus `_`; `\d` is any decimal digit). JavaScript's are
 *   ASCII-only. They become Unicode property classes and lookarounds.
 * - `\s` is Python's `str.isspace()` set, which includes U+001C to U+001F
 *   and U+0085 and excludes U+FEFF. It becomes an explicit class.
 * - The `i` flag is expanded by hand instead of using JavaScript's `i`:
 *   Python also matches U+0130 and U+0131 for `i`, U+017F for `s` and
 *   U+212A for `k`, and JavaScript's case folding differs on the first two.
 *   A cased non-ASCII character under `i` is rejected rather than guessed.
 * - `.` becomes "any code point" (`s` flag) or "anything but `\n`"; `$`
 *   becomes Python's "end, or before a final `\n`".
 * - The result is used with the `u` flag only, so quantifiers, `.` and
 *   lookbehind count code points, as Python does, not UTF-16 units.
 *
 * Anything outside the subset (named groups, backreferences, inline flags,
 * possessive quantifiers, unknown escapes) throws, so a new construct in the
 * pack fails the build instead of silently meaning something else.
 *
 * Speed. A lookaround test of `[\p{L}\p{N}_]` is slow on characters outside
 * the BMP, and a pattern that starts with one hides its first letters from
 * the regex engine's fast scan. So, where it means the same thing:
 * - `\b` next to something that must start (or end) with a word character
 *   becomes a single lookbehind (or lookahead): if the next character is
 *   certainly a word character, "boundary" just means "the previous one is
 *   not";
 * - neighbouring assertions are reordered so the cheap ones run first
 *   (assertions at the same position commute);
 * - a pattern whose first character comes from a small known set gets a
 *   lookahead for that set in front.
 * `translate(pattern, flags, { optimize: false })` skips all three; the
 * tests check that both forms find the same matches.
 *
 * Size. V8 stops optimizing a regex whose source is longer than 20 KB and
 * runs it several times slower, so literals are written as short as they
 * can be (see `literal`), with or without the rewrites.
 */

/** Python `\w`: `str.isalnum()` or `_`, which is exactly L, N and `_`. */
const WORD = "\\p{L}\\p{N}_";
/** Python `\d`: `str.isdecimal()`, which is exactly Nd. */
const DIGIT = "\\p{Nd}";
/** Python `\s`: `str.isspace()`. */
const SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const IS_WORD = `[${WORD}]`;
const BOUNDARY = `(?:(?<=${IS_WORD})(?!${IS_WORD})|(?<!${IS_WORD})(?=${IS_WORD}))`;
// On an empty input, Python 3.14's \B matches and earlier versions' doesn't;
// this one does. That only matters to a pattern that can match the empty
// string, and the pack has none (test/regex.test.ts checks).
const NON_BOUNDARY = `(?:(?<=${IS_WORD})(?=${IS_WORD})|(?<!${IS_WORD})(?!${IS_WORD}))`;
const NOT_AFTER_WORD = `(?<!${IS_WORD})`;
const NOT_BEFORE_WORD = `(?!${IS_WORD})`;
const IS_WORD_CHAR = new RegExp(`^${IS_WORD}$`, "u");

/**
 * Characters Python's IGNORECASE matches for an ASCII letter besides its two
 * cases: U+0130 and U+0131 for i (lowercase of U+0130 starts with "i", and
 * `re` treats U+0131 as equivalent), U+212A KELVIN SIGN for k, U+017F LONG S
 * for s. Checked against Python for every code point by scripts/parity.mjs.
 */
const CASE_EXTRAS: Readonly<Record<string, readonly number[]>> = {
  i: [0x130, 0x131],
  k: [0x212a],
  s: [0x17f],
};

/** Largest first-character set worth a lookahead. */
const MAX_FIRST_SET = 128;

export interface Translation {
  /** JavaScript RegExp source; compile it with the `u` flag (plus `g` or `y`). */
  readonly source: string;
  /** Fewest code points a match can span. 0 means it can match the empty string. */
  readonly minWidth: number;
}

export interface TranslateOptions {
  /** Apply the speed rewrites described above (default true). */
  optimize?: boolean;
}

export class PatternError extends Error {
  constructor(pattern: string, position: number, message: string) {
    super(`${message} at position ${position} in rule-pack regex ${JSON.stringify(pattern)}`);
    this.name = "PatternError";
  }
}

/**
 * Translate `pattern` (Python `re` syntax) with pack flags `flags` (a subset
 * of "is") into a JavaScript source for the `u` flag.
 */
export function translate(pattern: string, flags: string, options: TranslateOptions = {}): Translation {
  for (const f of flags) {
    if (f !== "i" && f !== "s") {
      throw new PatternError(pattern, 0, `unsupported regex flag ${JSON.stringify(f)}`);
    }
  }
  const optimize = options.optimize ?? true;
  const parser = new Parser(pattern, flags.includes("i"), flags.includes("s"), optimize);
  const top = parser.parse();
  let source = top.source;
  const first = top.first.points;
  if (optimize && top.minWidth > 0 && first !== null && first.size > 0 && first.size <= MAX_FIRST_SET) {
    source = `(?=${classOf(first)})(?:${source})`;
  }
  try {
    new RegExp(source, "u");
  } catch (err) {
    throw new PatternError(pattern, 0, `translation did not compile (${String(err)})`);
  }
  return { source, minWidth: top.minWidth };
}

/**
 * What can start a match: `points` lists every possible first character
 * (null when there are too many to list), and `word` says whether each one
 * is a word character. Only non-empty matches count.
 */
interface First {
  points: Set<number> | null;
  word: boolean;
}

const NO_FIRST: First = { points: new Set(), word: true };
const ANY_FIRST: First = { points: null, word: false };
const WORD_FIRST: First = { points: null, word: true };

function union(a: First, b: First): First {
  return {
    points: a.points === null || b.points === null ? null : new Set([...a.points, ...b.points]),
    word: a.word && b.word,
  };
}

interface Node {
  source: string;
  minWidth: number;
  /** Zero-width: matches a position, consumes nothing. */
  assertion: boolean;
  /** A `\b`, written out once its neighbours are known. */
  boundary: boolean;
  /** Cheap to test (a single lookaround of one class); runs first in a run of assertions. */
  cheap: boolean;
  first: First;
  /** Every non-empty match ends with a word character. */
  lastWord: boolean;
}

interface Parsed {
  source: string;
  minWidth: number;
  first: First;
  lastWord: boolean;
}

type ClassAtom = { kind: "char"; cp: number } | { kind: "escape"; inline?: string; negated?: string };

interface ClassItems {
  /** Single code points, after case expansion. */
  points: Set<number>;
  /** Inclusive ranges kept as ranges (no case expansion needed). */
  ranges: Array<[number, number]>;
  /** Class-escape contents that fit inside a JavaScript class. */
  inline: string[];
  /** Negated escapes (\W, \S), which need an alternation. */
  negated: string[];
}

const HEX = /^[0-9A-Fa-f]+$/;

/**
 * One code point as an escape, in the shortest form that means exactly that
 * code point under the `u` flag. Surrogates keep the braced form, because
 * two neighbouring `\uHHHH` escapes of a surrogate pair would read as one
 * code point.
 */
function hex(cp: number): string {
  if (cp <= 0xff) return `\\x${cp.toString(16).padStart(2, "0")}`;
  if (cp <= 0xffff && (cp < 0xd800 || cp > 0xdfff)) return `\\u${cp.toString(16).padStart(4, "0")}`;
  return `\\u{${cp.toString(16)}}`;
}

/** Letters and numbers in the BMP: never regex syntax, safe to write as themselves. */
const PLAIN_CHAR = /^[\p{L}\p{N}]$/u;

/**
 * A code point as a literal, in or out of a class. Letters and numbers are
 * written as themselves, everything else as an escape. This keeps the source
 * short: V8 stops optimizing a regex whose source is longer than 20 KB
 * (`kRegExpTooLargeToOptimize`), and such a regex runs several times slower.
 * `[Aa]` is 4 characters, where `[\u{41}\u{61}]` is 15, and a class of
 * accented capitals ("Ā", "Ă", "Ą", ...) takes one character per letter.
 */
function literal(cp: number): string {
  if ((cp >= 0x30 && cp <= 0x39) || isAsciiLetter(cp)) return String.fromCharCode(cp);
  if (cp >= 0x80 && cp <= 0xffff && (cp < 0xd800 || cp > 0xdfff) && PLAIN_CHAR.test(String.fromCharCode(cp))) {
    return String.fromCharCode(cp);
  }
  return hex(cp);
}

function classOf(points: Iterable<number>): string {
  return `[${[...points].sort((a, b) => a - b).map(literal).join("")}]`;
}

function isAsciiLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

function isWordChar(cp: number): boolean {
  return IS_WORD_CHAR.test(String.fromCodePoint(cp));
}

/** True when neither lowercasing nor uppercasing changes the character. */
function isCaseless(cp: number): boolean {
  const s = String.fromCodePoint(cp);
  return s.toLowerCase() === s && s.toUpperCase() === s;
}

/** Every character Python's IGNORECASE treats as equal to `cp`. */
function caseVariants(cp: number, pattern: string, position: number): number[] {
  if (isAsciiLetter(cp)) {
    const lower = cp | 0x20;
    const extras = CASE_EXTRAS[String.fromCharCode(lower)] ?? [];
    return [lower, lower - 0x20, ...extras];
  }
  if (cp < 0x80 || isCaseless(cp)) return [cp];
  throw new PatternError(
    pattern,
    position,
    `cased non-ASCII character U+${cp.toString(16).toUpperCase().padStart(4, "0")} under the i flag is not supported`,
  );
}

function assertionNode(source: string, cheap = false): Node {
  return { source, minWidth: 0, assertion: true, boundary: false, cheap, first: NO_FIRST, lastWord: true };
}

function consuming(source: string, first: First): Node {
  return { source, minWidth: 1, assertion: false, boundary: false, cheap: false, first, lastWord: first.word };
}

/** First characters of a sequence of nodes, and whether it can match empty. */
function firstOf(nodes: readonly Node[]): { first: First; nullable: boolean } {
  let first = NO_FIRST;
  for (const node of nodes) {
    if (node.assertion) continue;
    first = union(first, node.first);
    if (node.minWidth > 0) return { first, nullable: false };
  }
  return { first, nullable: true };
}

/** Whether every non-empty match of a sequence ends with a word character. */
function lastWordOf(nodes: readonly Node[]): { word: boolean; nullable: boolean } {
  let word = true;
  for (let k = nodes.length - 1; k >= 0; k--) {
    const node = nodes[k] as Node;
    if (node.assertion) continue;
    word &&= node.lastWord;
    if (node.minWidth > 0) return { word, nullable: false };
  }
  return { word, nullable: true };
}

class Parser {
  private readonly cps: number[];
  private pos = 0;

  constructor(
    private readonly pattern: string,
    private readonly ignoreCase: boolean,
    private readonly dotAll: boolean,
    private readonly optimize: boolean,
  ) {
    this.cps = Array.from(pattern, (ch) => ch.codePointAt(0) as number);
  }

  parse(): Parsed {
    const result = this.alternation();
    if (this.pos < this.cps.length) this.fail("unbalanced parenthesis");
    return result;
  }

  private fail(message: string, position = this.pos): never {
    throw new PatternError(this.pattern, position, message);
  }

  private peek(offset = 0): number | undefined {
    return this.cps[this.pos + offset];
  }

  private is(ch: string, offset = 0): boolean {
    return this.peek(offset) === ch.codePointAt(0);
  }

  private startsWith(text: string): boolean {
    for (let k = 0; k < text.length; k++) {
      if (!this.is(text[k] as string, k)) return false;
    }
    return true;
  }

  private alternation(): Parsed {
    const branches = [this.sequence()];
    while (this.is("|")) {
      this.pos++;
      branches.push(this.sequence());
    }
    let first = NO_FIRST;
    for (const b of branches) first = union(first, b.first);
    return {
      source: branches.map((b) => b.source).join("|"),
      minWidth: Math.min(...branches.map((b) => b.minWidth)),
      first,
      lastWord: branches.every((b) => b.lastWord),
    };
  }

  private sequence(): Parsed {
    const nodes: Node[] = [];
    while (this.pos < this.cps.length && !this.is("|") && !this.is(")")) {
      const atomStart = this.pos;
      const atom = this.atom();
      const q = this.quantifier();
      if (q === null) {
        nodes.push(atom);
        continue;
      }
      if (atom.assertion) this.fail("quantifier after an assertion is not supported", atomStart);
      nodes.push({ ...atom, source: atom.source + q.source, minWidth: atom.minWidth * q.min });
    }
    const { first } = firstOf(nodes);
    const { word } = lastWordOf(nodes);
    return {
      source: this.emit(nodes),
      minWidth: nodes.reduce((sum, n) => sum + n.minWidth, 0),
      first,
      lastWord: word,
    };
  }

  /** Write out a sequence: resolve each `\b` from its neighbours, then order each run of assertions. */
  private emit(nodes: Node[]): string {
    const resolved = nodes.map((node, k): Node => {
      if (!node.boundary) return node;
      if (this.optimize) {
        const after = firstOf(nodes.slice(k + 1));
        if (!after.nullable && after.first.word) return assertionNode(NOT_AFTER_WORD, true);
        const before = lastWordOf(nodes.slice(0, k));
        if (!before.nullable && before.word) return assertionNode(NOT_BEFORE_WORD, true);
      }
      return assertionNode(BOUNDARY);
    });
    if (!this.optimize) return resolved.map((n) => n.source).join("");
    let source = "";
    for (let k = 0; k < resolved.length; ) {
      let end = k;
      while (end < resolved.length && (resolved[end] as Node).assertion) end++;
      if (end === k) {
        source += (resolved[k] as Node).source;
        k++;
        continue;
      }
      const run = resolved.slice(k, end);
      source += [...run.filter((n) => n.cheap), ...run.filter((n) => !n.cheap)].map((n) => n.source).join("");
      k = end;
    }
    return source;
  }

  /** Python's rules for `*`, `+`, `?` and `{m,n}`, then lazy `?`. */
  private quantifier(): { source: string; min: number } | null {
    let min: number;
    let max: number | null;
    if (this.is("*")) {
      this.pos++;
      [min, max] = [0, null];
    } else if (this.is("+")) {
      this.pos++;
      [min, max] = [1, null];
    } else if (this.is("?")) {
      this.pos++;
      [min, max] = [0, 1];
    } else if (this.is("{")) {
      const brace = this.braceQuantifier();
      if (brace === null) return null;
      [min, max] = brace;
    } else {
      return null;
    }
    let source =
      max === null
        ? min === 0 ? "*" : min === 1 ? "+" : `{${min},}`
        : min === 0 && max === 1 ? "?" : min === max ? `{${min}}` : `{${min},${max}}`;
    if (this.is("?")) {
      this.pos++;
      source += "?";
    } else if (this.is("+")) {
      this.fail("possessive quantifier is not supported");
    }
    if (this.is("*") || this.is("+") || this.is("?") || (this.is("{") && this.looksLikeBrace())) {
      this.fail("multiple repeat");
    }
    return { source, min };
  }

  private looksLikeBrace(): boolean {
    const save = this.pos;
    const brace = this.braceQuantifier();
    this.pos = save;
    return brace !== null;
  }

  /**
   * Python reads `{m}`, `{m,}`, `{,n}`, `{m,n}` and `{,}` as quantifiers and
   * any other `{` as a literal. Returns null (position unchanged) for a literal.
   */
  private braceQuantifier(): [number, number | null] | null {
    const start = this.pos;
    this.pos++; // "{"
    let lo = "";
    let hi = "";
    while (this.isDigit()) lo += String.fromCodePoint(this.cps[this.pos++] as number);
    let comma = false;
    if (this.is(",")) {
      comma = true;
      this.pos++;
      while (this.isDigit()) hi += String.fromCodePoint(this.cps[this.pos++] as number);
    } else {
      hi = lo;
    }
    if (!this.is("}") || (!comma && lo === "")) {
      this.pos = start;
      return null;
    }
    this.pos++; // "}"
    const min = lo === "" ? 0 : Number(lo);
    const max = hi === "" ? null : Number(hi);
    if (max !== null && max < min) this.fail("min repeat greater than max repeat", start);
    return [min, max];
  }

  private isDigit(): boolean {
    const c = this.peek();
    return c !== undefined && c >= 0x30 && c <= 0x39;
  }

  private atom(): Node {
    const start = this.pos;
    const c = this.cps[this.pos] as number;
    switch (String.fromCodePoint(c)) {
      case "(":
        return this.group();
      case "[":
        return this.characterClass();
      case "\\":
        return this.escape();
      case ".":
        this.pos++;
        return consuming(this.dotAll ? "[^]" : "[^\\n]", ANY_FIRST);
      case "^":
        this.pos++;
        return assertionNode("^");
      case "$":
        this.pos++;
        return assertionNode("(?=\\n?$)");
      case "*":
      case "+":
      case "?":
        return this.fail("nothing to repeat", start);
      case "{":
        if (this.looksLikeBrace()) this.fail("nothing to repeat", start);
        this.pos++;
        return this.char(c, start);
      default:
        this.pos++;
        return this.char(c, start);
    }
  }

  private char(cp: number, position: number): Node {
    const variants = this.ignoreCase ? caseVariants(cp, this.pattern, position) : [cp];
    const first: First = { points: new Set(variants), word: variants.every(isWordChar) };
    const source = variants.length === 1 ? literal(cp) : `[${variants.map(literal).join("")}]`;
    return consuming(source, first);
  }

  private group(): Node {
    const start = this.pos;
    let open: string;
    let assertion = false;
    if (this.startsWith("(?:")) {
      open = "(?:";
    } else if (this.startsWith("(?=") || this.startsWith("(?!")) {
      open = this.startsWith("(?=") ? "(?=" : "(?!";
      assertion = true;
    } else if (this.startsWith("(?<=") || this.startsWith("(?<!")) {
      open = this.startsWith("(?<=") ? "(?<=" : "(?<!";
      assertion = true;
    } else if (this.startsWith("(?")) {
      return this.fail("group syntax other than (?:, (?=, (?!, (?<= and (?<! is not supported", start);
    } else {
      // A capturing group: nothing reads its capture, so it is kept as a
      // plain group. That also keeps the engine's own \1 free.
      open = "(";
    }
    this.pos += open.length;
    const inner = this.alternation();
    if (!this.is(")")) this.fail("missing ), unterminated subpattern", start);
    this.pos++;
    const source = `${open === "(" ? "(?:" : open}${inner.source})`;
    if (assertion) return assertionNode(source);
    return {
      source,
      minWidth: inner.minWidth,
      assertion: false,
      boundary: false,
      cheap: false,
      first: inner.first,
      lastWord: inner.lastWord,
    };
  }

  /** An escape outside a class (Python `_escape`). */
  private escape(): Node {
    const start = this.pos;
    this.pos++; // "\"
    const c = this.peek();
    if (c === undefined) return this.fail("bad escape (end of pattern)", start);
    this.pos++;
    switch (String.fromCodePoint(c)) {
      case "b":
        return { ...assertionNode(BOUNDARY), boundary: true };
      case "B":
        return assertionNode(NON_BOUNDARY);
      case "A":
        return assertionNode("^");
      case "Z":
        return assertionNode("$");
      case "w":
        return consuming(IS_WORD, WORD_FIRST);
      case "W":
        return consuming(`[^${WORD}]`, ANY_FIRST);
      case "d":
        return consuming(DIGIT, WORD_FIRST);
      case "D":
        return consuming("\\P{Nd}", ANY_FIRST);
      case "s":
        return consuming(`[${SPACE}]`, ANY_FIRST);
      case "S":
        return consuming(`[^${SPACE}]`, ANY_FIRST);
      default:
        return this.char(this.escapedChar(c, start), start);
    }
  }

  /**
   * The character an escape stands for, for escapes that mean one character
   * (shared by escapes inside and outside classes).
   */
  private escapedChar(c: number, start: number): number {
    const ch = String.fromCodePoint(c);
    const controls: Record<string, number> = { a: 7, f: 12, n: 10, r: 13, t: 9, v: 11 };
    const control = controls[ch];
    if (control !== undefined) return control;
    if (ch === "x" || ch === "u" || ch === "U") {
      const width = ch === "x" ? 2 : ch === "u" ? 4 : 8;
      const digits = String.fromCodePoint(...this.cps.slice(this.pos, this.pos + width));
      if (digits.length !== width || !HEX.test(digits)) this.fail(`incomplete escape \\${ch}`, start);
      const cp = parseInt(digits, 16);
      if (cp > 0x10ffff) this.fail(`bad escape \\${ch}${digits}`, start);
      this.pos += width;
      return cp;
    }
    if ((c >= 0x30 && c <= 0x39) || (c < 0x80 && /[A-Za-z]/.test(ch))) {
      // Digits (backreferences, octal) and every other ASCII letter.
      return this.fail(`escape \\${ch} is not supported`, start);
    }
    return c;
  }

  /** A class (Python's `[` handling in `_parse`). */
  private characterClass(): Node {
    const start = this.pos;
    this.pos++; // "["
    let negate = false;
    if (this.is("^")) {
      negate = true;
      this.pos++;
    }
    const items: ClassItems = { points: new Set(), ranges: [], inline: [], negated: [] };
    const firstItem = this.pos;
    for (;;) {
      if (this.pos >= this.cps.length) this.fail("unterminated character set", start);
      if (this.is("]") && this.pos !== firstItem) {
        this.pos++;
        break;
      }
      const itemStart = this.pos;
      const lo = this.classAtom();
      if (this.is("-")) {
        this.pos++;
        if (this.pos >= this.cps.length) this.fail("unterminated character set", start);
        if (this.is("]")) {
          // "a-]": a literal hyphen at the end.
          this.addClassAtom(items, lo, itemStart);
          this.addPoint(items, 0x2d, itemStart);
          this.pos++;
          break;
        }
        const hi = this.classAtom();
        if (lo.kind !== "char" || hi.kind !== "char" || hi.cp < lo.cp) {
          this.fail("bad character range", itemStart);
        }
        this.addRange(items, lo.cp, hi.cp, itemStart);
      } else {
        this.addClassAtom(items, lo, itemStart);
      }
    }
    return consuming(this.emitClass(items, negate), this.classFirst(items, negate));
  }

  private classAtom(): ClassAtom {
    const start = this.pos;
    const c = this.cps[this.pos++] as number;
    if (c !== 0x5c) return { kind: "char", cp: c }; // not "\"
    const e = this.peek();
    if (e === undefined) return this.fail("bad escape (end of pattern)", start);
    this.pos++;
    switch (String.fromCodePoint(e)) {
      case "b":
        return { kind: "char", cp: 8 }; // backspace, as in Python
      case "w":
        return { kind: "escape", inline: WORD };
      case "d":
        return { kind: "escape", inline: DIGIT };
      case "D":
        return { kind: "escape", inline: "\\P{Nd}" };
      case "s":
        return { kind: "escape", inline: SPACE };
      case "W":
        return { kind: "escape", negated: WORD };
      case "S":
        return { kind: "escape", negated: SPACE };
      default:
        return { kind: "char", cp: this.escapedChar(e, start) };
    }
  }

  private addClassAtom(items: ClassItems, atom: ClassAtom, position: number): void {
    if (atom.kind === "char") {
      this.addPoint(items, atom.cp, position);
    } else if (atom.inline !== undefined) {
      items.inline.push(atom.inline);
    } else if (atom.negated !== undefined) {
      items.negated.push(atom.negated);
    }
  }

  private addPoint(items: ClassItems, cp: number, position: number): void {
    const variants = this.ignoreCase ? caseVariants(cp, this.pattern, position) : [cp];
    for (const v of variants) items.points.add(v);
  }

  private addRange(items: ClassItems, lo: number, hi: number, position: number): void {
    if (!this.ignoreCase) {
      items.ranges.push([lo, hi]);
      return;
    }
    // Under i every member needs its case variants. Walk the range; a range
    // that holds a cased non-ASCII character is rejected by caseVariants.
    if (hi - lo > 0xffff) this.fail("range too wide under the i flag", position);
    for (let cp = lo; cp <= hi; cp++) this.addPoint(items, cp, position);
  }

  /** The class's members as a first-character set, when they can be listed. */
  private classFirst(items: ClassItems, negate: boolean): First {
    if (negate || items.negated.length > 0) return ANY_FIRST;
    const word = items.inline.every((i) => i === WORD || i === DIGIT);
    let points: Set<number> | null = items.inline.length === 0 ? new Set(items.points) : null;
    for (const [lo, hi] of items.ranges) {
      if (points !== null && hi - lo < MAX_FIRST_SET) {
        for (let cp = lo; cp <= hi; cp++) points.add(cp);
      } else {
        points = null;
      }
    }
    const listed = points ?? items.points;
    const rangesWord = items.ranges.every(([lo, hi]) => hi - lo < MAX_FIRST_SET && allWord(lo, hi));
    return { points, word: word && rangesWord && [...listed].every(isWordChar) };
  }

  private emitClass(items: ClassItems, negate: boolean): string {
    const merged: Array<[number, number]> = [];
    for (const cp of [...items.points].sort((a, b) => a - b)) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last[1] + 1 === cp) last[1] = cp;
      else merged.push([cp, cp]);
    }
    const ranges = [...items.ranges, ...merged];
    const body =
      ranges.map(([lo, hi]) => (lo === hi ? literal(lo) : `${literal(lo)}-${literal(hi)}`)).join("") +
      items.inline.join("");
    if (items.negated.length === 0) return `[${negate ? "^" : ""}${body}]`;
    // \W or \S inside a class: a JavaScript class can't hold a complement, so
    // the class becomes an alternation of its parts.
    const parts = [...(body === "" ? [] : [`[${body}]`]), ...items.negated.map((n) => `[^${n}]`)];
    return negate ? `(?:(?!${parts.join("|")})[^])` : `(?:${parts.join("|")})`;
  }
}

function allWord(lo: number, hi: number): boolean {
  for (let cp = lo; cp <= hi; cp++) if (!isWordChar(cp)) return false;
  return true;
}
