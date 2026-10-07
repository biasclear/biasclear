// Composed explanations (SPEC §7, replacing free text). The model never writes
// the explanation. It picks, for the marked words, one or two "does" phrases
// and up to three "unsaid" items from a reviewed bank (data/explain-phrases.json),
// by id; the server writes the sentence:
//
//   The words “<mark>” <does-1>[, and <does-2>]. The sentence does not say <unsaid list>.
//
// So nothing a model returns reaches the visitor except the mark, quoted exactly
// as the visitor wrote it (or refused when it can't be: see quotable), and
// phrases a person reviewed. A reply that names an id
// the bank doesn't hold for this move, repeats one, or carries any other key or
// text is refused.

import { createHash } from "node:crypto";
import phrasesJson from "../data/explain-phrases.json";
import { sentenceCount } from "./text.js";

/** Limits on the explanation as the visitor sees it, the quoted mark included (SPEC §7). */
export const HOW_MAX_CHARS = 400;
export const HOW_MAX_WORDS = 60;
export const HOW_MAX_SENTENCES = 3;

export const DOES_MIN = 1;
export const DOES_MAX = 2;
export const UNSAID_MAX = 3;

export interface MovePhrases {
  /** id -> verb phrase in base form ("treat agreement as if it were evidence"). */
  does: ReadonlyMap<string, string>;
  /** id -> noun clause after "The sentence does not say" ("who agrees"). */
  unsaid: ReadonlyMap<string, string>;
}

export type PhraseBank = ReadonlyMap<string, MovePhrases>;

const ID = /^[a-z][0-9]{1,2}$/u;

/** Reads and checks the bank: every id well formed and unique within its move; common unsaid items added to each move. */
export function bankFrom(json: unknown): PhraseBank {
  const j = json as { common?: { unsaid?: Record<string, unknown> }; moves?: Record<string, { does?: Record<string, unknown>; unsaid?: Record<string, unknown> }> };
  if (j.moves === undefined || typeof j.moves !== "object") throw new Error("explain-phrases.json has no moves");
  const strings = (o: Record<string, unknown> | undefined, prefix: string): Map<string, string> => {
    const m = new Map<string, string>();
    for (const [id, text] of Object.entries(o ?? {})) {
      if (!ID.test(id) || id[0] !== prefix || typeof text !== "string" || text.trim() === "") throw new Error(`explain-phrases.json: bad entry ${id}`);
      m.set(id, text.trim());
    }
    return m;
  };
  const common = strings(j.common?.unsaid, "c");
  const bank = new Map<string, MovePhrases>();
  for (const [rule, entry] of Object.entries(j.moves)) {
    const does = strings(entry.does, "d");
    const unsaid = strings(entry.unsaid, "u");
    for (const [id, text] of common) unsaid.set(id, text);
    if (does.size === 0) throw new Error(`explain-phrases.json: ${rule} has no does phrases`);
    bank.set(rule, { does, unsaid });
  }
  return bank;
}

let bundled: PhraseBank | undefined;
export function bundledBank(): PhraseBank {
  bundled ??= bankFrom(phrasesJson);
  return bundled;
}

let bundledHash: string | undefined;
/** SHA-256 of the bundled bank as parsed, so a recorded selection names the exact bank its ids came from. */
export function bankHash(): string {
  bundledHash ??= createHash("sha256").update(JSON.stringify(phrasesJson)).digest("hex");
  return bundledHash;
}

/** The -s form of a base verb, for a one-word mark ("The word "inevitable" presents ..."). */
export function thirdPerson(verb: string): string {
  const irregular: Record<string, string> = { be: "is", have: "has", do: "does", go: "goes" };
  if (irregular[verb] !== undefined) return irregular[verb]!;
  if (/[^aeiou]y$/u.test(verb)) return `${verb.slice(0, -1)}ies`;
  if (/(?:s|sh|ch|x|z|o)$/u.test(verb)) return `${verb}es`;
  return `${verb}s`;
}

const singular = (phrase: string): string => {
  const [first, ...rest] = phrase.split(" ");
  return [thirdPerson(first!), ...rest].join(" ");
};

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * Characters that could end the quotation or start a sentence of its own
 * inside it, in any script or look-alike form: quotation marks and primes,
 * sentence ends and ellipses, line breaks, control and invisible format
 * characters (bidirectional overrides among them).
 */
