# Threat model: Explain (Mode C)

Code-only draft, 2026-10-07. Explain is optional: a future visitor consent flow sends one marked sentence to the service, which re-checks the mark and requests a checked explanation through Bedrock Converse. The current website is unchanged and sends no visitor text. Grok 4.7 is the default; Claude Sonnet 5.5 and GPT-6.1 Sol are reviewed alternatives, never automatic fallbacks.

**Intermediate checkpoint:** the PR-head checker remains unchanged. Claude's unaccepted 301 replacement vocabulary/input guard is not included. H1 verdict/instruction bypasses, H2 contact/link bypasses and replacement-guard usefulness findings remain open pending Claude's 304 packet and review. This document reports risk; it does not clear the checker.

Scope: `packages/explain/`, `infra/aws/`, the manual Explain workflow, and the future site contract. The rule engine itself is unchanged. Current model provenance and unresolved evidence are in [`MODEL-SOURCES.md`](../handoff/explain/MODEL-SOURCES.md); actual local results are in [`VALIDATION.md`](../handoff/explain/VALIDATION.md).

## Assets and boundaries

Protect the visitor's sentence and network address, bounded model spending, even-handed analysis, and narrow AWS permissions. Attackers include public callers, hostile pasted text, compromised dependencies, a bad code change, and a compromised owner session. AWS and the selected model provider are external processors governed by the verified route, settings and terms.

The boundaries are browser → API Gateway → Lambda; Lambda → Bedrock/counters/fixed logs; GitHub Actions → owner-approved AWS role; and AWS Budgets → one pre-created deny policy. CORS is a browser courtesy, not authentication. Agents can act through the owner's account, so GitHub cannot identify an agent click as different from the owner's click.

## T1. A free chatbot or arbitrary model endpoint

The request has exactly seven fixed keys, at most 4,096 bytes, and one sentence of at most 500 characters. The server re-runs the bundled engine and requires the requested rule at the requested span in the requested domain. Move names and descriptions come from reviewed server data. Neither the caller nor the model selects a model, route, price, tool or prompt. Converse sends the fixed Explain system prompt and one marked sentence; no chat history, search, X access, grounding or tools. Tests inspect the wire body.

The answer is short checked plain text, not arbitrary model output. Authenticated evaluation keeps the same spend reservations and input/output gates, while bypassing only public per-connection fairness limits. Its artifacts inherit repository access; they are not intrinsically private. A sentence with a real trigger can still pass; that is the intended feature, not proof that its claim is sound.

## T2. Draining the account

A call must reserve money with one transaction checking the persistent pause, both monthly/daily counters and a unique reservation record. Settlement uses a conditional event-state transaction, so neither counter can commit alone and a duplicate cannot double-apply the charge. Lost acknowledgments require a consistent recovery read; no non-idempotent ADD is blindly retried. Rates come from the selected reviewed table entry. Credits do not enlarge the allowance. Defaults remain $25/month and $2.50/day; no relaxation has been authorized. Counters belong to the setup stack, so service redeployment cannot reset them. Every billed output token, including reasoning, must be counted.

**A hard cap needs verified input and total billed-token bounds and accounting.** All three real entries refuse paid startup while exact Converse reasoning-accounting and input evidence remains unknown. Grok's visible limit is not assumed to bound reasoning; Sonnet's documented native bound alone does not establish normalized Converse billing. A measured smoke maximum is not a universal bound. Stub tests use a separate trusted synthetic registry; caller events/environment cannot activate it.

Storage failure before reservation means no model call. Unknown billing or failed/uncertain settlement keeps the reservation and attempts a persistent no-TTL billing pause. A measured bound/cost breach counts the actual charge and writes the pause in the same transaction; it returns paused rather than an explanation. There are no model retries. If persistence fails, the instance remains paused and the fixed log reports pausePersisted=0; do not promise an account-wide durable stop. An already billed breach cannot be undone. The proposed visible-only CloudWatch alarm has no notification actions and is not deployed. Official source price verification stops a deploy on mismatch or unreadable evidence. The old infrastructure cost estimate requires recalculation after these extra reads/writes.

Backstops are the HTTP API throttle, limited DynamoDB throughput, an owner emergency pause, and setup-owned AWS Budget actions attaching a deny-Bedrock policy. Budget billing updates lag; they cannot guarantee a dollar-exact cap. API Gateway, Lambda, counters and fixed logs have separate charges and no hard total-account stop. Do not describe a model spending cap as a guaranteed total AWS bill.

## T3. Shared-service exhaustion

One caller can fill the shared API throttle and cause busy responses for others. Per-connection limits run behind that throttle and cannot prevent this. The checker still works without Explain. This is a deployment trade-off for owner review; it is not an already accepted risk merely because an earlier recommendation said so.

