# Explain draft validation — 2026-10-07

Base: current remote main `2b39303652d54607ee6837743f9801e3aecf5ce4`, re-read before the draft PR. Candidate branch: `codex/explain-swappable-20261007`.

Source packet: `bws82/biasclear`, branch `claude/biasclear-revival-strategy-xvdgjm`, commit `e7c3d1dbd15340c19e80c22aaad712c9c74a7a8a`. Exact Git blob `937bc7ca155d2cc80e48e81d3944569ff4fecc0c`, patch SHA-256 `6115729e6387dec12be9dfed1393274862cb12a0539cc1801ba25e281a410596`. The patch was obtained by decoding the Git blob rather than using a raw download that changed Unicode fixture bytes. Owner-rule files were excluded; the proposal is unapplied.

## Completed local checks

| Check | Result |
|---|---|
| Python engine `python -m pytest tests/ -q` | 10,690 passed; 20 existing expected failures |
| TypeScript engine `npm test` | Typecheck/build; 140 tests passed; 103,068 Python/JS scans identical |
| Site `node --test site/test/site.test.mjs` | 27 passed |
| Site custom-domain build | 6 pages; rules 2.0.0a5; log says `link previews for https://biasclear.com/` |
| Explain `npm test` | Typecheck/build; 451 tests passed in 15 files, after the final sentence-boundary fix |
| Infrastructure pytest | 85 passed, no skips |
| `cfn-lint infra/aws/explain.yaml infra/aws/setup.yaml` | Passed with pinned cfn-lint 1.57.0 |
| `shellcheck infra/aws/ops.sh infra/aws/summary.sh` | Passed with ShellCheck 0.11.0 |
| `node infra/aws/model-table.mjs --check` | Reviewed selector/rates and exact model/profile IAM match |
| Default `readiness.mjs --model grok47` | Expected fail closed: actual owner/privacy policy missing and Grok total billed-output bound unverified; no credentials requested |
| `npm run eval:dry` | 811 cases per model; 3 expected preflight rejections/model; 808 model-stub calls/model; 2,424 total; $0 actual spend; 0 network attempts; every call had prior monthly/daily reservation |

Local Node 22.23.3; Python 3.12.14. CI uses Node 24 for the Lambda package and the existing Python matrix for the engine; CI readback is still pending at initial PR creation. The site tests run with SITE_URL unset because they create their own address fixtures. A first invocation with SITE_URL inherited failed those two environment-specific expectations; the prescribed command then passed, and the separate custom-domain build passed. No source workaround was made.

Final deployment zip SHA-256: `cba5acc8d48c170372f020750aafbe355e1b5dbf7bf60d504abbc8ff5240e058`. This is a local build artifact, not a deployment.

## Offline evidence

`STUB-RESULTS.md` prints one table per model. `STUB-RESULTS.json` contains aggregate machine-readable results and the full report hash. The complete per-answer JSON is reproduced by `npm run eval:dry` and published by the credential-free CI job as artifact `explain-offline-evaluation` (14 days). The fixed set hash is `ead45b914609c9ff8720f8efc2e86189996601ffbfe534e34e657391e668bd59`.

Each synthetic model rejects 9/9 injected-verdict probes, drops 6/6 unsafe rewrites and keeps 12/12 safe rewrites. `REGRESSION-EVIDENCE.json` shows measured source-validator counterexamples and the new results. Synthetic answers, times, token counts and charges are not real model measurements. The report sets `qualityMeasured=false`, `releaseApproved=false` and `humanReviewRequired=true`.

## Before paid use

- Default remains Grok 4.7. Grok and Sol intentionally refuse paid startup while billing/settings evidence is unresolved. No automatic fallback.
- Base IDs were copied from the signed-in Bedrock catalog. US profile IDs/routes and Grok/Sol prices came from official AWS cards; Sonnet price came from the official AWS price offer. Account-console profile confirmation remains outstanding. See MODEL-SOURCES.md for exact strings, sources and contradictions.
- All approved US routes use source us-east-1 and documented destinations us-east-1/us-east-2/us-west-2. No in-region-only or global-route promise.
- First approved default-model smoke must prove retention `none`. A review-retention requirement means stop and report. No compatibility claim is made now.
- Current owner/privacy rules are unchanged. OWNER-RULES.patch is a proposal; deployment readiness blocks until actual rules are adopted. Branch/environment protection also requires owner readback.
- Temporary evaluation key/switch cleanup is best effort after cancellation or runner loss, with no automatic key expiry. Verify recovery or pause manually.
- Claude's independent red-team review and the real same-set evaluation remain required. A failure is reported to the owner; no self-issued release approval, model switch or retry.

No AWS account change, live model call, spending, deployment, merge, public-site edit or actual owner-rule edit occurred. Model Check is a separate later PR; its question set requires owner approval before execution.
