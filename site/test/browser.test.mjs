// Checks the built site in a real browser (Chromium, through Playwright):
//
// - the home page paints and settles without a long stall, even on a slow
//   phone (the CPU slowed four times, as Lighthouse does for mobile);
// - no page logs an error or breaks its security policy;
// - the request counter stays at 0 after the page has loaded, when you
//   switch Paper and Ink, and when you check a text of your own;
// - below a short text of your own, the resting loupe covers nothing: not
//   the hand-off, not the edit button, not the counter;
// - a text with no marks says what the rules miss, and links to it;
// - Enter on a row of the move list keeps the row on screen, and picking a
//   sample announces what was found;
// - hostile strings pasted as a text of your own ("Safe rendering" in
//   AGENTS.md) come out as literal text in the highlighted text and the move
//   list, with no element created, no script run and no link made.
//
// Playwright is not a dependency of this repository. Install it and its
// Chromium outside the repository and point NODE_PATH at the node_modules
// folder that holds it, as for scripts/readme-images.mjs:
//
//   (cd packages/engine && npm ci)
//   NODE_PATH="$(npm root -g)" node --test site/test/browser.test.mjs
//
// Without Playwright every test here is skipped. SITE_SKIP_ENGINE_BUILD=1
// reuses packages/engine/dist as it is.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build } from "../../scripts/build-site.mjs";
import { PAGES_CACHE, serve } from "../../scripts/serve-site.mjs";

let chromium = null;
try {
  const paths = (process.env.NODE_PATH ?? "").split(":").filter(Boolean);
  const from = paths.length ? join(paths[0], "noop.js") : import.meta.url;
  ({ chromium } = createRequire(from)("playwright"));
} catch {
  chromium = null;
}
const skip = chromium ? false : "Playwright is not installed (see the header of this file)";

let out;
let server;
let browser;
let origin;
const BASE = "/biasclear/";

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "biasclear-browser-"));
  await build({ out, engineBuild: !process.env.SITE_SKIP_ENGINE_BUILD, log: () => {} });
  // GitHub Pages lets a browser keep files for ten minutes; the counter's checks depend on that
  server = await serve({ dir: out, port: 0, cache: PAGES_CACHE });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

