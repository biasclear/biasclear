# BiasClear v2 board

Status: revision 3, public edition. Maintained by the PM (Claude). Last updated: 2026-10-14; the status lines were read back that day from GitHub's API and the live site.

**Blueprint:** [`ops/BLUEPRINT.md`](BLUEPRINT.md) settles the roles, the release process, the AI model, hosting and the security model. Build tickets follow it.
**Owner steps:** the owner works from a private checklist. This board names owner steps by outcome only, as "owner step (private checklist)", and links none of it.

**Goal:** a free, browser-only persuasion checker whose numbers are measured and whose neutrality is tested on every release. It should feel remarkable the first time someone pastes text into it.

**Launch window:** week of November 16, 2026. Repository set up by Oct 9, engine (E1–E3) by Oct 30, site by Nov 6, go/no-go Nov 9. The engines and the site are built and arrive with the seed; the site goes up as a labeled public preview when the seed merges. The first release, 2.0.0a1, is planned for Monday, Oct 19 (owner decision 2026-10-14).
**Launch floor:** mode A checker, Field Guide, Method (benchmark numbers or an honest "not measured yet"), Privacy, About. Everything else can slip past launch.

## Now (2026-10-14)

- `main` is at `71e793c` and has been protected by the `protect-main` ruleset since 2026-10-09. The live site serves that commit.
- Merged 2026-10-11 on the owner's instruction: [#3](https://github.com/biasclear/biasclear/pull/3), [#4](https://github.com/biasclear/biasclear/pull/4), [#6](https://github.com/biasclear/biasclear/pull/6) and [#8](https://github.com/biasclear/biasclear/pull/8). The About website link is set to `https://biasclear.com/`.
- The `pypi` environment is locked to the owner's approval (2026-10-11).
- Closed as parked 2026-10-14, branches kept: Explain ([#10](https://github.com/biasclear/biasclear/pull/10)) and Model Check ([#15](https://github.com/biasclear/biasclear/pull/15)). They, and the Linux timing diagnostic ([#14](https://github.com/biasclear/biasclear/issues/14)), come back only after 2.0.0a1 and Gate A, on the owner's yes.
- The stable ReDoS guard ([#5](https://github.com/biasclear/biasclear/issues/5)) merged 2026-10-14 as [#20](https://github.com/biasclear/biasclear/pull/20), after the independent review's GO at its head commit and on the owner's go-ahead.
- Next: the first release, 2.0.0a1, on Monday, Oct 19; then a rules update (ads and sales wording, authority named by profession, mirror pairs), the S1b accessibility and browser-safety checks, and the go/no-go on Nov 9.

## Questions for the owner

The PM doesn't decide these. Answer in chat whenever it suits you.

1. **`.github/FUNDING.yml`.** It still points the repository's Sponsor button at a personal account. The README no longer links it (owner decision 2026-10-11). Keep the file, or delete it?

Decided 2026-10-14: **`severity`** stays in 2.0.0a1 as labeled. Each move keeps its hand-set `severity` label carried over from v1, which has never been measured, with the README's existing note that says so (README, "In Python").

The Codex-fallback question of 2026-09-27 is set aside: it applied to the Codex ticket loop, which is not in use since the owner's 2026-10-09 decision (`AGENTS.md`, "The loop").

## Gates

| Gate | Passes when | Who approves |
|---|---|---|
| **A: launch-ready** | Symmetry suite green in Python and TypeScript. The Method page shows benchmark numbers made by a script, or an honest "not measured yet". Every public number traces to a script. The Privacy page matches the deployed site. Accessibility checks green, plus one manual screen-reader pass. The site passes the airtight checklist, including the hostile-string tests. Zero secrets in the tree. | Owner, at the Nov 9 go/no-go (Jarvis gives the outside check) |
| **B: keep going** (Feb 1) | At least one outside signal (educator, citation, researcher or journalist), or 50 stars. BiasClear runs no analytics, so a visit count is used only if the owner first approves a cookieless, self-evident way to count. Otherwise: stars, PyPI downloads, citations and messages to hello@biasclear.com. The owner's time stayed within budget. | Owner |

## Tracks

### 0: Cleanup and claims
- [x] Withdraw v1 accuracy, neutrality and compliance claims (README "v1 claims withdrawn")
- [x] LLM-proposed rules no longer auto-activate; human `approve()` required (v1, kept at `v1-final`)
- [x] Agent charter (`AGENTS.md`), PR template, this board
- [x] License decided (Apache-2.0 for the code, CC BY 4.0 for the rule pack) and applied in the seed (`LICENSE`, `rules/LICENSE`, `pyproject.toml`)
- [ ] Withdrawal notice at the top of the `v1-final` README and CHANGELOG
- [ ] Repository description, website and topics with no "ai-governance" or "detection engine" wording (`docs/REPO_SETTINGS.md`; owner step). Website link set to `https://biasclear.com/` 2026-10-11, on the owner's instruction (read back 2026-10-14). Still open (owner step): the live description says "any text" and the topics include `bias-detection`; neither matches `docs/REPO_SETTINGS.md`.

### 0b: Set up the repository (by Oct 9; order in `ops/BLUEPRINT.md` §6)
- [x] **Owner step (private checklist):** the organization and the public repository `biasclear/biasclear` with a README; the Claude app and the Codex connector installed (2026-09-28)
- [x] **Owner step (private checklist), before the seed merges:** the `pypi` environment (owner as required reviewer, admin bypass off, tags `v*` only); Actions read-only; security scanners on; Pages source set to GitHub Actions. Done 2026-09-28 except the `pypi` environment's rules, which the owner set 2026-10-11 (read back that day, and again 2026-10-14): the owner is the only required reviewer, admins can't bypass it, and only tags matching `v*` may deploy.
- [x] **PM: seed PR** ([#1](https://github.com/biasclear/biasclear/pull/1), merged by the owner 2026-10-06; its `test` job failed once on the ReDoS timing guard, `VAGUE_INSTITUTIONAL_APPEAL[0]` at 52.5 ms against the 50 ms limit, and passed on re-run; a ticket made the guard stable: [#5](https://github.com/biasclear/biasclear/issues/5), fixed by [#20](https://github.com/biasclear/biasclear/pull/20), merged 2026-10-14). One commit on top of the repository's README commit, from an explicit file list, never a working folder (`ops/SEED_NOTES.md`). It carries E1, E2, E3, E6 and S1 (the site as a labeled public preview), hardened CI, the release workflow, CODEOWNERS and Dependabot for GitHub Actions only. Before opening it, the PM runs the personal-data and withdrawn-claim gate and a full secret scan, and records the source commit and the gate output in the PR. Owner merge.
- [x] **Owner step:** ruleset `protect-main`, right after the seed's checks pass on `main`: Active, default branch, PR required with 0 approvals, checks `test`, `security`, `secret-scan` and `sast` each tied to GitHub Actions, no force pushes, no deletions, empty bypass list. The PM reads it back through the API. **No agent merges until that read-back passes.** Done 2026-10-09: the owner pressed the prepared, independently reviewed button, and the PM's read-back through the API passed. Read back again 2026-10-14: active on the default branch, with the same four rules.
- [ ] **Set aside: the Codex ticket loop setup** (the PM's Codex environment clicks, the labels, the access test and the PR-sweep routine). Since 2026-10-09 the owner has Claude lead and Jarvis (GPT) do the independent review (`AGENTS.md`, "The loop"), so none of it is in use. It stays in `ops/BLUEPRINT.md` §2 and §6 in case the owner restarts Codex tickets. With no access test, the PM creates no tags: the owner creates each release tag and `v1-final` on the Releases page (`AGENTS.md`, "History").
- [ ] **PM: open the tickets** from `ops/ISSUES_TO_RECREATE.md`: E1, E2, E3, E6 and S1 opened and closed as done by the seed, with a link; then E4 and S1b. B2 and S2 get drafts later. No Codex handle in any body. Status 2026-10-14: none opened yet; S1b's checks are planned for Oct 20–22.
- [x] **PM: check the `github-pages` environment** allows `main` only after the Pages workflow's first run (`docs/REPO_SETTINGS.md`). Read back 2026-10-09: selected branches only, `main`.
- [ ] **PM: name watch** before each PyPI owner step and before the release tag: look up `biasclear` in PyPI's simple index. If a project appears that isn't ours, stop, report it and pick a fallback name the same day.
- [ ] **Owner step (private checklist):** the PyPI account and the pending publisher (project `biasclear`, owner `biasclear`, repository `biasclear`, workflow `release.yml`, environment `pypi`). Planned for release day, Oct 19.
- [ ] **PM: `v1-final`.** After the seed merges, build the retired v1 code as an orphan commit from a recorded commit of the old code, pass the same gate, and push it through the PM's branch. Tag it after `v2.0.0a1` (owner decision 2026-10-11): the 2.0.0a1 README and CHANGELOG say the tag is added after that version is published, and link nothing. The owner tags it on the Releases page.
- [ ] **First release, 2.0.0a1** (after the seed, the ruleset and the PyPI step), planned for Monday, Oct 19 (owner decision 2026-10-14; the guard fix, [#20](https://github.com/biasclear/biasclear/pull/20), merged the same day). The PM posts the built files and their metadata. The owner creates tag `v2.0.0a1` on the Releases page, then presses Approve and deploy. The first release claims the name.
- [x] **Owner step (private checklist):** the site at `https://biasclear.com/`. Domain verified, custom domain and DNS records set 2026-10-06. Read back from the Pages settings 2026-10-09: certificate approved for `biasclear.com` and `www.biasclear.com`, HTTPS enforced, domain verified. The PM's pull request that switches the README, the PyPI readme, the repository settings text and `pyproject.toml`'s `Homepage` to the new address ([#4](https://github.com/biasclear/biasclear/pull/4)) merged 2026-10-11 on the owner's instruction, and the About website link is set. The live site serves `71e793c` (read back 2026-10-14).
- [ ] **Owner step (private checklist):** the old repository points to this one, `v1-final` and the preprint's DOI; the preprint record links to this repository. Archiving the old repository with a pointer here is planned for the owner's Oct 15 sitting; the `v1-final` link follows the tag.
- [ ] **PM: concept DOI.** Once the Zenodo concept DOI and v1 version DOI are confirmed, a ticket points "always current" PIT links at the concept DOI and keeps the version DOI where v1 is meant.

### 1: Engine v2
- [x] **E1** Rule pack (`rules/biasclear-rules.json`) and a zero-dependency Python engine that loads it; parity with v1 on the golden file. In the seed (`ops/SEED_NOTES.md`).
- [x] **E2** Zero-dependency TypeScript engine (`packages/engine`) that reads the same rule pack, including citation suppression; golden-file parity with Python. It follows decision 24: the engine emulates Python's `re`, so browser and Python results agree on every tested text, pinned by the Unicode golden cases; they can differ only on characters newer than one runtime's Unicode version. In the seed.
- [x] **E3** Symmetry: structural rules replace named-entity lists; name windows counted in words; word lists given both sides' words (not complete yet: `rules/RULE_CHANGES.md`, "Mirror coverage"); no rule holds a group's name (rules 2.0.0a3; one exception, the sentence-splitting abbreviation list, holds every major faith's titles and both parties' "Rep." and "Dem." alike); open slots take any word shape and closed lists gained the mirrors the red team found missing (rules 2.0.0a4). Swapped pairs, red-team pairs, known limits and retired pairs are counted by `scripts/site_facts.py`, and every rule is in at least one pair. The README's withdrawn example sentences are a permanent regression test. All pairs run in Python and TypeScript inside the required `test` job. In the seed.
- [ ] **E4** Benchmark harness on PTC-SemEval20 (Zenodo record 3952415; reported as CC BY 4.0 with no registration, unverified). The fetch script checks the license and checksum and stops on any mismatch. Data is never committed, uploaded as an artifact or printed. The rule-to-technique mapping is committed before the first scored run; published numbers come from a sealed, hash-selected half. Per-rule precision and recall go to `bench/results/`. SemEval-2023 Task 3 is deferred: its data agreement reportedly limits use to the shared task (unverified).
- [x] **E5** Retire the v1 "truth score". Done by design: v2 returns moves and per-tier counts, and has no score.
- [x] **E6** Neutral rule names and descriptions: they describe structure, never intent (`tests/test_rule_text.py`). Done in E3, in the seed.

### 2: Our own labeled set (after launch; PM designs, no paid labelers)
- [ ] **L1** Written labeling guide (what counts as each move, what doesn't), from the PIT preprint's definitions. It never quotes rule-pack trigger phrases, and a red-team pass checks it for leakage before it is hashed. Pre-registered and hashed before any labeling.
- [ ] **L2** Separation of duties: the rules are frozen and hashed *before* labeling. Labels come from a blind labeler job (the Anthropic API from GitHub Actions) that never sees the rules. Refused items are counted, not dropped. An agreement threshold is set before any number is published. Only texts we may republish (otherwise URL, offsets and hash). The owner spot-checks a sample. Guide, labels and hash are all published, marked as secondary evidence. Numbers are tagged "LLM-labeled, owner-audited, secondary, single model family" unless the owner later approves a labeler from a second model family.

### 3: Brand and site
- [x] **B1** Brand direction: Lightbox (PM, delegated by owner)
- [ ] **B2** Design tokens and wordmark (SVG), tier colors, type (self-hosted, done in S1); a contrast script inside `test`
- [x] **S1** Static site (the checker, Field Guide, Method, Privacy, About, 404) on GitHub Pages, deployed by `.github/workflows/pages.yml`, labeled as a public preview. Pasted text reaches the page only as text; strict meta-tag policies on every page; no analytics, cookies or storage; every claim checked at build time (`site/README.md`). In the seed.
- [ ] **S1b** Site hardening before Gate A (draft in `ops/ISSUES_TO_RECREATE.md`):
  - Hostile-string tests (`AGENTS.md`, "Safe rendering") in a required check: `site/test/browser.test.mjs` already pastes `<img src=x onerror=alert(1)>`, `</mark><script>alert(1)</script>` and `javascript:alert(1)` and requires literal text with no element created, but that suite needs Playwright and doesn't run in CI yet.
  - A copy check inside the required `test` job that scans user-facing copy (README.md, site pages, the pyproject description) for claim-shaped phrases from the `AGENTS.md` "Truth in copy" list, with a checked-in allowlist for the list itself and negations.
  - A local Semgrep rule inside the required `sast` job that fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `createContextualFragment`, `srcdoc`, `eval` and `new Function` in site and package code.
  - An automated accessibility check green; one manual screen-reader pass before Gate A (VoiceOver on a phone: paste the sample, confirm the count is announced and the list is readable), logged in the time log.
- [ ] **S2** Share cards rendered locally (no server), with alt text; poster of the Field Guide as HTML or tagged PDF

### 4: Distribution (after Gate A)
- [ ] **D1** npm first publish, and the first stable PyPI release (2.0.0a1 in Phase 0 is the first release)
- [ ] **D2** MCP server so AI agents can lint their own drafts
- [ ] **D3** Browser extension (after Feb 1, if users show up)

### 5: Lab
- [ ] **F1** Fidelity Trace: compare a source against a retelling and show what was dropped, hardened, unsourced, or had its numbers changed

## Outside signals (for Gate B)

The PM logs each one. The owner has nothing to do here.

| Date | Type (educator, citation, researcher, journalist, stars) | Link | Logged by |
|---|---|---|---|

## Decisions log

Numbered decisions keep their numbers from the full log. The ones about accounts, recovery, and domain, mail and hosting operations are in the owner's private checklist and are not listed here.

| Date | Decision | By |
|---|---|---|
| 2026-09-26 | Relaunch: honest, browser-only, launch week of Nov 16, build starts now | Owner |
| 2026-09-26 | Agents may push branches and open PRs | Owner |
| 2026-09-26 | Labeling is done in-house (no paid labelers) | Owner |
| 2026-09-26 | Owner is not featured on the site; small citation plus a contact address only | Owner |
| 2026-09-26 | Brand design delegated to PM. Direction: **Lightbox** (paper-and-ink page; a loupe reveals persuasion structure as a film negative, colored by PIT tier). Strings dropped: it reads as intent, not structure | Owner → PM |
| 2026-09-26 | New GitHub organization `biasclear`; retire old repos once nothing depends on them | Owner |
| 2026-09-27 | Blueprint revision 2 approved | Owner |
| 2026-09-27 | License: Apache-2.0 for code, CC BY 4.0 for the rule pack; v1 code, including `v1-final`, stays AGPL-3.0 | Owner |
| 2026-09-27 | First PyPI release is a clean v2 alpha, 2.0.0a1 (rules only, zero dependencies), not a v1 re-release; retired v1 code kept as a scrubbed `v1-final` snapshot for the preprint | PM |
| 2026-09-27 | 1. The owner creates the new repo with a README; the PM's seed arrives as a PR on top of it, and the owner merges it | PM |
| 2026-09-27 | 2. Codex starts from one PM comment on the ticket issue (no stub draft PR), with checks at 2 and 60 minutes and a fixed fallback ladder; the 24-hour fallback choice is the owner's | PM |
| 2026-09-27 | 3. The Codex handle appears only in the PM's trigger comments: the one start comment per ticket, plus one new follow-up comment on the PR per round of blocking findings (decision 4). Never anywhere else, and no old comment is edited to add it | PM |
| 2026-09-27 | 4. Follow-ups on a Codex PR: one PR comment first; if the head commit doesn't change, re-trigger on the issue for a replacement PR | PM |
| 2026-09-27 | 5. One GitHub identity, one enforced gate (the `pypi` Approve). No Claude session gets settings or deployment permissions; never connect GitHub through `/web-setup` or a token | PM |
| 2026-09-27 | 6. Red-team verdicts are Comment reviews plus a `redteam:clear` / `redteam:blocking` label; the PM merges an unprotected-path PR only with `redteam:clear` and green checks | PM |
| 2026-09-27 | 7. The PM relies on CI job logs for secret findings | PM |
| 2026-09-27 | 8. Releases stay tag-triggered (`v[0-9]*`) behind the `pypi` environment's owner Approve; the owner creates release tags on the Releases page until the access test shows the PM can | PM |
| 2026-09-27 | 9. First version 2.0.0a1, never 0.x or 1.x; never delete a PyPI project, release or file (yank instead) | PM |
| 2026-09-27 | 10. `v1-final` is an orphan commit pushed after the seed merges; tagged by the PM if it can, otherwise by the owner | PM |
| 2026-09-27 | 14. Hosting is GitHub Pages; soft limits 100 GB a month and a 1 GB site | PM |
| 2026-09-27 | 16. Pages can't send response headers; Mode B hosting is decided before its spec is final | PM |
| 2026-09-27 | 17. The Privacy page says GitHub logs visitor IPs; no analytics before Gate B unless the owner approves a cookieless count | PM |
| 2026-09-27 | 20. The owner's personal GitHub account is never renamed or deleted | PM |
| 2026-09-27 | 21. Owner sittings are 30 minutes or less, web clicks only | PM |
| 2026-09-27 | 24. E2 Unicode: option (a), the TypeScript engine emulates Python's `re`, so browser and Python results agree on every tested text (they can differ only on characters newer than one runtime's Unicode version) | PM |
| 2026-09-27 | 25. The owner's step list and any unsent notices stay private; public docs link neither | PM |
| 2026-09-27 | 26. Public docs never call the PyPI name unclaimed; they say the first release claims it | PM |
| 2026-09-28 | 30. No real person's name anywhere in the repository or site except the paper citation; test texts use made-up names of the same shape | PM |
| 2026-09-28 | 31. No rule names, or holds a word built from, a person, party, movement, ideology, faith, country, program, outlet, institution or school, in any form; mirroring does not make such a list neutral. The neutrality lint enforces it | PM |
| 2026-09-28 | 32. Public claims are counted, not asserted: every number in the README, the site, the CHANGELOG, `rules/RULE_CHANGES.md` and package READMEs comes from `scripts/site_facts.py`, a build script or a test, and tests keep it true; history keeps an old number only as a dated measurement | PM |
| 2026-09-28 | 33. The neutrality lint's reference list may hold ideology, faith, party and eponym word forms, because it exists to keep them out; it is marked as a denylist and kept in plain text | PM |
| 2026-09-28 | 34. Symmetry pairs swap sides, not word types; pairs that change the kind of word are retired with a one-line reason, and known limits are only true mirrors | PM |
| 2026-09-28 | 35. The shared abbreviation list is sentence-splitting data; both parties' abbreviations stay, and no country's | PM |
| 2026-09-28 | 36. Faith-specific common nouns count as faith words when they are rule content; rules use faith-neutral terms | PM |
| 2026-09-28 | 37. The "Ignore the ___" trade-off (the object must end the clause) is accepted as documented | PM |
| 2026-09-28 | 38. Generic government bodies and seats of government may stay in test text; named faith bodies, parties, outlets, think tanks, companies and awards get made-up names of the same shape | PM |
| 2026-10-06 | The site moves to `https://biasclear.com/` now, ahead of the old server's cleanup | Owner |
| 2026-10-06 | The ReDoS timing guard is made stable on shared runners without loosening what it protects (ticket) | Owner |
| 2026-10-09 | Claude leads BiasClear and Jarvis (GPT) does the independent review; the owner decides every major step and presses every owner button | Owner |
| 2026-10-11 | Merge #3, #4, #6 and #8 and set the About website link; the PM carried them out on this instruction (#4 touches protected paths, so this was the owner's own merge decision) | Owner |
| 2026-10-11 | Park Explain, Model Check and the Linux timing diagnostic until after 2.0.0a1; tag `v1-final` after the first release; leave the personal Sponsors link off the release | Owner |
| 2026-10-14 | Adopt the two-week launch plan from the whole-project review; release 2.0.0a1 on Monday, Oct 19, even if the guard fix hasn't merged; close #10 and #15 as parked, branches kept; invite 3–5 readers to try the checker | Owner |
| 2026-10-14 | Merge the stable ReDoS guard, #20, after the independent review's GO; the PM carried it out on this instruction | Owner |
| 2026-10-14 | Keep the unmeasured `severity` field in 2.0.0a1, labeled as it is in the README | Owner |
| 2026-10-14 | Every merge needs the owner's go-ahead for that specific PR, with Jarvis checking Claude's work (`AGENTS.md`, "Merging" and "The loop") | Owner |

## Owner time log

Budget: at most 2 hours a week, at most 30 minutes per sitting, web clicks and decisions only.

| Date | Task | Estimate | Actual |
|---|---|---|---|
| 2026-10-06 | Merge the seed, PR #1 (one re-run of `test`) | 5 min | not recorded |
| 2026-10-06 | biasclear.com to GitHub Pages: verified domain, custom domain, DNS records | 30 min | not recorded |
| 2026-10-09 | Ruleset `protect-main`: one press of the prepared button, then the PM's read-back | — | not recorded |
| 2026-10-11 | Merge and About-link decisions, in chat (the PM carried them out) | — | not recorded |
| 2026-10-11 | Lock the `pypi` environment: one press, then the PM's read-back | 5 min | not recorded |
| 2026-10-14 | Decisions on the whole-project review and the merge of #20, in chat | — | not recorded |
