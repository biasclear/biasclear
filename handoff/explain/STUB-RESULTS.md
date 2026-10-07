# Explain offline evaluation rehearsal

Actual spend: $0. All operations used in-memory AWS/model stubs. Times, tokens, costs and answers are synthetic.
Model quality is unmeasured. Nothing is approved to ship. The real matched-pair, injection and rewrite review remains a separate owner-approved sitting under the cap.

Fixture SHA-256: ead45b914609c9ff8720f8efc2e86189996601ffbfe534e34e657391e668bd59

## Grok 4.7

Route: us.xai.grok-4.7. Live configuration blocked: yes.

| Part | Planned | Ran | Answered | Refusal-like | Preflight rejected | Output rejected | Simulated cost USD | Simulated time ms |
|---|---|---|---|---|---|---|---|---|
| a | 365 | 365 | 365 | 0 | 0 | 0 | 0.27302 | 365 |
| b | 365 | 365 | 365 | 0 | 0 | 0 | 0.27302 | 365 |
| i | 63 | 63 | 42 | 0 | 3 | 18 | 0.04488 | 60 |
| r | 18 | 18 | 18 | 0 | 0 | 0 | 0.013464 | 18 |

Stub verdict probes rejected: 9/9. Unsafe stub rewrites dropped: 6/6. Safe stub rewrites kept: 12/12.
Synthetic wiring checks: pass. This is not a model pass.

## Claude Sonnet 5.5

Route: us.anthropic.claude-sonnet-5-5. Live configuration blocked: no.

| Part | Planned | Ran | Answered | Refusal-like | Preflight rejected | Output rejected | Simulated cost USD | Simulated time ms |
|---|---|---|---|---|---|---|---|---|
| a | 365 | 365 | 365 | 0 | 0 | 0 | 0.4015 | 365 |
| b | 365 | 365 | 365 | 0 | 0 | 0 | 0.4015 | 365 |
| i | 63 | 63 | 42 | 0 | 3 | 18 | 0.066 | 60 |
| r | 18 | 18 | 18 | 0 | 0 | 0 | 0.0198 | 18 |

Stub verdict probes rejected: 9/9. Unsafe stub rewrites dropped: 6/6. Safe stub rewrites kept: 12/12.
Synthetic wiring checks: pass. This is not a model pass.

## GPT-6.1 Sol

Route: us.openai.gpt-6.1-sol. Live configuration blocked: yes.

| Part | Planned | Ran | Answered | Refusal-like | Preflight rejected | Output rejected | Simulated cost USD | Simulated time ms |
|---|---|---|---|---|---|---|---|---|
| a | 365 | 365 | 365 | 0 | 0 | 0 | 0.4015 | 365 |
| b | 365 | 365 | 365 | 0 | 0 | 0 | 0.4015 | 365 |
| i | 63 | 63 | 42 | 0 | 3 | 18 | 0.066 | 60 |
| r | 18 | 18 | 18 | 0 | 0 | 0 | 0.0198 | 18 |

Stub verdict probes rejected: 9/9. Unsafe stub rewrites dropped: 6/6. Safe stub rewrites kept: 12/12.
Synthetic wiring checks: pass. This is not a model pass.
