/* BiasClear checker: the loupe on the home page. Ported from the approved Lightbox design.

   The rules are the engine's own: js/biasclear.iife.min.js is the browser build of packages/engine (global BiasClear),
   built from rules/biasclear-rules.json. Move names come from js/site-data.js, which the site build writes from
   site/data/moves.json, with each sample's moves as the engine found them at build time: the samples need no scan, so
   the page shows them at once, and the rules are compiled afterwards, a rule at a time, for text of your own.
   Nothing here sends anything anywhere, and no text is ever parsed as HTML: every node is built with DOM calls and
   textContent. */
(() => {
'use strict';

/* ------------------------------------------------------------ engine and names */
const SITE = window.BiasClearSite;
if (!SITE || !document.getElementById('stage')) return;
const MAX = SITE.maxChars;
const NAMES = {}, DESC = {}, LINKS = {};
for (const id in SITE.moves){ NAMES[id] = SITE.moves[id].name; DESC[id] = SITE.moves[id].short; LINKS[id] = SITE.moves[id].href; }
const TIER = SITE.tiers;
const SAMPLES = {}, KNOWN = new Map();
SITE.samples.forEach(s => { SAMPLES[s.key] = s; KNOWN.set(s.text, s.moves); });
const FIRST = SITE.samples[0].key;

let engineOk = !!(window.BiasClear && typeof window.BiasClear.scan === 'function');
function engineFailed(){
  if (!engineOk && !document.getElementById('engineErr').hidden) return;
  engineOk = false;
  document.getElementById('engineErr').hidden = false;
}
// The engine's own result, general rules: one entry per move, sorted by start, then longest first, then rule-pack order.
// A sample's moves were found by the same engine when the site was built (the site's test checks they still agree).
function analyze(input){
  const t = String(input || '');
  if (!t) return [];
  const known = KNOWN.get(t);
  if (known) return known.map(m => ({ s:m.s, e:m.e, id:m.id, t:m.t }));
  if (!engineOk){ engineFailed(); return []; }
  try {
    return window.BiasClear.scan(t).moves.map(m => ({ s:m.start, e:m.end, id:m.ruleId, t:m.tier }));
  } catch (err) {
    engineFailed();
    return [];
  }
}
/* The rules are compiled in the background, one rule per idle moment, once the opening read is over (or sooner, when
   you reach for your own text), so the page never stalls to load them. A text of your own that arrives first waits a
   moment under a short note while the rest are compiled at once. */
const canPrepare = engineOk && typeof window.BiasClear.prepare === 'function';
let rulesReady = !canPrepare, warming = false;
function prepareStep(){
  try { rulesReady = window.BiasClear.prepare(); } catch (err) { rulesReady = true; engineFailed(); }
  return rulesReady;
}
function warmUp(){
  if (rulesReady || warming) return;
  warming = true;
  const later = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout:500 }) : f => setTimeout(f, 30);
  const step = () => { if (!rulesReady && !prepareStep()) later(step); };
  later(step);
}
function whenReady(fn){
  if (rulesReady){ fn(); return; }
  nMoves.textContent = 'Loading the rules…'; listCount.textContent = '';
  say('Loading the rules.');
  // let the note paint, then finish the rest in one go
  requestAnimationFrame(() => setTimeout(() => { while (!rulesReady) prepareStep(); fn(); }, 0));
}
// the first MAX UTF-16 units, never splitting a character in two
function clip(t){
  if (t.length <= MAX) return t;
  let n = MAX;
  const c = t.charCodeAt(n - 1);
  if (c >= 0xD800 && c <= 0xDBFF) n--;
  return t.slice(0, n);
}

const words = t => (t.trim().match(/\S+/g) || []).length;
const NONE_FOUND = 'No moves found. The rules know set wordings, and can miss the same move made in other words.';
const two = n => String(n).padStart(2, '0');
// thousands with commas, without the cost of loading a locale on first use
const nf = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const plural = (n, w) => nf(n) + ' ' + w + (n === 1 ? '' : 's');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MAXTXT = nf(MAX);

/* ------------------------------------------------------------ elements */
const $ = s => document.querySelector(s);
const stage = $('#stage'), base = $('#base'), film = $('#film'), neg = $('#neg'), marksEl = $('#marks'), numsEl = $('#nums');
const loupe = $('#loupe'), ring = $('#ring'), glass = $('#glass');
const readout = $('#readout'), roIdx = $('#roIdx'), roName = $('#roName'), roTier = $('#roTier'), roDesc = $('#roDesc'), roQuote = $('#roQuote');
const roMore = $('#roMore'), roLink = $('#roLink');
const list = $('#moves'), listCount = $('#listCount'), nMoves = $('#nMoves'), nWords = $('#nWords');
const live = $('#live'), handoff = $('#handoff'), reqOut = $('#reqN');
const editor = $('#editor'), own = $('#own'), count = $('#count'), edNote = $('#edNote');
const markAll = $('#markAll');
const chips = [...document.querySelectorAll('.chip')];
const ownChip = chips.find(c => c.dataset.k === 'own');

const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqSmall = matchMedia('(max-width: 640px)');
const mqCoarse = matchMedia('(pointer: coarse)');
const onMq = (mq, fn) => { if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn); };

/* ------------------------------------------------------------ state */
let lh = 57, R3 = 92, Rcap = 118, Rbig = 148, B = 18, E = 150, R = 92, ink = .28;
let text = '', key = FIRST, spans = [], clusters = [], moves = [], lines = [], lineAt = [], W = 0, H = 0, bx = 0, vw = 0;
let pos = { x:0, y:0 }, cur = -2, anchor = -1;
let mode = 'boot';            // boot, sweep, park, rest, user
let raf = 0, rraf = 0, sweepRaf = 0, shown = 0, sweepLine = 0;
let ringTopText = 'BiasClear', ringTopNode = null, rtRadius = 90;
let fromKeys = false, sayT = 0, keyT = 0, lastGeo = '', shownRO = -2;

