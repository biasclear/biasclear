# Threat model: Explain (Mode C)

Code-only draft, 2026-10-07. Explain is optional: a future visitor consent flow sends one marked sentence to the service, which re-checks the mark and requests a checked explanation through Bedrock Converse. The current website is unchanged and sends no visitor text. Grok 4.7 is the default; Claude Sonnet 5.5 and GPT-6.1 Sol are reviewed alternatives, never automatic fallbacks.

Scope: `packages/explain/`, `infra/aws/`, the manual Explain workflow, and the future site contract. The rule engine itself is unchanged. Current model provenance and unresolved evidence are in [`MODEL-SOURCES.md`](../handoff/explain/MODEL-SOURCES.md); actual local results are in [`VALIDATION.md`](../handoff/explain/VALIDATION.md).

## Assets and boundaries

Protect the visitor's sentence and network address, bounded model spending, even-handed analysis, and narrow AWS permissions. Attackers include public callers, hostile pasted text, compromised dependencies, a bad code change, and a compromised owner session. AWS and the selected model provider are external processors governed by the verified route, settings and terms.

The boundaries are browser → API Gateway → Lambda; Lambda → Bedrock/counters/fixed logs; GitHub Actions → owner-approved AWS role; and AWS Budgets → one pre-created deny policy. CORS is a browser courtesy, not authentication. Agents can act through the owner's account, so GitHub cannot identify an agent click as different from the owner's click.

## T1. A free chatbot or arbitrary model endpoint

The request has exactly seven fixed keys, at most 4,096 bytes, and one sentence of at most 500 characters. The server re-runs the bundled engine and requires the requested rule at the requested span in the requested domain. Move names and descriptions come from reviewed server data. Neither the caller nor the model selects a model, route, price, tool or prompt. Converse sends the fixed Explain system prompt and one marked sentence; no chat history, search, X access, grounding or tools. Tests inspect the wire body.

The answer is short checked plain text, not arbitrary model output. Private evaluation keeps the same spend reservations and input/output gates, while bypassing only public per-connection fairness limits. A sentence with a real trigger can still pass; that is the intended feature, not proof that its claim is sound.

## T2. Draining the account

A call must first reserve money in the persistent monthly and daily counters, with atomic conditional updates. Rates come from the selected reviewed table entry. Credits do not enlarge the allowance. Defaults remain $25/month and $2.50/day; no relaxation has been authorized. Counters belong to the setup stack, so service redeployment cannot reset them. Every billed output token, including reasoning, must be counted.

**A hard cap needs a verified total billed-token bound.** Grok's visible output limit is not assumed to bound its reasoning. Grok and Sol currently refuse paid startup while their required billing/settings evidence is unresolved. A measured smoke-test maximum is not a general bound. Stub tests exercise the reservation/settlement behavior with explicitly synthetic bounded configurations; they do not remove these gates.

Storage failure before reservation means no model call. Unknown billing, a timeout or failed settlement keeps the full reservation. There are no model retries. The runtime records an overrun rather than hiding it. Official source price verification stops a deploy on mismatch or an unreadable source.

Backstops are the HTTP API throttle, limited DynamoDB throughput, an owner emergency pause, and setup-owned AWS Budget actions attaching a deny-Bedrock policy. Budget billing updates lag; they cannot guarantee a dollar-exact cap. API Gateway, Lambda, counters and fixed logs have separate charges and no hard total-account stop. Do not describe a model spending cap as a guaranteed total AWS bill.

## T3. Shared-service exhaustion

One caller can fill the shared API throttle and cause busy responses for others. Per-connection limits run behind that throttle and cannot prevent this. The checker still works without Explain. This is a deployment trade-off for owner review; it is not an already accepted risk merely because an earlier recommendation said so.

## T4. Prompt injection

The prompt treats the marked sentence as data and escapes its delimiter characters. Hidden control/bidirectional text is refused. One-sentence validation prevents a caller from appending a second instruction sentence, but an injection can still fit inside a valid single sentence.

The server checks shape, lengths, plain text, quotations, wording clauses, source echoes, verdicts, names, side labels and motives. Finding a verdict in the source does not authorize repeating it as the answer's own claim. Direct regressions cover the known obedient-answer bypasses. A recognized Converse reasoning block is discarded from the public answer, while its billed usage remains counted; tool or unknown content blocks fail closed.

These are deterministic pattern checks, not semantic proof. An unlisted instruction-following answer could pass them. The same-set injection evaluation and Claude's independent reading remain release gates. A failure blocks shipping and becomes a regression; it never triggers an automatic model switch.

## T5. Slant or a changed claim

Every model uses the same prompt and output checks. Side-word families are checked symmetrically, including reviewed inflections, punctuation, hyphens and possessives. Tests run paired forms in both directions.

