# Explain on Amazon Web Services: the owner's guide

This guide is for the project owner. It says what the optional **Explain** feature puts in your AWS account, what it costs, how to switch it on and off, and how to delete all of it. You never handle a key or a password: GitHub proves who it is to Amazon each time, and only for runs you approve.

A short technical section for reviewers is at the end.

**Nothing here is live yet.** Grok 4.7 remains the default. All three real models are blocked while exact Converse reasoning-accounting and input-bound evidence is unknown. Grok and Sol also lack a documented total billed-output bound; Sol lacks verified lowest-effort settings. Sonnet's native output bound alone does not establish its normalized Converse accounting. The code never switches models by itself. Offline tests and the stub evaluation spend nothing.

Before visitors can use Explain, all of these happen, in this order:

1. **Before merging this service PR, rewrite the rulebook's privacy rule** (ticket X0): `AGENTS.md` today says visitor text never leaves the browser, and a hosted AI mode needs that rule changed first. The unapplied owner proposal is `handoff/explain/OWNER-RULES.patch`. You review and merge that separate change first.
2. The red team reviews this work, and you merge it only after step 1 is adopted. This draft has no merge or deploy approval.
3. You do the one-time setup below, and approve the first deploy. It leaves Explain switched **off**.
4. The live test (`evaluate`), and the red team reads every answer.
5. The website change that shows the button and rewrites every privacy sentence (tickets X3 and X5). You merge it, then run **resume**.

---

## What Explain is

On the checker page, a visitor can press **Explain** on one marked move. After a one-time consent line, the page sends that one sentence to a small service in your AWS account. The service checks that BiasClear's rules really mark that sentence, then asks the selected AI model through Amazon Bedrock, two short things: how the wording works, and one plainer way to write the sentence.

- The checker itself doesn't change and never needs Explain. A visitor who never presses Explain sends nothing.
- The service keeps no copy of the sentence or the answer. Its logs hold counts only, for 7 days.
- It points at wording, never at people or sides. It is not a fact-check and gives no verdict.

## What it puts in your AWS account

There are two parts, both in **US East (N. Virginia)**. The model is called through a reviewed **US inference profile**. The documented destinations are **N. Virginia (`us-east-1`), Ohio (`us-east-2`) and Oregon (`us-west-2`)**. Brad approved these routes on 2026-10-07; no global route is selected. Account availability and retention eligibility still need the owner's sitting.

**1. The one-time setup** (you create it once, from the file `infra/aws/setup.yaml`; it is called `biasclear-explain-setup`):