/* ------------------------------------------------------------ the barrel */
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent){ const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
function buildRing(){
  const D = 2 * (R + B), c = R + B, small = B < 16;
  const fsT = 10, fsB = small ? 9.5 : 9, capT = fsT * .7, capB = fsB * .7;
  loupe.style.width = loupe.style.height = D + 'px';
  glass.style.left = glass.style.top = B + 'px';
  glass.style.width = glass.style.height = (2 * R) + 'px';
  ring.setAttribute('viewBox', `0 0 ${D} ${D}`); ring.setAttribute('width', D); ring.setAttribute('height', D);
  ring.replaceChildren();
  el('circle', { class:'band', cx:c, cy:c, r:R + B/2, 'stroke-width':B }, ring);
  el('circle', { class:'hair', cx:c, cy:c, r:R + .5 }, ring);
  const tr = R + B - 1.6, circ = 2 * Math.PI * tr, n = Math.max(60, Math.round(circ / 7));
  el('circle', { class:'ticks', cx:c, cy:c, r:tr, 'stroke-width':1.6, 'stroke-dasharray':`0.7 ${(circ/n - .7).toFixed(3)}`, transform:`rotate(-90 ${c} ${c})` }, ring);
  const rt = R + (B - capT) / 2 - .6, rb = R + (B + capB) / 2 - .4;
  rtRadius = rt;
  el('path', { id:'arcT', d:`M ${c - rt} ${c} A ${rt} ${rt} 0 0 1 ${c + rt} ${c}`, fill:'none' }, ring);
  el('path', { id:'arcB', d:`M ${c - rb} ${c} A ${rb} ${rb} 0 0 0 ${c + rb} ${c}`, fill:'none' }, ring);
  const t1 = el('text', { class:'rtext', 'font-size':fsT }, ring);
  ringTopNode = el('textPath', { href:'#arcT', startOffset:'50%', 'text-anchor':'middle' }, t1);
  const t2 = el('text', { class:'rtext', 'font-size':fsB, 'letter-spacing':(fsB * .2).toFixed(2) }, ring);
  const ringBotNode = el('textPath', { href:'#arcB', startOffset:'50%', 'text-anchor':'middle' }, t2);
  ringBotNode.textContent = mqCoarse.matches ? 'Drag to read' : 'Drag · Arrows · Enter';
  setRingTop(ringTopText, true);
}
function setRingTop(s, force){
  if (s === ringTopText && !force) return;
  ringTopText = s;
  if (!ringTopNode) return;
  const t = ringTopNode.parentNode;
  // fit the engraving to the top half of the barrel: tighten the tracking first, then the size (never under 9px), then drop the tier prefix
  const avail = Math.PI * rtRadius * .84;
  const fit = str => {
    const n = str.length; let fs = 10, ls = .2;
    while (n * fs * (.6 + ls) > avail && ls > .04) ls -= .02;
    while (n * fs * (.6 + ls) > avail && fs > 9) fs -= .25;
    return { fs, ls, ok: n * fs * (.6 + ls) <= avail };
  };
  let str = s, f = fit(str);
  if (!f.ok && str.includes(' · ')){ str = str.slice(str.indexOf(' · ') + 3); f = fit(str); }
  t.setAttribute('font-size', f.fs); t.setAttribute('letter-spacing', (f.fs * f.ls).toFixed(2));
  ringTopNode.textContent = str;
}

/* ------------------------------------------------------------ render */
// Moves from different rules may cover the same words. Each run of overlapping moves is one marked phrase on the page
// (a cluster, coloured by its first move); every move keeps its own outline, label, list row and stop for the loupe.
function clustersOf(sp){
  const out = [];
  sp.forEach(s => {
    const c = out[out.length - 1];
    if (c && s.s < c.e){ c.e = Math.max(c.e, s.e); c.m.push(s); }
    else out.push({ s:s.s, e:s.e, t:s.t, m:[s] });
    s.c = out.length - 1;
  });
  return out;
}
// a short phrase is kept on one line, as the samples keep theirs with fixed spaces, so the glass can rest on all of it
const keepWhole = q => q.length < 32 && !q.includes('\n');
function paint(node, t, cl){
  const frag = document.createDocumentFragment();
  let p = 0;
  cl.forEach((c, k) => {
    if (c.s > p) frag.appendChild(document.createTextNode(t.slice(p, c.s)));
    const q = t.slice(c.s, c.e), span = document.createElement('span');
    span.className = 'mv t' + c.t;
    if (keepWhole(q)){ span.classList.add('nw'); span.dataset.nw = ''; }
    span.dataset.c = String(k);
    span.appendChild(document.createTextNode(q));
    frag.appendChild(span);
    p = c.e;
  });
  if (p < t.length) frag.appendChild(document.createTextNode(t.slice(p)));
  node.replaceChildren(frag);
}
// ...unless the phrase is wider than the line itself; both layers change together, so they still break alike
function fitPhrases(){
  const bs = base.querySelectorAll('.mv[data-nw]'); if (!bs.length) return;
  const ns = neg.querySelectorAll('.mv'), w = base.clientWidth;
  bs.forEach(n => n.classList.add('nw'));
  // measure every phrase first, then change them all: one layout, not one per phrase (a phrase kept whole has the same
  // width wherever its line breaks)
  const fits = [...bs].map(n => n.getBoundingClientRect().width <= w - 1);
  bs.forEach((n, i) => { const m = ns[+n.dataset.c]; if (!fits[i]) n.classList.remove('nw'); if (m) m.classList.toggle('nw', fits[i]); });
}
function moveLine(i){
  const s = spans[i];
  return `Move ${i + 1} of ${spans.length}: ${NAMES[s.id]}, Tier ${TIER[s.t][0]} (${TIER[s.t][1]}), "${text.slice(s.s, s.e)}"`;
}
function part(tag, cls, txt){ const n = document.createElement(tag); if (cls) n.className = cls; n.setAttribute('aria-hidden', 'true'); n.textContent = txt; return n; }
function buildList(){
  list.replaceChildren();
  const hide = mode === 'boot' || mode === 'sweep';
  if (!spans.length){
    const li = document.createElement('li'); li.className = 'none';
    li.textContent = engineOk ? NONE_FOUND : 'The rules could not run in this browser.';
    list.appendChild(li);
  }
  spans.forEach((s, i) => {
    const li = document.createElement('li'); const b = document.createElement('button');
    if (!hide) li.className = 'in';
    b.type = 'button'; b.className = 't' + s.t; b.dataset.i = String(i);
    b.setAttribute('aria-label', moveLine(i) + '. Show under the loupe.');
    b.append(part('span', 'n', two(i + 1)), part('span', 'nm', NAMES[s.id]), part('span', 'tg', TIER[s.t][0]), part('q', '', text.slice(s.s, s.e)));
    li.appendChild(b); list.appendChild(li);
  });
  showCount(hide ? 0 : spans.length);
}
function showCount(n){
  // nothing before the reading starts; during it, the count appears with the first move
  const t = n ? plural(n, 'move') : (mode === 'boot' || mode === 'sweep') ? '' : 'No moves';
  nMoves.textContent = t; listCount.textContent = t;
}
function render(t){
  text = clip(String(t));
  spans = analyze(text);
  clusters = clustersOf(spans);
  paint(base, text, clusters); paint(neg, text, clusters);
  stage.dataset.size = sizeOf(text);
  nWords.textContent = plural(words(text), 'word');
  buildList();
  numsEl.replaceChildren();
  cur = -2; anchor = -1; shownRO = -2;
  if (laidOut) layout();
}

/* ------------------------------------------------------------ layout */
const sizeOf = t => t.length <= 380 ? 'l' : t.length <= 1400 ? 'm' : 's';
let roomTop = 0, roomKey = '', lastFontKey = '';
// the serif and the mono each count once they are in; label widths and line breaks both depend on them
const fontKey = () => { try { return document.fonts ? [document.fonts.check('400 16px Newsreader'), document.fonts.check('500 11px "DM Mono"')].join() : ''; } catch (e) { return ''; } };
// The first layout (where each outline, label and resting place goes) waits until the text has been painted once, in two
// tasks, the room above the text first: until the loupe is shown, nothing on screen depends on it.
let laidOut = false;
function roomFor(w){
  // the room above the text is set once per width by the sample texts, so the first line never moves when the text changes
  const k = [w.toFixed(1), mqSmall.matches, lastFontKey].join('|');
  if (k !== roomKey){ roomKey = k; roomTop = sampleRoom(); }
}
function firstLayout(){
  if (laidOut) return;
  laidOut = true;
  if (layout() && mode === 'boot' && moves.length){ anchor = 0; const p = moves[0].rest; setR(p.r); setPos(p.x, p.y); }
}
function layout(){
  const w = base.getBoundingClientRect().width;
  if (w < 2) return false;
  lastFontKey = fontKey();
  roomFor(w);
  fitPhrases();
  model();
  stage.style.setProperty('--E', E + 'px');
  // every text rests within the room the samples set (your own text resting lower in the glass if it must), so the first line
  // stays put; only a text with no move and a single short line may ask for a few pixels more
  const need = moves.length ? roomTop : Math.max(roomTop, (p => p.r + B - p.y + 8)(restPose(-1)));
  stage.style.marginTop = Math.round(need) + 'px';
  // the hand-off sits just under the text; below a short text, room is kept for the loupe where it rests, so it never
  // covers the hand-off, the edit button or the counter (a loupe dragged below the last line may still pass over them)
  const poses = moves.length ? moves.map(m => m.rest) : [restPose(-1)];
  const below = Math.max(0, ...poses.map(p => p.y + p.r + B + 8 - H));
  stage.style.marginBottom = Math.round(Math.max(mqSmall.matches ? 12 : 14, below)) + 'px';
  lastGeo = modelGeo;
  sizeReadout();
  return true;
}
function metrics(){
  const sr = base.getBoundingClientRect();
  W = sr.width; H = sr.height; bx = sr.left; vw = document.documentElement.clientWidth;
  const cs = getComputedStyle(base);
  lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.86;
  const nb = mqSmall.matches ? 13 : 18;
  const nR3 = Math.round(lh * 1.62);
  Rcap = Math.round(lh * 2.2); Rbig = Math.round(lh * 2.6);
  ink = .52 * parseFloat(cs.fontSize) / lh; // half the height of the letters, ascenders to descenders, in line heights
  if (nb !== B || nR3 !== R3){ B = nb; R3 = nR3; }
  E = Rbig + B + 16;
  return sr;
}
// the line boxes of a range, one per line: a range can report a line in more than one piece
function lineRects(rs){
  const out = [];
  for (const r of rs){
    const o = out.find(q => Math.abs((q.y + q.h / 2) - (r.y + r.h / 2)) < Math.min(q.h, r.h) * .5);
    if (!o){ out.push({ x:r.x, y:r.y, w:r.w, h:r.h }); continue; }
    const x0 = Math.min(o.x, r.x), x1 = Math.max(o.x + o.w, r.x + r.w), y0 = Math.min(o.y, r.y), y1 = Math.max(o.y + o.h, r.y + r.h);
    o.x = x0; o.w = x1 - x0; o.y = y0; o.h = y1 - y0;
  }
  return out;
}
// where each move's words sit, line by line, relative to the text
function measureSpans(sr){
  const els = base.querySelectorAll('.mv'), rg = document.createRange();
  return spans.map(s => {
    const node = els[s.c], tn = node && node.firstChild, c0 = clusters[s.c].s;
    let raw = [];
    if (tn){ rg.setStart(tn, s.s - c0); rg.setEnd(tn, s.e - c0); raw = [...rg.getClientRects()]; }
    return lineRects(raw.filter(r => r.width > 1).map(r => ({ x:r.left - sr.left, y:r.top - sr.top, w:r.width, h:r.height })));
  });
}
// a signature of that geometry: a font or a switch that moves nothing leaves it unchanged, and nothing is laid out again
const signature = (sr, all) => [sr.width.toFixed(1), sr.height.toFixed(1), ...all.map(rs => rs.map(r => r.x.toFixed(1) + ',' + r.y.toFixed(1) + ',' + r.w.toFixed(1)).join(';'))].join('|');
let modelGeo = '';
function model(){
  const sr = metrics();
  const all = measureSpans(sr);
  modelGeo = signature(sr, all);
  moves = spans.map((s, i) => {
    const rects = all[i];
    const boxes = rects.map(r => { const a = r.h * .17, b = r.h * .13; return { x:r.x - 3, y:r.y + a, w:r.w + 6, h:r.h - a - b }; });
    const main = boxes.length ? boxes.reduce((p, q) => (q.w > p.w ? q : p), boxes[0]) : null;
    return { s, rects, boxes, main, line: rects.length ? Math.floor((rects[0].y + rects[0].h / 2) / lh) : 0 };
  });
  // two rules on exactly the same words: each later outline sits just outside the one before, so both show
  moves.forEach((m, i) => {
    let k = 0;
    for (let j = 0; j < i; j++) if (spans[j].s === m.s.s && spans[j].e === m.s.e) k++;
    m.nest = k;
    if (k) m.boxes.forEach(b => { const d = 3 * k; b.x -= d; b.y -= d; b.w += 2 * d; b.h += 2 * d; });
  });
  lines = measureLines(sr);
  lineAt = []; lines.forEach(L => { lineAt[L.i] = L; });
  drawMarks();
  moves.forEach((m, i) => { m.rest = restPose(i); });
}
// lay out each sample in turn (in the same task, so nothing is painted), then put the current text back
function sampleRoom(){
  const keep = { nodes:[...base.childNodes], size:stage.dataset.size, spans, clusters }, snaps = [];
  roomTop = Infinity;
  for (const k in SAMPLES){
    const t = SAMPLES[k].text;
    spans = analyze(t); clusters = clustersOf(spans); paint(base, t, clusters); stage.dataset.size = sizeOf(t);
    model();
    snaps.push({ moves, H });
  }
  spans = keep.spans; clusters = keep.clusters; base.replaceChildren(...keep.nodes); stage.dataset.size = keep.size;
  // the least room above the text at which every sample move can rest with its phrase whole in the glass (resting a little
  // low if it must), and the opening read can take the first line from near its middle
  const need = t => {
    roomTop = t; let n = 0;
    for (const sn of snaps){ moves = sn.moves; H = sn.H; (moves.length ? moves.map((m, i) => restPose(i, true)) : [restPose(-1)]).forEach(p => { n = Math.max(n, p.r + B - p.y + 8); }); }
    return n;
  };
  let lo = Math.max(mqSmall.matches ? 16 : 22, R3 + B + 8 - lh * .95), hi = Math.max(lo, need(Infinity));
  if (need(lo) <= lo + .5) return lo;
  while (hi - lo > .5){ const mid = (lo + hi) / 2; if (need(mid) <= mid + .5) hi = mid; else lo = mid; }
  return hi;
}
// the lowest a pose of radius r may sit and still keep its barrel 8px clear of the line above the text (the move count and the switch)
const minY = r => r + B + 8 - roomTop;
function geo(){ const sr = base.getBoundingClientRect(); return signature(sr, measureSpans(sr)); }
function measureLines(sr){
  const rg = document.createRange(); rg.selectNodeContents(base);
  const out = [];
  for (const r of rg.getClientRects()){
    if (r.width < 1) continue;
    const i = Math.max(0, Math.floor((r.top - sr.top + r.height / 2) / lh));
    const L = out[i] || (out[i] = { i, l:Infinity, r:-Infinity, y:(i + .5) * lh });
    L.l = Math.min(L.l, r.left - sr.left); L.r = Math.max(L.r, r.right - sr.left);
  }
  return out.filter(Boolean);
}
const overlap = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
// Past this many moves, the outlines are drawn without name labels (placing labels grows with the square of the count);
// the barrel and the readout still name the move under the glass.
const MAX_LABELS = 200;
function drawMarks(){
  marksEl.replaceChildren();
  const labelled = moves.length <= MAX_LABELS;
  moves.forEach(m => {
    const cls = 't' + m.s.t;
    m.boxes.forEach(b => {
      const d = document.createElement('div'); d.className = 'mk ' + cls;
      d.style.left = b.x.toFixed(1) + 'px'; d.style.top = b.y.toFixed(1) + 'px';
      d.style.width = b.w.toFixed(1) + 'px'; d.style.height = b.h.toFixed(1) + 'px';
      marksEl.appendChild(d); b.el = d; b.sl = false;
    });
    m.lel = null; m.lbox = null; m.sbox = null; m.lst = '';
    if (!m.main || !labelled) return;
    const l = document.createElement('div'); l.className = 'ml ' + cls;
    const badge = document.createElement('b'); badge.textContent = TIER[m.s.t][0];
    const name = document.createElement('span'); name.textContent = NAMES[m.s.id];
    l.append(badge, name);
    marksEl.appendChild(l); m.lel = l;
  });
  // place each label in the gap above its move; never on another label or on an outline
  const obstacles = [];
  moves.forEach(m => m.boxes.forEach(b => obstacles.push({ b, m })));
  const placed = [];
  const gap = mqSmall.matches ? 4 : 5;
  const lineOf = b => Math.floor((b.y + b.h / 2) / lh);
  // measure every label first, then place them all: one layout, not one per label
  moves.forEach(m => { if (m.lel) m.sz = [m.lel.offsetWidth, m.lel.offsetHeight || 14, m.lel.firstElementChild.offsetWidth]; });
  moves.forEach(m => {
    if (!m.lel) return;
    const [w, h, bw] = m.sz, f = m.main; // bw: the tier badge on its own
    // above the phrase first; below only when the line under it has no move of the same tier, where it could be misread
    const fl = lineOf(f);
    const belowOk = !moves.some(o => o !== m && o.s.t === m.s.t && o.boxes.some(b => lineOf(b) === fl + 1));
    const spots = ww => {
      const hi = Math.max(0, W - ww);
      const xs = [clamp(f.x + f.w / 2 - ww / 2, 0, hi), clamp(f.x, 0, hi), clamp(f.x + f.w - ww, 0, hi)];
      const c = xs.map(x => ({ x, y:f.y - gap - h, w:ww, h }));
      if (belowOk) xs.forEach(x => c.push({ x, y:f.y + f.h + gap, w:ww, h }));
      return c;
    };
    const free = c => !placed.some(p => overlap(c, p, 5)) && !obstacles.some(o => o.m !== m && overlap(c, o.b, 2)) && !m.boxes.some(b => overlap(c, b, 1));
    const pick = spots(w).find(free);
    m.lst = '';
    if (pick){
      // the badge alone sits over the middle of the phrase, inside the room the full label already holds
      const sx = clamp(f.x + f.w / 2 - bw / 2, pick.x, pick.x + w - bw);
      m.lbox = pick; m.sbox = { x:sx, y:pick.y, w:bw, h };
      placed.push(pick);
    } else {
      // no room for the name: the badge alone, or no label at all (the barrel still names the move)
      const sb = spots(bw).find(free);
      if (!sb){ m.lel.remove(); m.lel = null; m.lbox = m.sbox = null; return; }
      m.lbox = null; m.sbox = sb; m.lel.classList.add('short');
      placed.push(sb);
    }
    const b0 = m.lbox || m.sbox;
    m.lel.style.left = b0.x.toFixed(1) + 'px'; m.lel.style.top = b0.y.toFixed(1) + 'px';
  });
}
function clampX(x, r){
  let lo = 0, hi = W;
  const elo = r + B + 12 - bx, ehi = vw - 12 - (r + B) - bx; // keep the whole loupe 12px inside the screen
  if (elo <= ehi){ lo = Math.max(lo, elo); hi = Math.min(hi, ehi); }
  if (lo > hi) return (lo + hi) / 2;
  return clamp(x, lo, hi);
}
// How well a glass edge sits against the lines of the specimen (0 is clean). At the top and bottom of the glass the edge runs
// almost level: through a line it leaves a row of half-cut letters beside the engraving (cost 1 and up), and just short of a
// line it leaves a thin row of letter tops or tails inside the glass (a small cost). Past the end of the words, nothing to cut.
function edgeCut(e, cx, r, top){
  const a = .47 - ink, b = .53 + ink, u = e / lh, i = Math.floor(u), f = u - i;
  const half = Math.sqrt(2 * r * (b - a) * lh); // how far either side of centre the edge stays level enough to matter
  const has = j => { const L = lineAt[j]; return !!L && L.r > cx - half && L.l < cx + half; };
  if (f > a && f < b && has(i)) return 1 + Math.min(f - a, b - f);
  // the first line inside the glass, and how far in its letters start
  const j = top ? Math.max(0, Math.ceil(u - a)) : Math.floor(u - b);
  const d = has(j) ? (top ? j + a - u : u - j - b) : Infinity;
  return Math.max(0, .22 - d);
}
// The glass for a box (the phrase, with or without its label): the smallest radius from the roaming one up to rMax that holds it
// with 5px to spare, and the height at which both edges fall between lines. With lift, it rests no higher than the room above
// the text allows. quick: any fit will do (used to size that room).
function settle(bx0, rMax, lift, quick){
  const [x0, y0, x1, y1] = bx0, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const rMin = Math.max(R3, Math.hypot(x1 - x0, y1 - y0) / 2 + 5);
  let best = null;
  for (let r = rMin; r <= rMax + .01; r = r < Math.ceil(r) ? Math.ceil(r) : r + 1){
    const x = clampX(mx, r), hw = Math.max(x - x0, x1 - x), v2 = (r - 5) ** 2 - hw * hw;
    if (v2 <= 0) continue;
    const v = Math.sqrt(v2), lo = Math.max(y1 - v, lift ? minY(r) : -Infinity), hi = Math.min(y0 + v, H);
    if (lo > hi + .01) continue;
    const yc = clamp(my, lo, Math.max(lo, hi));
    if (quick) return { x, y:yc, r, cut:0 };
    let by = yc, bc = Infinity;
    for (let k = 0; k <= hi - lo + 1 && bc > 0; k++){
      for (const y of k ? [yc - k, yc + k] : [yc]){
        if (y < lo - .01 || y > hi + .01) continue;
        const c = edgeCut(y - r, x, r, true) + edgeCut(y + r, x, r, false);
        if (c < bc - 1e-6){ bc = c; by = y; }
      }
    }
    const p = { x, y:by, r, cut:bc };
    if (bc <= .03) return p;
    if (!best || bc < best.cut - 1e-6) best = p;
  }
  return best;
}
function restPose(i, strict){
  const m = moves[i];
  if (!m || !m.main){ return { x:clampX(W / 2, R3), y:Math.min(Math.max(Math.min(H / 2, lh * 1.5), minY(R3)), H), r:R3 }; }
  const f = m.main, pbox = [f.x, f.y, f.x + f.w, f.y + f.h];
  const withLab = lb => [Math.min(pbox[0], lb.x), Math.min(pbox[1], lb.y), Math.max(pbox[2], lb.x + lb.w), Math.max(pbox[3], lb.y + lb.h)];
  // the phrase with its full label, then with its tier badge, then alone
  const boxes = [m.lbox, m.sbox].filter(Boolean).map(withLab).concat([pbox]);
  if (strict){ // sizing the room above the text: can it rest, lifted, with the phrase whole?
    for (const bb of boxes){ const p = settle(bb, Rcap, true, true); if (p) return p; }
    return { x:clampX((pbox[0] + pbox[2]) / 2, Rcap), y:(pbox[1] + pbox[3]) / 2, r:Rcap };
  }
  // about three lines of glass if it can, edges between lines if it can, the label kept if it can
  const r19 = Math.max(R3, Math.round(lh * 1.9)), labelled = boxes.length - 1;
  const order = [];
  for (let k = 0; k < labelled; k++) order.push([boxes[k], r19]);
  for (let k = 0; k < labelled; k++) order.push([boxes[k], Rcap]);
  order.push([pbox, r19], [pbox, Rcap]);
  let fallback = null;
  for (const [bb, cap] of order){
    const p = settle(bb, cap, true);
    if (!p) continue;
    if (p.cut <= .03) return p;
    if (!fallback || p.cut < fallback.cut - .05) fallback = p;
  }
  if (fallback) return fallback;
  // a phrase too wide for the widest glass at that height (your own text): a wider glass, up to 2.6 lines
  const wide = settle(pbox, Rbig, true);
  if (wide) return wide;
  // still no fit (a phrase on the first line, or one wider than any glass): the widest glass the room above the text allows,
  // resting as low as that room requires, on the whole phrase if it is narrow enough, otherwise on its start
  const mx = (pbox[0] + pbox[2]) / 2, my = (pbox[1] + pbox[3]) / 2, rTop = clamp(H - B - 8 + roomTop, R3, Rbig);
  const yAt = r => clamp(my, Math.min(minY(r), H), H);
  let q = null;
  for (let r = R3; r <= rTop; r++){
    const y = yAt(r), x = clampX(mx, r), gap = r - Math.max(...[[0, 1], [2, 1], [0, 3], [2, 3]].map(([a, b]) => Math.hypot(pbox[a] - x, pbox[b] - y)));
    if (!q || gap > q.gap + .5) q = { x, y, r, cut:0, gap };
  }
  if (q && q.gap > -8) return q;
  const r = Math.min(Rcap, rTop), y = yAt(r), dy = Math.abs(y - my);
  return { x:clampX(pbox[0] + Math.sqrt(Math.max(0, (r - 8) ** 2 - dy * dy)), r), y, r, cut:0 };
}
function hit(x, y){
  // parked on a move it was sent to: that move is the one under the loupe, even when a screen edge kept it off-centre
  const a = anchor >= 0 && moves[anchor] && moves[anchor].rest;
  if (a && Math.hypot(a.x - x, a.y - y) < 3) return anchor;
  let best = -1, bd = Infinity;
  // during the opening read the barrel names only moves already counted, on the line being read, so it never runs ahead of the count
  moves.forEach((m, i) => (mode === 'sweep' && (m.line !== sweepLine || i >= shown)) || m.boxes.forEach(r => {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d < bd - .01){ bd = d; best = i; }
  }));
  return bd <= R3 * .34 ? best : -1;
}

