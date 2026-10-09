// Word helpers for the answer checks (SPEC §7). Deliberately simple and
// deterministic: they are a backstop, and the live evaluation is the real
// test.

/** A word: letters, marks and digits, with apostrophes inside ("don't", "Harlan's"). Hyphens split words. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['\u{2019}][\p{L}\p{M}\p{N}]+)*/gu;

export interface Word {
  text: string;
  index: number;
}

export function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD)) out.push({ text: m[0], index: m.index ?? 0 });
  return out;
}

/** Lowercase, curly apostrophes made straight, a trailing possessive "'s" removed. */
export function normWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/\u{2019}/gu, "'")
    .replace(/'s$/, "");
}

export function wordSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const w of wordsOf(text)) {
    set.add(w.text.toLowerCase().replace(/\u{2019}/gu, "'"));
    set.add(normWord(w.text));
  }
  return set;
}

export function isCapitalised(word: string): boolean {
  return /^\p{Lu}/u.test(word);
}

/**
 * True when the word at `index` starts a sentence: nothing but opening
 * quotes, brackets and spaces stands between it and the start of the text
 * or the end of the previous sentence (".", "!" or "?").
 */
export function startsSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[\s"'\u{2018}\u{201C}\u{2039}\u{AB}(\[]+$/u, "");
  return before === "" || /[.!?]["'\u{2019}\u{201D}\u{203A}\u{BB})\]]*$/u.test(before);
}

/** Collapses every run of whitespace to one space and trims the ends. */
export function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Sentences in plain prose: ".", "!" or "?" (and any closing quotes) followed by a space. */
export function sentenceCount(text: string): number {
  const t = collapse(text);
  if (t === "") return 0;
  return t.split(/(?<=[.!?]["'\u{2019}\u{201D}\u{203A})\]]*)\s+(?=\S)/u).length;
}

/** A quoted stretch of text ("...", “...”, ‘...’ or '...'): its inner text and where that sits. */
export interface Quoted {
  text: string;
  start: number;
  end: number;
}

const LETTER = /[\p{L}\p{N}]/u;
/** What may stand just before an opening single quote, and just after a closing one. */
const BEFORE_OPEN = /[\s(\[\u{2014}\u{2013}-]/u;
const AFTER_CLOSE = /[\s.,;:!?)\]\u{2014}\u{2013}-]/u;

/**
 * The quoted stretches of a field, in order. Double quotes pair as usual (a
 * curly opening quote closes at the next curly or straight closing one).
 * Single quotes, which models often use inside JSON strings, count only at a
 * word's edge: an opening one after a space or bracket and before a letter,
 * a closing one after a letter or punctuation and before a space, punctuation
 * or the end. So the apostrophes in "don't" and "critics' view" are not
 * quotes. An unclosed quote is not a quotation.
 */
export function quotedSpans(text: string): Quoted[] {
  const out: Quoted[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "\u{201C}") {
      const close = c === '"' ? /"/g : /[\u{201D}"]/gu;
      close.lastIndex = i + 1;
      const m = close.exec(text);
      if (m === null) break;
      out.push({ text: text.slice(i + 1, m.index), start: i + 1, end: m.index });
      i = m.index + 1;
      continue;
    }
    if ((c === "'" || c === "\u{2018}") && (i === 0 || BEFORE_OPEN.test(text[i - 1]!)) && LETTER.test(text[i + 1] ?? "")) {
      let j = i + 1;
      let found = -1;
      for (; j < text.length; j++) {
        const d = text[j];
        if ((d === "'" || d === "\u{2019}") && /[\p{L}\p{N}.,!?]/u.test(text[j - 1]!) && (j + 1 === text.length || AFTER_CLOSE.test(text[j + 1]!))) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        out.push({ text: text.slice(i + 1, found), start: i + 1, end: found });
        i = found + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Text folded for matching quotations against the sentence: lowercase, curly
 * quotes and apostrophes straightened, the prompt's ‹ › read as < >, every
 * whitespace run one space. `map[i]` is the index in `text` of folded
 * character i.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i]!;
    if (/\s/u.test(c)) {
      if (lastSpace) continue;
      lastSpace = true;
      folded += " ";
      map.push(i);
      continue;
    }
    lastSpace = false;
    if (c === "\u{2018}" || c === "\u{2019}") c = "'";
    else if (c === "\u{201C}" || c === "\u{201D}") c = '"';
    else if (c === "\u{2039}") c = "<";
    else if (c === "\u{203A}") c = ">";
    const lower = c.toLowerCase();
    folded += lower.length === 1 ? lower : c;
    map.push(i);
  }
  return { folded, map };
}

/** Folds a quotation's text (as foldWithMap) and trims spaces and edge punctuation. */
export function foldQuote(text: string): string {
  return foldWithMap(text).folded.replace(/^[\s.,;:!?'"()\u{2026}-]+|[\s.,;:!?'"()\u{2026}-]+$/gu, "");
}
