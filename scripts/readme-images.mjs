// Make the README's images from the built site, so they show what the site
// really does:
//
//   docs/img/hero.png, docs/img/hero-dark.png
//     The checker on the home page, light and dark, marking its first sample
//     text (an ad for a kettle) with every move marked on paper and the loupe
//     on one move.
//   docs/img/social-preview.png
//     A 1280x640 card for the repository's social preview (see
//     docs/REPO_SETTINGS.md). It uses the site's own styles and typefaces.
//     Its sample sentence and the move it names are checked with the engine
//     first; the script stops if they no longer hold.
//
// Usage:
//   node scripts/build-site.mjs
//   node scripts/readme-images.mjs
//
// It needs Playwright and its Chromium, which are not dependencies of this
// repository. Install them outside the repository (a global install will do)
// and point NODE_PATH at the node_modules folder that holds playwright:
//   NODE_PATH="$(npm root -g)" node scripts/readme-images.mjs
//
// Nothing is fetched from another site: the pages and typefaces are served
// from _site/ on 127.0.0.1, and the script fails if a page asks for anything
// else.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_ESM, ROOT } from "./build-site.mjs";
import { serve } from "./serve-site.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("readme-images: Playwright not found. See the usage note at the top of this script.");
  process.exit(1);
}

const SITE_OUT = join(ROOT, "_site");
const IMG = join(ROOT, "docs", "img");
const BASE_PATH = "/biasclear/";
const fail = (msg) => {
  console.error(`readme-images: ${msg}`);
  process.exit(1);
};
if (!existsSync(join(SITE_OUT, "index.html"))) fail("no _site/; run node scripts/build-site.mjs first");
mkdirSync(IMG, { recursive: true });

// ------------------------------------------------------------------ the social card's claim

const pack = JSON.parse(readFileSync(join(ROOT, "rules", "biasclear-rules.json"), "utf8"));
const names = JSON.parse(readFileSync(join(ROOT, "site", "data", "moves.json"), "utf8")).moves;
const { scan } = await import(pathToFileURL(ENGINE_ESM).href);
const ROMAN = { 1: "I", 2: "II", 3: "III" };

/** The card's sample, and the moves the engine must find in it, in order. */
const CARD_TEXT = "Everyone knows it is the best one yet.\nOnly a fool would wait.";
const CARD_MOVES = [
  ["CONSENSUS_AS_EVIDENCE", "Everyone knows"],
  ["SHAME_LEVER", "Only a fool"],
];
const found = scan(CARD_TEXT).moves.map((m) => [m.ruleId, m.match]);
if (JSON.stringify(found) !== JSON.stringify(CARD_MOVES)) {
  fail(`the card's sample no longer gives ${JSON.stringify(CARD_MOVES)}; the engine gives ${JSON.stringify(found)}`);
}
const rule = (id) => pack.rules.find((r) => r.id === id);
const lead = rule(CARD_MOVES[0][0]);
const tierName = (r) => pack.tiers[String(r.pit_tier)].name;

// ------------------------------------------------------------------ serve the site, refuse anything external

const server = await serve({ dir: SITE_OUT, base: BASE_PATH, port: 0 });
const HOST = `127.0.0.1:${server.address().port}`;
const BASE = `http://${HOST}${BASE_PATH}`;
const browser = await chromium.launch();