const UNQUOTABLE = /[\p{Quotation_Mark}\p{Sentence_Terminal}\p{Cc}\p{Cf}\p{Zl}\p{Zp}`\u{00B4}\u{02B9}-\u{02BB}\u{02BD}\u{02C8}-\u{02CB}\u{02DD}\u{02EE}\u{05F3}\u{05F4}\u{2024}-\u{2026}\u{2032}-\u{2037}\u{2057}\u{3003}\u{FE52}\u{FF0E}]/u;
/** An apostrophe after a letter, inside or at the end of a word ("don't", "teachers'"). */
const APOSTROPHE = /(?<=\p{L})['\u{2019}](?=\p{L}|\s|$)/gu;
/** The sentence's own scare quotes: a straight pair around whole words ("improved", 'experts'). */
const INNER_PAIR = /(?<=^|\s)(["'])[\p{L}\p{N}][\p{L}\p{N}' -]*?(?<=[\p{L}\p{N}])\1(?=\s|$)/gu;

/**
 * Whether the marked words can be quoted exactly as the visitor wrote them.
 * The explanation never shortens, cleans or reorders the mark. It quotes it
 * between curly quotation marks, so the sentence's own straight scare quotes
 * can stand inside, whole. Anything else that could close the quotation, open
 * a sentence inside it or change how it displays, or a mark that names the
 * product, is refused instead. Checked on the text as written and on its
 * compatibility form, so a full-width or look-alike character counts as what
 * it looks like.
 */
export function quotable(mark: string): boolean {
  if (!/^\S+(?: \S+)*$/u.test(mark)) return false;
  for (const form of [mark, mark.normalize("NFKC")]) {
    if (UNQUOTABLE.test(form.replace(INNER_PAIR, (pair) => pair.slice(1, -1)).replace(APOSTROPHE, ""))) return false;
    if (/biasclear/iu.test(form.replace(/[^\p{L}]/gu, ""))) return false;
  }
  return true;
}

const plural = (mark: string): boolean => mark.includes(" ");
const shown = (mark: string, phrase: string): string => (plural(mark) ? phrase : singular(phrase));

/** The explanation the visitor sees, from the mark (quoted exactly) and the chosen phrases. */
export function render(mark: string, does: readonly string[], unsaid: readonly string[]): string {
  let text = `The ${plural(mark) ? "words" : "word"} \u{201C}${mark}\u{201D} ${does.map((p) => shown(mark, p)).join(", and ")}.`;
  if (unsaid.length > 0) text += ` The sentence does not say ${orList(unsaid)}.`;
  return text;
}

/** Whether a text is within the explanation limits. */
export function withinLimits(text: string): boolean {
  const chars = [...text].length;
  return chars >= 1 && chars <= HOW_MAX_CHARS && text.split(" ").length <= HOW_MAX_WORDS && sentenceCount(text) <= HOW_MAX_SENTENCES;
}

/** Most picks first; each step gives up one item. */
const PICK_STEPS: ReadonlyArray<{ does: number; unsaid: number }> = [
  { does: DOES_MAX, unsaid: UNSAID_MAX },
  { does: DOES_MIN, unsaid: UNSAID_MAX },
  { does: DOES_MIN, unsaid: UNSAID_MAX - 1 },
  { does: DOES_MIN, unsaid: UNSAID_MAX - 2 },
  { does: DOES_MIN, unsaid: 0 },
];

/**
 * How many phrases this move and mark leave room for: the most picks such that
 * every choice within them, the mark quoted whole, is within the limits (the
 * longest phrases by words and by characters are tried). Undefined when even
 * one "does" phrase doesn't fit, or the mark can't be quoted.
 */
export function pickLimits(ruleId: string, mark: string, bank: PhraseBank = bundledBank()): { does: number; unsaid: number } | undefined {
  const phrases = bank.get(ruleId);
  if (phrases === undefined || !quotable(mark)) return undefined;
  const longest = (m: ReadonlyMap<string, string>, n: number, by: (t: string) => number) =>
    [...m.values()].sort((a, b) => by(shown(mark, b)) - by(shown(mark, a))).slice(0, n);
  const words = (t: string) => t.split(" ").length;
  const chars = (t: string) => [...t].length;
  return PICK_STEPS.find((step) =>
    [words, chars].every((by) => withinLimits(render(mark, longest(phrases.does, step.does, by), longest(phrases.unsaid, step.unsaid, by)))),
  );
}


export type Choice =
  | { ok: true; how: string; does: string[]; unsaid: string[] }
  | { ok: false; reason: "shape" | "choice" | "mark" | "long" };

/**
 * Checks the model's choice for one move and writes the explanation. `does` is
 * a list of ids from the move's "does" phrases, `unsaid` a list of ids from its
 * "unsaid" items, at most as many as pickLimits allows for this mark (the
 * prompt states the same numbers); no repeats, nothing else.
 */
export function compose(ruleId: string, mark: string, does: unknown, unsaid: unknown, bank: PhraseBank = bundledBank()): Choice {
  const phrases = bank.get(ruleId);
  if (phrases === undefined) return { ok: false, reason: "choice" };
  const ids = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  const d = ids(does);
  const u = ids(unsaid);
  if (d === undefined || u === undefined) return { ok: false, reason: "shape" };
  if (!quotable(mark)) return { ok: false, reason: "mark" };
  const limits = pickLimits(ruleId, mark, bank);
  if (limits === undefined) return { ok: false, reason: "long" };
  if (d.length < DOES_MIN || d.length > limits.does || u.length > limits.unsaid) return { ok: false, reason: "choice" };
  if (new Set(d).size !== d.length || new Set(u).size !== u.length) return { ok: false, reason: "choice" };
  if (!d.every((id) => phrases.does.has(id)) || !u.every((id) => phrases.unsaid.has(id))) return { ok: false, reason: "choice" };
  return { ok: true, how: render(mark, d.map((id) => phrases.does.get(id)!), u.map((id) => phrases.unsaid.get(id)!)), does: d, unsaid: u };
}

/** The options as the prompt lists them for one move: "d1: treat agreement as if it were evidence". */
export function optionLines(ruleId: string, bank: PhraseBank = bundledBank()): { does: string[]; unsaid: string[] } {
  const phrases = bank.get(ruleId);
  if (phrases === undefined) return { does: [], unsaid: [] };
  return {
    does: [...phrases.does].map(([id, text]) => `${id}: ${text}`),
    unsaid: [...phrases.unsaid].map(([id, text]) => `${id}: ${text}`),
  };
}
