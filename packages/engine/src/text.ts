/**
 * Code point helpers. Python counts and slices strings in code points;
 * JavaScript indexes UTF-16 units. A character outside the Basic
 * Multilingual Plane (most emoji) is one code point and two UTF-16 units.
 * A lone surrogate counts as one of each, in both languages.
 */

const SURROGATE = /[\uD800-\uDFFF]/;

function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLow(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** True when index `i` falls between the two halves of a surrogate pair. */
function splitsPair(s: string, i: number): boolean {
  return i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i));
}

/** Python's `len(s)`. */
export function codePointLength(s: string): number {
  if (!SURROGATE.test(s)) return s.length;
  let n = s.length;
  for (let i = 1; i < s.length; i++) {
    if (splitsPair(s, i)) {
      n--;
      i++;
    }
  }
  return n;
}

/** The UTF-16 index just past the code point that starts at `i`. */
export function nextCodePoint(s: string, i: number): number {
  return splitsPair(s, i + 1) ? i + 2 : i + 1;
}

/**
 * Python's `haystack.find(needle)`, returned as a UTF-16 index: the first
 * occurrence that starts and ends on code point boundaries, or -1.
 */
export function findCodePoints(haystack: string, needle: string): number {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1 || (!splitsPair(haystack, i) && !splitsPair(haystack, i + needle.length))) {
      return i;
    }
    from = i + 1;
  }
}

/**
 * Converts between UTF-16 indices and code point indices of one string.
 * Both tables are null when the string has no surrogates (then the two
 * kinds of index are equal).
 */
export class Offsets {
  /** Number of code points in the string. */
  readonly length: number;
  /** UTF-16 index of each code point index, 0..length inclusive. */
  private readonly toUnits: Uint32Array | null;
  /** Code point index of each UTF-16 index, 0..s.length inclusive. */
  private readonly toPoints: Uint32Array | null;

  constructor(s: string) {
    if (!SURROGATE.test(s)) {
      this.length = s.length;
      this.toUnits = null;
      this.toPoints = null;
      return;
    }
    const toUnits = new Uint32Array(s.length + 1);
    const toPoints = new Uint32Array(s.length + 1);
    let cp = 0;
    for (let i = 0; i < s.length; cp++) {
      const next = nextCodePoint(s, i);
      toUnits[cp] = i;
      for (let j = i; j < next; j++) toPoints[j] = cp;
      i = next;
    }
    toUnits[cp] = s.length;
    toPoints[s.length] = cp;
    this.length = cp;
    this.toUnits = toUnits.subarray(0, cp + 1);
    this.toPoints = toPoints;
  }

  /** UTF-16 index of code point index `cp`, clamped to the string as a Python slice is. */
  units(cp: number): number {
    const c = Math.max(0, Math.min(cp, this.length));
    return this.toUnits === null ? c : (this.toUnits[c] as number);
  }

  /** Code point index of a UTF-16 index on a code point boundary. */
  codePoints(unit: number): number {
    return this.toPoints === null ? unit : (this.toPoints[unit] as number);
  }
}
