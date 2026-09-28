# Seed notes

How the seed of `biasclear/biasclear` was built, how it lands, what it decided, and what the PM checks before opening its pull request. Written 2026-09-27; updated 2026-09-28.

## How the seed lands

- **One pull request, one commit.** The owner creates `biasclear/biasclear` with a README. The PM puts the whole seed in one commit on top of that README commit, pushes it to the PM's own branch and opens one pull request. The owner reviews and merges it. (A pull request needs shared history, and the PM can push only its own branch.)
- **What merging does.** It is CI's first run on `main`, and it deploys the site from `site/` to GitHub Pages as a clearly labeled public preview (`.github/workflows/pages.yml`). The README's "Try it" link points at that preview.
- **Identity.** The commit uses a non-personal name and a noreply address for author and committer alike (for example `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`), never a personal name or address (`AGENTS.md` allows no personal name beyond the citation). Check before pushing: every line of `git log --all --format='%an <%ae> | %cn <%ce>'` shows that name and address. If `v1-final` is an annotated tag, its tagger uses the same identity.
- **Owner steps before the merge** (private checklist): the `pypi` environment and the repository settings in `ops/BLUEPRINT.md` §6 step 2, and the Pages source (`docs/REPO_SETTINGS.md`), so the site goes live when the seed merges.

## After the merge

1. **Ruleset (owner step).** After CI has run once on `main`, require `test`, `security`, `secret-scan` and `sast`. Each is a single job with exactly that name. `test` runs pytest on Python 3.10 to 3.14 inside one job, so the check name has no matrix suffix. The release workflow's test job is named `release-test`, so it can't be mistaken for the required `test`.
2. **Tag `v1-final` before `v2.0.0a1`.** At the merge the tag does not exist yet, so the README, `SECURITY.md`, `CHANGELOG.md` and `AGENTS.md` say the v1 code "will be kept" at the tag and link nothing. Build the tag from the scrubbed v1 snapshot as an orphan commit, with no v1 history. Once it is pushed, a pull request links it from the README's "v1 claims withdrawn" and puts those four files in the present tense. Before pushing it:
   - Delete any `__pycache__`, `.pyc` or `*.db` files a local test run left in the snapshot.
   - Run the personal-data grep gate over it (see "Gates").
   - Run `gitleaks git --config .gitleaks.toml --redact --exit-code 1 .` over a clone that holds both `main` and the tag. CI checks out with `fetch-depth: 0`, which fetches every tag, and gitleaks scans every ref. The snapshot's `tests/test_infra.py` holds one fake key literal that a v1 test hashes. `.gitleaks.toml` allowlists exactly that literal, in that file, for the `generic-api-key` rule only. Without it, the tag would turn the required `secret-scan` check red on every run and block every merge.
3. **The PyPI description.** PyPI shows `docs/PYPI_README.md`, not the README, and a description can't be edited after upload. Its links are absolute and it says nothing that stops being true once the package is out (`tests/test_readme.py` checks both). Read it once more in the release pull request.
4. **Date the changelog.** In a pull request before the release tag, change `## 2.0.0a1 (unreleased)` in `CHANGELOG.md` to the release day, `## 2.0.0a1 (YYYY-MM-DD)`. The sdist ships `CHANGELOG.md` and can't be changed after upload, and `release.yml` refuses to build an entry without a date.
5. **The first release.** The first release claims the name, so the time between the seed and that release is kept short. The owner's PyPI step (private checklist) sets up the pending publisher: owner `biasclear`, repository `biasclear`, workflow `release.yml`, environment `pypi`. The `pypi` environment is locked before the first tag:
   - **Deployment branches and tags:** "Selected branches and tags" with one tag rule, `v*`. Not `main`, and not "Protected branches only": the publish job runs on a tag, so either of those makes GitHub reject it.
   - **Required reviewers:** the owner's own account, with self-review allowed, so each publish waits for the owner's click.
   - **Optional:** a tag ruleset on `v*` that restricts creations, updates and deletions, with only the organization owner role allowed to bypass it. The owner then creates each release tag from the Releases page.
   - **Why:** a tag push runs the `release.yml` from the tagged commit. Anyone who can push to the repository, including the Claude GitHub App and the Codex connector, could otherwise tag an unmerged branch carrying its own `release.yml` and mint the PyPI token. That would publish a permanent, unreviewed version. `release.yml` needs no change for this: its publish job already runs in the `pypi` environment, and the pending publisher is bound to that environment.