async function open(scheme, viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, colorScheme: scheme, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const external = [];
  const errors = [];
  page.on("request", (r) => {
    if (new URL(r.url()).host !== HOST) external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const done = async () => {
    if (external.length) fail(`a page asked for another site: ${external.join(" ")}`);
    if (errors.length) fail(`a page logged errors: ${errors.join(" | ")}`);
    await ctx.close();
  };
  return { page, done };
}

// ------------------------------------------------------------------ the hero: the checker, light and dark

for (const [scheme, file] of [["light", "hero.png"], ["dark", "hero-dark.png"]]) {
  const { page, done } = await open(scheme, { width: 1280, height: 1000 }, 1.25);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("#handoff.on", { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  // The fourth move of the ad ("Top groups agree", Tier III) under the loupe, every move marked on paper.
  const vague = page.locator("#moves button").nth(3);
  // (the samples keep short phrases on one line with no-break spaces)
  if (!(await vague.getAttribute("aria-label")).replace(/\s+/g, " ").includes('"Top groups agree"')) fail("the ad's fourth move is no longer \"Top groups agree\"");
  await vague.click();
  await page.locator("#markAll").click();
  await page.mouse.move(1270, 990);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(1200);
  const box = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const wrap = r(".hero .wrap"), tabs = r(".tabs"), req = r(".spec-foot .req"), list = r("#moves"), ro = r("#readout");
    const pad = 28;
    const top = Math.min(tabs.top, ro.top) - pad;
    const bottom = Math.max(req.bottom, list.bottom) + pad;
    const left = wrap.left + parseFloat(getComputedStyle(document.querySelector(".hero .wrap")).paddingLeft) - pad;
    const right = wrap.right - parseFloat(getComputedStyle(document.querySelector(".hero .wrap")).paddingRight) + pad;
    return { x: Math.round(left), y: Math.round(top + scrollY), width: Math.round(right - left), height: Math.round(bottom - top) };
  });
  await page.screenshot({ path: join(IMG, file), clip: box, fullPage: true });
  console.log(`docs/img/${file}: ${box.width}x${box.height} CSS px at 1.25x (${scheme})`);
  await done();
}

// ------------------------------------------------------------------ the social card

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The sample with each move wrapped as on the site; `neg` is the loupe's copy. */
const spec = (neg) => {
  let out = "", p = 0;
  CARD_MOVES.forEach(([id, q], k) => {
    const a = CARD_TEXT.indexOf(q, p);
    out += esc(CARD_TEXT.slice(p, a));
    out += `<span class="mv t${rule(id).pit_tier}"${neg ? ` data-k="${k}"` : ""}>${esc(q)}</span>`;
    if (neg) out += `<span class="bl" data-b="${k}"></span>`;
    p = a + q.length;
  });
  return out + esc(CARD_TEXT.slice(p));
};
const leadName = names[lead.id].name;
const card = `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<link rel="stylesheet" href="css/site.css">
<style>
  html,body{margin:0;width:1280px;height:640px;overflow:hidden}
  .c{position:absolute;inset:0}
  .top{position:absolute;left:64px;right:64px;top:42px;display:flex;align-items:center;gap:14px;padding-bottom:20px;border-bottom:1px solid var(--rule)}
  .top .wm{font-size:40px}
  .top .pv{font-size:13px;padding:5px 8px 4px}
  .top .lab{margin-left:auto;font-size:14px}
  .left{position:absolute;left:64px;top:148px;width:560px}
  h1{font-size:76px;line-height:1;letter-spacing:-.028em;font-weight:360}
  h1 em{font-style:italic;font-weight:340}
  .sub{margin-top:30px;font-size:25px;line-height:1.45;color:var(--ink-2);width:500px}
  .right{position:absolute;left:700px;top:228px;width:516px}
  .stage{position:relative}
  .spec{margin:0;font-family:var(--serif);font-size:30px;line-height:1.9;letter-spacing:-.004em;white-space:pre-wrap}
  .spec .mv{white-space:nowrap}
  .base .mv{background-image:linear-gradient(100deg,transparent .06em,var(--hlc) .24em,var(--hlc) calc(100% - .24em),transparent calc(100% - .06em));
    background-repeat:no-repeat;background-size:100% .66em;background-position:0 80%}
  .bl{display:inline-block;width:0;height:0;vertical-align:baseline}
  .film{position:absolute;inset:-200px;padding:200px;background-color:var(--film);background-image:url("img/grain.svg");background-size:180px;
    -webkit-font-smoothing:antialiased}
  .neg{color:var(--film-ink);text-shadow:0 0 14px rgba(110,180,255,.28)}
  .neg .mv.t1{color:var(--t1);text-shadow:0 0 12px color-mix(in srgb,var(--t1) 60%,transparent)}
  .neg .mv.t2{color:var(--t2);text-shadow:0 0 12px color-mix(in srgb,var(--t2) 60%,transparent)}
  .neg .mv.t3{color:var(--t3);text-shadow:0 0 12px color-mix(in srgb,var(--t3) 60%,transparent)}
  .mk{position:absolute;border:1.5px solid var(--c);border-radius:3px;background:color-mix(in srgb,var(--c) 8%,transparent);
    box-shadow:0 0 16px -2px color-mix(in srgb,var(--c) 70%,transparent),inset 0 0 14px -8px var(--c)}
  .ml{position:absolute;white-space:nowrap;font:500 14px/1 var(--mono);color:var(--c);display:flex;align-items:center;gap:7px;
    text-shadow:0 0 10px color-mix(in srgb,var(--c) 60%,transparent)}
  .ml b{font-weight:500;border:1px solid currentColor;border-radius:2px;padding:2px 4px;line-height:1}
  .loupe{position:absolute;border-radius:50%;box-shadow:var(--lift)}
  .loupe svg{position:absolute;inset:0;overflow:visible}
  .band{fill:none;stroke:var(--band)}
  .hair{fill:none;stroke:var(--band-line);stroke-width:1}
  .rtext{font-family:var(--mono);font-weight:500;fill:var(--band-ink);text-transform:uppercase}
  .cap{position:absolute;left:700px;top:448px;width:516px;border-top:1px solid var(--ink)}
  .cap .row{display:grid;grid-template-columns:40px 1fr auto;align-items:center;padding:9px 0 8px;border-bottom:1px solid var(--rule-2)}
  .cap .nm{font-size:24px;line-height:1.3}
  .cap .tl{font:500 13px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ic)}
  .foot{position:absolute;left:64px;right:64px;bottom:40px;padding-top:16px;border-top:1px solid var(--rule);display:flex;justify-content:space-between}
  .foot .lab{font-size:14px}
</style></head>
<body><div class="c">
  <div class="top"><span class="wm">Bias<em>Clear</em></span><span class="pv">Preview</span><span class="lab">Free &middot; Open source</span></div>
  <div class="left">
    <h1>See how a text is built <em>to move you.</em></h1>
    <p class="sub">It marks the moves a text makes to carry its reader along, and names each one.</p>
  </div>
  <div class="right"><div class="stage" id="stage"><p class="spec base">${spec(false)}</p></div></div>
  <div class="cap">${CARD_MOVES.map(([id]) => rule(id)).map((r) =>
    `<p class="row t${r.pit_tier}"><span class="sw"></span><span class="nm">${esc(names[r.id].name)}</span>` +
    `<span class="tl">Tier ${ROMAN[r.pit_tier]} &middot; ${esc(tierName(r))}</span></p>`).join("")}</div>
  <div class="foot"><span class="lab">Runs in your browser. Sends nothing.</span><span class="lab">Not a fact-checker. No truth score.</span></div>
</div>
<template id="film"><div class="film"><p class="spec neg">${spec(true)}</p></div></template>
</body></html>`;

{
  const { page, done } = await open("light", { width: 1280, height: 640 }, 1);
  await page.route(`${BASE}social-card.html`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: card }));
  await page.goto(`${BASE}social-card.html`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check('400 30px Newsreader') && document.fonts.check('500 14px "DM Mono"'));
  if (!ok) fail("the site's typefaces did not load for the card");
  // The loupe, as on the site: the same words as a negative inside a ring over the first move, outlined and named.
  await page.evaluate(({ roman, name, bottom }) => {
    const NS = "http://www.w3.org/2000/svg";
    const stage = document.getElementById("stage");
    stage.appendChild(document.getElementById("film").content.cloneNode(true));
    const s = stage.getBoundingClientRect();
    // Each move's box on the film: its width, and from its baseline up to the ascenders and down to the descenders.
    const boxes = [...stage.querySelectorAll(".neg .mv")].map((n) => {
      const r = n.getBoundingClientRect();
      const base = stage.querySelector(`[data-b="${n.dataset.k}"]`).getBoundingClientRect().top - s.top;
      const fs = parseFloat(getComputedStyle(n).fontSize);
      return { x0: r.left - s.left, x1: r.right - s.left, y0: base - 0.8 * fs, y1: base + 0.27 * fs, t: n.className.match(/t(\d)/)[1] };
    });
    const lead = boxes[0];
    const cx = (lead.x0 + lead.x1) / 2, cy = (lead.y0 + lead.y1) / 2 + 22, R = 128, B = 20;
    stage.querySelector(".film").style.clipPath = `circle(${R}px at ${cx + 200}px ${cy + 200}px)`;
    const layer = document.createElement("div");
    Object.assign(layer.style, { position: "absolute", inset: "0", clipPath: `circle(${R}px at ${cx}px ${cy}px)` });
    boxes.forEach((bx, k) => {
      const mk = document.createElement("div");
      mk.className = `mk t${bx.t}`;
      Object.assign(mk.style, { left: `${bx.x0 - 6}px`, top: `${bx.y0}px`, width: `${bx.x1 - bx.x0 + 12}px`, height: `${bx.y1 - bx.y0}px` });
      layer.appendChild(mk);
      if (k) return;
      const ml = document.createElement("div");
      ml.className = `ml t${bx.t}`;
      const mb = document.createElement("b"), ms = document.createElement("span");
      mb.textContent = roman;
      ms.textContent = name;
      ml.append(mb, ms);
      Object.assign(ml.style, { left: `${bx.x0 - 4}px`, top: `${bx.y0 - 24}px` });
      layer.appendChild(ml);
    });
    stage.appendChild(layer);
    const D = 2 * (R + B), c = D / 2;
    const loupe = document.createElement("div");
    loupe.className = "loupe";
    Object.assign(loupe.style, { left: `${cx - c}px`, top: `${cy - c}px`, width: `${D}px`, height: `${D}px` });
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${D} ${D}`);
    svg.setAttribute("width", D);
    svg.setAttribute("height", D);
    const el = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };
    el("circle", { class: "band", cx: c, cy: c, r: R + B / 2, "stroke-width": B });
    el("circle", { class: "hair", cx: c, cy: c, r: R + 0.5 });
    const rt = R + B / 2 - 4, rb = R + B / 2 + 4;
    el("path", { id: "arcT", d: `M ${c - rt} ${c} A ${rt} ${rt} 0 0 1 ${c + rt} ${c}`, fill: "none" });
    el("path", { id: "arcB", d: `M ${c - rb} ${c} A ${rb} ${rb} 0 0 0 ${c + rb} ${c}`, fill: "none" });
    for (const [arc, words, size] of [["#arcT", `${roman} · ${name}`, 11.5], ["#arcB", bottom, 10.5]]) {
      const t = el("text", { class: "rtext", "font-size": size, "letter-spacing": (size * 0.2).toFixed(2) });
      el("textPath", { href: arc, startOffset: "50%", "text-anchor": "middle" }, t).textContent = words;
    }
    loupe.appendChild(svg);
    stage.appendChild(loupe);
  }, { roman: ROMAN[lead.pit_tier], name: leadName, bottom: "BiasClear" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(IMG, "social-preview.png") });
  console.log("docs/img/social-preview.png: 1280x640");
  await done();
}

await browser.close();
server.close();
