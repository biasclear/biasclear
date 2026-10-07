// The model's reply, checked (SPEC §7). Checks 1 to 10 must pass or the
// visitor gets "no_answer". Checks 11, 11b and 12 apply to the rewrite only: if
// one fails, the rewrite is dropped (plainer: null) and the explanation is
// still shown. The answer is plain text; the site renders it with
// textContent, never as HTML.
//
// These checks are a backstop, not proof of neutrality: they catch the
// shapes of a slanted or obedient answer that can be named in advance. The
// live evaluation's swapped pairs are the main test (docs/THREAT_MODEL.md T4,
// T5). Every list below is applied the same way to every side, and side
// words are kept as pairs (SIDE_PAIRS) so both halves are always listed.

import type { Code, PlainerState } from "./codes.js";
import type { Domain, EngineBuild } from "./engines.js";
import { parseJsonOrUndefined } from "./json.js";
import { SYSTEM_PROMPTS, type PromptMode } from "./prompt.js";
import {
  codePointLength,
  collapse,
  foldQuote,
  foldWithMap,
  isCapitalised,
  normWord,
  quotedSpans,
  sentenceCount,
  startsSentence,
  wordSet,
  wordsOf,
  type Quoted,
} from "./text.js";

export const HOW_MAX_CHARS = 400;
export const HOW_MAX_WORDS = 60;
export const HOW_MAX_SENTENCES = 3;
/** Check 9b: this many words in a row copied from the sentence, outside quotation marks, is an echo. */
export const ECHO_WORDS = 6;

/** Words that say how sure a sentence is (check 11). */
export const CERTAINTY_WORDS: ReadonlySet<string> = new Set([
  "will", "won't", "would", "must", "can", "cannot", "can't", "could", "may", "might", "should",
  "always", "never", "certainly", "definitely", "surely", "clearly", "obviously",
]);

/** Words that turn a claim around (check 11). A word ending in "n't" counts too. */
export const NEGATION_WORDS: ReadonlySet<string> = new Set([
  "not", "no", "never", "none", "nothing", "nobody", "nor", "neither", "nowhere", "cannot",
]);

/**
 * Words too plain to carry a claim (check 11): articles, pronouns, linking
 * verbs, prepositions, conjunctions and intensifiers. Every other word of
 * three or more letters outside the marked words must survive the rewrite,
 * quantifiers among them ("all" to "some" is another claim).
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "but", "for", "nor", "yet", "that", "this", "these", "those", "with", "from", "into", "onto",
  "upon", "about", "over", "under", "than", "then", "there", "their", "they", "them", "theirs", "its", "his",
  "her", "hers", "him", "she", "you", "your", "yours", "our", "ours", "who", "whom", "whose", "which", "what",
  "when", "where", "while", "how", "why", "are", "was", "were", "been", "being", "has", "have", "had", "having",
  "does", "did", "doing", "done", "also", "just", "very", "such", "either", "own", "same", "other", "another",
  "too", "via", "per", "out",
  "off", "again", "still", "even", "ever", "because", "since", "until", "unless", "although", "though",
  "whether", "who's", "it's", "that's", "there's", "they're", "we're", "you're", "i'm", "let", "lets",
  "one", "ones", "thing", "things", "people", "say", "says", "said", "saying", "between", "among", "amongst",
  "across", "around", "through", "throughout", "toward", "towards", "during", "within", "beyond", "along",
  "before", "after",
]);

/**
 * Check 6: ordinary words that may open a sentence of the answer although
 * the visitor's sentence doesn't have them. The system prompt's own words
 * count too. A capitalised word at a sentence start that is neither is
 * treated as a new name.
 */
const SENTENCE_OPENERS: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its", "they", "their", "there", "here", "we",
  "you", "i", "and", "but", "or", "so", "yet", "nor", "if", "when", "while", "because", "although", "though",
  "since", "unless", "until", "as", "at", "by", "for", "from", "in", "into", "of", "on", "to", "with",
  "without", "instead", "rather", "also", "only", "even", "still", "then", "thus", "so", "such", "some",
  "many", "most", "much", "more", "all", "any", "each", "every", "both", "either", "neither", "no", "none",
  "nothing", "nobody", "not", "one", "two", "other", "another", "what", "which", "who", "why", "how",
  "where", "whether", "unlike", "like", "once", "after", "before", "here", "overall", "together", "put",
  "taken", "read", "seen", "framed", "phrased", "worded", "word", "words", "wording", "phrase", "phrases",
  "phrasing", "sentence", "sentences", "reader", "readers", "claim", "claims", "statement", "agreement",
  "calling", "saying", "using", "framing", "naming", "putting", "treating", "pointing", "presenting",
  "labelling", "labeling", "describing", "linking", "tying", "leaning", "appealing", "invoking", "citing",
  "casting", "setting", "placing", "pairing", "offering", "suggesting", "implying", "asking", "leaving",
  "giving", "making", "turning", "tagging", "grouping", "moving", "shifting", "stating", "adding",
  "dismissing", "questioning", "doubting", "disagreeing", "nobody's", "no-one", "someone", "anyone",
  "everyone", "somebody", "anybody", "everybody", "whoever", "whatever", "however", "therefore",
  "meanwhile", "otherwise", "first", "second", "finally", "together", "alone", "yes", "disagreement",
  "disagreeing", "evidence", "research", "support", "trust", "trusting", "doubt", "doubting", "fear", "urgency",
  "shame", "pressure", "praise", "blame", "agreeing", "believing", "accepting", "choosing", "ending", "opening",
]);

