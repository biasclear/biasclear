// Build the BiasClear website into _site/ (gitignored), ready for GitHub Pages.
//
//   1. Builds the engine (packages/engine/scripts/build.mjs). The browser
//      bundle the site serves is that build, copied byte for byte, so the
//      site always runs the tested engine and the current rule pack.
//   2. Reads the rule pack, site/data/*.json, the citation in README.md, and
//      the test counts (scripts/site_facts.py, which needs pytest).
//   3. Checks every claim the pages make from that data with the engine:
//      each Field Guide example, honest version, fair use and "misses"
//      sentence, and each example on the home page. A claim that no longer
//      holds stops the build.
//   4. Writes the pages from site/pages/ into one layout, with a strict
//      Content-Security-Policy and relative links only, and copies the
//      styles, scripts, typefaces and images.
//
// Usage:  node scripts/build-site.mjs [--out DIR] [--skip-engine-build]
// Env:    PYTHON    the Python that runs scripts/site_facts.py (default python3)
//         SITE_URL  the site's public address (the Pages workflow passes it).
//                   Used only for the link-preview tags (og:url, og:image),
//                   which must be absolute; every link and asset stays relative.
//
// No runtime dependencies. It needs packages/engine's dev dependencies
// (npm ci in packages/engine) to build the engine.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SITE = join(ROOT, "site");
export const ENGINE = join(ROOT, "packages", "engine");
export const ENGINE_IIFE = join(ENGINE, "dist", "biasclear.iife.min.js");
export const ENGINE_ESM = join(ENGINE, "dist", "index.js");
/** Where the site serves the engine's browser bundle. */
export const BUNDLE_PATH = "js/biasclear.iife.min.js";
export const REPO = "https://github.com/biasclear/biasclear";
/**
 * Every page's policy: files from this site only; no fetch, XHR, beacon,
 * WebSocket or EventSource connection (connect-src 'none'); and, where the
 * browser supports Trusted Types, no string ever parsed as HTML or run as code.
 * It does not govern navigation or requests for the site's own files; the
 * page's own scripts use none of those connections (site/test/site.test.mjs)
 * and ask for nothing once the page, its images and typefaces are in.
 */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  "require-trusted-types-for 'script'; trusted-types 'none'";
export const REFERRER = "no-referrer";
/** The checker reads at most this many characters (UTF-16 units) of pasted text. */
export const UI_MAX = 20_000;
/** The link-preview image: docs/img/social-preview.png (made by scripts/readme-images.mjs), served here. */
export const SOCIAL_IMAGE = "img/social-preview.png";
const SOCIAL_SIZE = [1280, 640];
/** The three rules that replaced v1's CREDENTIAL_AS_PROOF and INSTITUTIONAL_NEUTRALITY (rules/RULE_CHANGES.md). */
const REBUILT = ["CREDENTIAL_AS_PREMISE", "INSTITUTIONAL_POSITION_AS_SETTLED", "NEUTRALITY_CLAIM"];
const ROMAN = { 1: "I", 2: "II", 3: "III" };
const DOMAIN_NAMES = { general: "General", legal: "Legal", media: "News and media", financial: "Finance" };
const TIER_PLAIN = {
  1: "Moves that decide what counts as common sense before any evidence is weighed: agreement, tradition, momentum or a quiet verdict stands in for a reason.",
  2: "Moves that work on feelings (fear, shame, belonging, frustration, hope) so that a reaction takes the place of a reason.",
  3: "Moves that borrow the voice or weight of an office, a credential or an organization, so that official standing takes the place of a reason.",
};

// ------------------------------------------------------------------ small helpers

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const nf = (n) => n.toLocaleString("en-US");
const plural = (n, w) => `${nf(n)} ${w}${n === 1 ? "" : "s"}`;
const words = (t) => (t.trim().match(/\S+/g) ?? []).length;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** A count as prose: words below ten, figures from ten up; `cap` for the start of a sentence. */
const say = (n, cap = false) => {
  const w = n < 10 ? WORDS[n] : nf(n);
  return cap ? w[0].toUpperCase() + w.slice(1) : w;
};
/** Straight double quotes in prose become curly ones. Apostrophes are left alone: some entries are about them. */
const curly = (s) => s.replace(/"([^"\n]*)"/g, "\u201c$1\u201d");
/** Escape text for HTML element content and quoted attribute values. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** The Field Guide anchor of a rule: CONSENSUS_AS_EVIDENCE -> consensus-as-evidence. */
export const anchor = (id) => id.toLowerCase().replace(/_/g, "-");

class BuildError extends Error {}
function check(ok, message) {
  if (!ok) throw new BuildError(message);
}

/** Group overlapping [start, end) ranges; each group keeps its items in order. */
function clusters(items) {
  const out = [];
  for (const it of [...items].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out[out.length - 1];
    if (last && it.start < last.end) {
      last.end = Math.max(last.end, it.end);
      last.items.push(it);
    } else out.push({ start: it.start, end: it.end, items: [it] });
  }
  return out;
}

