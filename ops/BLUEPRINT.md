# BiasClear v2 blueprint

Owner: the project owner. Author: the PM (Claude). Status: **approved**. The owner approved revision 2 on 2026-09-27. This is the public edition of **revision 3, 2026-09-27**, and it takes effect when the owner merges it.

It holds the product plan, the principles, the roles, the engines and the site, the fairness suite, the release process and the gates. Account security, account recovery, domain, mail and hosting operations, and payments are the owner's. They live in the owner's private checklist, and this page names them only as "owner step (private checklist)".

Nothing is decided unless it's written here. Changing a decision means changing this page first.

## What changed in revision 3

- **The owner creates the repository with a README.** The PM's code arrives as one "seed" pull request on top of that README commit, and the owner merges it. The Claude app can't create repositories, and it can push only its own branch.
- **The release switch is set before the seed merges.** Every PyPI release waits for the owner's Approve. That Approve is the one owner gate GitHub itself enforces. Until the access test shows the PM can create tags, the owner also creates each release tag.
- **Codex starts from one comment on the ticket.** Its handle appears only in the PM's trigger comments, because any mention from the owner's account starts a paid task. If the trigger fails, a short fallback ladder applies (§2).
- **The security table has new rows:** faked checks, auto-created environments, handle-triggered paid tasks and injected script. Controls that aren't built yet say so.
- **The first PyPI release (2.0.0a1) has written contents** (§6), and the access test covers every step nobody has proven yet.
- **The owner's step list is private** (decision 25). Public docs name owner steps by outcome only.

---

## 1. Principles

1. **Measure before cutting.** No build ticket starts until this page and the ticket agree.
2. **Store nothing worth stealing.** The product runs in the visitor's browser: no server, no database, no user data, no secrets. This is a design goal with named exceptions: GitHub, as the site's host, logs visitor IP addresses (the Privacy page says so), and the AI modes in §4.
3. **No stored credentials where a keyless option exists.** Publishing and CI use short-lived GitHub identity tokens (OIDC), scoped to one repository, one workflow and one environment. For PyPI, that environment accepts only release tags and waits for the owner's Approve click (§6).
4. **Every public number is produced by a script in the repo.** If the script isn't there, the number isn't published.
5. **The owner holds the keys; agents hold the tools.** Accounts, two-factor, payments, deletions and release approvals are the owner's. Owner steps are web clicks and decisions, in short sittings.
6. **Accessible to everyone.** WCAG 2.2 AA is a launch requirement, not polish.

---

## 2. Who does what

| Role | Who | Does | Never does |
|---|---|---|---|
| Owner | The project owner | Vision, gate approvals, account security, payments, deletions, merges on protected paths, release tags and approvals | Terminal work, code review |
| PM | Claude | Plan, tickets, design, code review, merges on unprotected paths, starts Codex tasks | Create accounts or repositories, spend money, change settings or rulesets, approve deployments, merge protected paths |
| Builder | Codex | Implements tickets as PRs | Merge, touch accounts or settings, edit `AGENTS.md` or rulesets |
| Red team | A separate Claude session the PM starts on every ready PR; Jarvis (GPT) at gates, relayed by the owner | Attack changes and public claims | Write product code, merge |

**One GitHub identity, one enforced gate.** Claude, Codex and the owner all act through the owner's GitHub account, so GitHub can't tell them apart. That means:
- **Code-owner review can't be enforced by GitHub.** GitHub won't let an account approve its own PR, so the ruleset on `main` requires status checks, not approvals.
- **Owner-only merges are a process rule, not a GitHub control.** The PM never merges a PR that touches a protected path (the list in `AGENTS.md`, "Merging"). For those, the PM posts a plain-language summary, and the owner clicks Merge. A PR can change the workflow that runs its own checks, so the owner's read of any `.github/` change is what protects CI. The PM batches protected merges into one list about once a week; anything that gates a date or a security step goes to the owner the same day.
- **The one gate GitHub enforces is the release approval.** The Claude GitHub App has no Administration, Deployments, Environments, Secrets or Pages permission, so no Claude session can change a setting or approve a protected deployment, even though it acts as the owner.
  - Never connect GitHub through `/web-setup`, and never put a GH_TOKEN in the cloud environment. Either would replace the app's token with a broader one.
  - The owner declines any future app permission request for those five.
  - Whether the Codex connector holds Deployments is unverified. The owner checks its permission list at install.
