// Builds the website into a temporary folder and checks what it ships:
//
// - every page carries the Content-Security-Policy and referrer policy, and
//   has no inline script, inline style or event-handler attribute;
// - no file asks another site for anything: an external URL may appear only
//   as a plain link (<a href>) to GitHub, GitHub's docs or the preprint's DOI;
// - every internal link, script, stylesheet, font and image resolves, with
//   relative paths only, including #fragments;
// - the engine the site serves is the engine package's browser build, byte
//   for byte, and gives the same results as the package on sample texts;
// - the page scripts never parse text as HTML, store nothing and send nothing,
//   and load every image the stylesheets use before the request counter starts;
// - the sample moves the page draws without a scan are the engine's own;
// - link previews (og:image, og:url) appear only with a site address, and are
//   the only absolute URLs the pages load nothing from;
// - the vendored typefaces match site/fonts/fonts.json;
// - the Field Guide and home-page claims hold (the build checks them too),
//   and each Field Guide example shows its own move and no other;
// - contact and personal details are limited to what AGENTS.md allows.
//
// Run: node --test site/test/site.test.mjs   (needs `npm ci` in packages/engine,
// and a Python with pytest as PYTHON or python3, for scripts/site_facts.py)
// site/test/browser.test.mjs checks the pages in a real browser (Playwright).
// SITE_SKIP_ENGINE_BUILD=1 reuses packages/engine/dist as it is.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { after, before, describe, it } from "node:test";
import {
  BUNDLE_PATH,
  CSP,
  ENGINE_ESM,
  ENGINE_IIFE,
  REFERRER,
  ROOT,
  SITE,
  SOCIAL_IMAGE,
  anchor,
  basePath,
  build,
  checkGuide,
  checkHome,
  checkOut,
  checkTierNumerals,
  esc,
  siteAddress,
} from "../../scripts/build-site.mjs";

/** Hosts a page may link to (never load from). */
const LINK_HOSTS = new Set(["github.com", "doi.org", "docs.github.com"]);
/** The one URL that may appear in scripts and images: the SVG namespace name, which is never fetched. */
const SVG_NS = "http://www.w3.org/2000/svg";

let out;
let site;
let engine;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}
const rel = (file) => relative(out, file).split("\\").join("/");
const read = (file) => readFileSync(file, "utf8");
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const pages = () => walk(out).filter((f) => f.endsWith(".html"));

/** Check generated markup's exact spelling; expected URLs and paths are not regexes. */
function assertLiteralHtml(html, expected, label) {
  assert.ok(html.includes(expected), `${label}: missing ${expected}`);
}

/**
 * A strict assertion for this build's static markup, not an HTML sanitizer.
 * Read quoted attributes through their closing quote so a quoted ">" cannot
 * hide a later event handler. Scripts must use the emitter's canonical form.
 */