## Decisions made in the seed

1. **License.** Owner decision 2 (2026-09-27): Apache-2.0 for the code, in `LICENSE`, and CC BY 4.0 for the rule pack, in `rules/LICENSE`. The CC BY notice also covers the package copy of the pack in `src/biasclear/data/`. `pyproject.toml` declares `license = "Apache-2.0 AND CC-BY-4.0"` and `license-files = ["LICENSE", "rules/LICENSE"]` (PEP 639, which needs hatchling 1.27 or later). The built wheel's METADATA says `License-Expression: Apache-2.0 AND CC-BY-4.0`, and both files are under `.dist-info/licenses/`.
2. **Overlaps are removed within each rule, not across rules.** Within a rule: sort by start, then longest first, and drop any span that overlaps one already kept. Two different rules may mark the same words. Removing overlaps across rules would silently drop whole rules, which breaks "same rule IDs as v1" parity.
3. **Over-long input is an error, not a truncation.** `scan()` raises `ValueError` above 200,000 characters, and the CLI exits with status 2. Truncating would hide moves without saying so.
4. **Domains.** `None` means `"general"`, as v1's default did. `"all"` replaces v1's `"auto"`, which ran every rule and didn't auto-detect anything. An unknown domain raises; v1 silently fell back to general.
5. **Offsets are code points** in Python, so `text[start:end] == match`. The TypeScript engine returns UTF-16 offsets for the DOM and converts when it compares against the golden files.
6. **Month names are calendar words.** Rules version 2.0.0a1 left `FIN_CHERRY_PICKED_TIMEFRAME` out for its month list; 2.0.0a2 restored it, and the neutrality lint holds months and weekdays in an explicit calendar allowlist.
7. **v1's keyword markers are not carried over.** They were never among v1's rules, and the original E1 ticket asked for one pack entry per structural rule. `rules/RULE_CHANGES.md` ("Not carried over") shows which ones the rules already cover.
8. **The pack exists twice, byte for byte.** `rules/biasclear-rules.json` is the one people review. `src/biasclear/data/` holds a copy, so installed, editable and source-tree runs all work without build tricks. A test fails if they differ; `scripts/sync_rules.py` copies it.
9. **v1 quirks kept on purpose,** because parity comes first:
   - Citation suppression looks around the *first* occurrence of the matched text. Repeat a phrase with a citation next to the first copy, and the uncited second copy is suppressed too (golden `edge:11`).
   - `MONOCAUSAL_BLAME`'s "it's all X's fault" branch never matched a possessive in v1; E3 fixed that (`rules/RULE_CHANGES.md`).
10. **Unicode.** The pack's syntax is in the common subset of Python's `re` and JavaScript's `RegExp`, but `\w`, `\b`, `\d` and parts of `\s` behave differently in JavaScript on non-ASCII text. E2 chose to emulate Python in TypeScript (board decision 24), pinned by `tests/golden/unicode_parity.json`.
11. **No Homepage URL in 2.0.0a1.** The site is at a preview address until biasclear.com serves it, and a PyPI release page can't be edited, so `pyproject.toml` lists only the Repository URL. The first release after the site is at its own domain adds `Homepage`.
12. **The CLI decodes stdin itself, as strict UTF-8.** It reads bytes, so input that isn't valid UTF-8 exits with status 2 on every platform. Line endings reach `scan()` as given, so offsets match the input.

## The golden file (`tests/golden/v1_parity.json`)

- It was made by `scripts/make_golden.py`, from the rule pack `scripts/extract_v1_rules.py` writes from a v1 checkout (rules 2.0.0a1), running v1's `frozen_core.py` read-only (git blob `feaba315eda026785a41275b91e88f66f668a076`, the same in the `v1-final` snapshot). No v1 code is committed.
- **Texts:** every string literal of three or more words in v1's `tests/*.py` (skipping anything with `@`, `bc_` or a URL), every calibration corpus sample, and edge cases written for v2 (empty input, curly quotes, an emoji, a non-breaking space, CRLF line breaks, a buried qualifier past 200 characters, both citation-lookup quirks, overlapping indicators, and `min_matches`), with duplicates removed. `tests/test_parity.py` reads it.
- **Left out:** texts that name real, identifiable people or carry dated litigation details that could echo a real legal matter, listed by source and reason in the script. Generic placeholders like "Smith v. Jones" and "(Smith et al., 2024)" are kept.
- **Names:** v1's texts named real people, parties, organizations and outlets. The committed file holds them renamed: the script's `--rename` option replaces each real name with a made-up name of the same shape before v1 reads the text. The map from real to made-up names lists the real names, so it is kept outside the repository. The file can therefore be rebuilt byte for byte only with that private map, which is accepted: `tests/test_parity.py` checks the engine against the committed file without it.
- **Checks built in:** for every text, the script re-derives v1's decisions from spans and requires them to equal v1's own `evaluate()` output, for `auto` and for each domain. It also requires the first span to equal v1's reported fragment, and forbids zero-length matches.

