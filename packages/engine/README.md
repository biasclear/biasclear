# @biasclear/engine

The BiasClear rule engine in TypeScript, for browsers and Node. It reads the same rule pack as the Python engine, [`rules/biasclear-rules.json`](../../rules/biasclear-rules.json), and returns the same results. It has no runtime dependencies, makes no network calls, uses no DOM or other host globals, and never evaluates code from strings.

It names the structural moves a text makes. It points at structure, never at people, and it is not a fact-checker. See the [main README](../../README.md) for what the rules do and do not do.

Status: alpha, and not published to npm yet (`"private": true` until the first npm release).

## Use

```js
import { scan } from "@biasclear/engine";

const result = scan("Everyone agrees we must act now. Either we pass this bill or the economy collapses.");
for (const move of result.moves) console.log(move.tier, move.ruleId, JSON.stringify(move.match));
```

```text
1 CONSENSUS_AS_EVIDENCE "Everyone agrees"
2 FEAR_URGENCY "act now"
2 FALSE_BINARY "Either we pass this bill or"
```

In a page, the browser bundle defines one global, `BiasClear`:

```html
<script src="biasclear.iife.min.js"></script>
<script>
  const { moves, counts } = BiasClear.scan(document.querySelector("textarea").value);
</script>
```

Serve the file from your own site; don't load it from a third party.

## API

`scan(text, { domain } = {})` returns `{ rulesVersion, rulesHash, moves, counts }`:

- `moves`: one entry per move, `{ ruleId, name, tier, domain, severity, start, end, match }`, sorted by `start`, then longest first, then rule-pack order. `severity` is a hand-set label (low, moderate, high or critical) carried over from v1. It has not been measured and is not a score of the text or the writer; it may be removed.
- `start` and `end` are **UTF-16 indices**, the indices JavaScript strings and DOM ranges use, so `match === text.slice(start, end)`. The Python engine returns code point offsets for the same moves; they differ only after a character outside the Basic Multilingual Plane, such as most emoji.
- `counts`: `{ "1": n, "2": n, "3": n }`, the number of moves per tier.
- `rulesVersion` and `rulesHash` identify the exact rules that ran. `rulesHash` equals the Python engine's `rules_hash`.
- `domain`: `"general"` (the default; `undefined` and `null` mean the same) runs the general rules; `"legal"`, `"media"` or `"financial"` add that domain's rules; `"all"` runs every rule.
- Errors: a `TypeError` if `text` is not a string (or the options are not an object), a `RangeError` if `text` is longer than `MAX_INPUT_CHARS` (200,000 code points, counted as Python counts them) or `domain` is unknown. Nothing is truncated.

`prepare({ domain } = {})` gets the rules ready ahead of a scan, one pattern per call: it translates the pattern, compiles it and runs it on two short texts. It returns `true` once every rule for that domain is ready. It is optional (a scan compiles what it needs by itself, with the same result) and exists so a page can spread the first scan's cost, which is noticeable on a slow phone, over short tasks:

```js
const step = () => { if (!BiasClear.prepare()) requestIdleCallback(step); };
requestIdleCallback(step);
```

Also exported: `DOMAINS`, `MAX_INPUT_CHARS`, `rulePack()` (a fresh copy of the bundled pack, for example to build a field guide from the rule names and descriptions), and the TypeScript types.

## Same results as the Python engine

The engine is a port of [`src/biasclear/_engine.py`](../../src/biasclear/_engine.py). It keeps every rule of the Python engine, including the ones carried over from v1:

- `min_matches` counts every match of every indicator, before overlaps are removed.
- Zero-length matches are never reported or counted. After one, the next match may still start at the same place if it is not empty, as with Python's `re.finditer`.
- Citation suppression drops a rule only when every one of its matches has a citation nearby. For each match it finds the *first* case-insensitive occurrence of the matched text in the whole input (which can be an earlier copy), takes 120 code points on each side, and looks for a citation pattern that overlaps that window (searching the window plus `CITATION_REACH`, 1,000 code points, on each side, so a long name inside a citation does not push it out). Where lowercasing changes the text's length (U+0130 lowercases to two code points), the index found in the lowercased text is used in the original text, as in Python.
- Overlaps are removed within each rule (earliest first, then longest), never across rules.
- Input is capped in code points, and a missing domain means `"general"`.

