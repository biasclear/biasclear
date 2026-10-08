# @biasclear/explain

The Lambda function behind BiasClear's optional **Explain** feature (Mode C). When a visitor presses Explain on one marked move and agrees, the site sends that one sentence here. The function re-runs the BiasClear rule engine on it, refuses anything that isn't a real mark, asks the selected reviewed model on Amazon Bedrock through Converse (default Grok 4.7, with Claude Sonnet 5.5 and GPT-6.1 Sol alternatives) how the wording works and for one plainer way to write the sentence, checks the answer, and returns plain text. It keeps no copy of the sentence or the answer.

- Owner's guide, costs and deploy steps: [`infra/aws/README.md`](../../infra/aws/README.md)
- What the website must do: [`SITE_CONTRACT.md`](SITE_CONTRACT.md)
- Threats and defences: [`docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md)

Status: **code-only draft, not deployed**. Local test and stub-evaluation evidence is recorded in [`VALIDATION.md`](../../handoff/explain/VALIDATION.md). Nothing here is live until Claude's red-team review, owner-approved setup, zero-retention proof, real evaluation and an approved deploy. The current site stays unchanged.

## Commands

```sh
npm ci --ignore-scripts
npm test                    # typecheck, build dist/, then all unit tests
npm run build               # dist/index.mjs, dist/explain.zip (+ .sha256), dist/ops.mjs (the workflow's offline helpers)
node scripts/build.mjs --previous auto   # also bundle the previous rules release (needs full git history)
npm run check-prices        # verify selected reviewed rates against official AWS sources (network)
npm run eval:dry            # offline stub only; zero AWS calls and zero spend
```

The zip holds one file, `index.mjs` (handler `index.handler`, runtime `nodejs24.x`), built reproducibly (same input, same bytes). It imports nothing but Node's own modules.

## Layout

| Path | What it does |
|---|---|
| `src/index.ts` | Lambda entry: reads the environment once, wires the real transport |
| `src/app.ts` | The request, step by step (SPEC §4), inside one top-level guard |
| `src/request.ts` | Shape and size (SPEC §3) |
| `src/engines.ts` | The bundled rule engine(s), keyed by rules version; `src/generated/engines.ts` is written by `scripts/gen-engines.mjs` |
| `src/moves.ts`, `data/moves.json` | Move names for the prompt; a byte-identical copy of `site/data/moves.json` (a test checks it) |
| `src/prompt.ts` | The system prompt and user message (SPEC §6) |
| `src/output.ts`, `src/text.ts` | The answer's checks (SPEC §7, and the red team's first two rounds): shape, plain text, quoting the marked words, every clause about the wording, no echo of the sentence's clauses, no verdict, label, motive, new name or side (sides kept as pairs), and a rewrite that keeps the speaker, the certainty and every word of the claim and brings in only neutral words |
| `src/spend.ts` | Atomic cap reservation and idempotent settlement, persistent billing pause and per-event unresolved debt (SPEC §8) |
| `src/ratelimit.ts`, `src/state.ts` | Per-connection limits, the daily salt, the in-memory over-limit list and pause flag (SPEC §9) |
| `src/log.ts` | The only module that logs; fixed fields only (SPEC §10) |
| `src/aws/` | SigV4 signing, one signed `fetch` per call (no retries), DynamoDB and Bedrock calls |
| `ops/ops.ts` | The deploy workflow's offline helpers (no AWS access): the smoke test's and the evaluation's request bodies, and the red team's report. The calls themselves are made by `infra/aws/ops.sh` |
| `eval/fixtures.json` | Matched pairs, controversial wording from opposite sides, injection sentences and rewrite-preservation cases; the dry report records exact counts and fixture hash |
| `scripts/` | Build, engine bundling, price check |
| `test/` | Unit tests with a fake AWS (mocked Bedrock, an in-memory DynamoDB that runs the function's own expressions) |

## Implementation choices carried forward

The build brief and the spec disagreed in a few places. Each choice below is deliberate and small; the red team should check it.

1. **Layout.** The code is in `packages/explain/` and the templates and deploy scripts in `infra/aws/` (the build brief's paths), not a single `explain/` folder. The proposed owner-rule update is `handoff/explain/OWNER-RULES.patch`, intentionally unapplied. The offline deployment readiness gate requires those actual rules before AWS credentials can be obtained; this draft cannot deploy under current owner rules.
2. **No AWS SDK, on purpose.** The brief asks for no runtime dependencies beyond the Lambda runtime; the spec asked to bundle and pin the AWS SDK so the tested bytes are the deployed bytes. This package does both: it signs its few AWS calls itself (SigV4 with `node:crypto`, about 100 lines, checked in CI against signatures made by botocore) and bundles nothing else. The runtime's own SDK is not used, because its version changes under the function without a review. Its request paths carry plain IDs only (an inference profile ID, not an ARN), so SigV4's double-encoding rule for ARNs in a path never applies; a change to an ARN would need new botocore vectors.
3. **Two templates.** The brief asked for one template with every resource; the spec's two-stack design is kept, because it is what stops a deployed change from widening IAM. Together `setup.yaml` and `explain.yaml` hold every resource the brief lists.
4. **Reviewed model parameter.** `Model` accepts `grok47` (default), `sonnet55` or `sol61`. The shared Converse transport uses that entry's exact US profile, lowest verified effort and reviewed rates. For source `us-east-1`, the documented destinations are N. Virginia, Ohio and Oregon. Exact profile availability still needs account-console confirmation. All three entries refuse paid startup while model-specific input-framing and billed reasoning-accounting evidence is unresolved. Sonnet's native output limit alone does not verify its Converse accounting. No automatic fallback exists.
5. **Prices from one table.** The stack and function derive rates from the reviewed entry, not independent price inputs. A source mismatch or unreadable price stops deployment.
6. **Reserved concurrency** is an optional parameter, default 0 (none), because new accounts can't reserve any.
7. **The kill switch defaults to off** in the template. Deploy and evaluate switch it on for their own calls and back to what it was; only resume leaves it on. Every other parameter is passed from the template's defaults on every deploy (`infra/aws/deploy-params.mjs`).
8. **Fewer log lines.** Lambda's own platform lines are limited to warnings (`SystemLogLevel: WARN`), so START, END and REPORT lines are not stored.
9. **DynamoDB throughput cap.** The table's on-demand throughput is capped at 50 reads and 50 writes a second, an extra bound on cost under a flood.
10. **Quoting is not permission to adopt a verdict.** The explanation must quote marked wording and describe it. A source containing an injected verdict does not authorize the answer to repeat that verdict as its own claim. Tests cover known counterexamples; passing tests does not close an independent review or establish semantic neutrality.
11. **The optional `describe.json`** (SPEC §6) is not included.
12. **The setup stack** can reuse an existing GitHub login in the account (`CreateGitHubLogin: no`).
13. **The counters live in the setup stack**, so removing and redeploying the service can't restart the month's spend count.
14. **The evaluation's direct invoke needs a temporary key.** The workflow draws it per deploy/evaluation and attempts cleanup afterward. Cancellation or runner loss can interrupt cleanup; there is no automatic key expiry. The owner must verify recovery or pause manually.
15. **Billing uncertainty persists.** Each ambiguous settlement leaves a separate durable debt record and an account-wide billing pause in the shared table; the counters hold either the reservation or the settled amount, so reconciliation reads the event's state first (infra/aws/README.md, "Reconciling a billing anomaly"). New reservations atomically check that pause. The visible billing-anomaly alarm has no delivery actions configured; it is not a notification promise. If storing the pause/debt fails, only the current instance is confirmed stopped and the fixed log records that failure. In-flight calls and an already-billed provider overrun cannot be recalled.

## What the tests cover

Valid explains; refusals of sentences that aren't marks (including a mark in another domain); oversize and malformed input; injection attempts in the text and in the answer (the red team's obedient answers among them); slanted answers, flipped rewrites, and the same answers about swapped sides; the spend cap failing closed (no headroom, a refused reservation, DynamoDB faults, billed and unbilled model errors, overruns); concurrent requests racing the monthly and the daily cap; per-connection limits, IPv6 grouping, the salt's rotation and the over-limit list; the kill switch; the account's privacy settings; malformed model output; CORS preflight and origins; that no user text reaches any log (canary tests with every console method and output stream captured); SigV4 against botocore; the price check against a saved copy of AWS's price list; the built bundle end to end; the evaluation fixtures and the red team's report; and the site contract's list of public promises. The deploy scripts are tested in `infra/aws/test_scripts.py`.

## Current decisions

The owner's October 7 decisions and source provenance are in [`SPEC.md`](../../handoff/explain/SPEC.md), [`DECISIONS.md`](../../handoff/explain/DECISIONS.md) and [`MODEL-SOURCES.md`](../../handoff/explain/MODEL-SOURCES.md). Models are swapped only through the reviewed stack parameter; unknown or unverified configurations fail closed. No automatic fallback, live search, tools or chat history. Reasoning is charged in the cap.
