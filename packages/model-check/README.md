# Model Check — offline draft

This package prepares a separate Model Check harness: every requested model receives the same approved questions, with one user message and no system prompt. Its only adapter replays explicit local JSON fixtures. It never loads an adapter module, reads credentials, imports an AWS SDK, or makes a network call. Every mode other than `offline` is refused.

The result is a private local plumbing record, not an evaluation of a real provider. Actual cost is always $0. The fake ledger uses the existing $25 monthly and $2.50 daily limits to rehearse admission, reservation, settlement and stops. It is in memory, starts with explicitly supplied simulation state, and has no connection to the real shared accounting ledger. It cannot enforce an account spending limit or authorize a paid run.

## Inputs and approval

All run inputs are explicit: reviewed registry, ordered model IDs, question document, replay fixtures and a new absolute artifact directory. There is no default model or output location, retry, fallback, next-day continuation or cap adjustment. Selecting a model absent from the registry, or with unverified low-effort settings, refuses the entire startup. In the current Explain source, Sol's settings are unverified; it must remain an explicit blocked comparison, not a silent omission. Accounting blocks remain intact even when a ready setting is used with a stub.

The source of model IDs, routes, prices, limits, settings and evidence is the single Explain table at `packages/explain/src/models.ts`, in the official `biasclear/biasclear` repository. This main-based draft does not import missing Explain code or maintain an independent model list. `scripts/import-registry.mjs` parses that marked JSON table from an explicitly supplied source file without executing TypeScript. It produces an envelope containing the full table, source commit, source-file SHA-256 and canonical table SHA-256. The original reviewed source at `19eebb338ad5676075c4ab5a971eec6d379ef1bc` has SHA-256 `b7d4cd785fad2ab611eb1089fd1ad81223bb07887b01e4eabeedfa0531f58ae0`. These values were checked against the local Git object. This is source lineage, not fresh provider or account verification. Future integration may wrap the direct output of `infra/aws/model-table.mjs`'s `modelTable()` in the same envelope; it must preserve that exact source provenance.

`NEUTRAL_SET` in `src/contracts.mjs` is the only built-in approval exception. Its digest binds its exact text, IDs and order. Any other set needs an explicit owner receipt bound to the question-set hash, complete registry hash, ordered selected models and scan domain. A local receipt preserves an approval reference; the program cannot authenticate the human author or verify that outside record. Operators must supply a receipt from actual owner approval. The harness does not create one.

The original October 7 question document, design, question Markdown and manifest are archived byte-for-byte in `drafts/`. They retain **unapproved** status, their original SHA-256 values and the unresolved instruction ending. They have not been run, including against a stub. `importQuestionDraft()` verifies source bytes against the supplied object, checks the original question fingerprint (`SHA-256(JSON.stringify(document.questions))` in original property order), and makes a lossless bridge retaining axis, position, kind and the full source document. Its new canonical set hash is distinct from the archived file-byte hash and original question-array fingerprint. None of those hashes is approval.

## Offline CLI

Build the existing engine first with its existing development dependencies. This package adds no dependency.

```sh
node packages/engine/scripts/build.mjs
node packages/model-check/cli.mjs --registry /absolute/reviewed-registry.json --models us.fixture.alpha,us.fixture.beta --questions /absolute/neutral-fixtures.json --fixtures /absolute/replay.json --artifacts /absolute/new-private-directory
```

The IDs above are explicitly synthetic examples, not provider identifiers or a ready-made run. The CLI writes no question or answer text to stdout. On failure it prints only a fixed error code. A non-neutral run additionally requires `--approval /absolute/owner-receipt.json`. The artifact directory's parent must already exist; an existing directory is refused before invocation, and files use exclusive creation. Partial output from a storage failure is left in that chosen directory for inspection, never overwritten or retried automatically.

Each fixture file has `{ "schema": 1, "kind": "offline-replay-fixtures", "replies": { modelId: { questionId: reply } } }`. A reply uses Converse's `output.message.role: "assistant"`, `output.message.content`, `stopReason` and optional `usage` shape. Fixture data can instead supply `{ "fixtureError": "timeout" }` to rehearse a fixed failure. Neither case invokes a provider. Every built-in replay invocation first checks its fresh fake reservation. Arbitrary callbacks and lookalike adapter tags are refused.

## Records and interpretation

The chosen directory receives `run.json` and per-model JSON and Markdown. It records exact questions, model IDs, request and response UTC timestamps, elapsed time, immutable request settings, route, registry and question hashes, original final text blocks, usage status, simulated accounting, and the engine's base revision, compiled-bundle hash, rule-pack version/hash and domain. The engine revision is local source/build lineage; no remote installation or independently verified provider fingerprint is implied.

Final text is never trimmed, rewritten, normalized, silently joined or truncated. Blocks retain their original indices and are scanned separately. Private reasoning blocks are excluded. Every mark contains the engine's rule ID, name, UTF-16 start/end and quoted span; the code verifies that the saved block slices to that quote. Oversized text is preserved with `scan-too-long`. Refusal-like, empty, malformed, truncated, failed, unknown-usage and unscanned results remain visibly incomplete. The refusal label is a heuristic for review, not a complete classifier. Zero structural marks do not establish truth, neutrality, factual quality, or a winning model.

Usage estimates remain synthetic. Missing, malformed or unrecognized usage fields retain the fake reservation and stop later invocations. Numeric unrecognized usage is preserved separately as unverified reported metadata. Provider reasoning accounting and input-bound evidence from the registry remain visibly unknown; fixture arithmetic never overwrites them.

The Markdown comparison table shows JSON representations with escaped Markdown/HTML syntax and bidi controls inside code spans, which also suppress URL autolinking. Detailed exact text is shown as a JSON string inside a fence longer than any returned fence. JSON retains the original text. Do not turn outputs into public benchmark claims or publish them without the owner's separate direction.

Run this package's tests with `npm test` from its directory after the existing engine dependencies are available. Tests use only the fixed neutral unit questions. [Method and future live boundary](docs/METHOD-DRAFT.md) explains the remaining integration.
