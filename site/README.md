# The BiasClear website

A static site in the Lightbox design: the checker (home page), the Field Guide, Method, Privacy, About and a 404 page. It runs the real engine in the visitor's browser, and its code sends nothing anywhere.

## Build and preview

```bash
(cd packages/engine && npm ci)     # the engine's build tools
pip install '.[test]'              # pytest, for the test counts on the Method page
node scripts/build-site.mjs        # writes _site/ (gitignored)
node scripts/serve-site.mjs        # http://127.0.0.1:8080/biasclear/
```

`scripts/build-site.mjs` builds the engine first and copies its browser bundle (`packages/engine/dist/biasclear.iife.min.js`) into the site unchanged, so the site always runs the tested engine and the current rule pack. It reads the rule pack, `site/data/`, the citation in `README.md`, and the test counts from `scripts/site_facts.py`, then checks the engine examples, rule coverage, tier labels and generated counts and stops if one fails. These checks do not verify every prose claim. `PYTHON` picks the Python that runs `site_facts.py` (default `python3`).

`scripts/serve-site.mjs` serves `_site/` under `/biasclear/`, the path GitHub Pages gives a project site with no custom domain. The live site is at the root of biasclear.com, and a relative link that works under a subfolder also works at the root, so the subfolder is the stricter test. It sends `no-store`, so an edit shows at once; `--pages-cache` sends GitHub Pages' ten-minute cache instead, which the request counter's behavior depends on.

`SITE_URL` (the Pages workflow sets it from `actions/configure-pages`) adds the link-preview tags, `og:url` and `og:image` with a large X card. They must be absolute, so they are the only absolute URLs on the pages, and they follow the site's address, including a custom domain, with no code change. Without `SITE_URL` the pages carry a plain `summary` card.

## Test

```bash
node --test site/test/site.test.mjs
```

It builds the site into a temporary folder and checks: the Content-Security-Policy (with Trusted Types) and referrer policy on every page; no inline script, style or event handler; no external URL anywhere except plain `<a href>` links to GitHub, GitHub's docs and the preprint's DOI, and the two link-preview tags when `SITE_URL` is set; every internal link, asset and `#fragment` resolves with relative paths; the served engine bundle is byte-identical to the package's and gives the same results on five sample texts; the samples' stored moves are the engine's own; the page scripts never use `innerHTML` or storage or the network, and load every stylesheet image before the request counter starts; tiers are written I, II and III; the vendored fonts match `site/fonts/fonts.json`; and the Field Guide and home-page claims hold. CI runs it in the `test` job, and the Pages workflow runs it before every deploy.

```bash
NODE_PATH="$(npm root -g)" node --test site/test/browser.test.mjs
```

`site/test/browser.test.mjs` checks the built pages in Chromium, through Playwright, which is not a dependency of this repository (install it outside, as for `scripts/readme-images.mjs`; without it the tests are skipped, and CI does not run them): no page logs an error or breaks its policy; the request counter stays at 0 through Paper, Ink and a text of your own; the resting loupe covers none of the controls below a short text; Enter on a row of the move list keeps the row on screen, and picking a sample announces what was found; a text with no marks says what the rules miss; the hostile strings of `AGENTS.md` ("Safe rendering"), pasted as a text of your own, come out as literal text with no element, script or link made from them; and, with the CPU slowed four times, the home page paints within 2.5 s and no task runs over 1.5 s.

## Layout