## T4. Prompt injection

The prompt treats the marked sentence as data. Request validation refuses disallowed C0/C1 controls, bidirectional overrides and Unicode tags. The current model-facing copy maps literal angle brackets only, keeping the original engine sentence/spans unchanged. The broader normalization proposal from 301 is not included; format/lookalike input remains an open follow-up. One-sentence validation prevents a caller from appending a second instruction sentence, but an injection can still fit inside a valid single sentence.

The server checks shape, lengths, plain text, quotations, wording clauses, source echoes, verdicts, names, side labels and motives. Finding a verdict in the source does not authorize repeating it as the answer's own claim. Direct regressions cover the known obedient-answer bypasses. A recognized Converse reasoning block is discarded from the public answer, while its billed usage remains counted; tool or unknown content blocks fail closed.

These are deterministic pattern checks, not semantic proof. An unlisted instruction-following answer could pass them. The same-set injection evaluation and Claude's independent reading remain release gates. A failure blocks shipping and becomes a regression; it never triggers an automatic model switch.

## T5. Slant or a changed claim

Every model uses the same prompt and output checks. Side-word families are checked symmetrically, including reviewed inflections, punctuation, hyphens and possessives. Tests run paired forms in both directions.

A rewrite must preserve the unmarked text and order, apart from defined whitespace and initial-case normalization, and replace marked wording only with a reviewed neutral template. Unsupported or ambiguous replacements produce `plainer: null`. Existing name, negation, certainty and content checks remain additional screens. This deliberately drops some useful rewrites; it does not prove that every accepted sentence preserves meaning.

The draft same-set evaluation includes matched pairs, controversial wording from opposite sides, side-free holdout controls, refusals, injections and claim-preservation cases. Canonical labels follow actual content regardless of presentation; reports retain planned side/topic/move denominators. Complete/unique request identities, explicit call/stop/bound metadata and unclipped raw evidence are required. Each paired sample must have zero unmatched answers and observable refusals; accepted/refusal/rewrite counts match, and both sides need an eligible answer. Unrounded accepted-answer means must satisfy `abs(meanA-meanB)/((meanA+meanB)/2) <= 0.30`. Injection violations and claim reversals must be zero. The proposed 80% floor counts useful accepted answers over every planned heldout control, with calibration separate; questions and thresholds still await approval. The exact executable gates and review hash binding are in `packages/explain/eval/README.md`. Human review remains mandatory and its name is provenance, not authenticated identity. Stub cost/time are synthetic, quality unmeasured and release approval false. Real Grok failures in even-handedness, injections or reversals must be reported to Brad and Claude; no automatic fallback or disabling rewrites to obtain a pass.

## T6. Text or addresses in storage/logs

Only one fixed-field logger writes application logs. It permits fixed/known outcome/code/rule/version/model/rewrite states and bounded numeric status/time/token/ledger values, plus bound/overrun/pause/evaluation flags. `reservedMicros` is distinct from known `actualMicros`; unknown usage never acquires an actual cost from its reservation. `pausePersisted=0` explicitly reports failed durable-pause evidence. Provider stop reasons/text and raw request/error/stack/address/hash fields cannot be logs. The sink can lose a line; neither durable billing reconciliation nor notification delivery is proved by logging. Canary tests capture console/output paths. The application stores counters under a daily salted HMAC, never the address or visitor text. Salts expire after two days; explicit deletion and DynamoDB TTL have the deletion delays stated in the site contract. No backups, streams or point-in-time recovery preserve them.

