# Explain evaluation

This evaluates the bounded Explain feature: one engine-verified marked
sentence, the fixed prompt, and no search or tools. It does not implement
ModelCheck or compare how much each model knows.

`fixtures.json` is one reviewed set for every model in `src/models.ts`.
It retains the original matched pairs and injection cases, adds controversial
matched pairs covering every listed side family, and adds claim-preservation
cases for subject/object order, pronouns, negation scope, temporal order,
and prepositions. The planner produces the count from the file.

## Offline rehearsal (no credentials, no spend)

From `packages/explain`:

```sh
npm run gen
node eval/build-dry-run.mjs
node dist/eval-dry-run.mjs
```

The rehearsal uses the handler's real validation, spend reservations and
settlement against in-memory AWS/model stubs. All models use the same
fixture hash and requests. The stub deliberately attempts quoted injected
verdicts and meaning-changing rewrites. Its outputs, token counts, ledger
costs and one-millisecond times are synthetic. The command blocks the
network primitive and reports network attempts; it uses no real transport,
account setting, credential or model. It writes a results table per model to
`dist/eval-dry-run.md` and the complete per-answer data to
`dist/eval-dry-run.json`.

A successful rehearsal proves the wiring and counterexamples were exercised.
It does not prove any model is accurate, even-handed, injection-resistant,
or ready to ship. Unverified live model settings remain blocked.

## Real evaluation (owner's later sitting only)

Use the existing authenticated function evaluation event and the setup
stack's selected model. Never call Bedrock directly from an evaluation
script. The handler re-checks the mark and the account's privacy settings,
reserves against the shared month/day caps before every call, and makes no
retry. Repeat the exact same planned set for each owner-selected model;
changing the selector requires the owner's authorization. The persistent
ledger counts all models' charges together. A cap, expired session, missing
case, duplicate case or mismatched model label makes a run incomplete or
invalid. Do not increase limits, retry, or choose a fallback automatically.

Report each run with its selected profile ID:

```sh
node dist/ops.mjs report --model SELECTED_PROFILE_ID --fixtures eval/fixtures.json --requests dist/eval-requests.jsonl --raw eval-raw.jsonl --out eval-results.json
```

The report includes each answer's usage-derived cost and handler duration,
answer/refusal-like counts on both sides, word differences, raw injection
replies and protected-text rewrite failures. Refusal-like detection is a
text screen, not a complete refusal classifier. Word differences alone
are not proof of bias. The red team must read the actual paired answers,
injection replies and claim meaning. Release stays blocked until that human
review is complete. Report a failure's numbers to Brad and Claude; do not
change the selected model.

Live Grok and Sol runs must wait for their documented billed-reasoning bounds
and settings, if the model table marks them blocked. Never treat the stub's
known output bound as evidence for a real model.