`scripts/parity.mjs` checks all of this on every text in [`tests/golden/`](../../tests/golden) and in the symmetry tests, for every domain, against the live Python engine (see Tests below).

### Unicode: the TypeScript engine reads the rules as Python does

The rule pack's regexes are written in the common syntax of Python's `re` and JavaScript's `RegExp`, but a few parts of that syntax mean different things on non-ASCII text. There were two choices: emulate Python in TypeScript, or move both engines to ASCII semantics in a new rules version. This engine emulates Python, so the rule pack and its version stay as they are and the Python engine is unchanged. [`src/regex.ts`](src/regex.ts) translates each regex once, when a scan first needs it (or when `prepare()` readies it):

| Python reads | Plain JavaScript reads | The translation |
|---|---|---|
| `\w`: any letter or number, and `_` | ASCII letters, digits and `_` | `[\p{L}\p{N}_]` |
| `\b`, `\B`: boundaries of that `\w` | ASCII boundaries | lookarounds on that class |
| `\d`: any decimal digit | ASCII digits | `\p{Nd}` |
| `\s`: `str.isspace()`, with U+001C to U+001F and U+0085, without U+FEFF | its own set | that exact set |
| `i`: also matches U+0130 and U+0131 for `i`, U+017F for `s`, U+212A for `k` | case folding that misses U+0130 and U+0131 | each letter spelled out with its variants; a cased non-ASCII character under `i` is rejected |
| `.`, `{m,n}` and lookbehind count code points | they count UTF-16 units | the `u` flag, and `.` as "any code point" |

[`tests/golden/unicode_parity.json`](../../tests/golden/unicode_parity.json) pins this with 27 cases (made by [`scripts/make_unicode_golden.py`](../../scripts/make_unicode_golden.py)); 19 of them come out differently with plain JavaScript regexes, and a test checks each case's claim. The parity script also compares, code point by code point, every character class, escape and case-insensitive letter the pack uses, and lowercasing.

One limit remains: each engine uses its own runtime's Unicode database (Python 3.10 has Unicode 13, Node 22 has Unicode 17). A character assigned in one version and not the other can be read differently, so the code point comparison covers the characters both databases assign.

## rulesHash

`rulesHash` is the SHA-256 of the rule pack in RFC 8785 canonical JSON, as in Python. It is computed **at build time** with `node:crypto` by [`scripts/gen-pack.mjs`](scripts/gen-pack.mjs), and embedded next to the pack, so `scan()` stays synchronous; Web Crypto's `digest` is asynchronous, and no SHA-256 code ships in the bundle. The tests recompute it at test time with Web Crypto (`crypto.subtle.digest`, as a browser would) and with `node:crypto`, and the parity script compares it with Python's `rules_hash`.

## Build

```bash
npm ci
npm run build
```

`scripts/gen-pack.mjs` reads `rules/biasclear-rules.json` on every build, typecheck and test run and writes `src/generated/pack.ts` (not committed), so there is no second copy of the pack to keep in sync. `scripts/build.mjs` then writes:

| File | What | Size | Gzipped |
|---|---|---|---|
| `dist/index.js` | ES module (not minified) | 558.8 KB | 53.0 KB |
| `dist/biasclear.iife.min.js` | minified browser bundle (global `BiasClear`) | 546.1 KB | 50.9 KB |
| `dist/*.d.ts` | type declarations | | |

Both bundles include the whole rule pack, which is most of their size. The sizes are what `scripts/build.mjs` prints for rules version 2.0.0a5 (1 KB is 1,024 bytes; gzip at level 9). The browser bundle's budget is 60 KB gzipped (`GZIP_BUDGET` in `scripts/build.mjs`), and it uses 50.9 KB, 85% of it. The build fails if the bundle goes over. `test/bundle.test.ts` checks this table, the rules version and the share of the budget against the built files, so a rule change that moves a size updates this table too.