| Path | What |
|---|---|
| `pages/*.html` | Each page's `<main>`, with a JSON front-matter comment (title, description, styles, scripts). `{{name}}` placeholders are filled by the build. Links are written from the site root; the build prefixes them for pages further down (`guide/`). |
| `css/site.css` | The shared Lightbox design tokens and components. `css/fonts.css` (generated) is put in front of it at build time. |
| `css/checker.css` | The home page: the loupe, the specimen, the sections under it. |
| `js/checker.js` | The loupe. It reads `window.BiasClear` (the engine) and `window.BiasClearSite` (`js/site-data.js`, written by the build, with each sample's moves as the engine found them at build time). The samples need no scan; the rules are compiled in the background with the engine's `prepare()`, one pattern per idle moment, for text of your own. |
| `js/theme.js` | The Paper / Ink switch. It stores nothing. |
| `data/moves.json` | The plain-language name and one-line description of every rule. Every page takes move names from here; the build fails if a rule is missing. |
| `data/field-guide.json` | The Field Guide (see below). |
| `data/home.json` | The home page's sample texts, tier examples, exhibits and limits table, each with what the engine must do. |
| `fonts/` | Newsreader and DM Mono (SIL OFL 1.1), vendored by `scripts/vendor-fonts.mjs` from pinned `@fontsource` packages, with their licenses and `fonts.json` (sources and sha256). |
| `img/`, `favicon.svg` | The paper and film grain, and the icon. |

Rules for editing: no inline `<script>` or `<style>` and no `style=` or `on*=` attributes (the policy blocks them); build nodes with DOM calls and `textContent`, never `innerHTML`; load nothing from another site; every number must come from the build.

## The Field Guide data

`data/field-guide.json` started as the draft written against v1's frozen core. Rules version 2.0.0a2 changed many of the windows and word lists its "What it misses" paragraphs described, so this copy differs from the draft:

- The "misses" paragraphs of 20 entries were rewritten where a claim no longer held (for example, E3 counts plurals and 16-word gaps, and no longer reads "3 March 2025" or "6 to 9" as citations). In 10 more, only the draft's "auto" domain (now "all domains") and one note about v1 changed (counted 2026-09-28).
- The fair use for `CONSENSUS_AS_EVIDENCE` was replaced: the draft's sentence is no longer marked.
- Every entry has `checks`: each sentence its "misses" paragraph quotes, with the domain, the rule (`*` for any), and whether it is marked. The build fails if a quoted sentence of three or more words has no check, or if a check no longer holds.
- Rules version 2.0.0a3 took every group's name out of the rules (`rules/RULE_CHANGES.md`, "Rules hold no group names"). The "misses" paragraph of `DISSENT_DISMISSAL` now says what the rule marks without a list of groups (dismissal words, role words applied as a label, open frames that take any word) and which judged lines it leaves alone; "crackpot" is now a dismissal word, so its example of a word the rule does not know is "daft". `CAUSAL_TOTALIZATION`'s says that "the cause of all ..." counts without a destruction verb.
- Rules version 2.0.0a4 (the first fix round): `LEGAL_SANCTIONS_THREAT` names no rule number, so its second example says "seeking sanctions against" rather than "Rule 11", its fair use reports when "sanctions are warranted", and its "misses" paragraph says a threat by rule number alone gets past it. `CAUSAL_TOTALIZATION`'s says any plural object counts ("ruining the riders", and a literal loss, "The frost ruined the tomatoes."), and `DISSENT_DISMISSAL`'s gives "Typical gardeners!" and says a neutral stance word ("They're just activists.") is not a label. The three rules rebuilt from v1 (`CREDENTIAL_AS_PREMISE`, `INSTITUTIONAL_POSITION_AS_SETTLED`, `NEUTRALITY_CLAIM`) have full entries, written for this version and checked like the others, so every rule has one.
- An example shows its own move and no other. Some examples also raised another rule in their entry's domain, and were changed: `TOTALIZING_HARM_LANGUAGE`'s hailstorm destroys the vegetable garden, not the community garden (whose "destroyed the community" is `CAUSAL_TOTALIZATION`'s move); `SOFT_CONSENSUS`'s second example says "a growing consensus suggests" (not "a growing body of evidence suggests", which `CLAIM_WITHOUT_CITATION` reads too); and `BUREAUCRATIC_OBSCURITY`'s contractor "says" rather than "has determined that" (`INSTITUTIONAL_POSITION_AS_SETTLED`).

The build also marks each example with what the engine marks today (two `MEDIA_EDITORIAL_AS_NEWS` spans are one word shorter than the draft's `flagged_span`), checks that each example raises its own rule and no other in its entry's domain, that each honest version raises no rule at all and each fair use no rule but the entry's own, and computes each fair use's verdict. The rules with no entry yet get a short entry from the rule pack.

## Deploy

`.github/workflows/pages.yml` runs on every push to `main` and by hand: it checks and builds the site, uploads `_site/` and deploys it with GitHub's OIDC token (no secrets). It needs one repository setting: **Settings > Pages > Source: GitHub Actions**.

The site is at `https://biasclear.com/`, the custom domain set in the Pages settings (a workflow deploy needs no `CNAME` file). It started at `https://biasclear.github.io/biasclear/`, and GitHub redirects that address to the new one. Every link is relative, and the link-preview tags and the 404 page's base path are built from `SITE_URL`, so a change of address needs no code change. It does need a new deploy: setting the domain does not run the workflow, so after any change of address, run the Pages workflow by hand.

The workflow deploys from `main` only (a run started by hand on another branch builds and checks, and stops there). The `github-pages` environment should also allow `main` only (`docs/REPO_SETTINGS.md`).

GitHub Pages cannot send response headers, so the policy is a `<meta>` tag, and browsers ignore `frame-ancestors` there: any site can frame the checker. No text can leak (the frame is another origin), but a frame could dress the page in a false verdict. biasclear.com is served by GitHub Pages directly, so the site does not send `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` or `X-Content-Type-Options: nosniff`. This is a known gap. Closing it needs a host in front of Pages that can set headers; that adds a service, so it is the owner's decision, and a check of the live response headers would confirm it.

GitHub Pages serves `404.html` for a missing address at any depth, so that page's links, styles and scripts are anchored at the site's base path (the path of `SITE_URL`, or `/biasclear/` without it; `basePath` in `scripts/build-site.mjs`), and it is styled at `guide/nope` as at the top. They are same-origin, so the policy's `'self'` allows them, and they follow a custom domain with no code change.
