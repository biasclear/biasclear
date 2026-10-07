// The request's shape and size (SPEC §3, §4 step 3). Every failure throws a
// CodedError with a fixed code; no message ever quotes the input.

import { CodedError } from "./codes.js";
import { DOMAINS, type Domain } from "./engines.js";
import { parseJsonOrUndefined } from "./json.js";
import { sentenceCount } from "./text.js";

/** Largest accepted request body, in bytes. */
export const MAX_BODY_BYTES = 4096;
/** Longest accepted sentence, in Unicode code points. */
export const MAX_SENTENCE_CHARS = 500;

export interface ExplainRequest {
  v: 1;
  rules: string;
  rule: string;
  domain: Domain;
  sentence: string;
  start: number;
  end: number;
}

const KEYS = ["domain", "end", "rule", "rules", "sentence", "start", "v"];

/**
 * C0 and C1 control characters other than tab, line feed and carriage
 * return; bidirectional embedding, override and isolate characters; Unicode
 * tag characters (a known way to hide text from people).
 */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{202A}-\u{202E}\u{2066}-\u{2069}]|[\u{E0000}-\u{E007F}]/u;

/** JSON.parse, but a failure throws only the fixed code E_PARSE (Node's own message quotes the input). */
export function parseJson(text: string): unknown {
  const value = parseJsonOrUndefined(text);
  if (value === undefined) throw new CodedError("E_PARSE");
  return value;
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

function splitsPair(s: string, i: number): boolean {
  return i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i));
}

export function validSentence(sentence: unknown): sentence is string {
  if (typeof sentence !== "string" || sentence.length === 0) return false;
  if (!sentence.isWellFormed()) return false;
  if (codePoints(sentence) > MAX_SENTENCE_CHARS) return false;
  if (FORBIDDEN.test(sentence)) return false;
  // Titles/initials/decimals are not sentence boundaries. Only the counting
  // copy is folded; the exact original sentence still goes to the engine/prompt.
  const counting = sentence
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.(?=\s+\p{Lu})/gu, value => value.replace(".", "·"))
    .replace(/\b(?:[A-Z]\.){2,}(?=\s+\p{L})/gu, value => value.replace(/\./g, "·"))
    .replace(/(?<=\d)\.(?=\d)/gu, "·")
    // Common domain/email suffixes are internal punctuation. Do not shield
    // arbitrary lowercase word.word, which could hide an attached sentence.
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|mil|int|io|ai|co|us|uk|ca|de|fr|au|jp|dev|app|me|info|biz|xyz)\b/gu, value => value.replace(/\./g, "·"))
    // Count a boundary even when the next sentence starts with quotes,
    // brackets or other punctuation without a separating space. A trailing
    // closing quote alone adds no boundary because no further word follows.
    .replace(/(?<=[.!?。！？])(?=[\p{L}\p{N}]|[\p{Ps}\p{Pi}\p{Pf}"'][\s\p{Ps}\p{Pi}\p{Pf}"']*[\p{L}\p{N}])/gu, " ");
  return sentenceCount(counting.replace(/[。！？]/gu, ". ")) === 1;
}

/** Checks a parsed body against SPEC §3: exactly these keys, these types, these bounds. */
export function validateRequest(body: unknown): ExplainRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new CodedError("E_SHAPE");
  const keys = Object.keys(body).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) throw new CodedError("E_SHAPE");
  const b = body as Record<string, unknown>;
  if (b.v !== 1) throw new CodedError("E_SHAPE");
  if (typeof b.rules !== "string" || !/^[0-9A-Za-z.+-]{1,32}$/.test(b.rules)) throw new CodedError("E_SHAPE");
  if (typeof b.rule !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(b.rule)) throw new CodedError("E_SHAPE");
  if (typeof b.domain !== "string" || !(DOMAINS as readonly string[]).includes(b.domain)) {
    throw new CodedError("E_DOMAIN");
  }
  if (!validSentence(b.sentence)) throw new CodedError("E_SENTENCE");
  const sentence = b.sentence;
  const { start, end } = b;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > sentence.length ||
    splitsPair(sentence, start) ||
    splitsPair(sentence, end)
  ) {
    throw new CodedError("E_SPAN");
  }
  return { v: 1, rules: b.rules, rule: b.rule, domain: b.domain as Domain, sentence, start, end };
}

/** The request body as text, or a CodedError when it is too big or badly encoded. */
export function bodyText(body: string | null | undefined, isBase64Encoded: boolean | undefined): string {
  if (typeof body !== "string" || body.length === 0) throw new CodedError("E_SHAPE");
  // A UTF-16 string can't be longer in UTF-8 than 3 bytes per unit, nor shorter than 1.
  if (body.length > MAX_BODY_BYTES * (isBase64Encoded ? 2 : 1)) throw new CodedError("E_BODY_SIZE");
  let bytes: Uint8Array;
  if (isBase64Encoded) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw new CodedError("E_BODY_ENCODING");
    try {
      bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    } catch {
      throw new CodedError("E_BODY_ENCODING");
    }
  } else {
    bytes = new TextEncoder().encode(body);
  }
  if (bytes.length > MAX_BODY_BYTES) throw new CodedError("E_BODY_SIZE");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CodedError("E_BODY_ENCODING");
  }
}