/**
 * Check 6b: side and group words. An answer may use one only when the
 * sentence already uses a word of the same family, so it can't bring a side
 * into a sentence that had none, or swap one side for another.
 *
 * Symmetric by construction: every family that names a side is listed in a
 * pair with its counterpart (SIDE_PAIRS), both added at once, and a test runs
 * every pair both ways. Labels that fit any side ("extremists", "zealots")
 * stand alone. Any other word naming a group by "-ist(s)" or "-ians" (a
 * pattern, not a list) counts too, whatever side it names. Left and right
 * share one list of exceptions ("the right hand", "the left of").
 */
const SIDE_EXCEPTIONS =
  "(?!\\s+(?:side|sides|hand|hands|foot|arm|eye|ear|of|to|way|words?|answer|thing|one|ones|time|moment|place|amount|kind|question|choice|call|track|direction|column|margin|edge)\\b)";
// The same spelling rules apply to both members of a pair. Normalization
// below handles every Unicode dash, repeated spaces, and possessive forms.
const HYPHEN = "[- ]?";
type Family = readonly [string, RegExp];
const wing = (side: "left" | "right"): RegExp => new RegExp(
  `\\bthe ${side}\\b${SIDE_EXCEPTIONS}|\\b${side}${HYPHEN}(?:wing(?:ers?)?|leaning)\\b|\\b${side}is(?:ts?|m)\\b|\\b${side}(?:-| )of(?:-| )cent(?:er|re)\\b`, "iu",
);
const ideology = (stem: string): RegExp => new RegExp(
  `\\b(?:${stem}(?:e(?:s|ly)?|ism|ists?)|${stem.replace(/iv$/u, "")}ism)\\b`, "iu",
);
const ism = (stem: string): RegExp => new RegExp(`\\b${stem}(?:ists?|ism|istic(?:ally)?)\\b`, "iu");
export const SIDE_PAIRS: ReadonlyArray<readonly [Family, Family]> = [
  [
    ["left", wing("left")],
    ["right", wing("right")],
  ],
  [["progressive", ideology("progressiv")], ["conservative", ideology("conservativ")]],
  [["liberal", /\bliberal(?:s|ism|ly)?\b/iu], ["libertarian", /\blibertarian(?:s|ism|ly)?\b/iu]],
  [["socialist", ism("social")], ["capitalist", ism("capital")]],
  [["communist", ism("commun")], ["fascist", ism("fasc")]],
  [["marxist", ism("marx")], ["nazi", /\bnazi(?:s|sm|ism)?\b/iu]],
  [["populist", /\bpopulis(?:ts?|m)\b/iu], ["establishment", /\bthe establishment\b|\bestablishment (?:figures?|politicians?|types?)\b/iu]],
  [["nationalist", ism("national")], ["globalist", ism("global")]],
  [["democrat", /\bdemocrat(?:s|ic|ically|ism)?\b/iu], ["republican", /\brepublican(?:s|ism|ly)?\b/iu]],
  [["woke", /\bwoke\b/iu], ["maga", /\bmaga\b/iu]],
  [["antifa", /\bantifa\b/iu], ["alt-right", /\balt[-\u2010\u2011 ]?right\b/iu]],
  [["feminist", /\bfeminis(?:ts?|m)\b/iu], ["traditionalist", /\btraditionalis(?:ts?|m)\b/iu]],
  [["activist", /\bactivists?\b/iu], ["lobbyist", /\blobby(?:ists?|ing)\b|\blobbies\b/iu]],
  [
    ["elite", /\belites?\b|\belitis(?:ts?|m)\b/iu],
    ["ordinary people", /\b(?:ordinary|everyday|average|regular|common|working|real)\s+(?:people|folks?|voters|citizens|families|men|women|americans|taxpayers)\b|\bthe masses\b/iu],
  ],
  [["radical", /\bradical(?:s|ism|ly)?\b/iu], ["moderate", /\bmoderate(?:s|ly)?\b|\bmoderatism\b|\bcentris(?:ts?|m)\b/iu]],
  [
    ["immigrant", /\b(?:im)?migrants?\b|\brefugees?\b|\basylum[- ]seekers?\b/iu],
    ["native-born", /\bnatives\b|\bnative[-\u2010\u2011 ]born\b|\bnativis(?:ts?|m)\b|\blocals\b/iu],
  ],
  [
    ["union", /\bunions?\b|\borgani[sz]ed labou?r\b/iu],
    ["business", /\bcompan(?:y|ies)\b|\bcorporations?\b|\bbusiness(?:es)?\b|\bindustry (?:groups?|lobby)\b|\bshareholders?\b/iu],
  ],
  [["worker", /\bworkers?\b|\bemployees?\b/iu], ["employer", /\bemployers?\b|\bboss(?:es)?\b|\bmanagement\b/iu]],
  [["landlord", /\blandlords?\b/iu], ["tenant", /\btenants?\b|\brenters?\b/iu]],
  [
    ["wealthy", /\bwealthy\b|\bthe rich\b|\b(?:billion|million)aires?\b|\bupper[-\u2010\u2011 ]class\b/iu],
    ["poor", /\bpoor\b|\blow[- ]income\b|\bworking[- ]class\b|\blower[- ]class\b/iu],
  ],
  [["alarmist", /\balarmis(?:ts?|m)\b/iu], ["denier", /\bdeniers?\b|\bdenialis(?:ts?|m)\b/iu]],
  [["urban", /\burban(?:ites?)?\b|\bcity[- ]dwellers?\b/iu], ["rural", /\brural\b|\bcountry folks?\b/iu]],
  [["young", /\bmillennials?\b|\bzoomers?\b|\bgen[- ]?z\b|\byoung people\b/iu], ["old", /\bboomers?\b|\bolder people\b|\bthe elderly\b/iu]],
  [["men", /\bmen\b/iu], ["women", /\bwomen\b/iu]],
  [["police", /\bpolice\b|\bcops\b/iu], ["protesters", /\bprotest(?:e|o)rs?\b|\bdemonstrators?\b/iu]],
  [["religious", /\bbelievers?\b|\breligious\b|\bthe faithful\b/iu], ["secular", /\bsecular(?:ists?|ism)?\b|\bnon[- ]?believers?\b/iu]],
];