- **GitHub's keyless login.** It lets the "Explain (AWS)" workflow in the BiasClear repository work in your account, only from the protected `explain-aws` environment, and only after you approve. No key is stored anywhere.
- **Three roles** (sets of permissions): one for GitHub, one for CloudFormation (Amazon's setup tool), and one for the Explain function. The function may use only the three reviewed model profiles and their exact destination model ARNs, its own counters and its own log. One stack parameter selects the active model; unknown or unverified settings refuse startup.
- **One table of counters**: money spent this month and today, and how often each connection used Explain, under a scrambled code (see "What stays private"). It lives here, not in the service, so removing and redeploying the service can't restart the month's count. After a billing anomaly it also holds the billing pause and one debt record per unresolved charge; those never expire and wait for you (see "Reconciling a billing anomaly").
- **A monthly budget of $30** for the whole account, which ignores credits. It emails `hello@biasclear.com` along the way. At $30 it takes the AI model away from Explain by itself, and at $45 it does so again (the last stop, see "If an email from AWS Budgets arrives").
- **A private storage bucket** for build files. Each is about 70 KB; they are kept, so a failed update can always go back to the one before. Deleting everything empties it.

**2. The service** (GitHub creates and updates it when you approve a deploy; it is called `biasclear-explain`):

- a web address (an Amazon "HTTP API"), at most 2 requests a second across everyone. Web pages on other sites can't use it through a visitor's browser. Scripts can, which is why the limits and the $25 stop exist;
- one small program (a Lambda function) that does the checking;
- one log, kept 7 days.

## What it costs each month

These are estimates from Amazon's published prices. The live test (the `evaluate` action) measures the real numbers.

| Part | Normal month | Worst month |
|---|---|---|
| The selected AI model | Actual price and latency are measured in the owner-approved live evaluation. The program reserves money before each call and limits the ledger to **$25/month** and **$2.50/day**. | Documented input-framing and total billed-output bounds plus verified Converse reasoning accounting are required before live use; all three models are blocked until that evidence is established. |
| Everything else (web address, function, counters, log, billing-anomaly metric/alarm) | Not measured in this code-only draft. | No hard infrastructure or total-account ceiling. Recalculate the cost model before the AWS sitting; the old $15–$20 flood estimate predates atomic ledger writes and consistent pause reads. |
| **Total** | **Unmeasured** | **No guaranteed total AWS bill** |

- **The $25 stop is counted at full price, whatever credits you have.** Explain stops calling the model for the rest of the month once it reaches $25, and for the rest of the day once it reaches $2.50. The count lives in the setup, so it holds even if the service is removed and deployed again in the same month.
- **Credits.** The owner checks the credit's applicable products during the sitting. The cap counts full model price before credits; credit availability never raises the spending limit.
- **The budget emails** arrive at $15 (half of $30), at $30, and when Amazon forecasts the month will pass $30. The forecast email only starts after a few weeks of billing history. Amazon's numbers lag by several hours, so the budget is a safety net; the $25 stop in the program is the real stop.

**Use this AWS account for Explain only.** The budget watches the whole account.

**Billing-anomaly stop.** Reservation and settlement update the month/day counters atomically with a unique event record. A cost/token-bound breach, unknown usage or uncertain settlement returns paused and attempts a persistent stop that ordinary resume cannot clear. The exact log records known actual cost separately from the reservation and reports whether the pause persisted. If persistence fails, only the current instance is guaranteed paused; the alarm is meant to make that failure observable. Its filter matches words, not JSON fields, because Lambda's JSON log format stores the app's line inside a "message" string; an offline test checks it against that envelope, but real alarm operation is unproven until the AWS sitting. The draft adds a named CloudWatch metric/alarm with no automatic actions or notification subscription. It has not been created, and no delivery is claimed. Owner reconciliation is required before clearing an anomaly; a pause cannot undo already billed charges.

---

## The one-time setup (one sitting, about 25 minutes, clicks only)

The PM sends you a link to `infra/aws/setup.yaml` on GitHub with the repository's public ID numbers already filled in. Nothing in these steps asks you to type a key or a password.

1. **Sign in** to the AWS console with the account's main (root) sign-in, with two-factor turned on. Use it for these steps only.
2. **Check the credit.** Billing and Cost Management → **Credits**. Send the PM a screenshot of the credit's name, expiry date and "applicable products".
3. **Check the selected model.** Choose **US East (N. Virginia)** and confirm the reviewed profile is available on this account. Model access, use-case forms, terms and any paid test are the owner's actions. Do not call a blocked model or substitute another model.
4. **Check the privacy settings.** Model invocation logging in source `us-east-1` must be **off**, and retention must report **`none`** in every approved processing region (`us-east-1`, `us-east-2`, `us-west-2`). AWS documents regional retention with no propagation; those conservative reads do not themselves prove selected-model compatibility. AWS documents no console retention control; any owner-authorized account change belongs to the sitting. If the selected model refuses `none`, stop and report it to Brad. Never change to default or review retention.
5. **Create the setup.** Open the PM's link to `setup.yaml` → **Download raw file**. Then CloudFormation → **Create stack** → **With new resources** → **Upload a template file** → choose the file → **Next**. Name it `biasclear-explain-setup`. Check the alert email (`hello@biasclear.com`) → **Next** → **Next** → tick **"I acknowledge that AWS CloudFormation might create IAM resources with custom names"** → **Submit**. Wait until it says `CREATE_COMPLETE`.
   - A true one-click link isn't possible for this first step: Amazon wants such files stored in Amazon first, and your account has nothing there yet.
   - Uploading the file makes CloudFormation create a small bucket of its own, named `cf-templates-…-us-east-1`. It costs next to nothing; the delete steps below remove it.
6. **Create the GitHub approval step.** In the repository: **Settings → Environments → New environment** → name it `explain-aws` → **Configure environment**:
   - before configuring reviewers, decide the identity boundary described below. With the present shared account, owner approval is a process rule; it is not an agent-proof lock. A separate reviewer identity with **Prevent self-review** requires that identity to approve a run started by the other identity;
   - set **Required reviewers** and the self-review option only according to that owner-approved design;
   - untick **Allow administrators to bypass configured protection rules**;
   - **Save protection rules**;
   - **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → **Branch** → type `main` → **Add rule**;
   - **Environment variables** → **Add variable** → name `AWS_ACCOUNT_ID`, value: the 12-digit number on the setup stack's **Outputs** tab → **Add variable**. It is not a secret.
7. **First deploy.** Only after the model readiness and owner-policy gates pass, run **deploy** and approve it. It makes two distinct checks (direct authenticated evaluation and public request), each once, then restores the previous off state. A retention refusal stops the run and is reported to Brad; there is no retry or fallback to a less private retention mode.
8. **Practise the emergency stop.** Lambda → `biasclear-explain` → **Throttle** → confirm. Then **Edit concurrency** → **Use unreserved account concurrency** → **Save**. Now you know the button works. If Amazon refuses the Throttle button on a new account, tell the PM; the console fallback below is then your emergency stop.

## Deploy, pause, resume: two clicks each

1. GitHub → **Actions** → **Explain (AWS)** → **Run workflow** → choose the action → **Run workflow**.
2. Open the run. Read the summary at the top: it says in plain words what the run will do and **which Explain files changed since the last deploy**. Every code file it lists should be one you merged. Rule and move-name files are listed apart: the PM may merge those. Then **Review deployments** → tick **explain-aws** → **Approve and deploy**.

| Action | What it does |
|---|---|
| **deploy** | Builds Explain from `main` twice and runs its tests, checks the model's price against Amazon's price list and your privacy settings, updates the service with every setting from the reviewed files, and makes two test calls (under a cent). It switches Explain on for those calls and back to how it was. You can also set a lower monthly cap here (1 to 25 dollars). |
| **pause** | Switches Explain off. Visitors see "Explain is paused". Nothing else changes, and nothing new is shipped. |
| **resume** | Switches it on. Run it only when the website's button goes live (step 5 at the top), or to undo a pause. |
| **evaluate** | Switches Explain on, asks the model the same reviewed synthetic cases for the one explicitly selected model, saves every answer for the red team, and switches Explain back to how it was. Costs and time are reported from actual usage, counted in the shared $25 ledger. Each further model requires an owner-approved selector change; nothing switches models automatically. |
| **remove** | Deletes the service (see "Delete everything"). The month's count stays in the setup. |

Nothing runs by itself. A change merged into the repository waits until you run **deploy**.

> **The one rule for approving: approve only a run you started yourself, just now.** If GitHub emails you about a run waiting for approval that you didn't start, don't approve it. Tell the PM.

Every agent works through your GitHub account, so GitHub can't tell your clicks from theirs. Your approval is the check, and it only works if you keep this rule.

**Approval boundary still to decide.** The workflow's restricted `GITHUB_TOKEN` does not restrict agents' existing CLI, connector or browser access. Dispatch uses Actions write access; [approval through GitHub's API requires Deployments write](https://docs.github.com/en/rest/actions/workflow-runs#review-pending-deployments-for-a-workflow-run). An agent acting as the same owner/reviewer account could therefore perform both actions if its access permits them. A separate reviewer identity plus Prevent self-review is a technical separation; enabling that option while the owner starts and approves under the same identity would block the owner too. Brad must choose the separation or explicitly accept the remaining process boundary before any AWS sitting. No identity, permission or environment change is part of this PR.

### If a deploy fails

- **"Another change to Explain is still running"**: wait ten minutes and run it again.
- **A first deploy that failed** leaves an empty service behind. The next **deploy** deletes it and starts again by itself; you do nothing else.
- **"Explain's service is stuck in AWS"**: tell the PM. Don't change it in the console.
- **"Explain may still be on. Run "pause" now."** (this can follow a run you cancelled, or one that ran out of time): start the workflow again with **pause**. If that also stops, use the emergency stop below.
- Anything else: the run's summary says what stopped it, and nothing after that point was done. Tell the PM.

## Emergency stop (no GitHub needed)

AWS console → Lambda → `biasclear-explain` → **Throttle**. Every new Explain request fails at once. Model calls already in flight can still be billed, and API Gateway still charges for requests it receives. To undo it: **Edit concurrency** → **Use unreserved account concurrency** → **Save**.

If Throttle is refused on this account: CloudFormation → `biasclear-explain` → **Update** → **Use existing template** → **Next** → set **Explain** to `off` → **Next** → **Next** → **Submit**.

## If an email from AWS Budgets arrives

- **At $15 or on a forecast:** nothing stops. Tell the PM, who will look at the counters and the bill.
- **At $30:** Amazon has taken the AI model away from Explain, and Explain answers "paused". This happens only if the program's own count was wrong or someone flooded the service. Tell the PM.
  - **The safe choice is to leave Explain paused until the 1st of next month.** When Amazon's budget month starts again, Amazon resets this kind of stop by itself (Amazon's own blog posts say so; its user guide doesn't, so check the action's history at the setup sitting), and Explain works again within 15 minutes. That happens whether or not anyone has looked, so find out why it fired before the 1st. If it doesn't come back by the 2nd, tell the PM.
  - If Explain must come back sooner, first understand why it fired, then run **deploy** with a lower monthly cap, then in AWS: Billing and Cost Management → **Budgets** → `biasclear-explain` → **Actions** → the $30 action → **Reverse**. Know this: **Amazon doesn't check a reversed action again that month.** From then on only the $45 last stop is automatic.
  - **Never press Reset** on the action while the month is over $30: it would fire again at once.
- **At $45 (the last stop):** the same, but leave Explain paused until the 1st. Don't reverse it.

## Changing the monthly cap

- **Lower** (1 to 25 dollars): run **deploy** and type the number in **monthly cap**. Approve it.
- **Higher than $25:** a small reviewed change to the files, plus one number in the setup stack's budget, done together. Ask the PM.

## Reconciling a billing anomaly

The PM does this with you at a sitting; the function itself can't delete these records (setup.yaml lets it delete only old salts).

1. In DynamoDB → `biasclear-explain` → items, find `billing#pause` and every `billingdebt#…` row.
2. For each debt row, open the event it names (`billing#…`). If its `state` is `settled`, the counters already hold its actual cost: change nothing. If it is still `reserved`, the counters hold only the reservation: when the debt has an `actual`, add actual minus reserved to the month and day counters the event names; when it has none (usage unknown), check the AWS bill before deciding.
3. Events left `reserved` with no debt row (a lost acknowledgment) keep their reservation on the counters until the month's count expires. They over-count, which is the safe direction.
4. Only then delete the debt rows and `billing#pause`. Explain stays paused until the pause is gone; resume doesn't clear it.

## Delete everything

In this order, so visitors never see a dead button:

1. **Hide the button.** The PM opens a change that switches Explain off on the website and restores the privacy wording. You merge it.
2. **Remove the service.** Run the workflow with **remove** and approve it. (Or: CloudFormation → `biasclear-explain` → **Delete**.) This deletes the function, the web address and every log line. The counters stay with the setup until step 3.
3. **Remove the setup too.** First reconcile any billing anomaly (above): deleting the setup deletes the pause and debt records with the counters.
   - S3 → the `biasclear-explain-build-…` bucket → **Empty**.
   - S3 → the `cf-templates-…-us-east-1` bucket → **Empty** → **Delete**.
   - CloudFormation → `biasclear-explain-setup` → **Delete**. This removes the GitHub login, the three roles, the counters, the budget and its two stops, the deny policy and the build bucket.
4. **Check:** CloudFormation shows neither stack; DynamoDB → Tables shows no `biasclear-explain`; CloudWatch → Log groups shows no `/biasclear/explain`; Budgets shows no `biasclear-explain`; S3 shows neither bucket; next month's bill has no Bedrock line. In GitHub, delete the `explain-aws` environment.
5. **What stays:** the model switch-on from the playground (it costs nothing unused), your Bedrock privacy settings as you left them, and the AWS account itself.

## What stays private, in plain words

- **The sentence and the answer.** The function holds them in memory while it works and never writes them down. It sends the sentence to Amazon Bedrock, which runs the AI model. The selected model's maker is xAI (Grok 4.7), Anthropic (Claude Sonnet 5.5) or OpenAI (GPT-6.1 Sol), shown in the draft consent copy. The approved profile may process it in N. Virginia, Ohio or Oregon. The account must report **zero data retention (`none`)**. A model that requires more permissive retention is refused; the service never falls back. Live compatibility remains unproven until the owner's sitting.
- **The visitor's internet address.** It is turned into a scrambled code for the counters and then dropped. The code is made with a secret that is replaced every day and expires after two days; the service erases old secrets on its first request each day, and Amazon erases any left over within a few days. Once the secret is gone, nobody can turn the code back into the address.
- **The logs** hold counts, not text, for 7 days.
- Amazon's own settings for extra logging and data keeping are checked before every deploy and every 15 minutes, and Explain pauses itself if either changes. **Never switch on Bedrock logging or data sharing in this account.** If you want to try other AI models, use a separate AWS account.

---

## Technical section

The selected Standard US input/output prices per million tokens are Grok 4.7 **$2.20/$6.60**, Sonnet 5.5 **$2.20/$11.00**, and GPT-6.1 Sol **$2.20/$11.00**. Base model IDs came from the AWS console; exact profiles/routes and prices came from linked public AWS model cards or the public AWS offer. The table preserves separate provenance. No account profile availability is implied.

**Files.**

| Path | What it is |
|---|---|
| `infra/aws/setup.yaml` | The owner's one-time stack: GitHub OIDC provider and deploy role, CloudFormation's service role, the function role, the counters table, the budget with `APPLY_IAM_POLICY` actions at 100% and 150%, the deny policy, the Budgets execution role, the build bucket |
| `infra/aws/explain.yaml` | The service stack the workflow deploys: HTTP API (CORS, throttle), Lambda (`nodejs24.x`, arm64), log group (7 days). No IAM, no table |
| `infra/aws/model-table.mjs`, `readiness.mjs` | Offline table/template drift check and owner-policy/model readiness gates before AWS credentials |
| `infra/aws/ops.sh`, `summary.sh`, `deploy-params.mjs` | The workflow's steps: everything that runs with AWS credentials (bash, jq, curl, the AWS CLI, no npm package), the plain-words summary, and the reviewed defaults every deploy passes |
| `infra/aws/test_templates.py`, `test_scripts.py` | Structural checks on both templates (with cfn-lint), and the scripts against fake `aws`, `curl` and `gh` |
| `packages/explain/` | The function: TypeScript, bundled by esbuild into one ES module with the rule engine; no runtime dependencies (its own SigV4 signer); tests with a mocked Bedrock and DynamoDB |
| `packages/explain/SITE_CONTRACT.md` | What the website must do (consent, states, privacy copy) |
| `.github/workflows/explain.yml` | The owner's deploy, pause, resume, evaluate and remove workflow |
| `docs/THREAT_MODEL.md` | Threats and what stops each |

**The workflow's jobs.** `summary` (read-only; finds the last deploy from the `explain-aws` environment's successful deployments whose run was a `deploy` from `explain.yml` on `main` with a successful `aws` job, on `main`'s history; the deployment and its status made by `github-actions[bot]`, and the deployment's commit equal to its run's commit) → `build` and `rebuild` (read-only, no environment, no `id-token`: `npm ci`, tests, the price check, two reproducible builds on separate runners) → `aws` (the environment and `id-token`; no npm: checks both builds' sha256, then `ops.sh`, each step signing in for its own process) → `report` (evaluate only; read-only).