- **Signatures label, they don't authenticate.** Every agent post ends with a role line (`— Codex (builder)`, `— Red team`, `— Claude (PM)`). A post from the owner's account proves nothing about who wrote it. Owner approvals count only when the owner gives them to the PM in the owner's own chat, or as the owner's own Merge or Approve click. A GitHub comment saying "approved" is never an owner approval.
- **The PM can't read GitHub's alert lists** (secret scanning, code scanning, Dependabot). It relies on CI job logs, and the owner forwards any alert email.
- **Later, optional:** a separate machine account for agents would let GitHub enforce owner review. It waits until the workflow proves itself.

**How Codex gets work.**
- **Start:** the PM starts each ticket with one comment on the ticket issue itself: the Codex handle, then "implement this issue per AGENTS.md. Open one pull request against main, fill every section of .github/pull_request_template.md, and put `Closes #N` in the body. — Claude (PM)". There is no stub PR. Codex picks its own branch.
- **Checks:** a bot reply or an eyes reaction within about 2 minutes, and a PR that references the issue within about 60 minutes. The PM checks open issues and PRs on a schedule, several times a day, rather than waiting for notifications.
- **Fallback ladder, in order:**
  1. Repost once.
  2. If the reply says "create an environment", check the owner's Codex environment step. It may also be a known Codex bug.
  3. If the task finished but no PR appeared, the owner opens the "View task" link and clicks Create PR.
  4. Otherwise the owner starts the task in Codex with one fixed line the PM supplies.
- **Still broken after 24 hours:** the owner chooses among a Claude Code builder session the PM starts (this loses the second model family), the Codex agent in a paid Copilot plan, or Codex run from a workflow with an API key. That question sits on the board's owner list.
- **Follow-ups on a Codex PR:** one comment on the PR asking Codex to address the blocking findings, then confirm that the PR's head commit changed. If it didn't, or Codex says it couldn't push, the PM re-triggers on the issue for a replacement PR and closes the old one.
- **Why the access test decides:** starting Codex from an issue comment has worked before, but it isn't documented now, so it could change without notice.
- **Prerequisites:** owner steps (private checklist): the Codex connector on the organization, a Codex environment for `biasclear/biasclear` with no secrets and agent internet off, and Codex code review set to explicit mentions only.

**Handle rule (all agents).** The Codex handle appears only in the PM's trigger comments: the one start comment per ticket, and one follow-up comment on the PR per round of blocking findings (each a new comment). Nowhere else: not in issue and PR bodies, reviews, summaries, relayed red-team posts, docs, or docs quoted in comments. (This page writes "the Codex handle" for that reason.) Any appearance in a comment from the owner's account starts a paid task, even inside backticks. Write "Codex" without the @, and never edit an old comment to add the handle.

**How the red team works.**
- The standing red team is a separate Claude session the PM starts on every ready PR. It gets the ticket, the raw diff and `AGENTS.md`, not the PM's summary. It shares the PM's model family and operator, so it isn't independent of the PM; it is a different vendor from Codex, the builder.
- It posts one `RED TEAM:` review as a **Comment** review, because the author and reviewer are the same account. Each finding is marked **blocking** or **note**. The verdict is one of two labels: `redteam:clear` or `redteam:blocking`.
- Codex answers each blocking finding with `fixed in <sha>` or `dispute: <reason>`. The red team re-reviews once, limited to the open findings and the fix commits. The PM decides anything still open in a signed comment with a one-line reason. An override that touches rules, symmetry pairs, benchmark output or public copy waits for the owner.
- The PM merges an unprotected-path PR only with `redteam:clear` and green checks. For a protected path, the PM's summary shows the verdict, and the owner doesn't merge on `redteam:blocking`.
- Dependabot PRs get no red-team pass. The PM checks CI and the release notes; bumps that touch `.github/` go on the owner's merge list.
- Every asymmetric pair any reviewer finds becomes a permanent test case, a known limit with a written reason, or a retired pair with a written reason (a pair that changes the kind of word rather than the side). Disputes are listed for the owner at Gate A.
- **Jarvis (GPT)** is the outside check at gates, starting with the go/no-go. The PM prepares one link and one prompt. The owner pastes them into ChatGPT and passes the answer back. The PM posts it in a quote block labeled "Jarvis (GPT) review, relayed by the owner", unedited except that any Codex handle loses its @. The PM never signs as Jarvis.

---

## 3. Where things live

