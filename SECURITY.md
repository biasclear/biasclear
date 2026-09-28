# Security

BiasClear is a rule pack, two small engines that run it (Python and TypeScript), and a static website that runs the rules in the visitor's browser. There is no server, no account and no stored user data. Reports are welcome all the same.

## Report a problem

Please report it privately, not in a public issue:

- through GitHub's private vulnerability reporting: **Report a vulnerability** on the repository's **Security** tab;
- or by mail to hello@biasclear.com.

Say what you found, how to reproduce it and what it affects.

## What counts

- **The engines and the rule pack** (`src/biasclear/`, `packages/engine/`, `rules/`): a crash, a side effect (a network call, a written file), or input that makes a pattern take far too long (ReDoS). `packages/engine/test/redos.test.ts` and `tests/test_engine.py` guard against the last.
- **The website** (`site/`, `scripts/build-site.mjs`): anything that lets a page send a visitor's text anywhere, load a file from another site, or run code it did not ship. Every page's security policy is set in `scripts/build-site.mjs` and checked by `site/test/site.test.mjs`.
- **The workflows** (`.github/workflows/`): anything that could publish a site or a package that did not come from reviewed code.

The retired v1 code will be kept at the tag `v1-final`, added after the first version of this repository is published, for reference only. It is not maintained.