/** A page that records errors, policy violations and long tasks from the start. */
async function open(path, { width = 1280, height = 900, scheme = "light", cpu = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.addInitScript(() => {
    window.__longTasks = [];
    window.__violations = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    }).observe({ type: "longtask", buffered: true });
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (cpu > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }
  await page.goto(origin + BASE + path);
  return { page, context, problems };
}

/** Wait until the counter has started (it shows a number instead of a dash). */
const armed = (page) => page.waitForFunction(() => /^\d+$/.test(document.getElementById("reqN").textContent), null, { timeout: 30_000 });

/** Put a text of your own under the loupe, through the editor. */
async function checkOwn(page, text) {
  await page.click("button.chip.own");
  await page.fill("#own", text);
  await page.click("#go");
  await page.waitForFunction(() => document.getElementById("stage").hidden === false && document.getElementById("nMoves").textContent !== "Loading the rules…");
  await page.waitForTimeout(700); // the loupe glides to its resting place
}

const box = (page, selector) =>
  page.evaluate((sel) => {
    const n = document.querySelector(sel);
    if (!n || n.hidden || !n.getClientRects().length) return null;
    const r = n.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, selector);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("in a browser", { skip }, () => {
  it("paints the home page and settles without a long stall on a slow phone", async () => {
    const { page, context, problems } = await open("", { width: 390, height: 844, cpu: 4 });
    await page.waitForSelector(".handoff.on", { timeout: 60_000 });
    // the rules are compiled in the background after the opening read; wait for that too
    await page.waitForFunction(() => {
      const t0 = performance.now();
      window.BiasClear.scan("Everyone knows it works. Act now, “please”.");
      return performance.now() - t0 < 100;
    }, null, { timeout: 60_000, polling: 1000 });
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? Infinity);
    const longest = Math.max(0, ...(await page.evaluate(() => window.__longTasks)));
    // Before the samples were marked at build time and the rules compiled in slices, a first paint took up to 7 s here
    // and one task 6.5 s. The limits leave room for a slower machine.
    assert.ok(fcp < 2500, `first contentful paint at ${Math.round(fcp)} ms`);
    assert.ok(longest < 1500, `a task took ${longest} ms`);
    assert.deepEqual(problems, []);
    await context.close();
  });

  it("logs no error and breaks no security policy on any page", async () => {
    for (const path of ["", "guide/", "method.html", "privacy.html", "about.html", "404.html"]) {
      const { page, context, problems } = await open(path);
      await page.waitForLoadState("load");
      await page.waitForTimeout(300);
      assert.deepEqual(problems, [], path);
      assert.deepEqual(await page.evaluate(() => window.__violations), [], path);
      await context.close();
    }
  });

  for (const scheme of ["light", "dark"]) {
    it(`asks for nothing once loaded, through Paper and Ink and a text of your own (${scheme})`, async () => {
      const { page, context } = await open("", { scheme });
      await armed(page);
      assert.equal(await page.textContent("#reqN"), "0");
      const seen = [];
      page.on("request", (r) => seen.push(r.url()));
      await page.click(`.tone button[data-tone="${scheme === "light" ? "dark" : "light"}"]`);
      await page.waitForTimeout(500);
      await page.click(`.tone button[data-tone="${scheme}"]`);
      await checkOwn(page, "Zoë Łódź Ω Привет 你好 \u{1F600} Everyone knows it. Act now.");
      await page.waitForTimeout(500);
      assert.deepEqual(seen, []);
      assert.equal(await page.textContent("#reqN"), "0");
      await context.close();
    });
  }

  for (const [width, height] of [[1280, 900], [390, 844], [640, 450]]) {
    it(`keeps the resting loupe off the hand-off, the edit button and the counter below a short text (${width}px)`, async () => {
      const { page, context } = await open("", { width, height });
      await armed(page);
      for (const text of ["Everyone knows it. Act now.", "Act now.", "The bus comes at nine."]) {
        await page.evaluate(() => document.getElementById("editOwn").hidden || document.getElementById("editOwn").click());
        if (await page.isVisible("#editOwnFoot")) await page.click("#editOwnFoot");
        await checkOwn(page, text);
        const loupe = await box(page, "#loupe");
        assert.ok(loupe, "the loupe is shown");
        for (const sel of ["#handoff", ".req", "#editOwnFoot"]) {
          const b = await box(page, sel);
          if (b) assert.ok(!overlaps(loupe, b), `${text}: the loupe covers ${sel}`);
        }
      }
      await context.close();
    });
  }

  it("keeps a row of the move list on screen when Enter picks it, and announces a picked sample", async () => {
    const { page, context } = await open("", { width: 640, height: 450 });
    await armed(page);
    // the opening read waits until the text is on screen
    await page.evaluate(() => document.getElementById("stage").scrollIntoView({ block: "center" }));
    await page.waitForSelector(".handoff.on", { timeout: 30_000 });
    for (const i of [0, 3, 5]) {
      await page.focus(`#moves button[data-i="${i}"]`);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1300);
      const top = await page.evaluate((k) => document.querySelector(`#moves button[data-i="${k}"]`).getBoundingClientRect().top, i);
      assert.ok(top >= 0 && top < 450, `row ${i} is at ${Math.round(top)} px, off the screen`);
    }
    await page.focus('.chip[data-k]:not([data-k="own"]):not([aria-pressed="true"])');
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /is under the loupe\. .*(found|No moves)/.test(document.getElementById("live").textContent));
    await context.close();
  });

  it("shows hostile strings as literal text, with no element, script or link made from them", async () => {
    const { page, context, problems } = await open("");
    await armed(page);
    const dialogs = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    const count = () =>
      page.evaluate(() => ({
        img: document.querySelectorAll("img").length,
        script: document.querySelectorAll("script").length,
        jsLinks: document.querySelectorAll('[href^="javascript:" i], [src^="javascript:" i], [src="x"]').length,
      }));
    const before = await count();
    const hostile = [
      "<img src=x onerror=alert(1)>",
      "</mark><script>alert(1)</script>",
      "javascript:alert(1)",
    ];
    // Each string sits beside a move, so it lands inside the marked text, the loupe and the move list.
    await checkOwn(page, `Act now. ${hostile[0]} Everyone knows it. ${hostile[1]} Act now: ${hostile[2]}`);
    await page.waitForTimeout(500);
    assert.deepEqual(await count(), before);
    const stage = await page.textContent("#stage");
    for (const h of hostile) assert.ok(stage.includes(h), `${h} is not shown as text`);
    assert.ok(Number((await page.textContent("#nMoves")).match(/\d+/)?.[0]) > 0, "the moves beside the strings are found");
    assert.deepEqual(dialogs, []);
    assert.deepEqual(problems, []);
    await context.close();
  });

  it("asks for nothing when Paper and Ink or the system's scheme switch long after load", async () => {
    // The primed paper grain was dropped from the memory cache after a few seconds, so a switch then fetched it again
    // (fix round 1); the page now keeps the primed images for its lifetime.
    const { page, context } = await open("");
    await armed(page);
    const seen = [];
    page.on("request", (r) => seen.push(r.url()));
    await page.waitForTimeout(12_000);
    await page.click('.tone button[data-tone="dark"]');
    await page.waitForTimeout(500);
    await page.click('.tone button[data-tone="light"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(800);
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(800);
    assert.deepEqual(seen, []);
    assert.equal(await page.textContent("#reqN"), "0");
    await context.close();
  });

  for (const [width, height] of [[390, 664], [360, 640], [1280, 600]]) {
    it(`shows the count, the loupe and the list on a short first screen (${width}x${height})`, async () => {
      // With the text partly below the fold, the page used to wait for it to scroll into view, and meanwhile drew the
      // film's disc with no loupe around it and left the count, the list and the readout empty.
      const { page, context, problems } = await open("", { width, height });
      await page.waitForSelector(".handoff.on", { timeout: 15_000 });
      const state = await page.evaluate(() => ({
        count: document.getElementById("nMoves").textContent,
        loupeOn: document.getElementById("loupe").classList.contains("on"),
        lit: document.getElementById("stage").classList.contains("lit"),
        rows: document.querySelectorAll("#moves li").length,
        shown: document.querySelectorAll("#moves li.in").length,
        name: document.getElementById("roName").textContent.trim(),
      }));
      assert.match(state.count, /^\d+ moves?$/);
      assert.ok(state.loupeOn && state.lit, "the loupe and its film are shown together");
      assert.ok(state.rows > 0 && state.shown === state.rows, `${state.shown} of ${state.rows} rows shown`);
      assert.ok(state.name.length > 0, "the readout names a move");
      // jumping past the text leaves the list and the readout filled in
      await page.evaluate(() => document.querySelector(".movelist").scrollIntoView());
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.querySelectorAll("#moves li.in").length), state.rows);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }

  it("never draws the film without the loupe around it", async () => {
    const { page, context } = await open("", { width: 390, height: 664 });
    await page.waitForLoadState("load");
    for (let i = 0; i < 10; i++) {
      const bad = await page.evaluate(() => {
        const film = getComputedStyle(document.getElementById("film")).visibility;
        return film === "visible" && !document.getElementById("loupe").classList.contains("on");
      });
      assert.equal(bad, false, "the film shows while the loupe is hidden");
      await page.waitForTimeout(150);
    }
    await context.close();
  });

  it("styles the 404 page and keeps its links working at any depth", async () => {
    const { page, context } = await open("guide/missing/deeper");
    const failed = [];
    page.on("requestfailed", (r) => failed.push(r.url()));
    page.on("response", (r) => { if (r.status() >= 400 && r.request().resourceType() !== "document") failed.push(`${r.status()} ${r.url()}`); });
    await page.reload();
    await page.waitForLoadState("load");
    assert.deepEqual(failed, []);
    const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(styled, "rgba(0, 0, 0, 0)", "the page has no stylesheet");
    const about = await page.evaluate(() => new URL(document.querySelector('nav a[href$="about.html"]').href).pathname);
    assert.equal(about, `${BASE}about.html`);
    await context.close();
  });

  it("says what the rules miss when it marks nothing", async () => {
    const { page, context } = await open("");
    await armed(page);
    await checkOwn(page, "The bus comes at nine.");
    assert.match(await page.textContent("#roDesc"), /set wordings/);
    assert.equal(await page.textContent("#roLink"), "What the rules miss");
    assert.equal(await page.getAttribute("#roLink", "href"), "#misses");
    assert.match(await page.textContent("#moves"), /can miss the same move made in other words/);
    await context.close();
  });
});