/* ------------------------------------------------------------ position */
function apply(){
  film.style.clipPath = `circle(${R.toFixed(2)}px at ${(pos.x + E).toFixed(2)}px ${(pos.y + E).toFixed(2)}px)`;
  loupe.style.transform = `translate3d(${(pos.x - R - B).toFixed(2)}px,${(pos.y - R - B).toFixed(2)}px,0)`;
  // a label shows only when it sits wholly inside the glass, clear of the barrel; when the name will not fit, the tier badge shows alone
  const rr = R - 3;
  const inG = b => !!b && [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].every(([px, py]) => Math.hypot(px - pos.x, py - pos.y) <= rr);
  for (let i = 0; i < moves.length; i++){
    const m = moves[i];
    if (!m.lel) continue;
    // the badge alone only for the move the loupe was sent to or, while it roams, the phrase the glass is centred on; never for a neighbour
    const f = m.main, near = anchor >= 0 ? i === anchor : !!f && Math.hypot(f.x + f.w / 2 - pos.x, f.y + f.h / 2 - pos.y) <= R * .45;
    const st = inG(m.lbox) ? 'full' : (near && inG(m.sbox)) ? 'short' : '';
    if (st === m.lst) continue;
    m.lst = st;
    if (st){
      const b = st === 'full' ? m.lbox : m.sbox;
      m.lel.style.left = b.x.toFixed(1) + 'px';
      m.lel.classList.toggle('short', st === 'short');
    }
    m.lel.classList.toggle('vis', !!st);
  }
  // an outline the glass barely reaches shows as a coloured sliver at its edge: leave it out until more of it is inside
  const R2 = R * R;
  for (let i = 0; i < moves.length; i++){
    for (const b of moves[i].boxes){
      if (!b.el) continue;
      let sl = false;
      if (i !== anchor && (clamp(pos.x, b.x, b.x + b.w) - pos.x) ** 2 + (clamp(pos.y, b.y, b.y + b.h) - pos.y) ** 2 < R2){
        let n = 0;
        for (let u = 0; u <= 4; u++) for (let v = 0; v <= 2; v++) if ((b.x + b.w * u / 4 - pos.x) ** 2 + (b.y + b.h * v / 2 - pos.y) ** 2 < R2) n++;
        sl = n < 4;
      }
      if (sl !== b.sl){ b.sl = sl; b.el.classList.toggle('sl', sl); }
    }
  }
  updateCurrent();
}
function setPos(x, y){ pos = { x:clampX(x, R), y:clamp(y, 0, H) }; apply(); }
function setR(r){ r = Math.round(r * 2) / 2; if (r !== R){ R = r; buildRing(); } }
const easeIO = k => k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2;
const easeOut = k => 1 - Math.pow(1 - k, 3);
function cancelGlide(){ cancelAnimationFrame(raf); raf = 0; cancelAnimationFrame(rraf); rraf = 0; }
function glideTo(p, dur, done){
  cancelGlide();
  if (mqReduce.matches || dur <= 0){ setR(p.r); setPos(p.x, p.y); if (done) done(); return; }
  const fx = pos.x, fy = pos.y, fr = R, dx = p.x - fx, dy = p.y - fy, dr = p.r - fr, dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(40, dist * .12), nx = -dy / dist, ny = dx / dist;
  let t0 = 0;
  const step = now => {
    if (!t0) t0 = now;
    const k = Math.min(1, (now - t0) / dur), e = easeIO(k), b = Math.sin(Math.PI * e) * bow;
    setR(fr + dr * e);
    setPos(fx + dx * e + nx * b, fy + dy * e + ny * b);
    if (k < 1) raf = requestAnimationFrame(step); else { raf = 0; if (done) done(); }
  };
  raf = requestAnimationFrame(step);
}
function rTo(target, dur){ // change the aperture only
  cancelAnimationFrame(rraf); rraf = 0;
  if (Math.abs(target - R) < .5) return;
  if (mqReduce.matches){ setR(target); setPos(pos.x, pos.y); return; }
  const fr = R; let t0 = 0;
  const step = now => {
    if (!t0) t0 = now;
    const k = Math.min(1, (now - t0) / dur);
    setR(fr + (target - fr) * easeOut(k)); setPos(pos.x, pos.y);
    if (k < 1) rraf = requestAnimationFrame(step); else rraf = 0;
  };
  rraf = requestAnimationFrame(step);
}
function goMove(i, opts = {}){
  let p;
  if (!moves.length){ anchor = -1; p = restPose(-1); }
  else { i = ((i % moves.length) + moves.length) % moves.length; anchor = i; p = moves[i].rest; }
  const d = Math.hypot(p.x - pos.x, p.y - pos.y);
  glideTo(p, opts.dur ?? clamp(420 + d * 1.1, 520, 1200), opts.done);
  if (opts.reveal) bringIntoView(p);
}
let scrollTill = 0;
function glideScroll(fn){ const smooth = !mqReduce.matches; fn(smooth ? 'smooth' : 'auto'); scrollTill = smooth ? performance.now() + 1200 : 0; }
function stopScroll(){ if (performance.now() < scrollTill){ scrollTill = 0; window.scrollTo({ top:window.scrollY, left:window.scrollX, behavior:'auto' }); } }
function bringIntoView(p){
  const r = base.getBoundingClientRect(), y = r.top + p.y, m = Math.min(160, innerHeight * .25);
  if (y < m || y > innerHeight - m) glideScroll(b => window.scrollBy({ top: y - innerHeight / 2, behavior:b }));
}