**Request path** (`packages/explain/src/app.ts`): strict startup validates the selected table entry, input/billed reasoning evidence and retention `none` → authenticated evaluation event or public origin/request boundary → source invocation logging off and all-region retention none, refreshed every 15 minutes with concurrent callers awaiting the same check → exactly seven request fields plus the consent fingerprint (visitors), <=4,096 bytes, one sentence <=500 code points → bundled engine rechecks the rule and span → rate limits → persistent pause fence and atomic month/day reservation before the call → one `Converse` request with the fixed prompt and sentence, no tools, search, grounding or retries → conditional atomic usage settlement → bound-breach pause or normalized answer checks → one fixed-field log line. Recognized reasoning blocks are discarded; normalized output accounting must be verified to include billed reasoning exactly once before live startup. Cache-read input counters are charged at the full input rate (an over-count); any cache-write counter is unknown usage, because none is requested and writes can bill above the input rate. Unknown usage keeps the full reservation and pauses; a model without verified input and total billed bounds cannot start live.

**Service stack parameters** (`explain.yaml`). `Model` is the only model selector: `grok47` (default), `sonnet55`, or `sol61`. The exact profile and reviewed prices are mapped from the one code table; prices cannot be lowered through stack parameters. Other workflow-controlled values are `Explain`, `MonthlyCapUsd`, `CodeKey` and the temporary `EvaluationKey` (`NoEcho`, best-effort cleanup after a run; no automatic expiry). Retention only allows `none`. `AllowedOrigins` defaults to `https://biasclear.com`.