/**
 * Text with highlights. `items` are {start, end, kind: "hit"|"miss", move?}.
 * A hit is marked in its first move's tier colour, and says which moves it is
 * for screen readers; a miss gets the dotted underline.
 */
function marked(text, items, names) {
  let out = "";
  let at = 0;
  for (const c of clusters(items)) {
    out += esc(text.slice(at, c.start));
    const q = esc(text.slice(c.start, c.end));
    const hits = c.items.filter((i) => i.kind === "hit");
    if (hits.length) {
      const said = hits.map((h) => names[h.move.ruleId].name).join(", ");
      out += `<mark class="hl t${hits[0].move.tier}">${q}<span class="sr-only"> (marked: ${esc(said)})</span></mark>`;
    } else {
      out += `<span class="miss">${q}<span class="sr-only"> (missed)</span></span>`;
    }
    at = c.end;
  }
  return out + esc(text.slice(at));
}

const hitsOf = (moves) => moves.map((m) => ({ start: m.start, end: m.end, kind: "hit", move: m }));

// ------------------------------------------------------------------ inputs

function buildEngine() {
  if (!existsSync(join(ENGINE, "node_modules", "esbuild"))) {
    throw new BuildError("packages/engine has no node_modules: run `npm ci` in packages/engine first");
  }
  const run = spawnSync(process.execPath, [join(ENGINE, "scripts", "build.mjs")], { cwd: ENGINE, stdio: "inherit" });
  check(run.status === 0, "the engine build failed");
}

function siteFacts() {
  const python = process.env.PYTHON || "python3";
  const run = spawnSync(python, [join(ROOT, "scripts", "site_facts.py")], { cwd: ROOT, encoding: "utf8" });
  check(
    run.status === 0,
    `scripts/site_facts.py failed (it imports tests/test_symmetry.py, which needs pytest: pip install '.[test]'):\n${run.stderr}`,
  );
  return JSON.parse(run.stdout);
}

/** The citation block and DOI, exactly as README.md has them. */
function citation() {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\r\n?/g, "\n");
  const block = readme.match(/```bibtex\n([\s\S]*?)\n```/);
  check(block, "README.md has no ```bibtex citation block");
  const doi = block[1].match(/doi\s*=\s*\{([^}]+)\}/);
  check(doi, "the README citation has no doi");
  check(/^## v1 claims withdrawn$/m.test(readme), 'README.md has no "## v1 claims withdrawn" section for the About page to link to (#v1-claims-withdrawn)');
  return { bibtex: block[1], doi: doi[1] };
}

/** The quoted examples in a "misses" paragraph that must have a check: three or more words, no gaps or slashes. */
export function quotedExamples(text) {
  const out = [];
  for (const m of text.matchAll(/"([^"]+)"|“([^”]+)”/g)) {
    const q = m[1] ?? m[2];
    if (q.split(/\s+/).filter(Boolean).length < 3 || q.includes(" ... ") || q.includes("___") || q.includes("/")) continue;
    out.push(q);
  }
  return out;
}

// ------------------------------------------------------------------ checks on the data

function checkMoves(pack, moveNames) {
  const ids = pack.rules.map((r) => r.id);
  const named = Object.keys(moveNames.moves);
  const missing = ids.filter((id) => !named.includes(id));
  const extra = named.filter((id) => !ids.includes(id));
  check(!missing.length, `site/data/moves.json has no name for: ${missing.join(", ")}`);
  check(!extra.length, `site/data/moves.json names rules the pack does not have: ${extra.join(", ")}`);
  const seen = new Set();
  for (const id of ids) {
    const m = moveNames.moves[id];
    check(m.name && m.short, `site/data/moves.json: ${id} needs a name and a short description`);
    check(!seen.has(m.name), `site/data/moves.json: the name "${m.name}" is used twice`);
    seen.add(m.name);
  }
}