/* ------------------------------------------------------------ readout */
function tierLine(t){
  const sw = document.createElement('i'); sw.className = 'sw';
  roTier.replaceChildren(sw, document.createTextNode(`Tier ${TIER[t][0]} · ${TIER[t][1]}`));
}
function fillReading(){
  readout.className = 'readout';
  roIdx.textContent = '';
  roName.textContent = 'Reading the text';
  roTier.replaceChildren();
  roDesc.textContent = 'The loupe reads it once, in order. Each move it passes is numbered and added to the list.';
  roQuote.textContent = '';
  roMore.hidden = true;
}
function readingState(){ shownRO = -2; fillReading(); }
// the readout keeps the height of its tallest state for this text and width, so the list under it never moves while you read
function sizeReadout(){
  const parts = [roIdx, roName, roTier, roDesc, roQuote];
  const keep = { cls:readout.className, nodes:parts.map(n => [...n.childNodes]), more:roMore.hidden, href:roLink.getAttribute('href'), link:roLink.textContent };
  readout.style.minHeight = '';
  let h = 0;
  const measure = () => { h = Math.max(h, readout.offsetHeight); };
  fillReading(); measure();
  fillReadout(-1); measure();
  const longest = new Map(); // one state per move name, with its longest quote
  spans.forEach((s, i) => { const o = longest.get(s.id); if (!o || s.e - s.s > o.n) longest.set(s.id, { i, n:s.e - s.s }); });
  longest.forEach(o => { fillReadout(o.i); measure(); });
  readout.className = keep.cls; parts.forEach((n, k) => n.replaceChildren(...keep.nodes[k]));
  roMore.hidden = keep.more; roLink.setAttribute('href', keep.href); roLink.textContent = keep.link;
  readout.style.minHeight = Math.ceil(h) + 'px';
}
function fillReadout(c){
  if (c < 0){
    readout.className = 'readout';
    roIdx.textContent = spans.length ? '— / ' + two(spans.length) : '';
    roName.textContent = spans.length ? 'Plain print' : 'Nothing marked';
    roTier.replaceChildren();
    roDesc.textContent = !engineOk
      ? 'This browser could not run the rules, so nothing is marked.'
      : spans.length
        ? 'No move under the glass. Drag it onto the words, or press Enter to jump to the next move.'
        : 'The rules found no moves they know. They look for set wordings, so a move made in other words can pass unmarked. That is not a verdict on whether the text is true.';
    roQuote.textContent = '';
    // with nothing marked, the link goes to what the rules miss
    roMore.hidden = !(engineOk && !spans.length);
    roLink.textContent = 'What the rules miss'; roLink.setAttribute('href', '#misses');
  } else {
    const s = spans[c];
    readout.className = 'readout t' + s.t;
    roIdx.textContent = two(c + 1) + ' / ' + two(spans.length);
    roName.textContent = NAMES[s.id];
    tierLine(s.t);
    roDesc.textContent = DESC[s.id] || '';
    roQuote.textContent = '“' + text.slice(s.s, s.e) + '”';
    roLink.textContent = 'More in the Field Guide'; roLink.setAttribute('href', LINKS[s.id]);
    roMore.hidden = false;
  }
}
function updateCurrent(force){
  const c = hit(pos.x, pos.y);
  // the barrel names what passes under the glass; the readout and the list name where a glide is going, so they hold still
  const t = raf && anchor >= 0 ? anchor : c;
  if (c === cur && t === shownRO && !force) return;
  const changed = c !== cur;
  cur = c;
  setRingTop(c < 0 ? (spans.length ? 'BiasClear' : 'No moves found') : TIER[spans[c].t][0] + ' · ' + NAMES[spans[c].id]);
  if (mode === 'boot' || mode === 'sweep' || mode === 'park' || !editor.hidden){ shownRO = -2; return; }
  if (t !== shownRO || force){
    shownRO = t;
    [...list.querySelectorAll('button')].forEach(b => b.setAttribute('aria-current', String(+b.dataset.i === t)));
    fillReadout(t);
  }
  if (fromKeys && changed){
    clearTimeout(keyT);
    keyT = setTimeout(() => say(cur >= 0 ? 'Under the loupe. ' + moveLine(cur) : 'No move under the loupe.'), 300);
  }
}
function say(msg){ clearTimeout(sayT); clearTimeout(keyT); live.textContent = ''; sayT = setTimeout(() => { live.textContent = msg; }, 60); }

