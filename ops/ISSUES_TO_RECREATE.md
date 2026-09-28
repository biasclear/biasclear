# Tickets to open in biasclear/biasclear

Drafts, maintained by the PM, updated for what the seed already does. Each becomes a GitHub Issue labeled `agent:codex` plus a track label, with no Codex handle in its body. "Was #N" refers to an issue in the old repository.

A note for every ticket: the `main` ruleset requires exactly four checks (`test`, `security`, `secret-scan`, `sast`). New tests go inside those jobs. A new required check needs the owner to change the ruleset, so ask the PM first.

---

## Done by the seed (open, link the seed commit, close)

The PM opens each of these, links the seed commit and closes it, so the record lives in this repository. Don't start Codex on them.

- **E1: Rule pack and Python engine** (was #18). `rules/biasclear-rules.json` with `schema_version` and `rules_version`, `rules/schema.json`, and the zero-dependency Python engine in `src/biasclear/`. `rules_hash` is the SHA-256 of RFC 8785 canonical JSON. Parity with v1 on the golden texts from v1's tests and calibration corpus (`tests/golden/v1_parity.json`), for every rule E3 left unchanged. `rules/RULE_CHANGES.md` records every rule that was left out, replaced or changed, and why. Texts that name real people or carry dated litigation details are left out of the golden file (`scripts/make_golden.py` lists them by source and reason).
- **E2: Zero-dependency TypeScript engine** (was #19). `packages/engine/`: the same rule pack, the same API in camelCase, UTF-16 offsets, the same citation suppression, overlap policy and input cap. Unicode decision (a): the engine emulates Python's `re`, pinned by `tests/golden/unicode_parity.json`. `packages/engine/scripts/parity.mjs` compares it with the live Python engine on every golden text and every symmetry pair, in every domain, inside the `test` job. Bundle sizes and the gzip budget are in `packages/engine/README.md`, checked by `packages/engine/test/bundle.test.ts`. The ReDoS guard is `packages/engine/test/redos.test.ts`.
- **E3: Structural rules and the symmetry suite** (was #20). Rules versions 2.0.0a2 to 2.0.0a4 (`rules/RULE_CHANGES.md`): structural rules replace the proper-noun lists; windows counted in words, the same for every name; open slots take any word shape, and word lists hold both sides' words; no rule holds a group's name, and `tests/test_neutrality_lint.py` enforces it. One exception decides only where a sentence ends: the shared abbreviation list holds every major faith's titles and both parties' "Rep." and "Dem.", treated alike, and the lint allows exactly these. `tests/test_symmetry.py` holds the swapped pairs, the red team's pairs, the known limits and the retired pairs; `scripts/site_facts.py` counts them. Every rule is raised by at least one pair.
- **E6: Neutral rule names and descriptions.** Done in E3: names and descriptions describe the phrasing, not a motive, and `tests/test_rule_text.py` fails on intent words.
- **S1: Lightbox site.** `site/`, built by `scripts/build-site.mjs` and deployed by `.github/workflows/pages.yml`, labeled as a public preview: the checker, the Field Guide, Method, Privacy, About and a 404 page. It runs the engine's browser bundle byte for byte and sends nothing. `site/test/site.test.mjs` runs in the `test` job and before every deploy (`site/README.md`).

---

## E4: Benchmark harness

Labels: `agent:codex`, `track:engine`.

**Depends on:** E1 and E3 (done), so the numbers describe the rules that ship.

**Scope**

- `bench/` with **download scripts only**. Start with PTC (SemEval-2020 Task 11) from Zenodo record 3952415, reported as CC BY 4.0 with no registration (unverified). The fetch script checks the license and a checksum and stops on any mismatch. Data is **never committed, uploaded as a CI artifact or printed**: `bench/data/` is gitignored.
- SemEval-2023 Task 3 is deferred: its data agreement reportedly limits use to the shared task (unverified). It returns only with the organizers' written permission.
- A written mapping from the dataset's techniques to our rule IDs, committed and reviewed by the PM before any number is computed. Techniques with no matching rule are reported as not covered.
- Published numbers come from a sealed, hash-selected half of the data, chosen before the first scored run.
- Per-rule precision and recall, at span level and sentence level, with counts and a bootstrap confidence interval. Results go to `bench/results/*.json` and are stamped with the `rules_version` and `rules_hash` they were computed on.
- No number reaches the README or the site unless this harness produced it, and the copy names the dataset and the script. A test keeps each quoted number equal to the results file.

**Done when:** one command reproduces `bench/results/*.json` from a clean checkout plus the downloaded data, and the PR shows the numbers alongside what we miss.

---

## S1b: Site hardening before Gate A

Labels: `agent:codex`, `track:site`.

**Depends on:** S1 (done).

**Scope**

- **Hostile strings in CI** (`AGENTS.md`, "Safe rendering"). `site/test/browser.test.mjs` already pastes `<img src=x onerror=alert(1)>`, `</mark><script>alert(1)</script>` and `javascript:alert(1)` into the checker and requires literal text, with no element, script or link made from them. It needs Playwright, which isn't a dependency and doesn't run in CI. Run those tests inside the required `test` job (Playwright pinned, justified in the PR), or cover the same strings with a DOM test that needs no browser.
- **Copy check** inside the required `test` job: it scans user-facing copy (`README.md`, the site pages and data, the `pyproject.toml` description) for claim-shaped phrases from the `AGENTS.md` "Truth in copy" list (for example "truth score", "certified", "compliant", "% recall"), with a checked-in allowlist for the list itself and for negations.
- **Semgrep rule** inside the required `sast` job: a local rule that fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `createContextualFragment`, `srcdoc`, `eval` and `new Function` in site and package code.
- **Accessibility:** an automated accessibility check of every page in both themes, green; contrast of text, highlight edges and focus rings checked against the design tokens.

**Done when:** the three checks run inside the existing required jobs, the hostile-string tests pass in Chromium, and the PR lists what the accessibility check covers and what it can't.

---

## Not recreated

- **E5 (retire the v1 truth score):** done by design. v2 returns moves and per-tier counts and has no score.
