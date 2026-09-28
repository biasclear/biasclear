// Parity between the Python engine (src/biasclear) and the built TypeScript
// engine (dist/), run live on the same texts. Fails on any difference.
//
// 1. Every text in tests/golden/*.json and every text in the symmetry tests
//    (tests/test_symmetry.py) is scanned by both engines for every domain
//    (none, general, legal, media, financial, all). The whole result must be
//    identical: rules version and hash, every move's rule, name, tier,
//    domain, severity, offsets and match, and the counts. Python's offsets
//    are code points; they are converted to UTF-16 before comparing. The ES
//    module and the browser bundle (run in an empty VM context) both run.
// 2. The symmetry suite, in TypeScript: every swapped pair raises the same
//    rules, and every rule in the pack is raised by at least one pair.
// 3. The Unicode building blocks: for each character class, escape and
//    case-insensitive letter the pack uses (and a few more), the set of code
//    points it matches alone must be the same in both engines, over every
//    code point both Unicode databases assign. Likewise str.lower() and
//    String.prototype.toLowerCase(), which the citation lookup uses.
//
// Usage: npm run build && node scripts/parity.mjs
// Environment: PYTHON (default python3) must have pytest installed.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import * as esbuild from "esbuild";
import { ESM_FILE, IIFE_FILE } from "./build.mjs";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(PACKAGE, "..", "..");
const PYTHON = process.env.PYTHON || "python3";

const failures = [];
function fail(message) {
  failures.push(message);
}

// --- The TypeScript side ---------------------------------------------------

const esm = await import(pathToFileURL(ESM_FILE).href);
const vm = createContext({}, { codeGeneration: { strings: false, wasm: false } });
runInContext(readFileSync(IIFE_FILE, "utf8"), vm);
const iifeScan = (text, options) => {
  vm.text = text;
  vm.options = options;
  return JSON.parse(runInContext("JSON.stringify(BiasClear.scan(text, options))", vm));
};

// The translator is internal, so compile it from source for the probes.
const bundled = await esbuild.build({
  absWorkingDir: PACKAGE,
  entryPoints: ["src/regex.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "warning",
});
const { translate } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

// --- Probes ------------------------------------------------------------------

const pack = JSON.parse(readFileSync(join(ROOT, "rules", "biasclear-rules.json"), "utf8"));
const probes = new Map();
const addProbe = (pattern, flags) => probes.set(`${flags}\u0000${pattern}`, [pattern, flags]);
for (const flags of ["", "i"]) {
  for (const p of ["\\w", "\\W", "\\d", "\\D", "\\s", "\\S", "[\\w\\s]", "[^\\W\\d]", "[\\S\\d]", "[^\\s]"]) addProbe(p, flags);
  for (let c = 0x41; c <= 0x5a; c++) {
    addProbe(String.fromCharCode(c), flags);
    addProbe(String.fromCharCode(c + 0x20), flags);
  }
}
addProbe(".", "");
addProbe(".", "s");
addProbe("[\\wA-Z]", "i");
addProbe("[^a-z]", "i");
const regexes = [
  ...pack.rules.flatMap((r) => r.indicators.map((p) => [p, r.flags])),
  ...pack.citation_suppression.patterns.map((p) => [p, pack.citation_suppression.flags]),
];
for (const [pattern, flags] of regexes) {
  for (const m of pattern.matchAll(/\[\^?(?:\\.|[^\]\\])+\]/g)) addProbe(m[0], flags);
  for (const ch of pattern) if (ch.codePointAt(0) > 0x7f) addProbe(ch, flags);
}
const probeList = [...probes.values()];

// --- The Python side -----------------------------------------------------------

const python = spawnSync(PYTHON, [join(PACKAGE, "scripts", "parity_dump.py")], {
  input: JSON.stringify({ probes: probeList }),
  encoding: "utf8",
  maxBuffer: 1 << 30,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
});
if (python.status !== 0) {
  console.error(python.stderr || python.error);
  console.error(`parity: ${PYTHON} scripts/parity_dump.py failed (it needs pytest: pip install '.[test]')`);
  process.exit(1);
}
const py = JSON.parse(python.stdout);

// --- 1. Texts ------------------------------------------------------------------

/** UTF-16 index of each code point index of `text`. */
function units(text) {
  const map = [];
  let u = 0;
  for (const ch of text) {
    map.push(u);
    u += ch.length;
  }
  map.push(u);
  return map;
}

function fromPython(result, text) {
  const map = units(text);
  return {
    rulesVersion: result.rules_version,
    rulesHash: result.rules_hash,
    moves: result.moves.map((m) => ({
      ruleId: m.rule_id,
      name: m.name,
      tier: m.tier,
      domain: m.domain,
      severity: m.severity,
      start: map[m.start],
      end: map[m.end],
      match: m.match,
    })),
    counts: result.counts,
  };
}

const goldenTexts = readdirSync(join(ROOT, "tests", "golden"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(join(ROOT, "tests", "golden", f), "utf8")).cases.map((c) => c.text));
if (goldenTexts.length !== py.golden.length) {
  fail(`golden texts: Python read ${py.golden.length}, TypeScript read ${goldenTexts.length}`);
}
goldenTexts.forEach((text, i) => {
  if (py.texts[py.golden[i]]?.text !== text) fail(`golden text ${i} differs between the two reads`);
});