/* ------------------------------------------------------------ the opening read */
function showHandoff(){ handoff.classList.add('on'); }
// the film is drawn only once the loupe that frames it is shown, so a disc never sits over the text without its barrel
function showLoupe(){ loupe.classList.add('on'); stage.classList.add('lit'); }
function revealOne(i){
  const li = list.children[i]; if (li) li.classList.add('in');
  shown = i + 1; showCount(shown);
  const m = moves[i], b = m && m.boxes[0];
  if (!b || mqReduce.matches) return;
  const n = document.createElement('span'); n.className = 'sn t' + m.s.t; n.textContent = two(i + 1);
  // a move on the same words as the one before it takes its number a step to the right
  n.style.left = (b.x + 3 * m.nest + 22 * m.nest).toFixed(1) + 'px'; n.style.top = (b.y + 3 * m.nest - 15).toFixed(1) + 'px';
  numsEl.appendChild(n);
  requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('show')));
  setTimeout(() => n.classList.remove('show'), 1100);
  setTimeout(() => n.remove(), 2300);
}
function revealAll(){
  [...list.children].forEach(li => li.classList.add('in'));
  shown = moves.length; showCount(spans.length);
}
let sweepLines = [];
function sweepAt(u){
  const segs = []; let prev = null;
  const low = Math.min(minY(R3), H); // the first line is read from a little below, so the barrel clears the move count and the switch
  for (const L of sweepLines){
    const xs = clampX(L.l + R3 * .55, R3), xe = Math.max(xs, clampX(L.r - R3 * .55, R3)), y = Math.max(L.y, low);
    if (prev) segs.push({ a:prev, b:{ x:xs, y }, w:.4, line:prev.line, ret:true });
    segs.push({ a:{ x:xs, y }, b:{ x:xe, y }, w:1, line:L.i, ret:false });
    prev = { x:xe, y, line:L.i };
  }
  if (!segs.length) return { x:W / 2, y:H / 2, line:0, cx:0 };
  let tot = 0;
  segs.forEach(s => { s.len = Math.max(30, Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)) * s.w; s.at = tot; tot += s.len; });
  const d = clamp(u, 0, 1) * tot;
  let s = segs[segs.length - 1];
  for (const q of segs){ if (d <= q.at + q.len){ s = q; break; } }
  let k = clamp((d - s.at) / s.len, 0, 1);
  if (s.ret) k = easeIO(k);
  const x = s.a.x + (s.b.x - s.a.x) * k, y = s.a.y + (s.b.y - s.a.y) * k;
  return { x, y, line:s.line, cx:s.ret ? Infinity : x };
}
function revealTo(p){
  while (shown < moves.length){
    const m = moves[shown], b = m.boxes[0];
    if (b && !(p.line > m.line || (p.line === m.line && p.cx + R3 * .3 >= b.x + b.w * .5))) break;
    revealOne(shown);
  }
}
function startSweep(){
  mode = 'sweep'; anchor = -1; shown = 0;
  [...list.children].forEach(li => li.classList.remove('in'));
  showCount(0); readingState();
  setR(R3);
  // it reads the lines that are on screen (on a short phone screen the last lines can start below the fold);
  // the moves on any lines it leaves out join the list when it ends
  const top = base.getBoundingClientRect().top, onScreen = lines.filter(L => top + (L.i + 1) * lh <= innerHeight + 2);
  sweepLines = onScreen.length >= 2 ? onScreen : lines;
  const p0 = sweepAt(0); sweepLine = p0.line; setPos(p0.x, p0.y);
  showLoupe();
  const hold = 260, dur = 3500; let t0 = 0;
  const ease = k => .55 * k + .45 * (-(Math.cos(Math.PI * k) - 1) / 2);
  const step = now => {
    if (mode !== 'sweep') return;
    if (!t0) t0 = now;
    const k = clamp((now - t0 - hold) / dur, 0, 1);
    const p = sweepAt(ease(k));
    sweepLine = p.line; revealTo(p); setPos(p.x, p.y);
    if (k < 1){ sweepRaf = requestAnimationFrame(step); return; }
    sweepRaf = 0; revealAll(); park();
  };
  sweepRaf = requestAnimationFrame(step);
}
function park(){
  mode = 'park'; showCount(spans.length);
  goMove(0, { dur:900, done:() => { if (mode !== 'park') return; mode = 'rest'; showHandoff(); updateCurrent(true); warmUp(); } });
}
/* Focus or a touch on the loupe is a takeover: every automatic motion stops at once. */
function stopAuto(){
  firstLayout();
  if (sweepRaf){ cancelAnimationFrame(sweepRaf); sweepRaf = 0; }
  const wasAuto = mode === 'boot' || mode === 'sweep' || mode === 'park';
  mode = 'user';
  if (wasAuto){
    // land in the final state at once: no rows sliding in, no hand-off rising, no numbers fading
    numsEl.replaceChildren();
    list.classList.add('instant'); handoff.classList.add('instant');
    revealAll(); showHandoff();
    void list.offsetWidth; void handoff.offsetWidth;
    requestAnimationFrame(() => { list.classList.remove('instant'); handoff.classList.remove('instant'); });
    if (!loupe.classList.contains('on')){ const p = moves.length ? moves[0].rest : restPose(-1); anchor = moves.length ? 0 : -1; setR(p.r); setPos(p.x, p.y); showLoupe(); }
    updateCurrent(true);
  }
}
function takeover(){ stopAuto(); cancelGlide(); stopScroll(); warmUp(); }