| Asset | Where | Notes |
|---|---|---|
| Code, rules, site source, plan | `biasclear/biasclear` on GitHub | Seeded by one PR on top of the repository's README commit, which the owner merges (§6). |
| Website | GitHub Pages on `biasclear/biasclear`, built by `.github/workflows/pages.yml` | A public preview at `https://biasclear.github.io/biasclear/`; later at `https://biasclear.com/` (owner step, private checklist). GitHub logs visitor IP addresses, and the Privacy page says so. Pages can't send response headers, so the site's policies are meta tags. |
| Python package | PyPI project `biasclear` | Published only by `release.yml` through Trusted Publishing and the owner-approved `pypi` environment. The first release claims the name. First version 2.0.0a1, never 0.x or 1.x. Never delete the project, a release or a file; yank instead. The PyPI account and its pending publisher are owner steps (private checklist). |
| npm `@biasclear/engine` | Later (after launch) | npm Trusted Publishing can't make a first publish, so the first npm release gets its own plan. |
| Retired v1 code | The tag `v1-final` | The PIT preprint refers to it. Kept under AGPL-3.0. |
| PIT preprint | Zenodo, DOI 10.5281/zenodo.18676405 | Whether this DOI is the version DOI or the concept DOI is unverified; checked before any page relies on one. |

---

## 4. The AI layer (after launch)

**Launch ships rules only.** The checker, the Field Guide and the benchmark are all deterministic. The product needs no AI API account, key or bill. The AI layer is post-launch work, planned now so the choices are settled.

**Model: Claude Opus 5.5 (`claude-opus-5-5`)**, the owner's pick. The PM checks Anthropic's current pricing and model pages, and cites them with a date, before anything relies on them. The cost per check is unmeasured. A script measures it before any page quotes a number.

**Refusals.** A declined request comes back as an ordinary response (HTTP 200) with `stop_reason: "refusal"`. Every caller follows these rules:
- Branch on `stop_reason`.
- A `refusal` or `max_tokens` stop is a failed item. The UI shows it as declined and discards any partly streamed text. Scripts (the labeler, red-team sweeps, the cost script) record it as refused and count it. They never drop it or treat it as a clean result.
- Prompts ask for analysis of the pasted text, never for the model's own reasoning, which can be declined.
- Server-side fallbacks would run a different model than the owner's pick. Whether to use them is an owner decision, recorded in the mode B and C specs.

| Mode | What | When |
|---|---|---|
| **A. Rules only** | Deterministic checker in the browser | Launch |
| **B. Bring your own key** | The visitor's own Anthropic key calls Anthropic straight from their browser | After launch, with its own security spec (below) |
| **C. Hosted second opinion** | A small server calls the AI for visitors without a key | Only if people ask, and only after rewriting the privacy rule to allow it as a labeled opt-in |

**Mode B security spec** (required before it ships):
- **Host first.** GitHub Pages can't send response headers, and browsers ignore `frame-ancestors` in a meta tag. So the host for the key origin (for example `ai.biasclear.com`) is decided before this spec is final: either a host that can set headers, or a popup design (not an iframe) with framing recorded as an accepted gap. Either way, the PM checks the live response headers before mode B ships.
- The key box and the AI call live on that separate origin, with no analytics or third-party scripts. The main page talks to it by `postMessage`, with exact origin checks both ways.
- Strict Content-Security-Policy on that origin: connections only to `api.anthropic.com`, no inline scripts, and framing only by the main site where the host allows it.
- The key is kept in memory by default, with no localStorage, cookies or URL. There's a visible Forget key button. Visitors are told to use a dedicated, spend-limited key.
- Model output is rendered as text, never as HTML.
- The `anthropic-dangerous-direct-browser-access` header is recorded as an accepted risk: bring-your-own-key only, never a project key.
- The Privacy page says the text goes to Anthropic under the visitor's own key and account, and that Anthropic's retention policy applies.

**Mode C honesty.** Mode C sends the visitor's text to a server we run and to Anthropic. That breaks today's "your text never leaves the tab" rule, so the rule and the page copy must change first, and the switch must say plainly where the text goes. Anthropic's API retention policy applies, and anything the service keeps (such as a per-visitor counter) is named on the Privacy page.

