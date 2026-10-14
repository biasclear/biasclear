// The ReDoS guard's adversarial strings (redos.test.ts explains the guard).
// The generator below is the one the old wall-clock guard used, unchanged.
export const LENGTH = 20_000;
// The ceiling: the CPU milliseconds one scan of a LENGTH-character string
// may take (a run over it is timed once more, and the faster counts). The
// slowest pack regex takes about 20 CPU ms on an Apple M3 Pro; the old
// wall-clock guard read up to 55 ms for it on slow shared CI runners.
export const LIMIT_MS = 150;
const EMOJI = "\u{1F642}";
// Sentence ends with a closing mark, quoted dialogue and bare whitespace: a
// pattern whose sentence start and sentence body read the same terminator
// differently starts again after every one of them (rules 2.0.0a4 fixed one
// in INSTITUTIONAL_POSITION_AS_SETTLED and one in MEDIA_EMOTIONAL_LEAD).
export const SENTENCE_ENDS = [
  "A?\u201d ",
  "A.) ",
  "Dr.) ",
  "A.\" ",
  "\u201cWhy?\u201d \u201cYes.\u201d \u201cIs it done?\u201d ",
  // Rules 2.0.0a5: skip every following space before testing lowercase.
  "a.  a ",
  "a!  a ",
  "a.\t a ",
  "a.\u00a0 a ",
  " ",
  "\n",
  "\t",
  "\u00a0",
];

/** The words and punctuation a pattern contains, as literal text. */
function literals(pattern: string): { words: string[]; marks: string[] } {
  // Drop escapes that stand for classes or assertions, keep escaped punctuation.
  const plain = pattern.replace(/\\([bBdDsSwW])|\\(.)/gu, (_m, cls: string | undefined, ch: string | undefined) =>
    cls !== undefined ? " " : (ch ?? ""),
  );
  const words = [...new Set(plain.match(/[A-Za-z]{2,}/g) ?? [])];
  const marks = [...new Set(plain.replace(/[A-Za-z0-9\s(){}[\]|?*+^$\\.:=!<-]/gu, "").split(""))];
  return { words, marks };
}

export function fill(unit: string): string {
  // A whitespace-only unit is kept as it is: a run of spaces or newlines is
  // itself an adversarial string (rules 2.0.0a4 fixed one).
  const u = unit === "" ? "a " : unit;
  return u.repeat(Math.ceil(LENGTH / u.length)).slice(0, LENGTH);
}

/** Adversarial strings for one pattern. */
export function adversarial(pattern: string): string[] {
  const { words, marks } = literals(pattern);
  const out = [
    fill(words.join(" ") + " "),
    fill(words.join(", ") + ", "),
    fill(words.join("")),
    fill(words.join(` ${EMOJI} `) + " "),
    fill(words.map((w) => w.toUpperCase()).join("\n") + "\n"),
    "x".repeat(250) + fill(words.join(" ") + " ").slice(250),
  ];
  for (const w of words) {
    out.push(fill(`${w} `), fill(`${w}, `), fill(`${w} x `));
  }
  for (const m of marks) {
    out.push(fill(`${m}abc${m} `), fill(`${m}${words[0] ?? "a"} `), fill(m));
    // a bracket, then a chain of tokens joined by the mark: the shape of a
    // citation's list of names, where a mark that both joins tokens and sits
    // inside one splits the chain 2^n ways (rules 2.0.0a3 fixed one)
    out.push(`(${fill(`A${m}`)}`, `[${fill(`A${m}`)}`);
  }
  // a bracket, then a run of one non-ASCII letter, bare or spaced: a pattern
  // that can read such a letter by two alternatives (a word character, or
  // any non-ASCII character) reads the run 2^n ways (rules 2.0.0a3 fixed two)
  for (const ch of ["\u00e9", "\u738b"]) {
    out.push(`(${fill(ch)}`, `(${fill(`${ch} `)}`);
  }
  out.push(...SENTENCE_ENDS.map(fill));
  return out;
}