**IAM.** All permissions live in the setup stack. The function has `bedrock:InvokeModel` and `bedrock:GetInferenceProfile` on each exact reviewed `us-east-1` profile ARN. Each profile has exactly three destination foundation-model ARNs, with `bedrock:InferenceProfileArn` equal to that profile; no region wildcard or direct model call is allowed. It may read the two account settings, use its one counters table and write its one log group. The budget attaches a deny policy for `bedrock:*` and `bedrock-mantle:*`. The deploy role may change only the service stack through its named CloudFormation role, upload builds, read settings and invoke the evaluation function. CloudFormation may manage only the named function/log and HTTP APIs in us-east-1 and pass only the function role. The Budgets role may only attach/detach the one deny policy. The OIDC trust pins account/repository IDs and the protected `explain-aws` environment.

**What is not locked by AWS.** Which API may invoke the function: IAM has no condition key for `lambda:AddPermission`'s `SourceArn` or `SourceAccount`, so CloudFormation's role could grant any API Gateway. The one grant `explain.yaml` makes is pinned to this account's API and route, and `test_templates.py` checks it exactly; review keeps it so. Even so, an evaluation event must carry this deploy's key. The key is stored only in the stack parameter and the function's environment; the run's last step clears it, on a best-effort basis, and it has no automatic expiry. And what the function's code does with text it already holds is guarded by review: the red team reads every change, these paths are owner-merged protected paths (`AGENTS.md`), and nothing deploys until the owner starts and approves a run. A private network (VPC endpoints) would make that technical too; it is not used (about $15 a month; SPEC §2, §19).

**Before a first paid call.** Confirm account profile availability; the default model's documented bound on all billed reasoning/text output; the model's ability to run with account retention `none`; invocation logging off; the owner's policy proposal applied in its separate approved change; and the owner's live-evaluation approval. GPT-6.1 Sol additionally needs a documented lowest reasoning setting. The offline workflow gate runs before any OIDC credential request for deploy, resume or evaluation, and strict function startup independently rejects blocked settings. Pause/remove remain available for emergencies. The same cap-backed evaluation set runs separately for each explicitly selected model. Passing a stub test does not establish model behavior, account access, retention eligibility, cost or latency.