**Mode C abuse and cost spec** (required before any mode C ticket opens; it ships in the same owner-merged PR that rewrites the privacy rule):
- A per-request ceiling: an input length cap, a fixed `max_tokens` and an explicit effort, with the worst-case cost per call taken from the cost script.
- A daily budget inside the service that fails closed to mode A with a plain message.
- Per-visitor limits, described honestly as weak against rotating addresses.
- Bot friction only if needed, and self-hosted (no third-party scripts).
- Its own spend-limited workspace with rate limits and spend alerts. When the limit is hit, the feature pauses for everyone.

**Internal AI jobs** (a blind labeler for the in-house test set, red-team sweeps):
- They use the Anthropic API from GitHub Actions through Workload Identity Federation (keyless), in a spend-limited workspace with the narrowest scope.
- **Trust rule.** A job that uses an environment gets the subject `repo:<owner>/<repo>:environment:<name>`, not the branch form. So the rule matches the subject for one environment (`ai-jobs`) exactly, with no trailing `*`. Its claims pin `ref` to `refs/heads/main`, the repository owner, and `workflow_ref` to the one workflow file. The token lifetime is short. The PM reads the exact values from one dry-run token (decoded claims only) before the owner creates the rule, and never loosens the subject to get past an error.
- The `ai-jobs` environment allows deploys from `main` only.
- The workflow runs on manual dispatch or a schedule and grants `id-token: write` to that one job. It never sets `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, not even empty, because either would outrank federation.
- Code merged to `main` runs with this credential, so the scope and the spend limit are what cap the damage. The rule is created only after the `main` ruleset is on.

---

## 5. Security model

"Planned" marks a control that isn't built yet, with where it lands.

| Threat | Control |
|---|---|
| A squatter takes `pip install biasclear` (the preprint points there) | Before each PyPI owner step and before the release tag, the PM looks up `biasclear` in PyPI's simple index and stops if a project appears that isn't ours. The pending publisher names this repository, `release.yml` and environment `pypi`. The first release claims the name with a working package, not a placeholder. Never delete the project, a release or a file. If the name is squatted: report it and pick a fallback name the same day. |
| A secret committed | The secret scanner pinned by version and checksum, with a bounded custom rule for BiasClear-style keys (`.gitleaks.toml`); read-only workflow permissions; checkout without persisted credentials. The PM runs the same scan on the seed before opening the PR. The PM reads CI job logs, and the owner forwards alert emails. `AGENTS.md` hard rule. |
| An agent loosening its own rules | **Process only, not enforced by GitHub** while agents share the owner's account: the PM never merges protected paths or edits rulesets, and no agent opens Settings. **Enforced by GitHub:** the Claude app has no Administration permission, so it can't edit rulesets or settings; required checks; an empty bypass list. Detection: the owner looks over the ruleset and recent protected-path merges at each gate. |
| **A required check faked** (anyone with write access can post a passing status named `test` through the API) | Each required check is pinned to GitHub Actions as its source. A PR that edits its own workflow is caught only by the owner's read of `.github/` changes (process). |
| **An unprotected environment created automatically** (GitHub creates a missing environment, with no protection, the first time a workflow names it) | The owner creates `pypi` (owner as required reviewer, admin bypass off, `v*` tags only) before the seed that names it merges. The Pages environment is checked for `main`-only deploys after its first run (`docs/REPO_SETTINGS.md`). |
| Keyless release tokens misused | PyPI trusts only this repository, `release.yml` and environment `pypi`. That environment takes tags only and waits for the owner's Approve. No Claude session can approve, because the app has no Deployments permission. |
| **A paid Codex task started by accident** | The Codex handle appears only in the PM's trigger comments (§2). Codex code review is set to explicit mentions only. |
| **Script injected through pasted text or a link** | Pasted text reaches the page only as text, never as HTML; a strict meta-tag Content-Security-Policy with Trusted Types on every page; no inline scripts; share links carry no user text. `site/test/site.test.mjs` checks the policies and that the page scripts use no `innerHTML`, storage or network; `site/test/browser.test.mjs` pastes hostile strings and requires literal text. **Planned:** those browser tests inside a required check, and a local Semgrep rule in the required `sast` job for the site's sinks (S1b). |
| Personal data republished | The seed is built from an explicit file list, never a working folder, and passes a gate for personal identifiers and withdrawn-claim phrases before the PR (§6). The same goes for `v1-final`. `tests/test_readme.py` checks that the README and CHANGELOG name no one beyond the citation. |
| Rules that tilt politically | Structural rules only, and no rule holds a group's name (the neutrality lint), except the sentence-splitting abbreviation list, which holds every major faith's titles and both parties' "Rep." and "Dem." alike and which the lint allows exactly. Thousands of swapped pairs run inside the required `test` check (`scripts/site_facts.py` reports the counts). Red-team pairs are added as tests, known limits or retired pairs, each with a written reason. |
| Inaccessible design | WCAG 2.2 AA: every result is also in a keyboard-reachable list, and tier is never shown by color alone. **Planned:** a contrast script against the design tokens inside `test` (B2); an automated accessibility check and one manual screen-reader pass before Gate A. |

New CI jobs become required when the owner adds them to the ruleset after their first green run on `main`. The TypeScript engine tests and the site tests run inside `test`.

---

## 6. Setting up the repository (safe order)

1. **Owner step (private checklist):** create the organization and the public repository `biasclear/biasclear` with "Add a README file" ticked, install the Claude app and the Codex connector (reading each permission list first, §2). The PM then attaches the repository to its session.
2. **Owner step (private checklist), before the seed merges.** The seed carries a workflow that names `pypi`, and GitHub would create a missing environment with no protection. So first: the `pypi` environment (the owner as required reviewer, admin bypass off, deployments from tags `v*` only); Actions read-only, with Actions unable to approve PRs; secret scanning, push protection, private vulnerability reporting and Dependabot alerts on; the Pages source set to GitHub Actions (`docs/REPO_SETTINGS.md`).
3. **PM: the seed PR.** One commit on top of the README commit, on the PM's branch, opened as one pull request (`ops/SEED_NOTES.md`).
   - **Contents: an explicit file list, never a working folder.** The v2 package, engines, rules, site and tests; the README and CHANGELOG with the v1 withdrawal notice; `AGENTS.md`; `CLAUDE.md`; `ops/` without the owner's private checklist; `.github/`; the license files. No v1 server or site, binaries (other than the site's fonts and images) or databases.
   - **Scrub:** personal data and withdrawn claims. `pyproject` authors: "BiasClear contributors" <hello@biasclear.com>.
   - **Gate:** a case-insensitive search of every file for personal identifiers and withdrawn-claim phrases, plus the pinned secret scanner. The PM also reads every file under `ops/` for the owner's operational details. The PR summary records the source commit and the gate's result.
4. **Owner: merge the seed.** The PM's plain summary lists every protected file it adds, `.github/` included. This merge is CI's first run on `main`, and it publishes the site as a preview.
5. **Owner step: ruleset `protect-main`,** right after the seed's checks pass on `main`, and before any agent merge or release. Enforcement Active; target the default branch; PR required with 0 approvals and code-owner review off; checks `test`, `security`, `secret-scan` and `sast`, each pinned to GitHub Actions; block force pushes; restrict deletions; empty bypass list. The PM reads the ruleset back through the API to confirm each field. No agent merges until that check passes.
6. **PM:** create the labels (`agent:codex`, `track:engine`, `track:site`, `question-for-pm`, `redteam:clear`, `redteam:blocking`, `dependencies`, `ci`). Open the tickets from `ops/ISSUES_TO_RECREATE.md`, with no Codex handle in their bodies.
7. **Access test,** before anything old is retired. It covers every step not yet proven:
   - The PM pushes its branch (including a `.github/workflows` change) and opens a PR.
   - The PM creates a label and an issue through the API, posts a comment and a Comment review, reads a job log, and dispatches and reruns a workflow.
   - The PM tries to create a tag through the API (one tag named `access-test`, which matches no release pattern, left in place). If it can't, the owner keeps creating release tags on the Releases page.
   - One small test issue goes from the Codex start comment to a merged Codex PR, recording whether Codex opened the PR itself.
   - The red team posts its review and label, and the PM merges that unprotected-path PR with `redteam:clear`.
   - The first release (step 9) shows the run waiting for the owner's Approve, with no way for an agent to approve it.
8. **`v1-final`:** after the seed merges, the PM builds the retired v1 code as an orphan commit from a recorded commit of the old code. It passes the same gate and carries the withdrawal notice at the top of its README and CHANGELOG. The tag is created by the PM if the access test shows it can, and otherwise by the owner on the Releases page. That tree has no release workflow, so its tag can't start a release. v1 code, including this tag, stays under AGPL-3.0.
9. **First release (2.0.0a1),** after the seed, the `protect-main` ruleset, the owner's PyPI step and the `v1-final` tag: the PM posts the built files and their metadata. Unless the access test showed the PM can create tags, the owner creates the tag on the Releases page, then presses Approve and deploy. The name is claimed when that run exchanges its token. That's two owner clicks per release, both deliberate.
10. **Owner step (private checklist): retire the old repository** so that it points to this one, `v1-final` and the preprint's DOI, and link the preprint record to this repository.

**First release contents (2.0.0a1).** The first release claims the name and stays public for good, so its contents are fixed here:
- A minimal package: zero dependencies; no file writes, network calls or side effects on import; no truth score, audit, learning, LLM, API or certificate code.
- Rules: the structural rule pack with no proper-noun lists, and the swapped-pair tests.
- Not a v1 1.2.x re-release, because v1 carries the withdrawn truth score and AI-SDK dependencies. v1 lives at `v1-final`.
- Metadata: authors "BiasClear contributors" <hello@biasclear.com>; repository links to `biasclear/biasclear`; a short description that says it's a pre-release rule set with no accuracy claims; license `Apache-2.0 AND CC-BY-4.0`, with both license files.
- Checks run on the built files, not just the tree: `twine check`, the personal-identifier gate, and a search for withdrawn lists, `truth_score` and AGPL. Before the owner approves, the PM posts the wheel's file list and metadata.

---

## 7. Build order and dates

| Phase | Work | Target |
|---|---|---|
| 0 | Repository set up and seeded; the ruleset on; PyPI name claimed with 2.0.0a1 | **Oct 9** |
| 1 | E1 rule pack, E2 browser engine (it emulates Python's `re`, so both engines agree on every tested text; they can differ only on characters newer than one runtime's Unicode version), E3 symmetry, E6 neutral names | **Oct 30** (built; in the seed) |
| 2 | Lightbox site, published as a labeled public preview when the seed merges | **Nov 6** (built; in the seed) |
| Go/no-go | Owner reviews the preview; Jarvis's first review, relayed by the owner | **Nov 9** |
| **Gate A** | Launch: the preview label comes off | **Week of Nov 16** |
| After launch | Mode B, share cards, poster, in-house labeled set, PIT v2 preprint, npm, MCP server | No date yet |
| **Gate B** | Keep going or shelve | **Feb 1, 2027** |

No agent merge lands until the `protect-main` ruleset passes the PM's read-back.

**Launch floor** (ships even if everything else slips):
- the mode A checker
- the Field Guide
- a Method page, with published benchmark numbers or an honest "not measured yet"
- Privacy (it says GitHub, as host, logs visitor IP addresses, and that BiasClear runs no analytics)
- About

Gate A accepts an honest "not measured yet" on the Method page, the same as the launch floor.

**Slip rule:** if the go/no-go fails, set one new launch date and move Gate B to about 10 weeks after launch.

**Gate B signals.** BiasClear runs no analytics before Gate B. If Gate B needs a visit count, it uses a cookieless, self-evident method the owner approves first. Otherwise it uses signals that need no tracking script, such as stars, PyPI downloads, citations and messages to hello@biasclear.com.

**Benchmarks.** E4 starts with PTC (SemEval-2020 Task 11) from Zenodo record 3952415, reported as an open download under CC BY 4.0 (unverified). The fetch script checks the license and a checksum and stops on a mismatch. SemEval-2023 Task 3 is left out of launch numbers: its data agreement reportedly limits use to the shared task (unverified), so it returns only with the organizers' written permission. Data is never committed, uploaded as a CI artifact or printed in logs. Any data request goes from hello@biasclear.com in the project's name.

**In-house labeled set** (after launch). It's self-graded however carefully it's built, so it's published as secondary evidence and labeled that way. Its design rules are in the board's Track 2.

**PIT v2 preprint.** It needs the owner's full read and a stated AI-assistance note first. That's after launch. It's posted as a new version of the same Zenodo record.

---

## 8. Shelving (if Gate B says stop)

Archive the repository, leaving the PyPI project in place. Delete nothing. Leave the preprint links working. Account and domain steps are owner steps (private checklist).

---

## 9. Owner decisions (answered 2026-09-27)

1. **Blueprint revision 2:** approved. Revision 3 (this page) applies the overnight audit and research. The owner's merge approves it.
2. **License:** Apache-2.0 for the code, CC BY 4.0 for the rule pack. v1 code, including the `v1-final` tag, stays under AGPL-3.0. Known costs of the split: packages that ship the rule pack declare `Apache-2.0 AND CC-BY-4.0`, and CC BY grants no patent rights.

Open questions for the owner are in `ops/BOARD.md`, under "Questions for the owner".