A rewrite must preserve the unmarked text and order, apart from defined whitespace and initial-case normalization, and replace marked wording only with a reviewed neutral template. Unsupported or ambiguous replacements produce `plainer: null`. Existing name, negation, certainty and content checks remain additional screens. This deliberately drops some useful rewrites; it does not prove that every accepted sentence preserves meaning.

The fixed evaluation includes matched pairs, controversial wording from opposite sides, refusals, injections and claim-preservation cases. Reports expose actual accepted/rejected answers and per-model cost/time. Human review is mandatory. Stub results always say release approval is false. Real Grok failures in even-handedness, injections or reversals must be reported to Brad and Claude; no automatic fallback or disabling rewrites to obtain a pass.

## T6. Text or addresses in storage/logs

Only one fixed-field logger writes application logs. Raw request text, model replies, error messages and stacks cannot be log fields. Canary tests capture console/output paths. The application stores counters under a daily salted HMAC, never the address or visitor text. Salts expire after two days; explicit deletion and DynamoDB TTL have the deletion delays stated in the site contract. No backups, streams or point-in-time recovery preserve them.

Invocation logging, tracing and access logs must be off. The account retention mode must be `none`, before deployment and in periodic runtime reads; an unreadable or changed setting pauses Explain. Compatibility is unproven until the owner-approved default-model smoke test. If Grok requires review retention, stop and report; never relax the setting.

For source `us-east-1`, the official cards document US-profile processing in `us-east-1`, `us-east-2` and `us-west-2` (N. Virginia, Ohio, Oregon). Base IDs were copied from the signed-in console; account-console profile confirmation is still outstanding. The future privacy copy names the selected maker and these locations. No global profile is authorized. AWS sees connection addresses as host. While a salt remains, a sufficiently privileged reader could test candidate IPv4 addresses against it.

## T7. Script or markup in an answer

The server refuses links, email addresses, markup and invisible/control characters. It returns JSON with defensive response headers. The future site must render checked fields with `textContent`, never HTML, and verify the response shape. That site implementation is outside this PR and cannot be described as already verified.

## T8. An unsafe deployment

All IAM lives in the owner-created setup stack. Exact profile ARNs and destination foundation-model ARNs are derived from the single reviewed table; foundation-model calls require the matching inference-profile condition. There is no general model allow or streaming/tool grant. Readiness checks reject an unreviewed selector or unresolved billing/settings metadata.

The workflow is manual, main-only for AWS actions, and waits in the owner's protected environment. Offline build/readiness work occurs before AWS credentials. Build tools cannot mint an OIDC token; the credentialed job installs no npm packages and compares independent reproducible builds. Actions are pinned. Its summary names changes since the last validated successful deployment. The deployed service cannot edit IAM or budgets.

The source packet's owner/privacy rule changes were intentionally not applied. `handoff/explain/OWNER-RULES.patch` is an owner-review proposal. Deployment must fail until the actual repository owner rules protect Explain, infrastructure, bundled engine code and future sending controls and permit the narrow hosted exception. CODEOWNERS path documentation alone is not GitHub branch protection. Repository/environment settings also need owner readback before release.

GitHub still cannot distinguish owner and agent clicks. Brad starts and approves the actual run himself. A compromised build dependency could affect both reproducible builds; reproducibility does not prove a dependency benign. The Explain lock overrides the inherited source-map-js advisory to the patched version; no runtime dependency is bundled.

## T9. Evaluation privilege bypass

Private smoke/evaluation calls require IAM-authorized direct Lambda invocation, an exact event shape and a temporary evaluation key. They preserve the engine, input, retention and money gates. Public API callers cannot obtain raw evaluation answers. Cleanup attempts to restore the prior switch and clear the key; failed cleanup makes the run red and requires an owner pause. Cancellation or runner loss can interrupt that cleanup, and the key has no automatic expiry. The owner must verify recovery after such a failure. No key is printed or committed.

The offline dry runner uses the in-memory AWS stub and cannot reach the real transport. Real evaluation is only in Brad's attended sitting, with his yes, using the same cap-backed handler. The separate Model Check harness has a separately approved question set and no Explain system prompt; it is not this evaluation.

## T10. Stale rules or settings

Requests identify the rules version; the service carries the current and previous release and refuses others. The future site must hide Explain for unsupported versions. Runtime retention/logging rechecks fail closed. A model switch requires pausing Explain, verifying/evaluating that entry, publishing matching consent/privacy/configuration, then resuming; changing a stack parameter is not permission to misstate the processor to visitors.

## Evidence still required before release

- Exact US profile/account availability and destination confirmation in the console.
- Grok total billed-token bound, Sol lowest-effort settings and total bound.
- Default-model success with retention `none`, logging off and exact setup IAM.
- Owner-rule adoption, branch/environment controls and the emergency-stop drill.
- Current prices and credit coverage; the current balance is not a spending control.
- Real same-set model evaluation and Claude's independent red-team verdict.
- Future site consent, privacy/security policy and plain-text rendering checks.

Nothing in this draft authorizes AWS changes, a live invocation, merging, deployment or publishing the Explain button.