/** Labels that fit any side; each is its own family. */
export const ANY_SIDE_LABELS: ReadonlyArray<Family> = [
  ["extremist", /\bextremis(?:ts?|m)\b/iu],
  ["zealot", /\bzealots?\b/iu],
  ["fanatic", /\bfanatics?\b/iu],
  ["ideologue", /\bideologues?\b/iu],
  ["partisan", /\bpartisans?\b/iu],
  ["bigot", /\bbigot(?:s|ry)?\b/iu],
];

export const SIDE_FAMILIES: ReadonlyArray<Family> = [...SIDE_PAIRS.flat(), ...ANY_SIDE_LABELS];

/**
 * Any word naming people by what they hold or do, "-ist(s)" or "-ians"
 * ("pacifists", "politicians"), whatever side: a pattern, so it treats every
 * side alike. Common words that only end that way are left out.
 */
const GROUP_SUFFIX = /^\p{L}{3,}(?:ists?|ians)$/u;
const NOT_A_GROUP = /^\p{L}*(?:sists?|xists?)$|^(?:check|play|short|wish|black|white|hit|price|song|reading|wait|guest)lists?$/u;
/** "right" and "wrong" as a verdict, but not "right-wing", "right-leaning" or "right of". */
const RIGHT_WRONG = `(?:wrong|right)(?![-\\u2010-\\u2015]|\\s+(?:wing|leaning|of)\\b)`;
const VERDICT_ADJECTIVES =
  "true|false|untrue|correct|incorrect|accurate|inaccurate|good|bad|better|worse|best|worst|great|terrible|" +
  "dangerous|harmful|corrupt|evil|fair|unfair|reasonable|unreasonable|justified|unjustified|valid|invalid|" +
  "sound|unsound|legitimate|illegitimate|misleading|deceptive|dishonest|baseless|unfounded|" +
  RIGHT_WRONG;

/**
 * Check 8: verdicts on the claim, labels for the writer, and guesses at
 * motive. "is", "isn't", "is not", "is simply", "are plainly not" all count.
 */
