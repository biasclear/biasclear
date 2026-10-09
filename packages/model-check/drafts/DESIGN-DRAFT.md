# ModelCheck — design draft, not an approved run

Prepared 2026-10-07 after the Explain draft PR was opened. No AWS change,
model call, stub answer, deployment, credential, or new API route is part of
this preparation. The owner instruction is incomplete after “in a table per
model and”; this draft specifies only the known request and preserves that
open boundary.

## Purpose and limits

Ask each reviewed model the same owner-approved questions and run the same
BiasClear engine on its final answers. Keep each raw final answer beside its
findings and quoted spans in a table for that model. This examines how the
models phrase answers to matched opposing positions and plain controls.

A detector count is not a truth score, factual accuracy score, political
alignment score, or ranking of models. A refusal, shorter answer, truncated
answer, or unscanned answer must never appear as a successful zero. This
small set is exploratory and cannot establish neutrality across all subjects.

## Reviewed model snapshot

Refreshed from `packages/explain/src/models.ts` at Explain draft head
`19eebb338ad5676075c4ab5a971eec6d379ef1bc` on 2026-10-07. This document is a
code snapshot, not a new account-access, pricing, retention, or routing
verification. Re-read the reviewed table before the approved sitting.

| Display name | Exact reviewed invocation ID | Route | Per-model setting in the reviewed table | Current live limitation |
|---|---|---|---|---|
| Grok 4.7 | `us.xai.grok-4.7` | US cross-region profile from `us-east-1` | `reasoning_effort: low` | Input-framing bound, total billed-token bound and Converse reasoning accounting remain unverified; live startup is blocked. |
| Claude Sonnet 5.5 | `us.anthropic.claude-sonnet-5-5` | US cross-region profile from `us-east-1` | adaptive thinking; output effort low | The native total output bound is documented, but input-framing bounds and Converse reasoning accounting remain unverified; live startup is blocked. |
| GPT-6.1 Sol | `us.openai.gpt-6.1-sol` | US cross-region profile from `us-east-1` | No unverified provider setting is sent. | Lowest reasoning setting, input-framing bound, total billed-token bound and Converse reasoning accounting remain unverified; live startup is blocked. |

The table lists Virginia (`us-east-1`), Ohio (`us-east-2`), and Oregon
(`us-west-2`) as possible processing destinations. It does not promise that
a particular call stays in Virginia. Do not widen routes or choose another
model to work around a block.

## Exact inputs and logical settings

Each call contains one user message holding the exact approved question and
starts with no conversation history. Omit the `system` field entirely.
Omit tools, tool configuration, search, web access, grounding, prompt-cache
directives, and retrieval attachments. A no-system request is distinct from
an empty or hidden neutrality prompt.

Use the same logical visible-output limit and the lowest documented
reasoning effort each provider supports. Pin and record the actual request
settings for each model. Different provider parameter names are permitted;
an unsupported or unknown mapping is a blocked comparison, not equivalent
settings. The current reviewed visible limit is 400 tokens. Whether that
limit gives enough final-answer room for these questions is an owner-review
item; no different limit is adopted by this draft.

Do not add temperature, sampling, or reasoning settings merely because
another model offers them. An unknown provider default remains visibly
unknown. Exact settings are part of the run record; identical logical
settings do not imply identical internal computation or behavior.

## Reuse the safe components without changing Explain

Keep ModelCheck in a separate package or internal operator command and a
separate draft PR. Do not add a ModelCheck option to the public Explain
handler, reuse its public route to carry arbitrary questions, or relax its
one-marked-sentence input limit or fixed prompt.

Reusable components are the reviewed model registry, signed Converse
transport, privacy-settings reader, pure spend calculations, shared ledger
reservation and settlement, and the deterministic engine. A separate pure
request builder must omit `system` and all optional tool/search fields.
Explain retains its existing request builder and response validation.

The operator-only execution path must reserve the documented worst-case
input, final-output, and reasoning charge before every call. It uses the
same persistent month/day counters across models, not a new meter per run.
No direct transport invocation may bypass that reservation. Missing usage
retains the full reservation; no automatic retries, model fallback, cap
increase, or next-day continuation is allowed. Budget deny actions and
logging/retention checks remain effective. Unknown billed bounds or any
retention mode requiring review stop the run.

The existing $25 safety limit is retained unless Brad makes a new specific
decision. Available account credit does not authorize consuming it. Actual
pricing, the run's worst-case cost, available headroom, and the exact
question/model/settings fingerprint must be shown before paid-run approval.
No run is authorized by this draft or by the earlier Explain approval.

## Preserve answers and scan evidence

For each question/model call, record the exact invocation ID, UTC request
and response timestamps, question ID and exact question, request settings,
route, completion status, final text blocks in their original order,
provider-reported usage, reservation, settlement, and duration. Store only
final-answer text; never store private reasoning, authorization headers,
credentials, or provider error bodies. Fixed error codes are sufficient.

Do not rewrite, strip disclaimers from, normalize, or fact-correct a raw
final answer before preserving it. If there are multiple final text blocks,
preserve them separately. Scan each original block and record its block
index so offsets point back to the exact text; do not silently insert
characters and then label the result raw.

Pin the engine revision, rule-pack version and hash, scan domain, and span
coordinate convention. Prefer the same existing engine and domain for every
answer. Show each finding's rule ID, move name, start, end, and exact quoted
span. The current TypeScript engine uses UTF-16 string offsets. If output
exceeds the engine's supported input limit, stop that scan and label it
incomplete; do not truncate and present the partial result as complete.

Per-model table fields already requested:

| Question ID / position | Raw final answer | Engine findings and exact spans | Scan / response status |
|---|---|---|---|

The exact model ID, date, settings, route, and engine/rules fingerprint are
the table's metadata. Usage and ledger evidence remain in the private run
record. No answer or findings are populated in this draft. Additional
outputs or combined statistics await the owner's missing sentence ending.

## Controls before a future run

The future implementation should verify that the reviewed question IDs and
pair structures are unchanged, every model receives identical question
bytes, the request has no system/tools/search fields, every model call has
a fresh reservation, and answer spans round-trip to the saved raw text.
Its implementation tests may use neutral synthetic transport fixtures, but
the draft question list itself is not executed even against a stub before
Brad approves it.

The first paid run is proposed as one fresh answer per approved question per
model. The same list is used for each model. Model order should be
interleaved or otherwise fixed and recorded before running; a missing case
or failed model remains missing, rather than being replaced with another
model's answer. No model is declared the winner automatically.

## Decisions still needed

- Brad's approval of the exact question list and the completion of the
  instruction ending “in a table per model and”.
- Model-specific input-framing bounds and Converse reasoning accounting for
  all three models; Grok/Sol total billed-token bounds and Sol reasoning settings.
  All three live entries are currently blocked, not just Grok and Sol.
- Approval of the visible output limit, run repetitions, and spending
  ceiling after the complete worst-case estimate is available.
- The private run-record destination and any later sharing/publication
  request. Preparing local drafts does not authorize publication.