const tsDomains = py.domains.map((d) => (d === null ? undefined : d));
let compared = 0;
for (const { src, text, results } of py.texts) {
  tsDomains.forEach((domain, k) => {
    const options = domain === undefined ? undefined : { domain };
    const want = JSON.stringify(fromPython(results[k], text));
    const fromEsm = JSON.stringify(esm.scan(text, options));
    const fromIife = JSON.stringify(iifeScan(text, options));
    compared++;
    if (fromEsm !== want) fail(`${src} (domain ${domain}): ES module ${fromEsm}\n  Python ${want}`);
    if (fromIife !== fromEsm) fail(`${src} (domain ${domain}): browser bundle differs from ES module`);
  });
}
const hash = py.texts[0]?.results[0]?.rules_hash;
if (esm.scan("").rulesHash !== hash) fail(`rules hash: TypeScript ${esm.scan("").rulesHash}, Python ${hash}`);

// --- 2. Symmetry -----------------------------------------------------------------

const ids = (text) => [...new Set(esm.scan(text, { domain: "all" }).moves.map((m) => m.ruleId))].sort().join(",");
const raisedByPairs = new Set();
for (const [group, pairs] of Object.entries(py.pairs)) {
  for (const [a, b] of pairs) {
    const [ta, tb] = [py.texts[a].text, py.texts[b].text];
    if (group === "symmetric" && ids(ta) === "") fail(`symmetry: template raised nothing: ${JSON.stringify(ta)}`);
    if (ids(ta) !== ids(tb)) fail(`symmetry: ${JSON.stringify(ta)} -> ${ids(ta)} but ${JSON.stringify(tb)} -> ${ids(tb)}`);
    for (const id of ids(ta).split(",")) if (id !== "") raisedByPairs.add(id);
  }
}
for (const rule of pack.rules) {
  if (!raisedByPairs.has(rule.id)) fail(`symmetry: no swapped pair raises ${rule.id}`);
}

// --- 3. Code point tables ------------------------------------------------------------

const SIZE = 0x110000;
const ALL = (() => {
  const parts = [];
  for (let c = 0; c < SIZE; c += 0x1000) {
    const chunk = [];
    for (let d = c; d < Math.min(c + 0x1000, SIZE); d++) if (d < 0xd800 || d > 0xdfff) chunk.push(d);
    parts.push(String.fromCodePoint(...chunk));
  }
  return parts.join("");
})();
const unitToPoint = new Uint32Array(ALL.length + 1);
{
  let cp = 0;
  for (let i = 0; i < ALL.length; cp++) {
    if (cp === 0xd800) cp = 0xe000;
    const width = cp > 0xffff ? 2 : 1;
    for (let k = 0; k < width; k++) unitToPoint[i + k] = cp;
    i += width;
  }
}

function bitmap(rangeList) {
  const bits = new Uint8Array(SIZE);
  for (const [lo, hi] of rangeList) bits.fill(1, lo, hi + 1);
  return bits;
}

const assigned = bitmap(py.assigned);
const unassignedInJs = /\p{Cn}/u;
let both = 0;
for (let c = 0; c < SIZE; c++) {
  if (assigned[c] && unassignedInJs.test(String.fromCodePoint(c))) assigned[c] = 0;
  both += assigned[c];
}

probeList.forEach(([pattern, flags], k) => {
  const source = translate(pattern, flags).source;
  const js = new Uint8Array(SIZE);
  for (const m of ALL.matchAll(new RegExp(`(?:${source})+`, "gu"))) {
    for (let i = m.index; i < m.index + m[0].length; i++) js[unitToPoint[i]] = 1;
  }
  const one = new RegExp(`^(?:${source})$`, "u");
  for (let c = 0xd800; c <= 0xdfff; c++) js[c] = one.test(String.fromCharCode(c)) ? 1 : 0;
  const pyBits = bitmap(py.probes[k]);
  const differ = [];
  for (let c = 0; c < SIZE; c++) {
    if (assigned[c] && js[c] !== pyBits[c]) differ.push(`U+${c.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  if (differ.length > 0) {
    fail(`probe ${JSON.stringify(pattern)} (flags "${flags}"): differs on ${differ.length} code points: ${differ.slice(0, 8).join(" ")}`);
  }
});

let lowered = 0;
for (let c = 0; c < SIZE; c++) {
  if (!assigned[c]) continue;
  const ch = String.fromCodePoint(c);
  const want = py.lower[c] ?? ch;
  if (ch.toLowerCase() !== want) fail(`lowercase of U+${c.toString(16).toUpperCase()}: JavaScript ${JSON.stringify(ch.toLowerCase())}, Python ${JSON.stringify(want)}`);
  lowered++;
}

// --- Report ----------------------------------------------------------------------------

const unicodeJs = process.versions.unicode ?? "unknown";
console.log(`parity: Python ${py.python} (Unicode ${py.unicode}, ${py.engine_file}) vs dist/ (Node ${process.versions.node}, Unicode ${unicodeJs})`);
console.log(`  rules hash ${hash}`);
console.log(`  ${py.texts.length} texts (${goldenTexts.length} golden, the rest from the symmetry tests) x ${tsDomains.length} domains = ${compared} scans, ES module and browser bundle`);
console.log(`  symmetry: ${py.pairs.symmetric.length} template pairs, ${py.pairs.red_team.length} red-team pairs`);
console.log(`  ${probeList.length} regex probes and lowercasing over ${both} code points assigned in both`);
if (failures.length > 0) {
  console.error(`\nparity FAILED: ${failures.length} differences`);
  for (const f of failures.slice(0, 20)) console.error(`- ${f}`);
  process.exit(1);
}
console.log("parity: identical");