## Found along the way (at the seed, fixed since)

The seed found three kinds of asymmetry in the v1 rules and pinned each as strict expected failures: bounded word and character windows that let a short name match where a long one didn't, label lists that marked one side's dismissive words and not their mirrors, and names whose own words triggered a rule. It also found rule names and descriptions that claimed intent. E3 fixed all four (rules versions 2.0.0a2 and 2.0.0a3; `rules/RULE_CHANGES.md`), and E6's intent-word test is `tests/test_rule_text.py`.

CI notes that still hold:

- **gitleaks.** The gitleaks GitHub Action needs a paid license key for organization accounts, so the `secret-scan` job downloads the gitleaks release binary instead, pinned by version and SHA-256.
- **Semgrep.** `sast` doesn't depend on the Semgrep registry. It fetches `semgrep/semgrep-rules` from GitHub at a pinned commit and runs the Python `security`, `correctness` and `best-practice` rules. The `compatibility` rules are left out because they flag `importlib.resources` for Python older than 3.7.
- **The release build is pinned by hash.** `release.yml` builds in its own job, apart from the tests. It installs `build`, `hatchling` and every package they need from `.github/requirements-release.txt` with `--require-hashes --no-deps`, and builds with `--no-isolation`, so nothing unpinned runs while the published files are made and they can be rebuilt from the same packages. A `sdist-test` job runs the tests from the built sdist before the upload.
- **Dependabot updates only the action SHAs.** Bump these by hand: the gitleaks version and checksum, the Semgrep version, the semgrep-rules commit, and the `build` and `pip-audit` versions in `ci.yml`. Dependabot's pip entry also covers `.github/requirements-release.txt`; regenerate its hashes with the whole closure when one package moves.

## Plan docs in the seed

`AGENTS.md`, `CLAUDE.md`, `.github/pull_request_template.md` and `.github/CODEOWNERS` are revision 3 of the plan, merged with this repository's own rules (the v2 repo map, calendar words, the site). `ops/BLUEPRINT.md` and `ops/BOARD.md` are public editions of revision 3: they keep the product plan, principles, architecture, engines, site, fairness suite, release process, gates, tracks, tickets and code decisions, and leave out account security, recovery, domain, mail and hosting operations, payments and anything about the owner as a person. Those are in the owner's private checklist (decision 25), which this repository doesn't carry or link. Owner steps appear only as "owner step (private checklist)".

`.github/CODEOWNERS` lists the protected paths and names no owner: code-owner review is off, so the file is informational, and it names no personal account. An organization team can be added later if the owner wants one.

## Gates

Run before the pull request is opened, over the exact tree it carries:

- The full check set: `python -m pytest -q`; `npm ci && npm test` in `packages/engine` (typecheck, build, unit tests, parity); `python scripts/site_facts.py`; the site build and `node --test site/test/site.test.mjs`; and, where Playwright is installed, `site/test/browser.test.mjs`.
- A personal-data grep gate over every file, text and binary alike: the citation's name only in the README citation (the BibTeX author field, which the About page shows) and as "Slimp, 2026" in the site footer (`scripts/build-site.mjs`); no personal GitHub account anywhere; no personal mail addresses (only `hello@biasclear.com` and the commit's noreply address), phone numbers, street addresses, cloud account numbers, or key and token shapes.
- `gitleaks` with `.gitleaks.toml` over the working tree and the history.
- A check for stray files (local databases, `.env` files, `node_modules`, build output, `__pycache__`), and that `.gitignore` covers them.
- The wheel and sdist built with `python -m build`, and the wheel installed into a clean virtual environment, with `python -m biasclear` run from outside the source tree.

The results are recorded in the pull request.