/** Every claim the Field Guide makes from its data, checked with the engine. Returns the problems found. */
export function checkGuide(guide, pack, scan) {
  const problems = [];
  const rules = new Map(pack.rules.map((r) => [r.id, r]));
  const marks = (text, domain, rule) =>
    scan(text, { domain }).moves.filter((m) => rule === "*" || m.ruleId === rule);
  const ids = new Set();
  for (const e of guide) {
    const rule = rules.get(e.id);
    if (!rule) {
      problems.push(`${e.id}: not in the rule pack`);
      continue;
    }
    if (ids.has(e.id)) problems.push(`${e.id}: two entries`);
    ids.add(e.id);
    if (rule.pit_tier !== e.pit_tier) problems.push(`${e.id}: tier ${e.pit_tier}, but the pack says ${rule.pit_tier}`);
    if (rule.domain !== e.domain) problems.push(`${e.id}: domain ${e.domain}, but the pack says ${rule.domain}`);
    // An example shows its own move and no other, in its entry's domain (the
    // rules the entry is shown with); its honest version shows none, and the
    // fair use shows no move but the entry's own.
    const others = (text) => [...new Set(marks(text, e.domain, "*").filter((m) => m.ruleId !== e.id).map((m) => m.ruleId))];
    e.examples.forEach((x, i) => {
      const hits = marks(x.text, e.domain, e.id);
      if (!hits.length) problems.push(`${e.id} example ${i + 1}: the rule marks nothing`);
      const at = x.text.indexOf(x.flagged_span);
      if (at < 0) problems.push(`${e.id} example ${i + 1}: "${x.flagged_span}" is not in the text`);
      else if (!hits.some((h) => h.start < at + x.flagged_span.length && at < h.end)) {
        problems.push(`${e.id} example ${i + 1}: the rule does not mark "${x.flagged_span}"`);
      }
      const also = others(x.text);
      if (also.length) problems.push(`${e.id} example ${i + 1}: also marks ${also.join(", ")}; an example shows only its own move`);
      if (marks(x.honest_version, e.domain, "*").length) problems.push(`${e.id} example ${i + 1}: the honest version is marked`);
    });
    const fa = marks(e.false_alarm.text, e.domain, e.id).length > 0;
    if (fa !== e.false_alarm.engine_flags_it) {
      problems.push(`${e.id}: the fair use is ${fa ? "" : "not "}marked, but the data says engine_flags_it: ${e.false_alarm.engine_flags_it}`);
    }
    const faAlso = others(e.false_alarm.text);
    if (faAlso.length) problems.push(`${e.id}: the fair use also marks ${faAlso.join(", ")}`);
    const checks = e.checks ?? [];
    for (const c of checks) {
      const got = marks(c.text, c.domain, c.rule).length > 0;
      if (got !== c.flagged) problems.push(`${e.id}: "${c.text}" (${c.domain}, ${c.rule}) is ${got ? "" : "not "}marked, but the check says flagged: ${c.flagged}`);
    }
    for (const q of quotedExamples(e.misses)) {
      if (!checks.some((c) => c.text === q)) problems.push(`${e.id}: the "misses" paragraph quotes "${q}" with no check`);
    }
  }
  return problems;
}