/* ------------------------------------------------------------ input: pointer */
let drag = null;
function local(e){ const r = base.getBoundingClientRect(); return { x:e.clientX - r.left, y:e.clientY - r.top }; }
loupe.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  takeover(); fromKeys = false; loupe.classList.add('ptr');
  const p = local(e);
  drag = { id:e.pointerId, ox:p.x - pos.x, oy:p.y - pos.y, sx:e.clientX, sy:e.clientY, type:e.pointerType, moved:false };
  try { loupe.setPointerCapture(e.pointerId); } catch (_) { /* capture is a nicety */ }
  loupe.classList.add('drag');
  e.preventDefault(); loupe.focus({ preventScroll:true });
});
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('.loupe') || e.button !== 0 || e.pointerType === 'touch') return;
  takeover(); fromKeys = false; anchor = -1; loupe.classList.add('ptr');
  const p = local(e); setPos(p.x, p.y); rTo(R3, 180);
  drag = { id:e.pointerId, ox:0, oy:0, moved:true };
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* capture is a nicety */ }
  loupe.classList.add('drag');
  e.preventDefault(); loupe.focus({ preventScroll:true });
});
function onMove(e){
  if (!drag || e.pointerId !== drag.id) return;
  const p = local(e);
  if (!drag.moved){
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < (drag.type === 'mouse' ? 3 : 8)) return; // a tap, not yet a drag
    drag.moved = true; anchor = -1; rTo(R3, 180);
  }
  setPos(p.x - drag.ox, p.y - drag.oy);
}
function onUp(e){
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null; loupe.classList.remove('drag');
  // a click or tap on a phrase in or under the loupe (no drag) sends the loupe to it
  if (!d.moved && e.type === 'pointerup'){
    const p = local(e), c = hit(p.x, p.y);
    if (c >= 0 && c !== cur){ goMove(c, { dur:460 }); say(moveLine(c)); }
  }
}
[loupe, stage].forEach(n => { n.addEventListener('pointermove', onMove); n.addEventListener('pointerup', onUp); n.addEventListener('pointercancel', onUp); });
stage.addEventListener('click', e => { // touch: tap the print to send the loupe there
  if (e.target.closest('.loupe')) return;
  if (e.pointerType && e.pointerType !== 'touch') return;
  if (!e.pointerType && !mqCoarse.matches) return;
  takeover(); fromKeys = false; loupe.classList.add('ptr');
  const p = local(e), c = hit(p.x, p.y);
  if (c >= 0) goMove(c, { dur:460 }); else { anchor = -1; glideTo({ x:p.x, y:p.y, r:R3 }, 420); }
});