function assertNoInlineCode(html, label) {
  for (const match of html.matchAll(/<([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/gi)) {
    let quote = null;
    let end = match.index + match[0].length;
    for (; end < html.length; end++) {
      const c = html[end];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    assert.ok(end < html.length, `${label}: an unterminated start tag`);
    const tag = html.slice(match.index, end + 1);
    const name = match[1].toLowerCase();
    assert.notEqual(name, "style", `${label}: a <style> element`);
    assert.doesNotMatch(tag, /[\s/]style\s*=/i, `${label}: a style attribute`);
    assert.doesNotMatch(tag, /[\s/]on[a-z]+\s*=/i, `${label}: an event-handler attribute`);
    if (name === "script") {
      const prefix = '<script src="';
      const suffix = '" defer>';
      assert.ok(tag.startsWith(prefix) && tag.endsWith(suffix), `${label}: a noncanonical script tag`);
      const src = tag.slice(prefix.length, -suffix.length);
      assert.ok(src.length > 0 && !/["\s<>]/.test(src), `${label}: a noncanonical script src`);
      const close = html.indexOf("</script>", end + 1);
      assert.ok(close >= 0, `${label}: a script without its closing tag`);
      assert.equal(html.slice(end + 1, close).trim(), "", `${label}: a script with inline code`);
    }
    assertSafeUrls(tag, label);
  }
  assert.doesNotMatch(html, /javascript:/i, `${label}: a javascript: URL`);
}

/** Character references a browser decodes in an attribute value, as far as a scheme could hide behind them. */
function decodeReferences(value) {
  const named = { colon: ":", tab: "\t", newline: "\n", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", sol: "/", period: "." };
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all);
}

/**
 * Every URL-bearing attribute is relative, https: or mailto: once decoded as a browser would read it
 * (character references decoded, ASCII tab and line breaks removed, leading spaces and controls
 * trimmed), and srcdoc is refused outright (311 LOW). Still a check of this build's markup, not a sanitizer.
 */
function assertSafeUrls(tag, label) {
  for (const a of tag.matchAll(/[\s/]([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = a[1].toLowerCase();
    assert.notEqual(name, "srcdoc", `${label}: a srcdoc attribute`);
    if (!["href", "src", "action", "formaction", "xlink:href", "poster", "background", "cite", "data"].includes(name)) continue;
    const value = decodeReferences(a[2] ?? a[3] ?? a[4] ?? "").replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "");
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1].toLowerCase();
    assert.ok(scheme === undefined || scheme === "https" || scheme === "mailto", `${label}: a ${scheme}: URL in ${name}`);
  }
}

before(async () => {
  out = mkdtempSync(join(tmpdir(), "biasclear-site-"));
  site = await build({ out, engineBuild: !process.env.SITE_SKIP_ENGINE_BUILD, log: () => {} });
  engine = await import(pathToFileURL(ENGINE_ESM).href);
});
after(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("pages", () => {
  it("builds every page", () => {
    const want = ["index.html", "guide/index.html", "method.html", "privacy.html", "about.html", "404.html"];
    for (const p of want) assert.ok(existsSync(join(out, p)), `${p} is missing`);
    assert.deepEqual([...site.pages].sort(), [...want].sort());
  });

  it("gives every page the security policy first, and the referrer policy", () => {
    for (const file of pages()) {
      const html = read(file);
      const csp = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];
      assert.equal(csp.length, 1, `${rel(file)}: one CSP meta`);
      assert.equal(csp[0][1], CSP, `${rel(file)}: CSP`);
      assert.doesNotMatch(csp[0][1], /unsafe-|\*|https?:|data:/, `${rel(file)}: CSP allows only 'self'`);
      assert.match(csp[0][1], /script-src 'self'/);
      assert.match(csp[0][1], /connect-src 'none'/);
      assert.match(csp[0][1], /require-trusted-types-for 'script'; trusted-types 'none'/);
      // the policy comes before anything the page loads
      const head = html.slice(0, html.indexOf("</head>"));
      assert.ok(head.indexOf("Content-Security-Policy") < head.search(/<(link|script)\b/), `${rel(file)}: CSP comes first`);
      assert.match(head, new RegExp(`<meta name="referrer" content="${REFERRER}">`), `${rel(file)}: referrer policy`);
    }
  });

  it("has no inline script, inline style or event handler", () => {
    for (const file of pages()) assertNoInlineCode(read(file), rel(file));
  });

  it("rejects executable-markup mutations, including case and attribute tricks", () => {
    assert.doesNotThrow(() => assertNoInlineCode('<script src="./js/theme.js" defer></script>', "control"));
    const unsafe = [
      "<SCRIPT>alert(1)</SCRIPT>",
      '<ScRiPt src="./js/theme.js">alert(1)</ScRiPt>',
      "<script/ >alert(1)</script>",
      "<script\n>alert(1)</script>",
      '<script src="./js/theme.js" defer>alert(1)</script>',
      '<script data-note=\' src="./js/theme.js"\'></script>',
      '<script data-note=">" src="./js/theme.js" defer>alert(1)</script>',
      '<script src="./js/theme.js" defer/>alert(1)</script>',
      '<script src="./js/theme.js" defer>',
      "<STYLE>body{color:red}</STYLE>",
      '<div style ="color:red"></div>',
      '<div data-note=">" OnClick ="alert(1)"></div>',
      '<img src="x"\nonerror ="alert(1)">',
      '<a href="javascript:alert(1)">link</a>',
      // Slash-delimited attributes were found in the root review.
      "<img/onerror=alert(1)>",
      "<svg/onload=alert(1)></svg>",
      "<div/style=color:red></div>",
      // Encoded and alternative schemes, and srcdoc (311 LOW).
      '<a href="jav&#x61;script:alert(1)">link</a>',
      '<a href="jav&#97;script:alert(1)">link</a>',
      '<a href="javascript&colon;alert(1)">link</a>',
      '<a href="java\tscript:alert(1)">link</a>',
      '<a href="java&Tab;script:alert(1)">link</a>',
      '<a href=" \njavascript:alert(1)">link</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">link</a>',
      "<a href='vbscript:msgbox(1)'>link</a>",
      "<a href=vbscript:msgbox(1)>link</a>",
      '<a href="http://example.org/">link</a>',
      '<form action="javascript:alert(1)"></form>',
      '<button formaction="data:text/html,x">go</button>',
      '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
      '<iframe SRCDOC="x"></iframe>',
    ];
    for (const html of unsafe) assert.throws(() => assertNoInlineCode(html, "mutation"), { name: "AssertionError" }, html);
    for (const safe of ['<a href="https://biasclear.com/">x</a>', '<a href="mailto:hello@biasclear.com">x</a>', '<a href="./guide/">x</a>',
      '<a href="#main">x</a>', '<a href="/method.html#status">x</a>', '<img src="./img/loupe.png" alt="">', '<a href="?q=1">x</a>']) {
      assert.doesNotThrow(() => assertNoInlineCode(safe, "control"), safe);
    }
  });

  it("has one h1, a language, a title, a description, and a skip link to <main id=main>", () => {
    for (const file of pages()) {
      const html = read(file);
      assert.match(html, /^<!doctype html>\n<html lang="en">/, rel(file));
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${rel(file)}: one h1`);
      assert.match(html, /<title>[^<]+<\/title>/, rel(file));
      assert.match(html, /<meta name="description" content="[^"]+">/, rel(file));
      assert.match(html, /<a class="skip" href="#main">/, rel(file));
      assert.equal((html.match(/<main id="main">/g) ?? []).length, 1, `${rel(file)}: one main#main`);
      assert.match(html, /<a class="pv" [^>]*>Preview<\/a>/, `${rel(file)}: the Preview label`);
    }
  });
});

describe("no third-party requests", () => {
  it("links out only with <a href> to GitHub, GitHub's docs or the DOI, and loads nothing from elsewhere", () => {
    for (const file of walk(out)) {
      if (/\.(woff2|png)$/.test(file)) continue;
      // The typefaces' license texts carry the license's own URLs; no page loads them.
      if (/^fonts\/OFL-[\w-]+\.txt$/.test(rel(file))) continue;
      let text = read(file);
      if (file.endsWith(".html")) {
        text = text.replace(/(<a\b[^>]*\shref=")(https:\/\/[^"]+)(")/g, (m, pre, url, post) => {
          assert.ok(LINK_HOSTS.has(new URL(url).host), `${rel(file)}: link to ${url}`);
          return `${pre}${post}`;
        });
      }
      if (/\.(js|svg)$/.test(file)) text = text.split(SVG_NS).join("");
      assert.doesNotMatch(text, /[a-z][a-z0-9+.-]*:\/\//i, `${rel(file)}: an external URL outside a plain link`);
      assert.doesNotMatch(text, /(?:href|src)="\/\//, `${rel(file)}: a protocol-relative URL`);
      assert.doesNotMatch(text, /url\(\s*["']?\/\//, `${rel(file)}: a protocol-relative url()`);
      assert.doesNotMatch(text, /@import/, `${rel(file)}: @import`);
    }
  });

  it("uses relative paths only, and every internal link, script, stylesheet and image resolves", () => {
    const BASE = basePath(site.siteUrl);
    const ids = new Map();
    const idsOf = (file) => {
      if (!ids.has(file)) ids.set(file, new Set([...read(file).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
      return ids.get(file);
    };
    const target = (from, url) => {
      const [path, frag] = url.split("#");
      let p = path === "" ? rel(from) : posix.normalize(posix.join(posix.dirname(rel(from)), path));
      if (path.endsWith("/") || path === "." || path === "./") p = posix.join(p, "index.html");
      return { file: join(out, p), frag, p };
    };
    let checked = 0;
    for (const file of pages()) {
      for (const m of read(file).matchAll(/\s(href|src)="([^"]*)"/g)) {
        let url = m[2].replace(/&amp;/g, "&");
        // GitHub Pages serves 404.html at any missing address, so its links are anchored at the site's base path
        // (basePath in scripts/build-site.mjs); from the site's root each one names a file that exists
        if (rel(file) === "404.html" && !/^(https:|mailto:|#)/.test(url)) {
          assert.ok(url.startsWith(BASE), `404.html: ${url} is not anchored at ${BASE}`);
          url = url.slice(BASE.length) || "./";
        }
        if (/^(https:|mailto:)/.test(url)) {
          if (url.startsWith("mailto:")) assert.equal(url, "mailto:hello@biasclear.com", `${rel(file)}: ${url}`);
          continue;
        }
        assert.ok(!url.startsWith("/"), `${rel(file)}: root-relative path ${url}`);
        assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(url), `${rel(file)}: ${url}`);
        const t = target(file, url);
        assert.ok(!t.p.startsWith(".."), `${rel(file)}: ${url} leaves the site`);
        assert.ok(existsSync(t.file), `${rel(file)}: ${url} does not resolve (${t.p})`);
        if (t.frag) assert.ok(idsOf(t.file).has(decodeURIComponent(t.frag)), `${rel(file)}: #${t.frag} is not in ${t.p}`);
        checked++;
      }
    }
    for (const file of walk(out).filter((f) => f.endsWith(".css"))) {
      for (const m of read(file).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        assert.ok(!m[1].startsWith("/") && !/^[a-z]+:/i.test(m[1]), `${rel(file)}: url(${m[1]})`);
        assert.ok(existsSync(join(dirname(file), m[1])), `${rel(file)}: url(${m[1]}) does not resolve`);
        checked++;
      }
    }
    assert.ok(checked > 100, `only ${checked} links checked`);
  });

  it("anchors the 404 page's links at the site's base path, so it is styled and its links work at any depth", () => {
    // GitHub Pages serves 404.html for a missing address such as /biasclear/guide/x/y; a relative ./css/site.css
    // would resolve inside the missing folder
    const BASE = basePath(site.siteUrl);
    const html = read(join(out, "404.html"));
    const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https:|mailto:|#)/.test(u));
    assert.ok(urls.length > 8, urls.join(" "));
    for (const u of urls) assert.ok(u.startsWith(BASE), `404.html: ${u}`);
    for (const f of ["css/site.css", "js/theme.js", "favicon.svg", "about.html", "guide/", "method.html", "privacy.html"]) {
      assert.ok(urls.includes(BASE + f), `404.html has no ${BASE + f}`);
    }
    assert.equal(basePath(null), "/biasclear/");
    assert.equal(basePath("https://biasclear.com/"), "/");
    assert.equal(basePath("https://biasclear.github.io/biasclear/"), "/biasclear/");
  });
});

describe("link previews", () => {
  it("are left out without a site address", () => {
    for (const file of pages()) {
      const html = read(file);
      assert.doesNotMatch(html, /og:image|og:url/, rel(file));
      assert.match(html, /<meta name="twitter:card" content="summary">/, rel(file));
    }
    assert.ok(existsSync(join(out, SOCIAL_IMAGE)), "the preview image is served");
  });

  it("with a site address, are the only absolute URLs besides plain links, and point into the site", async () => {
    const siteUrl = "https://example.github.io/biasclear/";
    const out2 = mkdtempSync(join(tmpdir(), "biasclear-site-url-"));
    try {
      await build({ out: out2, engineBuild: false, log: () => {}, site: siteUrl.slice(0, -1) });
      for (const file of walk(out2).filter((f) => f.endsWith(".html"))) {
        const name = relative(out2, file).split("\\").join("/");
        let html = read(file);
        assertLiteralHtml(html, `<meta property="og:image" content="${siteUrl}${SOCIAL_IMAGE}">`, name);
        assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, name);
        const og = html.match(/<meta property="og:url" content="([^"]+)">/);
        if (name === "404.html") assert.equal(og, null);
        else assert.equal(og[1], siteUrl + name.replace(/(^|\/)index\.html$/, "$1"), name);
        html = html.replace(/<meta property="og:(?:url|image)" content="https:\/\/example\.github\.io\/biasclear\/[^"]*">/g, "");
        html = html.replace(/(<a\b[^>]*\shref=")https:\/\/[^"]+"/g, "$1\"");
        assert.doesNotMatch(html, /[a-z][a-z0-9+.-]*:\/\//i, `${name}: an absolute URL other than the two preview tags`);
      }
    } finally {
      rmSync(out2, { recursive: true, force: true });
    }
  });

  it("take only a plain https address", () => {
    assert.equal(siteAddress(""), null);
    assert.equal(siteAddress("https://biasclear.com"), "https://biasclear.com/");
    assert.throws(() => siteAddress("http://biasclear.com/"));
    assert.throws(() => siteAddress("https://biasclear.com/?x=1"));
  });

  it("compares the preview image URL literally, including dots", () => {
    const expected = '<meta property="og:image" content="https://example.github.io/biasclear/img/social-preview.png">';
    assert.doesNotThrow(() => assertLiteralHtml(expected, expected, "control"));
    for (const mutated of [
      expected.replace("example.github.io", "exampleXgithubXio"),
      expected.replace("social-preview.png", "social-previewXpng"),
      expected.replace("https:", "http:"),
    ]) assert.throws(() => assertLiteralHtml(mutated, expected, "mutation"), { name: "AssertionError" });
  });
});

describe("the build", () => {
  it("never replaces the repository or a folder inside it other than _site/", () => {
    assert.throws(() => checkOut(ROOT), /holds the repository/);
    assert.throws(() => checkOut(dirname(ROOT)), /holds the repository/);
    assert.throws(() => checkOut(join(ROOT, "site")), /only _site/);
    assert.equal(checkOut(join(ROOT, "_site")), join(ROOT, "_site"));
    assert.equal(checkOut(out), out);
  });

  it("writes tiers with Roman numerals in the pages and their data", () => {
    assert.deepEqual(checkTierNumerals(), []);
  });
});

describe("the engine", () => {
  it("serves the engine package's browser build, byte for byte", () => {
    assert.equal(sha256(join(out, BUNDLE_PATH)), sha256(ENGINE_IIFE));
    assertLiteralHtml(read(join(out, "index.html")), `<script src="./${BUNDLE_PATH}" defer></script>`, "index.html");
  });

  it("compares the served bundle's script tag literally", () => {
    const expected = `<script src="./${BUNDLE_PATH}" defer></script>`;
    assert.doesNotThrow(() => assertLiteralHtml(expected, expected, "control"));
    for (const mutated of [
      expected.replace("./js/", "X/js/"),
      expected.replace("biasclear.iife", "biasclearXiife"),
      expected.replace(" defer", " async"),
    ]) assert.throws(() => assertLiteralHtml(mutated, expected, "mutation"), { name: "AssertionError" });
  });

  it("gives the same results through the site's bundle as the engine package", () => {
    const home = JSON.parse(read(join(SITE, "data", "home.json")));
    const texts = [
      ...home.samples.map((s) => s.text),
      "\u{1F642} Leading agencies warn of a wet spring. Studies show (Smith et al., 2024) that sleep helps; experts say it works. " +
        "It is well-settled law that this claim is plainly meritless. Critics claimed it; they insisted. On the right side of history.",
    ];
    assert.equal(texts.length, 5);
    const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
    runInContext(read(join(out, BUNDLE_PATH)), context);
    for (const text of texts) {
      for (const domain of ["general", "all"]) {
        const fromSite = JSON.parse(JSON.stringify(runInContext("BiasClear.scan", context)(text, { domain })));
        assert.deepEqual(fromSite, engine.scan(text, { domain }), `${domain}: ${text.slice(0, 40)}`);
      }
    }
  });

  it("draws the samples from the engine's own moves, found when the site was built", () => {
    const data = read(join(out, "js", "site-data.js"));
    const json = JSON.parse(data.slice(data.indexOf("Object.freeze(") + 14, data.lastIndexOf(");")));
    assert.ok(json.samples.length >= 4);
    for (const s of json.samples) {
      const live = engine.scan(s.text).moves.map((m) => ({ s: m.start, e: m.end, id: m.ruleId, t: m.tier }));
      assert.deepEqual(s.moves, live, s.key);
    }
  });

  it("names every rule, and links each to its Field Guide entry", () => {
    const data = read(join(out, "js", "site-data.js"));
    const json = JSON.parse(data.slice(data.indexOf("Object.freeze(") + 14, data.lastIndexOf(");")));
    const guide = read(join(out, "guide", "index.html"));
    for (const r of site.pack.rules) {
      assert.ok(json.moves[r.id]?.name, `${r.id} has no name`);
      assert.equal(json.moves[r.id].href, `guide/#${anchor(r.id)}`);
      assert.match(guide, new RegExp(`<article class="g12 entry[^"]*" id="${anchor(r.id)}"`), `${r.id} has no guide entry`);
    }
    assert.equal(json.maxChars, 20000);
  });
});

describe("claims", () => {
  it("the Field Guide and the home page say only what the engine does", () => {
    const pack = JSON.parse(read(join(ROOT, "rules", "biasclear-rules.json")));
    assert.deepEqual(checkGuide(JSON.parse(read(join(SITE, "data", "field-guide.json"))), pack, engine.scan), []);
    assert.deepEqual(checkHome(JSON.parse(read(join(SITE, "data", "home.json"))), engine.scan), []);
  });

  it("the Field Guide check fails an example that shows another move beside its own", () => {
    const pack = JSON.parse(read(join(ROOT, "rules", "biasclear-rules.json")));
    const guide = JSON.parse(read(join(SITE, "data", "field-guide.json")));
    const entry = structuredClone(guide.find((e) => e.id === "TOTALIZING_HARM_LANGUAGE"));
    // "destroyed the community" is CAUSAL_TOTALIZATION's move as well
    entry.examples[0].text = "Last night's hailstorm completely destroyed the community garden.";
    assert.deepEqual(checkGuide([entry], pack, engine.scan), [
      "TOTALIZING_HARM_LANGUAGE example 1: also marks CAUSAL_TOTALIZATION; an example shows only its own move",
    ]);
    entry.examples[0].text = "Last night's hailstorm completely destroyed the vegetable garden.";
    entry.examples[0].honest_version = "Studies show the storm flattened two beds.";
    assert.deepEqual(checkGuide([entry], pack, engine.scan), ["TOTALIZING_HARM_LANGUAGE example 1: the honest version is marked"]);
  });

  it("states plainly that accuracy is not measured, and quotes no accuracy figure", () => {
    const method = read(join(out, "method.html"));
    assert.match(method, /Accuracy on new text: <em>not measured yet\.<\/em>/);
    for (const file of pages()) {
      const text = read(file).replace(/<[^>]+>/g, " ");
      assert.doesNotMatch(text, /\d+(\.\d+)?\s*%\s*(accura|precis|recall)|\bF1\b\s*(score)?\s*(of|=|:)\s*\d/i, rel(file));
      assert.doesNotMatch(text, /truth score:|certified|compliant|detects lies|AI-powered/i, rel(file));
    }
  });

  it("puts the test counts on the Method page, as counted at build time", () => {
    const method = read(join(out, "method.html"));
    for (const k of ["symPairs", "redTeamPairs", "knownLimits", "retiredPairs", "goldenV2", "goldenUnicode"]) {
      assert.ok(method.includes(`>${site.values[k]}<`) || method.includes(` ${site.values[k]} `), `${k} ${site.values[k]}`);
    }
  });

  it("quotes the citation exactly as the README has it", () => {
    const readme = read(join(ROOT, "README.md"));
    const bibtex = readme.match(/```bibtex\n([\s\S]*?)\n```/)[1];
    assert.ok(read(join(out, "about.html")).includes(`<pre class="cite">${esc(bibtex)}</pre>`));
  });

  it("says what the host keeps and gives the one contact address", () => {
    const privacy = read(join(out, "privacy.html"));
    assert.match(privacy, /GitHub Pages/);
    assert.match(privacy, /IP addresses/);
    assert.match(privacy, /hello@biasclear\.com/);
  });

  it("names no one beyond the paper's citation, and gives no other address", () => {
    // The author's name is read from the README's citation, so this test does not spell it.
    const bibtex = read(join(ROOT, "README.md")).match(/```bibtex\n([\s\S]*?)\n```/)[1];
    const [surname, ...given] = bibtex.match(/author\s*=\s*\{([^}]*)\}/)[1].split(/[\s,]+/).filter(Boolean);
    const short = `${surname}, ${bibtex.match(/year\s*=\s*\{(\d{4})\}/)[1]}`;
    assert.ok(given.length > 0);
    for (const file of walk(out).filter((f) => /\.(html|js|css)$/.test(f))) {
      const text = read(file);
      for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) assert.equal(m[0], "hello@biasclear.com", `${rel(file)}: ${m[0]}`);
      const cite = text.match(/<pre class="cite">[\s\S]*?<\/pre>/)?.[0] ?? "";
      const rest = text.replace(cite, "");
      for (const name of given) assert.ok(!rest.includes(name), `${rel(file)}: a personal name outside the citation`);
      for (const m of rest.matchAll(new RegExp(surname, "g"))) {
        assert.equal(rest.slice(m.index, m.index + short.length), short, `${rel(file)}: the author's surname outside "${short}"`);
      }
    }
  });
});

describe("page scripts", () => {
  const scripts = () => readdirSync(join(SITE, "js")).map((f) => [f, read(join(SITE, "js", f))]);

  it("never parse text as HTML or run strings as code", () => {
    for (const [f, src] of scripts()) {
      assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setTimeout\(\s*["'`]/, f);
    }
  });

  it("load every image the stylesheets use before the request counter starts", () => {
    // A stylesheet image that is fetched only when the tone changes would count as a request after the counter starts.
    const checker = read(join(SITE, "js", "checker.js"));
    const listed = checker.match(/const GRAINS = \[([^\]]*)\]/);
    assert.ok(listed, "checker.js lists the images to load first (GRAINS)");
    const grains = new Set([...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    for (const css of ["site.css", "checker.css"]) {
      for (const m of read(join(SITE, "css", css)).matchAll(/url\(\s*["']?\.\.\/([^"')]+)["']?\s*\)/g)) {
        if (/\.woff2$/.test(m[1])) continue;
        assert.ok(grains.has(m[1]), `${css}: ${m[1]} is not loaded before the counter starts (add it to GRAINS)`);
      }
    }
  });

  it("store nothing and send nothing", () => {
    for (const [f, src] of scripts()) {
      assert.doesNotMatch(
        src,
        /localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\.submit\(/,
        f,
      );
    }
  });
});

describe("typefaces", () => {
  it("are the vendored files listed in site/fonts/fonts.json", () => {
    const manifest = JSON.parse(read(join(SITE, "fonts", "fonts.json")));
    const listed = new Set();
    for (const pkg of manifest.packages) {
      assert.equal(pkg.license, "OFL-1.1");
      for (const [name, hash] of Object.entries(pkg.files)) {
        listed.add(name);
        assert.equal(sha256(join(SITE, "fonts", name)), hash, name);
        assert.equal(sha256(join(out, "fonts", name)), hash, `built ${name}`);
      }
    }
    for (const f of readdirSync(join(SITE, "fonts"))) {
      if (f !== "fonts.json") assert.ok(listed.has(f), `${f} is not in fonts.json`);
    }
  });
});