/** Every example on the home page, checked with the engine. Returns the problems found. */
export function checkHome(home, scan) {
  const problems = [];
  const ruleIds = (t) => scan(t).moves.map((m) => m.ruleId).sort();
  for (const [tier, ex] of Object.entries(home.tiers)) {
    const got = ruleIds(ex.text);
    if (got.join() !== [...ex.expect].sort().join()) problems.push(`tier ${tier} example raises [${got}], expected [${ex.expect}]`);
    if (scan(ex.text).moves.some((m) => String(m.tier) !== tier)) problems.push(`tier ${tier} example raises a move of another tier`);
  }
  for (const ex of home.exhibits) {
    const moves = scan(ex.text).moves;
    for (const m of ex.missed) {
      const at = ex.text.indexOf(m.q);
      if (at < 0) problems.push(`exhibit ${ex.id}: "${m.q}" is not in the text`);
      else if (moves.some((mv) => mv.start < at + m.q.length && at < mv.end)) problems.push(`exhibit ${ex.id}: "${m.q}" is marked, not missed`);
    }
  }
  for (const g of home.limits) {
    for (const row of g.rows) {
      const got = ruleIds(row.text);
      if (got.join() !== [...row.expect].sort().join()) problems.push(`limits "${row.kind}" raises [${got}], expected [${row.expect}]`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ page parts

function header(root, nav, rulesVersion) {
  const link = (key, href, label, cls = "") =>
    `<a${cls ? ` class="${cls}"` : ""} href="${href}"${nav === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="wrap">
  <div class="mast">
    <div class="brandline">
      <a class="wm" href="${root}" aria-label="BiasClear, home">Bias<em>Clear</em></a>
      <a class="pv" href="${root}about.html#status" aria-label="Public preview: what that means">Preview</a>
    </div>
    <nav aria-label="Site">
      ${link("home", root, "Checker", "nv-home")}
      ${link("guide", `${root}guide/`, "Field Guide")}
      ${link("method", `${root}method.html`, "Method")}
      ${link("privacy", `${root}privacy.html`, "Privacy")}
      ${link("about", `${root}about.html`, "About")}
      <a class="gh" href="${REPO}">GitHub</a>
    </nav>
    <div class="tone" role="group" aria-label="Page tone">
      <button type="button" data-tone="light" aria-pressed="true" aria-label="Paper: light page">Paper</button>
      <button type="button" data-tone="dark" aria-pressed="false" aria-label="Ink: dark page">Ink</button>
    </div>
  </div>
  <div class="folio">
    <p class="lab"><span class="fo-l">Reads text for persuasion. </span>Free. Runs in this tab.</p>
    <p class="lab">No cookies. No accounts. Rules <span class="ver">${esc(rulesVersion)}</span>.</p>
  </div>
</header>`;
}

function footer(root, rulesVersion, doi, commit) {
  const built = commit
    ? ` &middot; built from <a href="${esc(commit.url)}">${esc(commit.sha.slice(0, 7))}</a>`
    : "";
  return `<footer class="wrap">
  <div class="g12 foot">
    <div class="brand">
      <a class="wm" href="${root}">Bias<em>Clear</em></a>
      <p>See how a text is built to move you.</p>
    </div>
    <nav class="links" aria-label="More">
      <a href="${root}guide/">Field Guide</a>
      <a href="${root}method.html">Method</a>
      <a href="${root}privacy.html">Privacy</a>
      <a href="${root}about.html">About</a>
      <a class="wide" href="${REPO}">Source on GitHub</a>
      <a class="wide" href="https://doi.org/${esc(doi)}">Built on Persistent Influence Theory (Slimp, 2026)</a>
    </nav>
    <div class="contact">
      <p>Write to</p>
      <a class="email" href="mailto:hello@biasclear.com">hello@biasclear.com</a>
    </div>
    <div class="fine">
      <p>Points at structure, never at people. Not a fact-checker. No truth score.</p>
      <p>Rules ${esc(rulesVersion)}${built} &middot; Set in Newsreader and DM Mono</p>
    </div>
  </div>
</footer>`;
}

/**
 * The site's public address for link previews, or null. It must be https,
 * with no query or fragment; a trailing slash is added.
 */
export function siteAddress(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BuildError(`SITE_URL is not an address: ${value}`);
  }
  check(url.protocol === "https:" && !url.search && !url.hash && !url.username, `SITE_URL must be a plain https address: ${value}`);
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * The path the site is served under: SITE_URL's path, or /biasclear/ (the
 * GitHub Pages project address) without one. GitHub Pages serves 404.html
 * for a missing address at any depth, so that page's links, styles and
 * scripts are anchored at this path instead of being relative.
 */
export function basePath(site) {
  return site ? new URL(site).pathname : "/biasclear/";
}

/** Link-preview tags. Absolute by necessity, so only with a known site address. */
function previewTags(meta, site) {
  if (!site) return `<meta name="twitter:card" content="summary">`;
  const page = meta.path === "404.html" ? "" : `<meta property="og:url" content="${esc(new URL(meta.path.replace(/(^|\/)index\.html$/, "$1"), site).href)}">\n`;
  return `${page}<meta property="og:image" content="${esc(new URL(SOCIAL_IMAGE, site).href)}">
<meta property="og:image:width" content="${SOCIAL_SIZE[0]}">
<meta property="og:image:height" content="${SOCIAL_SIZE[1]}">
<meta property="og:image:alt" content="BiasClear: see how a text is built to move you. A loupe over a sample sentence names two of its persuasion moves.">
<meta name="twitter:card" content="summary_large_image">`;
}

function layout({ root, meta, main, rulesVersion, doi, commit, site }) {
  const css = ["css/site.css", ...(meta.css ?? [])].map((h) => `<link rel="stylesheet" href="${root}${h}">`).join("\n");
  const js = ["js/theme.js", ...(meta.js ?? [])].map((s) => `<script src="${root}${s}" defer></script>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="${REFERRER}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#EDF0F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1114" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BiasClear">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
${previewTags(meta, site)}
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="preload" href="${root}fonts/newsreader-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
${css}
<noscript><link rel="stylesheet" href="${root}css/nojs.css"></noscript>
${js}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${header(root, meta.nav, rulesVersion)}

${main.trim()}

${footer(root, rulesVersion, doi, commit)}
</body>
</html>
`;
}

/** A page source: a JSON front-matter comment, then the page's <main>. */
function readPage(file) {
  const src = readFileSync(join(SITE, "pages", file), "utf8").replace(/\r\n?/g, "\n");
  const m = src.match(/^<!--page\n([\s\S]*?)\n-->\n/);
  check(m, `site/pages/${file} has no <!--page ... --> front matter`);
  return { meta: JSON.parse(m[1]), body: src.slice(m[0].length) };
}

/** Links in a page source are written from the site root; a page deeper down gets them prefixed. */
function relink(html, root) {
  if (root === "./") return html;
  return html.replace(/(\s(?:href|src)=")(?![a-z][a-z0-9+.-]*:|#|\/|\.\.\/)(\.\/)?([^"]*)"/gi, (_m, pre, _dot, rest) => `${pre}${root}${rest}"`);
}

function fill(html, values, file) {
  const out = html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    check(k in values, `site/pages/${file}: no value for {{${k}}}`);
    return String(values[k]);
  });
  return out;
}

// ------------------------------------------------------------------ the home page's generated parts

function homeParts({ home, pack, names, scan }) {
  const tierOf = (t) => `Tier ${ROMAN[t]}`;
  const first = home.samples[0];
  const firstMoves = scan(first.text).moves.length;
  const chips = home.samples
    .map((s, i) => {
      const n = scan(s.text).moves.length;
      return `        <button type="button" class="chip" data-k="${esc(s.key)}" aria-pressed="${i === 0}" aria-label="${esc(s.label)}, ${plural(n, "move")}">${esc(s.label)}<span class="ct" aria-hidden="true">&middot;&nbsp;${n}</span></button>`;
    })
    .join("\n");

  const pair = (t) => {
    const ex = home.tiers[t];
    const moves = scan(ex.text).moves;
    let film = "";
    let at = 0;
    for (const c of clusters(hitsOf(moves))) {
      film += esc(ex.text.slice(at, c.start));
      const labels = c.items
        .map((h, k) => `<span class="fl${k ? ` k${Math.min(k, 2)}` : ""}"><b>${ROMAN[h.move.tier]}</b>${esc(names[h.move.ruleId].name)}</span>`)
        .join("");
      film += `<mark class="t${c.items[0].move.tier}">${labels}${esc(ex.text.slice(c.start, c.end))}</mark>`;
      at = c.end;
    }
    film += esc(ex.text.slice(at));
    const caption = moves.length
      ? `Under the loupe, ${moves
          .map((m) => `“${m.match}” is outlined and named ${names[m.ruleId].name}, ${tierOf(m.tier)}.`)
          .join(" ")} In print, the sentence reads as ordinary text.`
      : "";
    return `      <figure class="pair" data-text="${esc(ex.text)}">
        <div class="strip" aria-hidden="true"><p>${film}</p><span class="ftag">Film</span></div>
        <div class="print"><p>${esc(ex.text)}</p><span class="ptag">Print</span></div>
        <figcaption class="sr-only">${esc(caption)}</figcaption>
      </figure>`;
  };
  const tierMoves = (t) =>
    pack.rules
      .filter((r) => r.domain === "general" && r.pit_tier === t)
      .map((r) => `        <li><a href="guide/#${anchor(r.id)}">${esc(names[r.id].name)}</a></li>`)
      .join("\n");

  const exhibits = home.exhibits
    .map((ex) => {
      const moves = scan(ex.text).moves;
      const misses = ex.missed.map((m) => {
        const start = ex.text.indexOf(m.q);
        return { start, end: start + m.q.length, kind: "miss" };
      });
      const caught = moves.length
        ? moves
            .map((m) => `<li class="t${m.tier}"><q>${esc(m.match)}</q><small>${tierOf(m.tier)} &middot; ${esc(names[m.ruleId].name)}</small></li>`)
            .join("")
        : "<li>Nothing.</li>";
      const missed = ex.missed.map((m) => `<li><q>${esc(m.q)}</q><span class="why">${esc(m.why)}</span></li>`).join("");
      return `    <article class="exhibit" aria-labelledby="ex${esc(ex.id)}">
      <div class="head"><h3 id="ex${esc(ex.id)}">Exhibit ${esc(ex.id)} &middot; ${esc(ex.title)}</h3><p class="cnt">${moves.length} marked &middot; ${ex.missed.length} missed</p></div>
      <p class="paper">${marked(ex.text, [...hitsOf(moves), ...misses], names)}</p>
      <div class="ledger2">
        <div><h4>Caught</h4><ul>${caught}</ul></div>
        <div><h4>Missed</h4><ul>${missed}</ul></div>
      </div>
    </article>`;
    })
    .join("\n");

  const limitsRows = home.limits
    .map((g) => {
      const rows = g.rows.map((row) => {
        const moves = scan(row.text).moves;
        // the tier in words, never by colour alone
        const res = moves.length
          ? `<td class="res hit t${moves[0].tier}">${esc(moves.map((m) => `${tierOf(m.tier)} · ${names[m.ruleId].name}`).join(", "))}</td>`
          : `<td class="res">No mark</td>`;
        return `        <tr><th scope="row">${esc(row.kind)}</th><td class="ex">${marked(row.text, hitsOf(moves), names)}</td>${res}<td class="why">${esc(row.why)}</td></tr>`;
      });
      // each group is its own row group, so its heading reads as one, not as a column header
      return [`      <tbody>`, `        <tr class="group"><th colspan="4" scope="rowgroup">${esc(g.group)}</th></tr>`, ...rows, `      </tbody>`].join("\n");
    })
    .join("\n");

  // Without JavaScript the page still lists the first sample's moves, as the engine found them at build time.
  const firstMoveList = scan(first.text)
    .moves.map((m) => `<li>${esc(names[m.ruleId].name)}, ${tierOf(m.tier)}: <q>${esc(m.match)}</q></li>`)
    .join("");
  return {
    sampleChips: chips,
    firstMoveList,
    firstMoves: plural(firstMoves, "move"),
    firstWords: plural(words(first.text), "word"),
    firstText: esc(first.text),
    tier1Pair: pair("1"),
    tier2Pair: pair("2"),
    tier3Pair: pair("3"),
    tier1Moves: tierMoves(1),
    tier2Moves: tierMoves(2),
    tier3Moves: tierMoves(3),
    exhibits,
    limitsRows,
  };
}

// ------------------------------------------------------------------ the Field Guide

function guideParts({ guide, pack, names, scan }) {
  const byId = new Map(guide.map((e) => [e.id, e]));
  const missing = pack.rules.filter((r) => !byId.has(r.id));
  const covered = pack.rules.length - missing.length;
  const tierName = (t) => pack.tiers[String(t)].name;
  const link = (r) => `<a href="#${anchor(r.id)}">${esc(names[r.id].name)}</a>`;
  const list = (rs) => (rs.length < 2 ? rs.map(link).join("") : `${rs.slice(0, -1).map(link).join(", ")} and ${link(rs[rs.length - 1])}`);

  let coverageNote;
  if (!missing.length) coverageNote = `This guide covers all ${pack.rules.length} rules.`;
  else if (missing.every((r) => REBUILT.includes(r.id))) {
    coverageNote =
      `<span id="soon">This guide covers ${covered} of the ${pack.rules.length} rules. ` +
      `${missing.length === 1 ? "One rule" : `${say(missing.length, true)} rules`} rebuilt from the first version&rsquo;s ` +
      `credential-as-proof and institutional-neutrality rules, ${list(missing)}, get their full entries soon; ` +
      `for now each has a short entry from the rule pack.</span>`;
  } else {
    coverageNote =
      `<span id="soon">This guide covers ${covered} of the ${pack.rules.length} rules. ` +
      `${list(missing)} get their full entries soon; for now each has a short entry from the rule pack.</span>`;
  }

  const domains = ["general", "legal", "media", "financial"];
  const rulesOf = (t, d) => pack.rules.filter((r) => r.pit_tier === t && r.domain === d);

  const toc = `  <div class="g12 toc">
${[1, 2, 3]
  .map(
    (t) => `    <nav class="col t${t}" aria-labelledby="toc-${t}">
      <h2 id="toc-${t}"><span class="sw" aria-hidden="true"></span><a href="#tier-${t}">Tier ${ROMAN[t]} &middot; ${esc(tierName(t))}</a></h2>
${domains
  .filter((d) => rulesOf(t, d).length)
  .map(
    (d) => `      <h3>${esc(DOMAIN_NAMES[d])}</h3>
      <ul>${rulesOf(t, d)
        .map((r) => `<li><a href="#${anchor(r.id)}">${esc(names[r.id].name)}${byId.has(r.id) ? "" : ' <span class="soon">(entry soon)</span>'}</a></li>`)
        .join("")}</ul>`,
  )
  .join("\n")}
    </nav>`,
  )
  .join("\n")}
  </div>`;

  const ruleMarks = (text, domain, id) => scan(text, { domain }).moves.filter((m) => m.ruleId === id);
  const entry = (r) => {
    const e = byId.get(r.id);
    const id = anchor(r.id);
    const tierLab = `<p class="lab"><span class="sw" aria-hidden="true"></span>Tier ${ROMAN[r.pit_tier]} &middot; ${esc(tierName(r.pit_tier))}</p>`;
    const formal = `In the rule pack: ${esc(r.name)}${r.domain === "general" ? "" : ` &middot; ${esc(DOMAIN_NAMES[r.domain])} domain`}`;
    if (!e) {
      return `  <article class="g12 entry stub t${r.pit_tier}" id="${id}" aria-labelledby="${id}-h">
    <div class="e-lab">${tierLab}<p class="rid">${esc(r.id)}</p></div>
    <div class="e-main">
      <h3 id="${id}-h">${esc(names[r.id].name)}</h3>
      <p class="one">${esc(names[r.id].short)}</p>
      <p class="formal">${formal}. ${esc(r.description)}</p>
      <p class="back">Full entry soon.</p>
    </div>
  </article>`;
    }
    const examples = e.examples
      .map((x) => {
        const moves = ruleMarks(x.text, e.domain, e.id);
        return `<li><p class="txt">${marked(x.text, hitsOf(moves), names)}</p><p class="hon"><i>Honest version:</i> ${esc(x.honest_version)}</p></li>`;
      })
      .join("");
    const faMoves = ruleMarks(e.false_alarm.text, e.domain, e.id);
    const verdict = faMoves.length
      ? "<b>Yes.</b> The rule marks it, so this is a false alarm."
      : "<b>No.</b> The rule leaves it unmarked.";
    return `  <article class="g12 entry t${r.pit_tier}" id="${id}" aria-labelledby="${id}-h">
    <div class="e-lab">${tierLab}<p class="rid">${esc(r.id)}</p></div>
    <div class="e-main">
      <h3 id="${id}-h">${esc(names[r.id].name)}</h3>
      <p class="one">${esc(curly(e.one_line))}</p>
      <p class="formal">${formal}</p>
      <div class="cols">
        <div><h4>How it works</h4><p>${esc(curly(e.how_it_works))}</p><h4 class="mt">The tier, in plain words</h4><p>${esc(curly(e.tier_explained))}</p></div>
        <div><h4>Examples</h4><ol class="ex">${examples}</ol></div>
      </div>
      <div class="fair"><h4>A fair use</h4><p class="txt">${marked(e.false_alarm.text, hitsOf(faMoves), names)}</p><p class="why">${esc(curly(e.false_alarm.why_fair))}</p><p class="verdict">Does the rule mark it? ${verdict}</p></div>
      <div class="miss"><h4>What it misses</h4><p>${esc(curly(e.misses))}</p></div>
    </div>
  </article>`;
  };

  const domainNote = {
    general: "These rules run on every scan, including the checker on this site.",
    legal: "These rules run only when a scan is set to the legal domain, or to all domains. The checker on this site runs the general rules.",
    media: "These rules run only when a scan is set to the media domain, or to all domains. The checker on this site runs the general rules.",
    financial: "These rules run only when a scan is set to the financial domain, or to all domains. The checker on this site runs the general rules.",
  };
  const entries = [1, 2, 3]
    .map(
      (t) => `<section class="wrap tier-sec t${t}" id="tier-${t}" aria-labelledby="tier-${t}-h">
  <div class="g12 tier-head">
    <p class="lab"><span class="sw" aria-hidden="true"></span>Tier ${ROMAN[t]}</p>
    <h2 id="tier-${t}-h"><em>${esc(tierName(t))}</em></h2>
    <p>${esc(TIER_PLAIN[t])}</p>
  </div>
${domains
  .filter((d) => rulesOf(t, d).length)
  .map(
    (d) => `  <div class="g12 dom-note"><p class="lab">${esc(DOMAIN_NAMES[d])}</p><p>${esc(domainNote[d])}</p></div>
${rulesOf(t, d).map(entry).join("\n")}`,
  )
  .join("\n")}
  <p class="back"><a href="#page-h">Back to the contents</a></p>
</section>`,
    )
    .join("\n\n");
  return { toc, entries, coverageNote, missing };
}

// ------------------------------------------------------------------ build

function copyDir(from, to, keep = () => true) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from, { withFileTypes: true })) {
    if (name.isDirectory()) copyDir(join(from, name.name), join(to, name.name), keep);
    else if (keep(name.name)) copyFileSync(join(from, name.name), join(to, name.name));
  }
}

function commitInfo() {
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  if (!sha || !repo || !/^[0-9a-f]{40}$/.test(sha)) return null;
  return { sha, url: `${server}/${repo}/tree/${sha}` };
}

/** Refuse an output folder whose removal would take the repository or its sources with it. */
export function checkOut(out) {
  const target = resolve(out);
  check(relative(target, ROOT).startsWith(".."), `refusing to replace ${target}: it holds the repository`);
  const inside = relative(ROOT, target);
  check(inside.startsWith("..") || inside === "_site", `refusing to replace ${target}: inside the repository, only _site/ may be used`);
  return target;
}

/** Tiers are written with Roman numerals in public prose (Tier I, II, III), as the pages and the readout show them. */
export function checkTierNumerals() {
  const problems = [];
  const files = [
    ...readdirSync(join(SITE, "pages")).map((f) => join(SITE, "pages", f)),
    ...readdirSync(join(SITE, "data")).map((f) => join(SITE, "data", f)),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bTier [1-3]\b/g)) problems.push(`${relative(ROOT, file)}: "${m[0]}" (write Tier I, II or III)`);
  }
  return problems;
}

/**
 * Build the site into `out`. Returns what the tests need: the output folder,
 * the pages written, and the numbers put on them. `site` is the public
 * address for link previews (default: the SITE_URL environment variable).
 */
export async function build({ out = join(ROOT, "_site"), engineBuild = true, log = console.log, site = process.env.SITE_URL } = {}) {
  out = checkOut(out);
  const siteUrl = siteAddress(site);
  if (engineBuild) buildEngine();
  check(existsSync(ENGINE_IIFE) && existsSync(ENGINE_ESM), "packages/engine/dist is missing: build the engine first");
  const engine = await import(`${pathToFileURL(ENGINE_ESM).href}?t=${Date.now()}`);
  const scan = engine.scan;

  const pack = readJson(join(ROOT, "rules", "biasclear-rules.json"));
  check(engine.rulePack().rules_version === pack.rules_version, "the engine build is older than rules/biasclear-rules.json: rebuild it");
  const names = readJson(join(SITE, "data", "moves.json"));
  checkMoves(pack, names);
  const moveNames = names.moves;
  const guide = readJson(join(SITE, "data", "field-guide.json"));
  const home = readJson(join(SITE, "data", "home.json"));
  const problems = [...checkGuide(guide, pack, scan), ...checkHome(home, scan), ...checkTierNumerals()];
  check(!problems.length, `the site's data makes claims the engine does not bear out:\n  ${problems.join("\n  ")}`);
  const facts = siteFacts();
  const cite = citation();
  const commit = commitInfo();

  const count = (pred) => pack.rules.filter(pred).length;
  const values = {
    rulesVersion: esc(pack.rules_version),
    ruleCount: nf(pack.rules.length),
    generalCount: nf(count((r) => r.domain === "general")),
    legalCount: say(count((r) => r.domain === "legal")),
    mediaCount: say(count((r) => r.domain === "media")),
    financialCount: say(count((r) => r.domain === "financial")),
    minMatchCount: say(count((r) => r.min_matches > 1), true),
    citedCount: say(count((r) => r.suppress_if_cited), true),
    citationWindow: nf(pack.citation_suppression.window),
    engineMax: nf(engine.MAX_INPUT_CHARS),
    uiMax: nf(UI_MAX),
    maxChars: String(UI_MAX),
    maxCharsText: nf(UI_MAX),
    goldenV1: nf(facts.golden.v1_parity.cases),
    goldenV2: nf(facts.golden.v2_parity.cases),
    goldenE3: nf(facts.golden.v2_parity.e3),
    goldenUnicode: nf(facts.golden.unicode_parity.cases),
    symPairs: nf(facts.symmetry.template_pairs),
    symSwaps: nf(facts.symmetry.swapped_names_and_labels),
    redTeamPairs: nf(facts.symmetry.red_team_pairs),
    knownLimits: nf(facts.symmetry.known_limits),
    retiredPairs: nf(facts.symmetry.retired_pairs),
    bibtex: esc(cite.bibtex),
    doi: esc(cite.doi),
  };
  check(facts.golden.v1_parity.cases + facts.golden.v2_parity.e3 === facts.golden.v2_parity.cases,
    "tests/golden/v2_parity.json is no longer the v1 texts plus the E3 texts; update the Method page's wording");

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const pages = [];
  const gp = guideParts({ guide, pack, names: moveNames, scan });
  values.missingCount = say(gp.missing.length);
  Object.assign(values, homeParts({ home, pack, names: moveNames, scan }), {
    toc: gp.toc,
    entries: gp.entries,
    coverageNote: gp.coverageNote,
  });

  for (const file of readdirSync(join(SITE, "pages")).filter((f) => f.endsWith(".html")).sort()) {
    const { meta, body } = readPage(file);
    const depth = meta.path.split("/").length - 1;
    const root = meta.path === "404.html" ? basePath(siteUrl) : depth ? "../".repeat(depth) : "./";
    const main = relink(fill(body, values, file), root);
    const html = layout({ root, meta, main, rulesVersion: pack.rules_version, doi: cite.doi, commit, site: siteUrl });
    check(!/\{\{\w+\}\}/.test(html), `${meta.path}: a placeholder was left unfilled`);
    const dest = join(out, meta.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
    pages.push(meta.path);
  }

  // styles: the typefaces' @font-face rules go first in the one shared sheet
  mkdirSync(join(out, "css"), { recursive: true });
  writeFileSync(
    join(out, "css", "site.css"),
    `${readFileSync(join(SITE, "css", "fonts.css"), "utf8")}\n${readFileSync(join(SITE, "css", "site.css"), "utf8")}`,
  );
  copyFileSync(join(SITE, "css", "checker.css"), join(out, "css", "checker.css"));
  copyFileSync(join(SITE, "css", "nojs.css"), join(out, "css", "nojs.css"));
  copyDir(join(SITE, "js"), join(out, "js"));
  copyFileSync(ENGINE_IIFE, join(out, BUNDLE_PATH));
  const siteData = {
    maxChars: UI_MAX,
    tiers: Object.fromEntries([1, 2, 3].map((t) => [t, [ROMAN[t], pack.tiers[String(t)].name]])),
    moves: Object.fromEntries(
      pack.rules.map((r) => [r.id, { name: moveNames[r.id].name, short: moveNames[r.id].short, href: `guide/#${anchor(r.id)}` }]),
    ),
    // Each sample's moves, from the engine at build time (general rules, as the checker runs them). The page draws the
    // samples from these, so it needs no scan to show them; the rules are compiled later, for your own text.
    samples: home.samples.map((s) => ({
      ...s,
      moves: scan(s.text).moves.map((m) => ({ s: m.start, e: m.end, id: m.ruleId, t: m.tier })),
    })),
  };
  writeFileSync(
    join(out, "js", "site-data.js"),
    `/* Generated by scripts/build-site.mjs from site/data/moves.json, site/data/home.json and the rule pack (rules ${pack.rules_version}). */\n` +
      `window.BiasClearSite = Object.freeze(${JSON.stringify(siteData)});\n`,
  );
  copyDir(join(SITE, "fonts"), join(out, "fonts"), (n) => n.endsWith(".woff2") || n.endsWith(".txt"));
  copyDir(join(SITE, "img"), join(out, "img"));
  copyFileSync(join(ROOT, "docs", "img", "social-preview.png"), join(out, SOCIAL_IMAGE));
  copyFileSync(join(SITE, "favicon.svg"), join(out, "favicon.svg"));

  log(`site: ${pages.length} pages, rules ${pack.rules_version}, ${gp.missing.length} rules without a full guide entry -> ${out}` +
    (siteUrl ? ` (link previews for ${siteUrl})` : ""));
  return { out, pages, values, pack, siteUrl, siteData };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = at >= 0 ? args[at + 1] : undefined;
  build({ out: out ? resolve(out) : undefined, engineBuild: !args.includes("--skip-engine-build") }).catch((err) => {
    console.error(err instanceof BuildError ? `build-site: ${err.message}` : err);
    process.exit(1);
  });
}
