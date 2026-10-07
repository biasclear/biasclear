# BiasClear Explain — supplementary public AWS evidence

Checked 2026-10-07. Public documentation and pricing reads only; no AWS account calls, invocations, changes, subscriptions, or terms acceptance. This is **not console-copied evidence** and does not establish Brad's account access. Root's Chrome readback remains the source for console observations.

Latest owner instruction relayed by the lead: use US geographic profiles explicitly; use each model's lowest supported reasoning effort; account retention must be `none`; if the selected model requires review or a less restrictive retention mode, stop without switching models or relaxing policy. Global IDs below are reference evidence, not approved runtime choices.

## Model IDs, routes, and Standard prices

USD per million tokens; input/output. All three support **Converse on bedrock-runtime**. None has direct in-region runtime inference. Mantle alternatives do not provide Converse and cannot satisfy the approved single Converse implementation.

| Display name / maker | Base model ID | US profile ID | Global profile ID | US rates | Global rates |
|---|---|---|---|---|---|
| Grok 4.7 / xAI | `xai.grok-4.7` | `us.xai.grok-4.7` | `global.xai.grok-4.7` | $2.20 / $6.60 | $2.00 / $6.00 |
| Claude Sonnet 5.5 / Anthropic | `anthropic.claude-sonnet-5-5` | `us.anthropic.claude-sonnet-5-5` | `global.anthropic.claude-sonnet-5-5` | $2.20 / $11.00* | $2.00 / $10.00* |
| GPT-6.1 Sol / OpenAI | `openai.gpt-6.1-sol` | `us.openai.gpt-6.1-sol` | `global.openai.gpt-6.1-sol` | $2.20 / $11.00 | $2.00 / $10.00 |

Sources: [Grok card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html), [Sonnet card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html), [Sol card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html). Fresh direct public HTTPS reads superseded stale search-tool copies that incorrectly omitted Sonnet US and Sol global profiles.

*Sonnet pricing is from the official [public AWS Foundation Models us-east-1 offer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/20260930001912/us-east-1/index.json), published 2026-09-30T00:19:12Z. Non-global Standard input SKU `6TG78WT6WYJUVS72` is `2.2000000000`; output `ZNY2E4B6MTPHYXVH` is `11.0000000000`. Global input `PXMCKMF8EGSRB3GB` is `2.0000000000`; output `HP32J6RXJZ3XYFUM` is `10.0000000000`. Each unit is `1M tokens`. Its non-global dimension says Standard, not explicitly “Geo”; pair it with the approved route readback rather than presenting an account quote. See `SONNET55-PUBLIC-PRICE-EXTRACT.json` for exact products/terms and source hash. Public Bedrock HTML and the Sonnet card did not render 5.5 prices.

Sol rates above are short-context Standard (input ≤272K tokens), sufficient for this bounded feature. No cache discounts assumed. Grok has Priority/Flex prices; do not select these silently. Standard is the reviewed pricing basis.

## Where processing occurs

Each fresh card's source-specific US profile table says **a request originating in us-east-1** can route to `us-east-1`, `us-east-2`, or `us-west-2`. Those are N. Virginia, Ohio, and Oregon. Canada is present in separate Canadian **source** rows, not the us-east-1 destination row. Thus an approved US profile invoked only from us-east-1 is not single-region processing; current documented destinations are the three US regions. Global profiles can process outside the US. Do not silently choose either profile.

The cards direct operators to read the profile's current routing configuration from the source region. Signed-in console profile details/account availability were not checked by this helper. A documentation list is not successful access or a future immutable routing guarantee. The lead reports that the signed-in system-defined profile table filtered for Grok showed no resources; do not turn a documentation ID into a claim of account availability.

## Request settings, without invented disabled values

