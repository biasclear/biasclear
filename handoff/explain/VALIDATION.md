# Explain draft validation — 2026-10-07

Base: current remote main `2b39303652d54607ee6837743f9801e3aecf5ce4`, re-read before the draft PR. Candidate branch: `codex/explain-swappable-20261007`.

Source packet: `bws82/biasclear`, branch `claude/biasclear-revival-strategy-xvdgjm`, commit `e7c3d1dbd15340c19e80c22aaad712c9c74a7a8a`. Exact Git blob `937bc7ca155d2cc80e48e81d3944569ff4fecc0c`, patch SHA-256 `6115729e6387dec12be9dfed1393274862cb12a0539cc1801ba25e281a410596`. The patch was obtained by decoding the Git blob rather than using a raw download that changed Unicode fixture bytes. Owner-rule files were excluded; the proposal is unapplied.

## Current red-team checkpoint

Claude 298 found new HIGH/MEDIUM defects after the initial draft. The 299/300 split is agreed: Claude owns answer checker/prompt fixes; Jarvis owns billing, privacy, evaluation and CI. Claude packet 301 was SHA-verified and tested locally, but Jarvis reproduced adopted instructions and claims that still passed. Its checker remains unaccepted and was excluded from this backend checkpoint; the answer/prompt files remain identical to original draft head 2299fe1. Replacement packet 304 and reciprocal backend review are pending. Passing unit tests and the synthetic rehearsal do not close these findings.

Current backend/evaluation fixes include atomic reservation/settlement and persistent per-event unresolved debt, explicit model accounting/input evidence, three-region retention reads, exact regional signing, clipping/completeness and canonical-side evaluation gates, generated model-specific privacy drafts, and unsuppressed fixes for three reported CodeQL patterns. No live access or setting changed.

## Completed local checks

| Check | Result |
|---|---|
| Python engine `python -m pytest tests/ -q` | Initial-draft check: 10,690 passed; 20 existing expected failures. Engine unchanged in this fix round |
| TypeScript engine `npm test` | Initial-draft check: 140 passed; 103,068 Python/JS scans identical. Engine unchanged in this fix round |
| Site `node --test site/test/site.test.mjs` | Initial-draft check: 27 passed. Site unchanged in this fix round |
| Site custom-domain build | 6 pages; rules 2.0.0a5; log says `link previews for https://biasclear.com/` |
| Explain `npm test` | Current backend checkpoint on original checker: typecheck/build; 519 passed in 18 files. An earlier combined scratch check passed 702 with unaccepted 301, which is excluded from this checkpoint |
| Infrastructure pytest | Current check: 103 passed, no skips, including model-table selector/metadata tests |
| `cfn-lint infra/aws/explain.yaml infra/aws/setup.yaml` | Passed with pinned cfn-lint 1.57.0 |
| `shellcheck infra/aws/ops.sh infra/aws/summary.sh` | Passed with ShellCheck 0.11.0 |
| `node infra/aws/model-table.mjs --check` | Reviewed selector/rates and exact model/profile IAM match |
| Production model readiness | All three models blocked by unresolved input-framing and Converse billed reasoning-accounting evidence. Owner/privacy policy remains unapplied; no credentials requested |
| `npm run eval:dry` | 1,085 cases/model; 3 expected preflight rejections/model; 1,082 stub calls/model; 3,246 total; $0 actual spend; 0 network; prior reservation verified for every call. Quality gates remain unapproved/unmet |

Local Node 22.23.3; Python 3.12.14. CI uses Node 24 for the Lambda package and the existing Python matrix for the engine. The initial CI failed ShellCheck SC2015 after 451 tests and 2,424 stub calls passed; Advanced Security also reported three high CodeQL patterns. The local fixes are prepared without dismissals or suppressions. Fresh CI readback is pending for this revision. The site tests run with SITE_URL unset because they create their own address fixtures. A first invocation with SITE_URL inherited failed those two environment-specific expectations; the prescribed command then passed, and the separate custom-domain build passed. No source workaround was made.

Final deployment zip SHA-256: `8ce982813b429f366fa3d8c3c230db49bbd46d02fd6182af7a1139c8f337ebee`. This is a local build artifact, not a deployment.

## Offline evidence

`STUB-RESULTS.md` prints one table per model. `STUB-RESULTS.json` contains aggregate machine-readable results and the full report hash. The complete per-answer JSON is reproduced by `npm run eval:dry` and published by the credential-free CI job as artifact `explain-offline-evaluation` (14 days). The draft fixed set hash is `0a3a4be14b244e7e7ec6de9692f50e0e311570710ce0e30ae1c8a5d699a6565f`. It contains 98 matched pairs, 56 controversial sentences, 24 proposed side-free heldout controls, plus injection and rewrite probes. Brad has not approved the corpus or quality gates for a paid run.

Each synthetic model rejects 9/9 injected-verdict probes, drops 6/6 unsafe rewrites and keeps 12/12 safe rewrites. `REGRESSION-EVIDENCE.json` preserves the initial-draft source-validator counterexamples; it is historical evidence, not a closure claim for later Claude 298 findings. Synthetic answers, times, token counts and charges are not real model measurements. The report sets `qualityMeasured=false`, `releaseApproved=false` and `humanReviewRequired=true`.

## Before paid use

- Default remains Grok 4.7. All three models intentionally refuse paid startup while input-framing and billed reasoning-accounting evidence is unresolved. No automatic fallback.
- Base IDs were copied from the signed-in Bedrock catalog. US profile IDs/routes and Grok/Sol prices came from official AWS cards; Sonnet price came from the official AWS price offer. Account-console profile confirmation remains outstanding. See MODEL-SOURCES.md for exact strings, sources and contradictions.
- All approved US routes use source us-east-1 and documented destinations us-east-1/us-east-2/us-west-2. No in-region-only or global-route promise.
- First approved default-model smoke must prove retention `none`. A review-retention requirement means stop and report. No compatibility claim is made now.
- Current owner/privacy rules are unchanged. OWNER-RULES.patch is a proposal; deployment readiness blocks until actual rules are adopted. Branch/environment protection also requires owner readback.
- Temporary evaluation key/switch cleanup is best effort after cancellation or runner loss, with no automatic key expiry. Verify recovery or pause manually.
- Claude's checker replacement, Jarvis's checker review, Claude's reciprocal backend review and the real same-set evaluation remain required. A failure is reported to the owner; no self-issued release approval, model switch or retry.

No AWS account change, live model call, spending, deployment, merge, public-site edit or actual owner-rule edit occurred. Model Check is a separate later PR; its question set requires owner approval before execution.

The 80% usefulness floor, side/answer/refusal/rewrite parity, injection and claim-preservation gates are executable drafts requiring independent hash-bound human judgments. Raw clipping or missing call evidence fails completeness. Synthetic wiring passes cannot grant `allGatesPass`; every model currently reports it false. CloudWatch alarms have no delivery actions; the $25/$2.50 model fences are not a guaranteed ceiling on the whole AWS bill. Failed durable pause storage stops only the confirmed instance; already-billed overruns cannot be recalled. See the owner guide and threat model for the disclosed limits.
