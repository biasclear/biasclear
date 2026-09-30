// Run every rule-pack regex through JavaScript's RegExp and report matches.
// Used by tests/test_regex_subset.py (skipped when node is not installed).
// Usage: node tests/portability.mjs rules/biasclear-rules.json tests/golden/v1_parity.json
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [packPath, goldenPath] = process.argv.slice(2);
const pack = JSON.parse(readFileSync(packPath, "utf8"));
const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

// UTF-16 index -> code point index, so offsets compare with Python's.
function codePointIndex(text) {
  const map = new Array(text.length + 1);
  let cp = 0;
  for (let i = 0; i <= text.length; i++) {
    map[i] = cp;
    const c = text.charCodeAt(i);
    if (!(c >= 0xd800 && c <= 0xdbff && i + 1 < text.length)) cp++;
  }
  return map;
}

function spans(regex, text, map) {
  const out = [];
  for (const m of text.matchAll(regex)) out.push([map[m.index], map[m.index + m[0].length]]);
  return out;
}

const compileErrors = [];
function compile(source, flags) {
  for (const extra of ["g", "gu"]) {
    try { new RegExp(source, flags + extra); } catch (e) { compileErrors.push([source, flags + extra, String(e)]); }
  }
  return new RegExp(source, flags + "g");
}

const rules = pack.rules.map((r) => ({ id: r.id, indicators: r.indicators.map((s) => compile(s, r.flags)) }));
const cs = pack.citation_suppression;
const citations = cs.patterns.map((s) => compile(s, cs.flags));

const cases = golden.cases.map((c) => {
  const map = codePointIndex(c.text);
  const ruleSpans = {};
  for (const r of rules) ruleSpans[r.id] = r.indicators.flatMap((rx) => spans(rx, c.text, map));
  return { rules: ruleSpans, citations: citations.map((rx) => spans(rx, c.text, map)) };
});

process.stdout.write(JSON.stringify({
  rules_hash: createHash("sha256").update(canonical(pack), "utf8").digest("hex"),
  compile_errors: compileErrors,
  cases,
}));