/* ------------------------------------------------------------ input: keys */
loupe.addEventListener('focus', () => takeover());
document.addEventListener('keydown', e => { if (!e.ctrlKey && !e.metaKey && !e.altKey) loupe.classList.remove('ptr'); }, true);
function loupeKey(k, shift){
  const step = shift ? 44 : 12;
  const nudge = (dx, dy) => { takeover(); fromKeys = true; anchor = -1; if (R !== R3) rTo(R3, 160); setPos(pos.x + dx, pos.y + dy); };
  let handled = true;
  switch (k){
    case 'ArrowLeft': nudge(-step, 0); break;
    case 'ArrowRight': nudge(step, 0); break;
    case 'ArrowUp': nudge(0, -step); break;
    case 'ArrowDown': nudge(0, step); break;
    case 'Enter': case ' ': {
      takeover(); fromKeys = false;
      if (!moves.length){ say('No moves in this text.'); break; }
      // while the loupe glides to a move (or rests on one), step from that move, not from whatever passes under the glass
      const n = moves.length, at = anchor >= 0 ? anchor : cur;
      const next = at >= 0 ? at + (shift ? -1 : 1) : (shift ? nearestAfter() - 1 : nearestAfter());
      const i = ((next % n) + n) % n;
      goMove(i, { reveal:true, dur:520 }); say(moveLine(i));
      break;
    }
    case 'Home': takeover(); fromKeys = false; if (moves.length){ goMove(0, { reveal:true, dur:520 }); say(moveLine(0)); } break;
    case 'End': takeover(); fromKeys = false; if (moves.length){ goMove(moves.length - 1, { reveal:true, dur:520 }); say(moveLine(moves.length - 1)); } break;
    default: handled = false;
  }
  return handled;
}
loupe.addEventListener('keydown', e => { if (loupeKey(e.key, e.shiftKey)) e.preventDefault(); });
// "or use the arrow keys": left and right reach the loupe while the text is on screen and focus is on nothing, or on one of
// the plain buttons around the text (a sample tab, the switch, a row of the list), none of which uses the arrow keys itself.
// Up and down are left to scroll the page until the loupe has focus.
const passKeys = '.chip, #markAll, #editOwn, #editOwnFoot, #moves button';
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement && !(a.matches && a.matches(passKeys))) return;
  if (stage.hidden || !loupe.classList.contains('on')) return;
  const r = stage.getBoundingClientRect();
  if (r.bottom < 60 || r.top > innerHeight - 60) return;
  e.preventDefault();
  loupe.focus({ preventScroll:true });
  loupeKey(e.key, e.shiftKey);
});
function nearestAfter(){ // the first move at or after the loupe, in reading order
  for (let i = 0; i < moves.length; i++){ const r = moves[i].boxes[0]; if (r && (r.y > pos.y + 4 || (Math.abs(r.y + r.h / 2 - pos.y) < r.h && r.x + r.w >= pos.x))) return i; }
  return 0;
}
list.addEventListener('click', e => {
  const b = e.target.closest('button[data-i]'); if (!b) return;
  takeover(); fromKeys = false;
  const i = +b.dataset.i;
  // a click scrolls the loupe into view; Enter or Space on a row (detail 0) keeps the row, and focus, on screen
  goMove(i, { reveal:e.detail !== 0 }); say(moveLine(i));
});

/* ------------------------------------------------------------ privacy counter */
// It starts once the page has finished loading, typefaces included, and never resets, so nothing can drop out of view.
// Until then it shows a dash, not a 0 it has not yet earned.
let since = Infinity, reqCount = 0, counting = true;
function armCounter(){ if (since !== Infinity) return; since = performance.now(); if (counting) reqOut.textContent = String(reqCount); }
try {
  new PerformanceObserver(l => {
    let add = 0;
    for (const en of l.getEntries()) if (en.startTime > since) add++;
    if (add){ reqCount += add; reqOut.textContent = String(reqCount); }
  }).observe({ type:'resource' });
} catch (err) {
  counting = false; reqOut.textContent = 'not available in this browser';
}

/* ------------------------------------------------------------ texts: tabs, editor, paste */
let ownText = '', lastKey = FIRST, ownCut = false, draftCut = false;
const CUT_READ = `Only the first ${MAXTXT} characters were read.`, CUT_FIT = `Only the first ${MAXTXT} characters fit. The rest was left out.`;
const NOTE = `Up to ${MAXTXT} characters. It stays in this tab.`;
const cutNote = $('#cutNote');
chips.forEach(c => {
  c.addEventListener('click', () => {
    takeover();
    if (c.dataset.k !== 'own'){ closeEditor(false); pick(c.dataset.k, { announce:true }); return; }
    if (!editor.hidden){ own.focus(); return; }
    if (ownText) pick('own', { announce:true }); // text already given: show it; "Edit your text" reopens the editor
    else openEditor();
  });
});
function press(k){ chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.k === k))); }
function pick(k, opts = {}){
  key = k; lastKey = k; press(k);
  render(k === 'own' ? ownText : SAMPLES[k].text);
  syncEdit();
  goMove(0, { dur: opts.dur ?? 800 });
  if (opts.announce){
    const cut = k === 'own' && ownCut ? ' ' + CUT_READ : '';
    say(`${k === 'own' ? 'Your text' : SAMPLES[k].label} is under the loupe.${cut} ` + (!engineOk && !spans.length ? 'The rules could not run in this browser.' : spans.length ? `${plural(spans.length, 'move')} found. The list follows.` : NONE_FOUND));
  }
}
const heroBody = $('.hero-body'), editOwn = $('#editOwn');
const editFoot = $('#editFoot');
function syncEdit(){ editOwn.hidden = editFoot.hidden = !(key === 'own' && ownText && editor.hidden); cutNote.hidden = !(key === 'own' && ownCut); }
function openEditor(){
  warmUp();
  press('own');
  ownChip.setAttribute('aria-expanded', 'true');
  if (!own.value && ownText) own.value = ownText; // a draft survives Cancel, Escape and a look at the samples
  syncCount();
  edNote.textContent = draftCut ? CUT_FIT : NOTE;
  editor.hidden = false; stage.hidden = true;
  heroBody.classList.add('editing');
  readout.className = 'readout';
  roIdx.textContent = ''; roName.textContent = 'Your text'; roTier.replaceChildren();
  roDesc.textContent = 'Paste or type it, then put it under the loupe.'; roQuote.textContent = ''; roMore.hidden = true; shownRO = -2;
  syncEdit();
  own.focus({ preventScroll:true });
}
function closeEditor(restore){
  if (editor.hidden) return;
  editor.hidden = true; stage.hidden = false;
  heroBody.classList.remove('editing');
  ownChip.setAttribute('aria-expanded', 'false');
  if (restore) press(lastKey);
  if (layout()) reposition();
  updateCurrent(true); syncEdit();
}
editOwn.addEventListener('click', () => { takeover(); openEditor(); });
$('#editOwnFoot').addEventListener('click', () => { takeover(); openEditor(); });
function syncCount(){ count.textContent = nf(Math.min(own.value.length, MAX)) + ' / ' + MAXTXT; }
own.addEventListener('input', () => { syncCount(); if (!own.value) draftCut = false; });
// the box keeps what fits (maxlength); say so when a paste or a drop was cut
const noteCut = () => { draftCut = true; edNote.textContent = CUT_FIT; };
const roomInBox = () => MAX - (own.value.length - Math.abs(own.selectionEnd - own.selectionStart));
const norm = t => String(t || '').replace(/\r\n?/g, '\n');
own.addEventListener('paste', e => { const t = norm(e.clipboardData && e.clipboardData.getData('text/plain')); if (t.length > roomInBox()) noteCut(); });
own.addEventListener('drop', e => { const t = norm(e.dataTransfer && e.dataTransfer.getData('text/plain')); if (t.length > roomInBox()) noteCut(); });
own.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); closeEditor(true); ownChip.focus(); } });
$('#cancel').addEventListener('click', () => { closeEditor(true); ownChip.focus(); });
$('#go').addEventListener('click', () => {
  const t = clip(own.value);
  if (!t.trim()){ edNote.textContent = 'Paste or type something first.'; own.focus(); return; }
  ownText = t; ownCut = draftCut;
  closeEditor(false);
  loupe.focus({ preventScroll:true });
  whenReady(() => {
    pick('own', { dur:0, announce:true });
    bringIntoView(moves.length ? moves[0].rest : restPose(-1));
  });
});
const isField = n => !!n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
function usePasted(t){
  t = norm(t);
  if (!t.trim()) return;
  // a draft is open: the paste joins it at the caret instead of replacing it
  if (!editor.hidden){
    const a = own.selectionStart ?? own.value.length, b = own.selectionEnd ?? a, room = roomInBox();
    own.setRangeText(t.length > room ? t.slice(0, Math.max(0, room)) : t, a, b, 'end');
    own.focus();
    syncCount();
    if (t.length > room) noteCut();
    return;
  }
  takeover();
  ownCut = draftCut = t.length > MAX;
  t = clip(t);
  ownText = t; own.value = t;
  whenReady(() => {
    pick('own', { dur:0, announce:true });
    const r = stage.getBoundingClientRect();
    if (r.top < 0 || r.top > innerHeight * .6) glideScroll(b => stage.scrollIntoView({ block:'center', behavior:b }));
  });
}
let pasteAt = -1;
document.addEventListener('paste', e => {
  if (isField(e.target) || isField(document.activeElement)) return;
  pasteAt = performance.now();
  const t = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (!t || !t.trim()) return;
  e.preventDefault();
  usePasted(t);
});
document.addEventListener('keydown', e => { // some browsers send no paste event outside a text field
  if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 'v' && e.key !== 'V')) return;
  if (isField(document.activeElement)) return;
  const t0 = performance.now();
  setTimeout(() => {
    if (pasteAt >= t0) return;
    try {
      if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(usePasted, () => {});
    } catch (err) { /* no clipboard access: nothing to do */ }
  }, 150);
});