const VERDICT_PATTERNS: readonly RegExp[] = [
  // "what is wrong with it" asks a question, it doesn't give a verdict.
  new RegExp(
    `(?<!\\bwhat\\s)\\b(?:is|are|was|were|be|being|been)(?:n['\\u2019]t)?\\s+(?:not\\s+)?(?:\\p{L}+ly\\s+)?(?:not\\s+)?(?:${VERDICT_ADJECTIVES})\\b`,
    "giu",
  ),
  /\b(?:untrue|lie|lies|lying|liar|liars|dishonest|misinformation|disinformation|propaganda|hoax|hoaxes|fake news|bogus|debunked|disproven|baseless|unfounded|spin)\b/giu,
  /\b(?:fallac\p{L}*|mislead\p{L}*|misled|decepti\p{L}*|deceiv\p{L}*|manipulat\p{L}*|bull(?:y|ies|ying)|stok(?:e|es|ed|ing)|fearmonger\p{L}*|scaremonger\p{L}*|demagog\p{L}*)/giu,
  /\b(?:meant|designed|intended|trying|tries|try|attempts?|attempting|aims?|aiming|wants?|wanting|seeks?|seeking)\s+to\b/giu,
  // Fix round 2: verdicts and labels in other words (RT probes t1 to t3).
  /\b(?:falsely|wrongly|mistaken(?:ly)?|nonsense|nonsensical|shaky|dubious|doubtful|flimsy|falsehoods?|wrongheaded|misguided|absurd|ridiculous|sadly|rightly|unfortunately|thankfully|graft|bribe[sd]?|bribery|briber(?:s|y)?|corrupt(?:s|ed|ing|ion|ly)?|crooked|fraud(?:s|ulent)?|scam(?:s|med)?|deceit\p{L}*)\b/giu,
  /\bdeserv(?:e|es|ed|ing)\b/giu,
  // "is not so", "says things that are not so" (but not "not so much").
  /\b(?:not|n['\u2019]t)\s+so\b(?!\s+much\b)/giu,
  /\b(?:has|have|had)\s+(?:\p{L}+ly\s+)?(?:failed|worked|succeeded|deceived|lied|cheated|stolen|harmed|hurt)\b/giu,
  /\b(?:would|will)\s+(?:\p{L}+ly\s+)?(?:hurt|harm|help|work|fail|succeed|backfire|damage|ruin|benefit)\b|\b(?:does|do|did)\s+(?:help|work|hurt|harm)\b/giu,
  /\b(?:wants?|wanting|wanted)\s+(?:\p{L}+\s+){1,3}to\b/giu,
  /\b(?:hid(?:e|es|ing)|conceal(?:s|ed|ing)?|cover(?:s|ing)?\s+up)\s+(?:that|the\s+fact)\b/giu,
  /\badmit\p{L}*/giu,
  /\b(?:good|sound|valid|solid|strong|fair|legitimate)\s+(?:reasons?|grounds|points?|case|arguments?)\b/giu,
  /\b(?:has|have)\s+a\s+point\b/giu,
];

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]|[\u{E0000}-\u{E007F}]/u;
const URL_LIKE = /\bhttps?\b|\bwww\./iu;
const EMAIL_LIKE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;

/** Every word of the system prompts: ordinary English the answer may open a sentence with. */
const PROMPT_WORDS: ReadonlySet<string> = new Set(
  Object.values(SYSTEM_PROMPTS).flatMap((p) => wordsOf(p).map((w) => normWord(w.text))),
);

export interface CheckContext {
  mode: PromptMode;
  sentence: string;
  start: number;
  end: number;
  ruleId: string;
  domain: Domain;
  /** The move's name as the site shows it. */
  moveName: string;
  /** The move's one-line description, which the prompt also shows the model. */
  moveShort?: string | undefined;
  engine: EngineBuild;
  /** Every rule that fires on the sentence (for check 12). */
  sentenceRuleIds: ReadonlySet<string>;
  /**
   * Every span where this rule fires in the sentence, the marked one among
   * them (check 11). The rewrite must lose them all (check 12), so their
   * words aren't part of the claim it must keep. Defaults to the mark alone.
   */
  ruleSpans?: ReadonlyArray<{ start: number; end: number }> | undefined;
}

export type CheckResult =
  | { ok: true; how: string; plainer: string | null; plainerState: PlainerState }
  | { ok: false; code: Code };

const fail = (code: Code): CheckResult => ({ ok: false, code });

/** The one text block's JSON, with one surrounding code fence removed (check 2). */
function replyObject(reply: unknown): Record<string, unknown> | undefined {
  const content = (reply as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block = content[0] as { type?: unknown; text?: unknown } | null;
  if (block === null || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") {
    return undefined;
  }
  let text = block.text.trim();
  const fence = /^```(?:json)?[ \t]*\n?([\s\S]*?)\n?[ \t]*```$/u.exec(text);
  if (fence) text = (fence[1] ?? "").trim();
  const parsed = parseJsonOrUndefined(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

/** Lowercased words joined by single spaces, padded, for word-sequence containment. */
function wordLine(text: string): string {
  return ` ${wordsOf(text)
    .map((w) => w.text.toLowerCase().replace(/\u{2019}/gu, "'"))
    .join(" ")} `;
}

/** A word, its singular, and its stem before "ies"/"es"/"s", for matching plurals both ways. */
function forms(word: string): string[] {
  const w = normWord(word);
  const out = [w];
  if (w.endsWith("ies") && w.length > 4) out.push(`${w.slice(0, -3)}y`);
  if (w.endsWith("es") && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith("s") && w.length > 2) out.push(w.slice(0, -1));
  return out;
}

function knownWord(word: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(word.toLowerCase())) return true;
  for (const f of forms(word)) {
    if (allowed.has(f) || allowed.has(`${f}s`) || allowed.has(`${f}es`)) return true;
  }
  return false;
}

function plainText(field: string): boolean {
  return !/[<>]/u.test(field) && !URL_LIKE.test(field) && !EMAIL_LIKE.test(field) && !CONTROL.test(field);
}

/**
 * Check 6: every capitalised word is in the sentence or the move's name.
 * At the start of a sentence, an ordinary opening word or a word of the
 * system prompt may stand too; anything else there is a new name.
 */
function noNewNames(field: string, allowed: ReadonlySet<string>): boolean {
  for (const w of wordsOf(field)) {
    if (!isCapitalised(w.text) || w.text === "I" || knownWord(w.text, allowed)) continue;
    if (startsSentence(field, w.index)) {
      const lower = normWord(w.text);
      if (SENTENCE_OPENERS.has(lower) || PROMPT_WORDS.has(lower)) continue;
    }
    return false;
  }
  return true;
}

/** Check 6b: the families of side and group words the text uses. */
function sideFamilies(text: string): Set<string> {
  const found = new Set<string>();
  const normalized = collapse(text.normalize("NFKC").replace(/[\u2010-\u2015]/gu, "-").replace(/\u2019/gu, "'"))
    .replace(/(\p{L})'s\b/giu, "$1").replace(/(\p{L})'(?!\p{L})/gu, "$1");
  for (const [family, pattern] of SIDE_FAMILIES) if (pattern.test(normalized)) found.add(family);
  for (const w of wordsOf(text)) {
    const lower = normWord(w.text);
    if (GROUP_SUFFIX.test(lower) && !NOT_A_GROUP.test(lower) && !SIDE_FAMILIES.some(([, p]) => p.test(lower))) {
      found.add(`group:${lower.replace(/s$/u, "")}`);
    }
  }
  return found;
}

/** The quotations of `how` whose text is words of the sentence, as they are there. */
function exactQuotes(how: string, sentence: string): Quoted[] {
  const folded = foldWithMap(sentence).folded;
  return quotedSpans(how).filter((q) => {
    const parts = foldQuote(q.text)
      .split(/\.\.\.|\u{2026}/u)
      .map((p) => foldQuote(p))
      .filter((p) => /[\p{L}\p{N}]/u.test(p));
    return parts.length > 0 && parts.every((p) => folded.includes(p));
  });
}

/**
 * Check 8. In `how`, a verdict word may stand only inside a quotation that
 * is the sentence's own words: quoting "misinformation" is pointing at it,
 * saying it is using it. In the rewrite (the visitor's sentence, rewritten)
 * it may stand only where the sentence has the same words.
 */
function noVerdicts(field: string, sentence: string, quotes: readonly Quoted[] | undefined): boolean {
  const sentenceLine = wordLine(sentence);
  for (const pattern of VERDICT_PATTERNS) {
    for (const m of field.matchAll(pattern)) {
      const at = m.index ?? 0;
      if (quotes !== undefined) {
        if (!quotes.some((q) => at >= q.start && at + m[0].length <= q.end && dataQuoteContext(field, q))) return false;
      } else if (!sentenceLine.includes(wordLine(m[0]))) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Check 9: `how` points at the marked words by quoting them: at least one
 * quotation that is the sentence's own words and overlaps the mark.
 */
function quotesTheMark(quotes: readonly Quoted[], ctx: CheckContext): boolean {
  const { folded, map } = foldWithMap(ctx.sentence);
  for (const q of quotes) {
    for (const part of foldQuote(q.text).split(/\.\.\.|\u{2026}/u).map((p) => foldQuote(p))) {
      if (!/[\p{L}\p{N}]/u.test(part)) continue;
      for (let at = folded.indexOf(part); at >= 0; at = folded.indexOf(part, at + 1)) {
        const start = map[at]!;
        const end = map[at + part.length - 1]! + 1;
        if (start < ctx.end && end > ctx.start) return true;
      }
    }
  }
  return false;
}

/**
 * Check 9c: every sentence and clause of `how` is about the wording. A part
 * with no quotation must still refer to the wording ("the words", "the
 * sentence", "it", "the reader"...). A part that talks about a name, a plan
 * or a side from the sentence instead ("The Harlan plan deserves support.",
 * "..., and the Ridge Alliance takes bribes.") is an answer to the sentence,
 * not a description of it. Parts end at ".", "!", "?", ";", ":", a dash, or
 * a comma followed by "and", "but", "though", "although", "while",
 * "whereas" or "yet". (", so the reader..." stays with the part it follows.)
 */
export const WORDING_REFS: ReadonlySet<string> = new Set([
  "word", "words", "wording", "phrase", "phrases", "phrasing", "sentence", "sentences", "it", "its",
  "this", "these", "they", "them", "reader", "readers", "reader's", "readers'", "line", "label", "labels",
  "labelling", "labeling", "quote", "quotation", "move", "framing", "frame", "frames", "framed", "mark",
  "marked", "term", "terms", "language", "expression", "wordings", "claim", "claims", "view", "views",
]);
const PART_BREAK =
  /[.!?;:]+["'\u{2019}\u{201D})\]]*(?:\s+|$)|\s[\u{2013}\u{2014}-]\s|,\s+(?=(?:and|but|though|although|while|whereas|yet)\b)/giu;

// A quoted verdict must be described as wording. Merely adding quotation
// marks to an injected instruction's answer is not a safe quotation.
const DESCRIBES_WORDING = /\b(?:quot(?:e[sd]?|ing)|call(?:s|ed|ing)?|label(?:s|led|ing|ing)?|labell(?:ed|ing)|fram(?:e[sd]?|ing)|treat(?:s|ed|ing)?|present(?:s|ed|ing)?|offer(?:s|ed|ing)?|ask(?:s|ed|ing)?|point(?:s|ed|ing)?|set(?:s|ting)?|tie(?:s|d|ing)?|link(?:s|ed|ing)?|make(?:s)?|made|cast(?:s|ing)?|use(?:s|d)?|using)\b/iu;
const ADOPTS_QUOTE = /\b(?:confirm(?:s|ed|ing)?|prov(?:e[sd]?|ing)|establish(?:es|ed|ing)?|demonstrat(?:e[sd]?|ing)|reveal(?:s|ed|ing)?|endors(?:e[sd]?|ing)|validat(?:e[sd]?|ing)|correct(?:ly)?|rightly|accurate(?:ly)?|truthful(?:ly)?|factual(?:ly)?|valid(?:ly)?|sound|legitimate|true|false|good|bad|indeed|exactly|absolutely)\b|\bas\s+(?:a\s+)?fact\b/iu;

/** Clauses with quoted contents blanked out, keeping indices intact. */
function wordingParts(how: string): Array<{ start: number; end: number; text: string; quotes: Quoted[] }> {
  const quotes = quotedSpans(how);
  let masked = how;
  for (const q of quotes) masked = masked.slice(0, q.start - 1) + " ".repeat(q.end - q.start + 2) + masked.slice(q.end + 1);
  const parts: Array<{ start: number; end: number; text: string; quotes: Quoted[] }> = [];
  let start = 0;
  for (const m of masked.matchAll(PART_BREAK)) {
    const end = m.index ?? masked.length;
    parts.push({ start, end, text: masked.slice(start, end), quotes: quotes.filter((q) => q.start >= start && q.end <= end) });
    start = end + m[0].length;
  }
  parts.push({ start, end: masked.length, text: masked.slice(start), quotes: quotes.filter((q) => q.start >= start) });
  return parts;
}

function descriptivePart(text: string): boolean {
  return (wordsOf(text).some((w) => WORDING_REFS.has(normWord(w.text))) || /\b(?:calling|called|labelled|labeled)\b/iu.test(text)) &&
    DESCRIBES_WORDING.test(text) && !ADOPTS_QUOTE.test(text);
}

function dataQuoteContext(how: string, quote: Quoted): boolean {
  // Ellipses may omit "not" or splice parts into another claim. The
  // verdict exception requires one contiguous quotation, never that splice.
  if (/\.\.\.|\u2026/u.test(quote.text)) return false;
  const part = wordingParts(how).find((p) => quote.start >= p.start && quote.end <= p.end);
  return part !== undefined && descriptivePart(part.text);
}

function everyPartAboutWording(how: string): boolean {
  for (const part of wordingParts(how)) {
    if (part.quotes.length > 0) {
      if (!descriptivePart(part.text)) return false;
    } else if (/\p{L}/u.test(part.text) && !wordsOf(part.text).some((w) => WORDING_REFS.has(normWord(w.text)))) return false;
  }
  return true;
}

/**
 * Check 9b: `how` describes the wording instead of repeating it. Outside
 * quotation marks, no run of ECHO_WORDS words may be copied from the sentence
 * in order (an answer that restates or obeys the sentence's own clauses).
 */
function noEcho(how: string, sentence: string): boolean {
  const sentenceWords = wordsOf(sentence).map((w) => normWord(w.text));
  const runs = new Set<string>();
  for (let i = 0; i + ECHO_WORDS <= sentenceWords.length; i++) runs.add(sentenceWords.slice(i, i + ECHO_WORDS).join(" "));
  if (runs.size === 0) return true;
  // Every quotation, matching or not, is set aside: only the answer's own words count.
  let rest = "";
  let from = 0;
  for (const q of quotedSpans(how)) {
    rest += `${how.slice(from, q.start - 1)} | `;
    from = q.end + 1;
  }
  rest += how.slice(from);
  for (const segment of rest.split("|")) {
    const words = wordsOf(segment).map((w) => normWord(w.text));
    for (let i = 0; i + ECHO_WORDS <= words.length; i++) {
      if (runs.has(words.slice(i, i + ECHO_WORDS).join(" "))) return false;
    }
  }
  return true;
}

/** Check 10: at least 60% of the rewrite's words of three or more letters appear in the sentence. */
function sameSentence(plainer: string, sentenceWords: ReadonlySet<string>): boolean {
  const words = wordsOf(plainer).filter((w) => codePointLength(w.text) >= 3);
  if (words.length === 0) return false;
  const found = words.filter((w) => sentenceWords.has(normWord(w.text)) || sentenceWords.has(w.text.toLowerCase()));
  return found.length / words.length >= 0.6;
}

function certaintyWords(text: string, skip: ReadonlySet<number> = new Set()): Set<string> {
  const set = new Set<string>();
  for (const w of wordsOf(text)) {
    if (skip.has(w.index)) continue;
    const lower = w.text.toLowerCase().replace(/\u{2019}/gu, "'");
    if (CERTAINTY_WORDS.has(lower)) set.add(lower);
  }
  return set;
}

function negations(text: string): number {
  let n = 0;
  for (const w of wordsOf(text)) {
    const lower = w.text.toLowerCase().replace(/\u{2019}/gu, "'");
    if (NEGATION_WORDS.has(lower) || lower.endsWith("n't")) n++;
  }
  return n;
}

/** A content word's key for "did it survive": its first five letters, so "lowers" matches "lower". */
function stem(word: string): string {
  return [...normWord(word)].slice(0, 5).join("");
}

/** The rule's spans in the sentence, the mark among them, in order and merged where they overlap. */
function spansOf(ctx: CheckContext): Array<{ start: number; end: number }> {
  const all = [...(ctx.ruleSpans ?? []), { start: ctx.start, end: ctx.end }].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of all) {
    const last = merged.at(-1);
    if (last !== undefined && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * The sentence with every span of the rule blanked out (same length, so
 * word positions stay); the words that join a span to the rest (the word
 * just before each span, which may change with it); and the word just after
 * each span, which may drop only if it is a certainty word the move leans on
 * ("would" in "Only a fool would").
 */
function outsideMark(ctx: CheckContext): { text: string; joining: Set<number>; after: Set<number> } {
  let text = ctx.sentence;
  const joining = new Set<number>();
  const after = new Set<number>();
  for (const s of spansOf(ctx)) {
    text = text.slice(0, s.start) + " ".repeat(s.end - s.start) + text.slice(s.end);
    const before = wordsOf(ctx.sentence.slice(0, s.start)).at(-1);
    if (before !== undefined) joining.add(before.index);
    const next = wordsOf(ctx.sentence.slice(s.end))[0];
    if (next !== undefined) after.add(s.end + next.index);
  }
  return { text, joining, after };
}

/**
 * Check 11: the rewrite keeps the sentence's names, its certainty and its
 * claim. The claim is every content word outside the marked words (by its
 * first five letters, so "lowers" keeps "lower"), and exactly the number of
 * negations ("not", "never", "n't"...) outside them: a rewrite that says
 * "lower" for "raise", or adds a "not", is another claim, however many words
 * it shares.
 */
function keepsSpeakerCertaintyAndClaim(ctx: CheckContext, plainer: string): PlainerState | undefined {
  const plainerWords = wordSet(plainer);
  const spans = spansOf(ctx);
  for (const w of wordsOf(ctx.sentence)) {
    const inMark = spans.some((s) => w.index < s.end && w.index + w.text.length > s.start);
    if (inMark || !isCapitalised(w.text) || w.text === "I" || startsSentence(ctx.sentence, w.index)) continue;
    if (!plainerWords.has(normWord(w.text)) && !plainerWords.has(w.text.toLowerCase())) return "P_SPEAKER";
  }
  const { text: outside, joining, after } = outsideMark(ctx);
  const needed = certaintyWords(outside, new Set([...joining, ...after]));
  const had = certaintyWords(ctx.sentence);
  const got = certaintyWords(plainer);
  for (const c of needed) if (!got.has(c)) return "P_CERTAINTY";
  for (const c of got) if (!had.has(c)) return "P_CERTAINTY";

  const plainerStems = new Set(wordsOf(plainer).map((w) => stem(w.text)));
  // The word that joins a span to the sentence may change with it
  // ("spreading" in "are spreading misinformation"), as the prompt allows.
  for (const w of wordsOf(outside)) {
    if (joining.has(w.index) && !isCapitalised(w.text)) continue;
    const lower = normWord(w.text);
    if (codePointLength(lower) < 3 || FUNCTION_WORDS.has(lower) || CERTAINTY_WORDS.has(lower)) continue;
    if (NEGATION_WORDS.has(lower) || lower.endsWith("n't")) continue;
    if (!plainerStems.has(stem(w.text))) return "P_CLAIM";
  }
  // Exactly the negations outside the mark: a mark's own "No" ("No serious
  // scientist disputes") may go with the mark, but a rewrite that keeps it,
  // or moves it, is dropped too, because a "not" elsewhere can't be told apart.
  if (negations(plainer) !== negations(outside)) return "P_CLAIM";
  return undefined;
}

/**
 * Check 11b: what may replace the mark. A rewrite is the sentence with the
 * marked words changed and nothing added, so every word of it that is not in
 * the sentence must come from a short neutral list: grammar words, plain
 * verbs of saying and thinking, and "some", "many" or "several" in place of
 * an "every" or "all". A few moves may also use a word or two of their own
 * (DISSENT_DISMISSAL may say "disagree with it"). Contrast words ("though",
 * "but", "however", "doubt") never come in, so a rewrite can't add a clause
 * that answers the claim. And it may run at most REWRITE_EXTRA_WORDS words
 * longer than the sentence, with at most REWRITE_EXTRA_WORDS more new words
 * than the marked words it replaces.
 */
export const REWRITE_EXTRA_WORDS = 2;

export const REWRITE_NEW_WORDS: ReadonlySet<string> = new Set([
  // grammar
  "a", "an", "the", "this", "that", "these", "those", "it", "its", "they", "them", "their", "he", "she", "his",
  "her", "him", "we", "us", "our", "you", "your", "i", "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "do", "does", "did", "of", "to", "in", "on", "at", "by", "for", "with", "from", "as",
  "and", "or", "who", "whom", "which", "what", "there", "about", "than",
  // plain verbs of saying and thinking
  "say", "says", "said", "think", "thinks", "thought", "believe", "believes", "believed", "argue", "argues",
  "argued", "expect", "expects", "expected", "hold", "holds", "held", "view", "views", "according",
  // plain quantifiers and people
  "some", "many", "several", "people", "others", "someone", "one",
]);

/** Words a move's rewrite may also bring in (see REWRITE_NEW_WORDS). */
export const REWRITE_NEW_WORDS_BY_RULE: Readonly<Record<string, readonly string[]>> = {
  DISSENT_DISMISSAL: ["disagree", "disagrees", "disagreed", "question", "questions", "questioned", "differ", "differs"],
  COMPETENCE_DISMISSAL: ["disagree", "disagrees", "disagreed", "question", "questions", "questioned"],
  DISMISSAL_BY_REFRAMING: ["disagree", "disagrees", "disagreed", "position"],
  LEGAL_MERIT_DISMISSAL: ["disagree", "disagrees", "disagreed", "argument", "arguments"],
  LEGAL_SETTLED_DISMISSAL: ["disagree", "disagrees", "disagreed", "question"],
  FALSE_EQUIVALENCE: ["different", "differ", "differs"],
  MEDIA_FALSE_BALANCE: ["different", "differ", "differs"],
};

/** Contrast words: never new in a rewrite, whatever list names them. */
export const CONTRAST_WORDS: ReadonlySet<string> = new Set([
  "though", "although", "but", "however", "yet", "whereas", "despite", "nevertheless", "nonetheless",
  "while", "whether", "doubt", "doubts", "doubted", "dispute", "disputes", "disputed", "instead", "unlike",
]);

function onlyNeutralNewWords(ctx: CheckContext, plainer: string): boolean {
  const sentenceWords = wordSet(ctx.sentence);
  const sentenceStems = new Set(wordsOf(ctx.sentence).map((w) => stem(w.text)));
  const spans = spansOf(ctx);
  const all = wordsOf(ctx.sentence);
  const markWords = all.filter((w) => spans.some((s) => w.index < s.end && w.index + w.text.length > s.start)).length;
  const words = wordsOf(plainer);
  if (words.length > all.length + REWRITE_EXTRA_WORDS) return false;
  const extra = new Set(REWRITE_NEW_WORDS_BY_RULE[ctx.ruleId] ?? []);
  let fresh = 0;
  for (const w of words) {
    const lower = normWord(w.text);
    if (knownWord(w.text, sentenceWords)) continue;
    if (CONTRAST_WORDS.has(lower)) return false;
    if (++fresh > markWords + REWRITE_EXTRA_WORDS) return false;
    // A form of a sentence word ("lowers" for "lower"), but never a new negation.
    if (codePointLength(lower) >= 5 && sentenceStems.has(stem(w.text)) && !NEGATION_WORDS.has(lower)) continue;
    if (REWRITE_NEW_WORDS.has(lower) || extra.has(lower)) continue;
    return false;
  }
  return true;
}

/**
 * Reviewed small changes to framing, not a general paraphrase vocabulary.
 * A broad mark (for example an either/or phrase containing its own claim)
 * cannot safely be rewritten by a bag of words, so it has no template.
 */
function neutralMarkReplacements(ctx: CheckContext, original: string): readonly string[] {
  const text = collapse(original).toLowerCase();
  if (ctx.ruleId === "CONSENSUS_AS_EVIDENCE") {
    const expert = /^every serious (economist|scientist|doctor) agrees$/u.exec(text);
    if (expert) {
      const plural = `${expert[1]}s`;
      return [`many ${plural} say`, `some ${plural} say`, `${plural} think`, `some ${plural} think`];
    }
    if (/^(?:everyone|everybody) (?:agrees|knows)$/u.test(text)) return ["some people say", "some people think"];
  }
  if (ctx.ruleId === "CLAIM_WITHOUT_CITATION" && text === "studies show") return ["some studies say", "some studies suggest"];
  if (ctx.ruleId === "DISSENT_DISMISSAL" && text === "no serious scientist disputes") return ["some scientists say"];
  if (ctx.ruleId === "SHAME_LEVER" && text === "only a fool") return ["some people"];
  if (ctx.ruleId === "MORAL_HIGH_GROUND" && text === "any decent person can see") return ["some people think"];
  if (ctx.ruleId === "INSTITUTIONAL_POSITION_AS_SETTLED") {
    if (text === "has concluded that") return ["says that"];
    if (text === "has concluded") return ["says"];
  }
  return [];
}

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Keep all unmarked text in its original order, including short words,
 * pronouns, negation scope, punctuation, and subject/object relationships.
 * Only the actual engine spans can change, using the reviewed templates.
 * If this reconstruction is not demonstrable, drop the rewrite. This is a
 * conservative check of allowed edits, not a proof of semantic equivalence.
 */
function preservesUnmarkedText(ctx: CheckContext, plainer: string): boolean {
  const spans = spansOf(ctx);
  let pattern = "^";
  let from = 0;
  for (const span of spans) {
    const unchanged = ctx.sentence.slice(from, span.start).replace(/\s+/gu, " ");
    pattern += `${escapePattern(from === 0 ? unchanged.trimStart() : unchanged)}([\\s\\S]*?)`;
    from = span.end;
  }
  pattern += `${escapePattern(ctx.sentence.slice(from).replace(/\s+/gu, " ").trimEnd())}$`;
  const matched = new RegExp(pattern, "u").exec(plainer);
  if (!matched) return false;
  return spans.every((span, i) => neutralMarkReplacements(ctx, ctx.sentence.slice(span.start, span.end))
    .includes(collapse(matched[i + 1] ?? "").toLowerCase()));
}

/** Check 12: the engine no longer finds this move in the rewrite, and finds no move the sentence didn't have. */
function losesTheMove(ctx: CheckContext, plainer: string): PlainerState | undefined {
  let ids: string[];
  try {
    ids = ctx.engine.scan(plainer, ctx.domain).map((m) => m.ruleId);
  } catch {
    return "P_MOVE";
  }
  for (const id of ids) if (id === ctx.ruleId || !ctx.sentenceRuleIds.has(id)) return "P_MOVE";
  return undefined;
}

export function checkReply(reply: unknown, ctx: CheckContext): CheckResult {
  if (reply === null || typeof reply !== "object") return fail("E_OUT_SHAPE");
  // 1. It finished normally.
  if ((reply as { stop_reason?: unknown }).stop_reason !== "end_turn") return fail("E_OUT_STOP");
  // 2. One text block holding one JSON object with exactly the expected string fields.
  const obj = replyObject(reply);
  if (obj === undefined) return fail("E_OUT_SHAPE");
  const keys = Object.keys(obj).sort().join(",");
  const withPlainer = ctx.mode === "how-and-plainer";
  if (keys !== (withPlainer ? "how,plainer" : "how")) return fail("E_OUT_SHAPE");
  if (typeof obj.how !== "string" || (withPlainer && typeof obj.plainer !== "string")) return fail("E_OUT_SHAPE");
  const how = collapse(obj.how);
  const plainer = withPlainer ? collapse(obj.plainer as string) : null;
  const fields = plainer === null ? [how] : [how, plainer];

  // 5. Plain text only.
  if (!fields.every(plainText)) return fail("E_OUT_PLAIN_TEXT");
  // 3. Short.
  const howChars = codePointLength(how);
  if (
    howChars < 1 ||
    howChars > HOW_MAX_CHARS ||
    how.split(" ").length > HOW_MAX_WORDS ||
    sentenceCount(how) > HOW_MAX_SENTENCES
  ) {
    return fail("E_OUT_HOW");
  }
  // 4. The rewrite is about as long as the sentence.
  if (plainer !== null) {
    const max = Math.max(200, Math.floor(1.5 * codePointLength(ctx.sentence)));
    const n = codePointLength(plainer);
    if (n < 1 || n > max) return fail("E_OUT_PLAINER_LENGTH");
  }
  const sentenceWords = wordSet(ctx.sentence);
  // 6. No names, places or groups the sentence doesn't have, at a sentence's start or anywhere else.
  const allowed = new Set([...sentenceWords, ...wordSet(ctx.moveName), ...wordSet(ctx.moveShort ?? "")]);
  if (!fields.every((f) => noNewNames(f, allowed))) return fail("E_OUT_NAMES");
  // 6b. No side or group the sentence doesn't name.
  const sentenceSides = sideFamilies(ctx.sentence);
  if (fields.some((f) => [...sideFamilies(f)].some((family) => !sentenceSides.has(family)))) return fail("E_OUT_SIDES");
  // 7. No brand voice.
  if (!/biasclear/iu.test(ctx.sentence) && fields.some((f) => /biasclear/iu.test(f))) return fail("E_OUT_BRAND");
  // 8. No verdicts, labels or motives, unless quoting the sentence's own words.
  const quotes = exactQuotes(how, ctx.sentence);
  if (!noVerdicts(how, ctx.sentence, quotes)) return fail("E_OUT_VERDICT");
  if (plainer !== null && !noVerdicts(plainer, ctx.sentence, undefined)) return fail("E_OUT_VERDICT");
  // 9. The explanation points at the mark: it quotes the marked words.
  if (!quotesTheMark(quotes, ctx)) return fail("E_OUT_POINTS");
  // 9b. It describes the wording instead of repeating the sentence's clauses.
  if (!noEcho(how, ctx.sentence)) return fail("E_OUT_ECHO");
  // 9c. Every part of it is about the wording, not about the sentence's subject.
  if (!everyPartAboutWording(how)) return fail("E_OUT_POINTS");
  // 10. The rewrite is the same sentence.
  if (plainer !== null && !sameSentence(plainer, sentenceWords)) return fail("E_OUT_SAME_SENTENCE");

  if (plainer === null) return { ok: true, how, plainer: null, plainerState: "off" };
  // 11 and 12: a weak rewrite is dropped, the explanation stays.
  // 11b (after 12, so a rewrite that adds a move is reported as P_MOVE):
  // nothing but neutral words replaces the mark, and nothing is added.
  const dropped =
    keepsSpeakerCertaintyAndClaim(ctx, plainer) ??
    losesTheMove(ctx, plainer) ??
    (onlyNeutralNewWords(ctx, plainer) && preservesUnmarkedText(ctx, plainer) ? undefined : "P_CLAIM");
  if (dropped !== undefined) return { ok: true, how, plainer: null, plainerState: dropped };
  return { ok: true, how, plainer, plainerState: "kept" };
}