The engine needs RegExp lookbehind and Unicode property escapes (Chrome 64, Firefox 78, Safari 16.4), and the bundles use ES2020 syntax such as `??` (Chrome 80, Firefox 72, Safari 13.1). So: Chrome 80, Firefox 78 or Safari 16.4 or later, and Node 22.12 or later for the tooling.

## Tests

```bash
PYTHON=python3 npm test
```

`npm test` runs, in order: the typecheck of the source and the tests, the build, the unit tests, and the parity check. `PYTHON` must name a Python that has pytest installed (`pip install '.[test]'` from the repo root); the parity check runs the Python engine from this repo's `src/`.

- `test/engine.test.ts`: the API, domains, errors, input cap, offsets, citation suppression, `min_matches`, overlaps, Python's iteration after empty matches (with made-up rules, like the monkeypatched engine in `tests/test_engine.py`), and `prepare()`, which must change no result.
- `test/regex.test.ts`: the translation, case by case, against what Python's `re` does; that every pack regex translates; that the speed rewrites (below) find the same matches as the plain translation on every golden text.
- `test/golden.test.ts`: every case in `tests/golden/*.json`, for every domain, with offsets converted to UTF-16.
- `test/hash.test.ts`: `rulesHash` with Web Crypto and `node:crypto`, and that the embedded pack matches `rules/biasclear-rules.json`.
- `test/redos.test.ts`: the ReDoS guard. Every regex must finish in under 50 ms (best of three runs) on each of a set of 20,000-character strings built from its own words and punctuation (the test prints how many), including a bracket followed by a chain of words joined by each punctuation mark, and a bracket followed by a run of one non-ASCII letter. It also tries sentence ends followed by a closing quote or bracket, quoted dialogue and runs of whitespace (rules 2.0.0a4 fixed two quadratic cases). Timed scans check that a citation's dash-joined names and its non-ASCII names, and those sentence ends and whitespace, are read in linear time (rules 2.0.0a3 fixed exponential cases).
- `test/bundle.test.ts`: the built files. The browser bundle runs in an empty VM context (ECMAScript built-ins only, with code generation from strings turned off) and gives the same results as the ES module and the source. The source is scanned for host globals, `eval`, `Function` and `import()`, and `tsconfig.json` compiles it against ECMAScript only, so a reference to `window`, `document`, `fetch`, `crypto` or `process` does not compile.
- `scripts/parity.mjs` (`npm run parity`, after a build): see "Same results as the Python engine". CI runs it against Python 3.10 to 3.14.

### Speed

A lookaround test of `[\p{L}\p{N}_]` is slow on characters outside the BMP, and a pattern that starts with one hides its first letters from the regex engine's fast scan. So the translation makes three rewrites where they mean the same thing: a `\b` next to something that must start (or end) with a word character becomes a single lookbehind (or lookahead); assertions at the same position are reordered so the cheap ones run first; and a pattern whose first character comes from a short known list gets a lookahead for that list. `translate(pattern, flags, { optimize: false })` skips them, and a test checks that both forms find the same matches. They exist because text made of emoji scanned slowly without them.

V8 stops optimizing a regex whose source is longer than 20 KB (`kRegExpTooLargeToOptimize`), and such a regex runs several times slower. So the translation writes letters and digits as themselves rather than as escapes (`[Aa]` rather than `[\u{41}\u{61}]`, and one character per letter in a class of accented capitals), which roughly halves most translated patterns. Surrogates keep the braced `\u{...}` form, so two neighbouring escapes are never read as one code point.

## Development dependencies

There are no runtime dependencies. The development dependencies are pinned exactly and never reach `dist/`:

- `typescript`: compiles and typechecks the source (strict) and the tests, and writes the type declarations.
- `vitest`: runs the tests, including TypeScript test files, without a separate compile step.
- `esbuild`: the one bundler. It bundles the source and the generated pack into the ES module and the minified browser bundle in one step, and it is a single binary with no dependencies of its own.

The tests need a few Node APIs; `test/node.d.ts` types them by hand, so `@types/node` isn't needed.

## License

The code is licensed under the Apache License 2.0. The rule pack, which the bundles include, is licensed under CC BY 4.0 ([`rules/LICENSE`](../../rules/LICENSE)).