/* ------------------------------------------------------------ highlight every move (on paper) */
markAll.addEventListener('click', () => {
  const on = markAll.getAttribute('aria-checked') !== 'true';
  markAll.setAttribute('aria-checked', String(on));
  stage.classList.toggle('all', on);
  // the marks only paint behind the words; if anything did move, the outlines and resting places follow it
  if (laidOut && geo() !== lastGeo && layout()) reposition();
});

/* ------------------------------------------------------------ section 02: film and print */
/* The film strips are marked when the site is built. The print takes the film's line breaks: both have the same measure,
   and the film's outlined phrases take a little more room, so the plain print always fits wherever the film breaks. */
function filmBreaks(p){
  const out = []; let at = 0, lastTop = null;
  const walk = n => {
    if (n.nodeType === 3){
      const rg = document.createRange();
      for (let i = 0; i < n.data.length; i++, at++){
        if (/\s/.test(n.data[i])) continue;
        rg.setStart(n, i); rg.setEnd(n, i + 1);
        const r = rg.getClientRects()[0]; if (!r) continue;
        if (lastTop !== null && r.top > lastTop + r.height * .5) out.push(at);
        lastTop = r.top;
      }
    } else if (!(n.classList && (n.classList.contains('fl') || n.classList.contains('sr-only')))) n.childNodes.forEach(walk);
  };
  walk(p);
  return out;
}
function syncPrint(fig){
  const t = fig.dataset.text, pp = fig.querySelector('.print p');
  const br = filmBreaks(fig.querySelector('.strip p'));
  const frag = document.createDocumentFragment(); let a = 0;
  br.forEach(b => { frag.appendChild(document.createTextNode(t.slice(a, b).trimEnd())); frag.appendChild(document.createElement('br')); a = b; });
  frag.appendChild(document.createTextNode(t.slice(a)));
  pp.replaceChildren(frag);
}
const pairs = [...document.querySelectorAll('.pair')];
let prT = 0;
const syncPrints = () => { cancelAnimationFrame(prT); prT = requestAnimationFrame(() => pairs.forEach(syncPrint)); };
if ('ResizeObserver' in window) pairs.forEach(fig => { syncPrint(fig); new ResizeObserver(syncPrints).observe(fig.querySelector('.strip')); });
if (document.fonts){ document.fonts.ready.then(syncPrints); if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', syncPrints); }

/* ------------------------------------------------------------ boot */
function reposition(){
  if (mode === 'sweep') return;
  cancelGlide();
  if (anchor >= 0 && moves[anchor]){ const p = moves[anchor].rest; setR(p.r); setPos(p.x, p.y); }
  else if (!moves.length){ const p = restPose(-1); setR(p.r); setPos(p.x, p.y); }
  else setPos(pos.x, pos.y);
  if (mode === 'park'){ mode = 'rest'; showHandoff(); updateCurrent(true); }
}
if (!engineOk) engineFailed();
loupe.hidden = false;
buildRing();
render(SAMPLES[FIRST].text);
// after the first paint: the room above the text in one task, the rest of the layout in the next
requestAnimationFrame(() => setTimeout(() => {
  if (laidOut) return;
  const w = base.getBoundingClientRect().width;
  if (w >= 2){ lastFontKey = fontKey(); roomFor(w); }
  setTimeout(firstLayout, 0);
}, 0));

let roT = 0;
if ('ResizeObserver' in window) new ResizeObserver(() => { if (!laidOut) return; cancelAnimationFrame(roT); roT = requestAnimationFrame(() => { if (geo() === lastGeo) return; if (layout()) reposition(); }); }).observe(base);
// a font arriving re-lays the text only if it moved something (the extra pieces of the type change nothing on screen)
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (!laidOut || (geo() === lastGeo && fontKey() === lastFontKey)) return; if (layout()) reposition(); });
onMq(mqSmall, () => { if (laidOut && layout()) reposition(); });
onMq(mqCoarse, buildRing);
onMq(mqReduce, () => { if (mqReduce.matches){ takeover(); } });

function begin(still){
  if (mode !== 'boot') return;
  laidOut = true;
  layout();
  // with reduced motion, or when the text is not on screen when the page is ready (a short window, or a visitor who has
  // scrolled on), the page shows its resting state at once: the loupe on the first move, the count, the list and the readout
  if (mqReduce.matches || still){
    mode = 'rest'; anchor = moves.length ? 0 : -1;
    reposition(); showLoupe();
    revealAll(); showHandoff(); updateCurrent(true); warmUp();
    return;
  }
  if (document.hidden){
    const f = () => { if (!document.hidden){ document.removeEventListener('visibilitychange', f); begin(!inViewNow(stage)); } };
    document.addEventListener('visibilitychange', f);
    return;
  }
  startSweep();
}
const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
const pageLoaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(r => addEventListener('load', r, { once:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
// the reading plays only where it can be seen: when most of the text is on screen as the page becomes ready
function inViewNow(node){
  const r = node.getBoundingClientRect();
  const seen = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
  return seen >= Math.min(r.height, innerHeight) * .6 - 1;
}
// start once the page has loaded and the type has settled, never later than 2.5 seconds in
Promise.race([Promise.all([pageLoaded, Promise.race([fontsReady, wait(900)])]), wait(2500)])
  .then(() => requestAnimationFrame(() => begin(!inViewNow(stage))));

/* Both typefaces are loaded whole (every subset, both styles) before the counter starts,
   so no text pasted later can make the browser fetch another piece of them. */
function primeFonts(){
  const fs = document.fonts; if (!fs) return Promise.resolve();
  const loads = [];
  try { fs.forEach(f => { if (f.status === 'unloaded') loads.push(f.load().catch(() => {})); }); } catch (e) { /* older browsers */ }
  ['400 16px Newsreader', 'italic 400 16px Newsreader', '400 16px "DM Mono"', '500 16px "DM Mono"'].forEach(q => {
    try { loads.push(fs.load(q, 'ąơ').catch(() => {})); } catch (e) { /* older browsers */ }
  });
  // the other tone's paper grain too, so that switching Paper and Ink (or the system's light and dark) asks for nothing
  // Each image is kept for the page's lifetime: an image no script holds can be dropped from the browser's memory
  // cache, and then a switch of tone after a few seconds would fetch the file again and move the counter.
  GRAINS.forEach(u => { const i = new Image(); PRIMED.push(i); loads.push(new Promise(r => { i.onload = i.onerror = r; })); i.src = u; });
  return Promise.all(loads).then(() => fs.ready);
}
/* Every image the stylesheets use; site/test/site.test.mjs checks the list against them. */
const GRAINS = ['img/grain.svg', 'img/grain-paper.svg', 'img/grain-paper-dark.svg'];
const PRIMED = [];
// the fallback timer starts at load, so a slow link cannot start the count before the priming has begun; if the timer wins,
// type may still arrive and be counted, so the label stops promising that the typefaces are in
// if nothing else has started it (a tab opened in the background, say), the rules are compiled a while after load
pageLoaded.then(() => wait(8000)).then(warmUp);
pageLoaded.then(() => Promise.race([fontsReady.then(primeFonts).then(() => true), wait(15000).then(() => false)])).then(fontsIn => {
  if (!fontsIn && since === Infinity) $('#reqLab').textContent = 'Requests sent since this page';
  armCounter();
});
})();