- **Grok:** reasoning is active; supported effort levels are low, medium, high, xhigh, default high. The official [AWS launch article](https://aws.amazon.com/blogs/machine-learning/grok-4-7-is-now-available-on-amazon-bedrock/) gives Converse `additionalModelRequestFields={"reasoning_effort": "xhigh"}` and documents the same levels. Therefore `additionalModelRequestFields: {reasoning_effort: "low"}` is the documented lowest effort. No disabled/off/none value was found. The article warns that reasoning can be the first content block, so extract text blocks rather than indexing block zero.
- **Sonnet:** its card says adaptive thinking defaults to high; low/medium/high/xhigh/max efforts are listed. Fresh AWS [adaptive thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html) explicitly lists Sonnet 5.5 as supported and provides the Converse low-effort structure: `additionalModelRequestFields: {thinking: {type: "adaptive"}, output_config: {effort: "low"}}`. No beta header is required. The `effort` field belongs in `output_config`, not `thinking`. Its explicit disabled guidance names Sonnet 5, not 5.5; do not infer disabled support. The supported model list plus generic Converse example is documentation evidence, not a successful 5.5 call.
- **Sol — unresolved:** the fresh card did not give model-specific reasoning settings. The fresh [OpenAI parameters page](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html) points closed models to their cards but scopes the ensuing request-body mapping to gpt-oss. Focused official-source searches and the [Sol launch article](https://aws.amazon.com/blogs/machine-learning/bring-near-astra-intelligence-to-everyday-work-with-gpt-6-1-sol-on-amazon-bedrock/) supplied no exact closed-model Converse knob. Do not borrow gpt-oss fields, another OpenAI model's card, or first-party API settings. Provider defaults do **not** satisfy the owner's lowest-effort instruction. Keep this alternative unavailable until its exact lowest setting is verified; do not silently switch to it.

Runtime server-side search/tools are unsupported for Grok and Sol in the cards. Regardless of support, code must omit `toolConfig` and all search/grounding fields and test the serialized outgoing request. No tools, images, document blocks, or remote references are needed for this feature.

## Reasoning, usage, and the cost reservation bound

The generic [Converse InferenceConfiguration](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InferenceConfiguration.html) defines `maxTokens` as the maximum generated response tokens. [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html) defines `outputTokens` as tokens generated by the model; it exposes no separate reasoning-token counter. The intended settlement must include every billed output token, including reasoning, rather than estimate output from visible text. Model-specific evidence must establish whether the normalized counter includes reasoning before that arithmetic is treated as verified; do not double count a native detail counter if it is a subset. Never log or store reasoning blocks.

AWS's adaptive-thinking documentation explicitly says Claude `max_tokens` is a hard total-output limit covering thinking and response text, and thinking tokens are billed at the output rate. The Converse example uses common `inferenceConfig.maxTokens`; verify the exact 5.5 mapping during the authorized sitting before live approval.

For Grok and Sol, the sources checked do **not** explicitly establish that Converse `maxTokens` also caps every billed hidden reasoning token. Grok's launch example uses `maxTokens` while reasoning is active, which supports the intended interface but is not an explicit billing guarantee. A post-call usage check cannot repair an insufficient pre-call reservation. The reviewed implementation must preserve this evidence gap as a readiness gate or use a separately verified conservative reservation bound; stub tests cannot prove provider billing semantics. No live calls were made to settle it.

**Contrary Grok evidence, requested follow-up:** fresh first-party xAI [Responses schema](https://docs.x.ai/developers/rest-api-reference/inference/responses.md) says `max_output_tokens` applies only to visible output and excludes reasoning/function-call tokens. Its [Chat Completions schema](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md) says the same for `max_completion_tokens`. Their unset default of 128,000 is a visible-token default, not a total hard maximum. The [Grok 4.7 overview](https://docs.x.ai/developers/grok-4-7) says “No text output limit”; the AWS card supplies no maximum-output field. Its 500,000 context window must not be relabeled a hard output cap. These are native xAI APIs, not proof of Bedrock's internal mapping, but they prevent treating a total reasoning cap as a safe inference. A finite smoke observation cannot establish a universal cap. A documented AWS total-billed bound or another proven finite bound is required before claiming the $25 hard cap.

## Account retention must be none

Fresh AWS [data-retention documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) says `none` means zero data retention and that Bedrock blocks a request when a model requires a more permissive retention mode than the effective policy. There is no automatic policy relaxation. `default` permits model-dependent safety retention; it does not establish zero retention. Request `store: false` alone likewise does not guarantee zero retention.

For bedrock-runtime, the account's source-region configuration is read through [GetAccountDataRetention](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetAccountDataRetention.html), route `GET /data-retention`, IAM action `bedrock:GetAccountDataRetention`; it returns `mode` and `updatedAt`. No read was made against Brad's account by this helper. The docs say there is no console UI for configuration at launch, and the Bedrock control plane does not expose per-model allowed retention modes. Mantle GetModel/ListModels expose a model's `allowed_modes`, but that is separate endpoint evidence rather than proof a US-profile Converse request will succeed.

The Sol launch article says AWS may retain classifier-flagged requests/responses up to 30 days under the default policy and directs customers seeking ZDR to their account team. This does not establish Brad's account status. The account and model must be verified under `none`; if unavailable, stop and report. No put/update action is authorized in this step.

## Scoped IAM and a documentation discrepancy

[Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) requires `bedrock:InvokeModel`. [Geographic routing IAM](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html) requires the exact US profile ARN plus the exact foundation-model ARNs in the source and listed destination regions. Condition the FM statement on the approved `bedrock:InferenceProfileArn`. Use exact IDs from the reviewed table, not model wildcards. [Inference prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-prereq.html) also lists `bedrock:GetInferenceProfile` for profile inference; scope it to those exact profiles. No streaming grant is needed for non-streaming Converse.

[Global routing IAM](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html) instead uses the regional profile, regional FM, and regionless global FM ARN; the latter has `aws:RequestedRegion=unspecified`. Those are additional processing permissions, not a substitute for approving global routing.

**Discrepancy:** the Grok card/article says default-project InvokeModel permission is additionally needed, but [endpoint documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html) and [inference prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-prereq.html) limit that requirement to Responses and explicitly say Converse/Invoke do not require a project resource. Do not claim this is account-verified. If a bounded extra project grant is included pending review, constrain `bedrock:ModelArn` to the exact approved profile ARN list, per [Responses authorization documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html); it must not authorize arbitrary models. SigV4 Converse does not need `bedrock:CallWithBearerToken`.

## Local provenance

Fresh source HTML files are in `/private/tmp/biasclear-{grok-card,sonnet-card,sol-card,bedrock-pricing,adaptive,grok-launch}-primary.html`; offer files are `/private/tmp/biasclear-public-{fm,bedrock}-use1.json`. No account identifiers, credentials, or user text were fetched. Evidence origin remains public documentation/public offer, not console.

Public offer scanning found no Grok 4.7 or GPT-6.1 Sol product/SKU in either Foundation Models us-east-1 (publication 2026-09-30T00:19:12Z) or [Bedrock us-east-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/20261006144726/us-east-1/index.json) (publication 2026-10-06T14:47:26Z). Their rates above come from their exact model cards. Do not borrow adjacent-version SKUs. Sonnet extract SHA256: `fff5b03557b375fbe9f0532a94106f6250b3c3826a54cb3acaf1de39611e89cd`.

Initial model-card SHA256s: Grok `b3c2124f5c30767e04bcc4f85f5001a6f2d7a2048be53e3b4ec51578309369a5`; Sonnet `60275fd3caa9945a76282981e6b78af9ea7d2c41887e0b3fd7f0c4f418f58055`; Sol `64710ddbb871ae3bd5c90f4cdae395da9fe161fb47c865a05e709bc9c99ec1cd`.

## Signed-in Chrome console readback, 2026-10-07

Region label: `United States (N. Virginia)`; console URL source `us-east-1`. Model catalog details copied the base IDs `xai.grok-4.7`, `anthropic.claude-sonnet-5-5`, `openai.gpt-6.1-sol`. Each shows `Cross-region inference`; the Grok popover states `This model can only be used through an inference profile.` No playground, model invocation, model access request, form, subscription or terms action was taken.

Sources are these exact console model-detail URLs:
- https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/model-catalog/serverless/xai.grok-4.7
- https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/model-catalog/serverless/anthropic.claude-sonnet-5-5
- https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/model-catalog/serverless/openai.gpt-6.1-sol

The system-defined inference profile table shows 95 profiles. Filters `Grok 4.7` and `grok` returned `No base models` / `There are currently no resources.` Therefore `us.xai.grok-4.7` has **not** been confirmed in this account console. The model-detail pages show base IDs, not profile IDs or prices. All US-profile IDs and destination strings above came from official AWS cards; none is relabeled as a console confirmation. The linked AWS pricing page rendered empty Anthropic tables, so Sonnet rates use the cited official offer file. The Grok and Sol cards were directly read in Chrome via that pricing route.

The retired Model access page says serverless models are enabled on first invocation and first-time Anthropic users may need use-case details. This does not establish this account's usable access or zero-retention compatibility. These remain explicit sitting gates; no invocation was used as a read-only probe.