Invocation logging, tracing and access logs must be off. [AWS documents cross-region invocation logs at the source](https://aws.amazon.com/blogs/machine-learning/getting-started-with-cross-region-inference-in-amazon-bedrock/), so logging is read in us-east-1. [Retention settings are regional and do not propagate](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html); the draft requires `none` in the source and every approved destination (currently the same three US regions). Unreadable/changed settings pause Explain. Concurrent callers await the same unfinished settings check. Those reads do not prove exact-model compatibility; the owner-approved default-model smoke remains required. If Grok requires review retention, stop and report; never relax the setting.

For source `us-east-1`, the official cards document US-profile processing in `us-east-1`, `us-east-2` and `us-west-2` (N. Virginia, Ohio, Oregon). Base IDs were copied from the signed-in console; account-console profile confirmation is still outstanding. The future privacy copy names the selected maker and these locations. No global profile is authorized. AWS sees connection addresses as host. While a salt remains, a sufficiently privileged reader could test candidate IPv4 addresses against it.

## T7. Script or markup in an answer

The validator aims to refuse links, email addresses, markup and invisible/control characters, and returns JSON with defensive response headers. The unchanged PR-head URL/contact screen has known H2 bypasses; do not claim it rejects every link, email or phone form. The replacement contact guard remains for Claude's 304 packet and review. The future site must render checked fields with `textContent`, never HTML, and verify the response shape. That site implementation is outside this PR and cannot be described as already verified.

## T8. An unsafe deployment

All IAM lives in the owner-created setup stack. Exact profile ARNs and destination foundation-model ARNs are derived from the single reviewed table; foundation-model calls require the matching inference-profile condition. There is no general model allow or streaming/tool grant. Readiness checks reject an unreviewed selector or unresolved billing/settings metadata.

The workflow is manual and main-only for AWS actions, and its credentialed job targets the proposed owner-protected environment. Actual repository/environment controls still need owner configuration and readback; the workflow file alone does not establish them. Offline build/readiness work occurs before AWS credentials. Build tools cannot mint an OIDC token; the credentialed job installs no npm packages and compares independent reproducible builds. Actions are pinned. Its summary names changes since the last validated successful deployment. The deployed service cannot edit IAM or budgets.

The source packet's owner/privacy rule changes were intentionally not applied. `handoff/explain/OWNER-RULES.patch` is an owner-review proposal. The owner must adopt that narrow hosted exception and protected paths before merging this service PR; deployment readiness also enforces actual policy adoption. CODEOWNERS path documentation alone is not GitHub branch protection. Repository/environment settings need owner readback before release.

GitHub cannot distinguish owner and agent clicks or API calls under the same identity. The same-owner start/approve rule is procedural, not a credential fence. Workflow `GITHUB_TOKEN` permissions constrain the minted job token, not the owner's separate browser, CLI or API credentials; those could dispatch or approve if their grants permit it. **Prevent self-review** would also block Brad starting and approving as that same identity. Brad must decide this boundary versus a distinct reviewer identity before setup. No token, account, repository or environment settings changed here; Brad remains the authorized starter/approver under the adopted arrangement. A compromised build dependency could affect both reproducible builds; reproducibility does not prove a dependency benign. The Explain lock overrides the inherited source-map-js advisory to the patched version; no runtime dependency is bundled.

## T9. Evaluation privilege bypass

Authenticated smoke/evaluation calls require IAM-authorized direct Lambda invocation, an exact event shape and a temporary evaluation key. They preserve the engine, input, retention and money gates. Public API callers cannot obtain raw evaluation answers. Only owner-approved synthetic questions belong in this path; artifact access is inherited, not guaranteed private. Evaluation retains provider text at most 4,000 characters with the full original length and explicit clipping flag. Clipped, missing or inconsistent evidence cannot pass quality review even if the checked public answer succeeded; no unlimited raw storage is required. Recognized reasoning is discarded. Cleanup attempts to restore the prior switch and clear the key; failed cleanup makes the run red and requires an owner pause. Cancellation or runner loss can interrupt that cleanup, and the key has no automatic expiry. The owner must verify recovery after such a failure. No key is printed or committed.

The offline dry runner uses the in-memory AWS stub and cannot reach the real transport. Real evaluation is only in Brad's attended sitting, with his yes, using the same cap-backed handler. The separate Model Check harness has a separately approved question set and no Explain system prompt; it is not this evaluation.

## T10. Stale rules or settings

Requests identify the rules version; the service carries the current and previous release and refuses others. The future site must hide Explain for unsupported versions. Runtime retention/logging rechecks fail closed. A model switch requires pausing Explain, verifying/evaluating that entry, publishing matching consent/privacy/configuration, then resuming; changing a stack parameter is not permission to misstate the processor to visitors.

## Evidence still required before release

- Exact US profile/account availability and destination confirmation in the console.
- Finite input/framing and total billed-output bounds plus exact Converse reasoning accounting for every used model; all three currently remain blocked, including Sonnet despite its native bound.
- Default-model success with regional retention `none` in every approved destination, source logging off and exact setup IAM; no blanket provider-retention assurance before exact-model compatibility evidence.
- Owner source-policy exception/protected paths before merge; shared-identity approval decision before setup; actual branch/environment readback and emergency-stop drill.
- Current prices and credit coverage; the current balance is not a spending control.
- Human approval/freeze of the draft corpus and executable thresholds, followed by real same-set evaluation and Claude's independent verdict on the final combined candidate. Neither local checks nor stub success are that verdict.
- Future site consent, privacy/security policy and plain-text rendering checks.

Nothing in this draft authorizes AWS changes, a live invocation, merging, deployment or publishing the Explain button.
