# Explain: the site's side (UI contract)

This is what the website must do when it gets the Explain button. **Nothing in `site/` changes in this branch.** The site work is its own ticket (X3 in the spec), and switching Explain on for visitors is another (X5). Both touch protected files, so the owner merges them.

The design this follows is the Explain spec (Mode C), sections 3, 11 and 12. Where this file and the service's code disagree, the code's tests win and this file is fixed.

---

## 1. Off by default

`site/data/explain.json` holds:

```json
{ "api": null, "rules": [], "retention": "none", "model": "grok47" }
```

While `api` is `null`:

- no Explain control is rendered anywhere;
- every page keeps `connect-src 'none'` in its security policy;
- every current site test passes unchanged;
- the page makes no request of any kind, as today.

`rules` lists the rules versions the deployed service accepts. The PM updates it after each approved deploy. `retention` must be `none`, and `model` must equal the approved stack `Model` key. The model table supplies the display name, maker and source-specific destination regions for the consent and privacy drafts. No provider-default or review retention fallback is permitted.

## 2. Switching it on (ticket X5)

The switch-on PR sets `"api": "https://{api-id}.execute-api.us-east-1.amazonaws.com"` (the `ApiUrl` output of the `biasclear-explain` stack, with no path; the deploy workflow never prints it, so the owner reads it on the stack's Outputs tab), the `rules` list and `retention`. In the same PR:

- `scripts/build-site.mjs` builds the security policy per page. **Only the checker page** (`index.html`) gets `connect-src` set to exactly that origin. Every other page keeps `connect-src 'none'`.
- Every public sentence that promises nothing leaves the browser changes (section 9).

Switching back is the same PR in reverse. The service's own kill switch (the `pause` action) is separate and faster.

## 3. When the button appears

The readout of a selected move, and each row of the keyboard move list, get a text button **"Explain this move"**. Its accessible name is "Explain this move: {move name}". It is offered only when all of these hold:

1. `api` is set, and the site's `rules_version` is in `rules`.
2. `Intl.Segmenter` with `granularity: "sentence"` exists.
3. The move lies inside one sentence of the text.
4. That sentence, or when it is longer than 500 characters a window of at most 500 characters around the mark cut at spaces, gives the same rule at the same relative span when scanned by the same engine in the same domain.

Otherwise the row shows: "Explain works on one sentence at a time; this move isn't inside one."

When the site's `rules_version` isn't in `rules`, the button is replaced by: "Explain is catching up with a rules update." Nothing is sent.

Because of check 4, the service's own mark check never surprises a visitor.

## 4. Consent, exactly

The first press in a page visit opens an inline box. It quotes the exact text that will be sent, then shows the consent line derived from the selected reviewed model table entry and verified zero-retention configuration (see section 1):

> Explain sends this sentence, and nothing else you pasted, to BiasClear's service on Amazon Web Services. It asks {model display name}, an AI model made by {maker}, through Amazon Bedrock, how the wording works. Amazon may process it in {locations from the selected reviewed model entry}. We keep no copy. Our Amazon account uses Bedrock's zero data retention setting; Explain pauses if that setting changes.
>
> **[Send this sentence]** **[Not now]** · [How Explain handles text](privacy.html#explain)

The consent line is the one sentence a visitor reads before sending, so it may never promise more than the Privacy page does. The site test checks that the line in the built page matches the mode.

- The choice lasts until the page is closed or reloaded. The site stores nothing (no cookie, no local storage), so a later visit asks again.
- After consent, the button reads "Explain this move (sends this sentence)".
- Escape closes the box. Focus returns to the button.
- The page's request counter counts the request.
- Nothing is sent before **Send this sentence** is pressed.

## 5. The request

One file, `site/js/explain.js`, is the only script allowed to call `fetch`, and only inside the click handler, after consent. `checker.js` stays network-free. The site tests enforce both.

```js
fetch(api + "/v1/explain", {
  method: "POST",
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ v: 1, rules, rule, domain, sentence, start, end }),
});
```

| Field | What it is |
|---|---|
| `v` | The number `1` |
| `rules` | The site's `rules_version` |
| `rule` | The move's rule id, for example `CONSENSUS_AS_EVIDENCE` |
| `domain` | `general` (the site's only domain today) |
| `sentence` | The sentence (or the 500-character window), 1 to 500 characters |
| `start`, `end` | Where the marked words sit in `sentence`, as JavaScript string indices (the engine's own) |

Exactly these keys; the service refuses any other. The body is at most 4,096 bytes. The service refuses control characters other than tab and line breaks, bidirectional override characters (U+202A to U+202E, U+2066 to U+2069) and Unicode tag characters (U+E0000 to U+E007F); the site may simply not offer the button for such a sentence.

The page waits at most 30 seconds, then treats the request as unreachable.

## 6. The answer

Success is `200` with:

```json
{ "v": 1, "rule": "CONSENSUS_AS_EVIDENCE", "how": "…", "plainer": "…", "model": "Grok 4.7", "rules": "2.0.0a3" }
```

`plainer` may be `null` (the service dropped a rewrite that failed its checks, or the build asks for explanations only).

The site checks the response again: exactly these keys, `v` is 1, `rule` is the rule it asked about, `how` is a non-empty string of at most 400 characters, `plainer` is `null` or a string of at most 750 characters, `model` a short string. Anything else is shown as "couldn't be reached".

**Display.** Both fields are rendered with `textContent`, never as HTML.

- Heading **"How the wording works"**, then `how`.
- Heading **"The same sentence, written more plainly"**, then `plainer` inside quotation marks, as a quoted rewrite of the visitor's sentence, not as BiasClear speaking. Omitted when `plainer` is `null`.
- Under both: **"Written by an AI model ({model}). It describes wording; it doesn't judge the claim or the writer. It can be wrong, and it can differ each time you ask."**
- Tier and colour are unchanged. Explain adds no colour meaning.
- While waiting, the button is disabled and reads "Explaining…". The answer is announced in the page's existing live region.

**One answer per mark per visit.** The page keeps each answer in memory, keyed by sentence, rule and span, until the page closes. Pressing Explain again on the same mark shows the same answer with no new request. There is no "ask again" button.

## 7. Errors: what the site says

Every error body is `{ "v": 1, "error": "<code>" }`. Each message is announced in the live region. None of them retries by itself.

| Status and code | When | The site says |
|---|---|---|
| `503 paused` | Switched off; a spend limit reached; an account privacy setting changed; the budget took the model away; a storage fault | **Explain is paused.** The checker works as before; it never needed Explain. |
| `503 busy` | The model was busy | **Explain is busy.** Try again in a minute. |
| `429` with no `error` field (API Gateway's own answer) | The whole service is at its request limit | **Explain is busy.** Try again in a minute. |
| `429 limit` | This connection's 10-minute or daily limit | **You've used Explain a lot from this connection.** Try again later; the limit resets within a day. |
| `409 rules` | The site's rules version isn't one the service carries | **Explain is catching up with a rules update.** Try again later. |
| `502 no_answer` | The model refused, ran out of room, or its answer failed the checks | **No explanation this time.** The move's description above still applies. |
| `400`, `403` or `422 invalid` | A malformed request, a wrong origin, or not a mark. The site never sends these, so one means a bug | **Explain couldn't use this sentence.** |
| Network error, timeout, any other status, or a body the page can't read | Includes a throttled answer that arrives without CORS headers | **Explain couldn't be reached.** The checker still runs on your device. |

## 8. The Privacy page's Explain section

A new section 05 with the id `explain` (Contact becomes 06). The numbers (500, 7 days, two days) must come from the build's shared constants, per the "every number from a script" rule. Only the `none` retention version is allowed. Model name, maker and destinations must come from the reviewed entry selected in the stack and confirmed before release.

> **Explain sends one sentence, only when you ask.**
>
> Explain is the one part of BiasClear that sends anything. It does nothing until you press Explain on a marked move and agree. Then the page sends that sentence (at most 500 characters), which move was marked and where, the domain and rules version, to BiasClear's Explain service on Amazon Web Services. Nothing else you pasted is sent. The service runs the same rules on the sentence to check that the move is really there, then asks {model display name}, an AI model made by {maker}, through Amazon Bedrock, to describe how the wording works. The service calls Amazon from {source location}; its approved US profile may process the sentence in {locations from the selected reviewed model entry}. BiasClear does not request web or X search, grounding or tools. It sends only the one sentence and our fixed wording prompt, with no conversation history or the rest of your text.
>
> We keep no copy of your sentence or of the answer. Our logs keep counts and settings only, such as which move was explained and how many tokens (pieces of words) the model read and wrote, for 7 days. To share Explain fairly, the service counts requests from each connection: it scrambles your network address with a secret that is replaced every day and expires after two days, and it never stores the address itself. The service erases old secrets each day, and Amazon erases any left over within a few days; once a secret is gone, the scrambled code can't be turned back into your address. Each count expires within two days and is erased within a few days after that. Like any web host, Amazon sees your network address when you connect.
>
> Our Amazon account uses Bedrock's "zero data retention" setting. Amazon's applicable handling must be verified for the selected model before this wording is published. Explain pauses if retention or invocation logging changes. If this model requires review retention, Explain will remain off rather than changing that setting.
>
> The checker never needs Explain. If you don't use it, your text stays on your device, and the counter stays at 0.

Links in that section go to AWS's Bedrock "Data protection" and "Data retention" pages. Before the switch-on PR, the red team verifies the selected model's handling and the successful zero-retention smoke test against AWS's current documentation. An unverified or review-retention requirement blocks publishing this draft.

The page's title and headline become **"Your text stays on your device unless you press Explain."** Section 01's policy sentence becomes: "The checker page carries a security policy that lets it connect to one address only, BiasClear's Explain service, and the page's code connects to it only when you press Explain and agree. Every other page connects to nothing."

## 9. Every public promise changes in the switch-on PR

Every sentence that says or implies that text never leaves the device changes in the same PR that sets `api`. This is the full list today (line numbers as of this branch):

| File | Today | After |
|---|---|---|
| `site/pages/index.html:38`, the text box's label | "Paste or type your text. It is read here and goes nowhere." | "Paste or type your text. It is read here, and sent only if you press Explain on a move and agree." |
| `site/pages/index.html:41` and `site/js/checker.js:923`, the note under the box | "Up to … characters. It stays in this tab." | "Up to … characters. It stays in this tab unless you press Explain." |
| `site/pages/index.html:101`, step 1 | "You paste text. It never leaves this tab." | "You paste text. It stays in this tab unless you press Explain on a move." |
| `site/pages/index.html:180`, section 03's heading | "Your text stays in this tab." | "Your text stays in this tab unless you press Explain." |
| `site/pages/index.html:183`, "No uploads." | "The rules run inside this page. What you paste is read here and sent nowhere." | Heading "No uploads unless you ask."; "The rules run inside this page. Nothing you paste is sent, unless you press Explain on a move and agree; then that one sentence is." |
| `site/pages/index.html:188`, "Check it yourself" | "…blocks the usual ways a script sends data (`connect-src 'none'`)… Paste something and watch it stay at 0…" | The policy sentence names the one allowed address, and: "Paste something and watch it stay at 0. It goes up by one only if you press Explain and agree." |
| `site/pages/privacy.html:4`, the title | "Privacy: nothing you type leaves your device" | "Privacy: your text stays on your device unless you press Explain" |
| `site/pages/privacy.html:5`, the description | "BiasClear reads your text inside your browser and sends it nowhere. …" | "BiasClear reads your text inside your browser and sends nothing, unless you press Explain on a move and agree. …" |
| `site/pages/privacy.html:16`, the headline | "Nothing you type leaves your device." | "Your text stays on your device unless you press Explain." |
| `site/pages/privacy.html:18`, the standfirst | "…What you paste is read there and sent nowhere." | "…What you paste is read there, and sent only if you press Explain and agree." |
| `site/pages/privacy.html:28`, section 01's heading | "Read here, kept nowhere." | "Read here, kept nowhere." (unchanged: neither the page nor the service keeps a copy) |
| `site/pages/privacy.html:31`, "The rules run in the page." | "…It is never uploaded, and the page keeps no copy…" | "…It is not uploaded unless you press Explain (section 05), and the page keeps no copy…" |
| `site/pages/privacy.html:32`, "The page does not send it." | "No script on the page sends your text anywhere… (`connect-src 'none'`)…" | Key "The page sends it only if you ask."; section 8's policy sentence |
| `site/pages/privacy.html:58`, the host's logs | "They cannot hold what you paste, because the page never sends it." | "They cannot hold what you paste, because the page never sends it to GitHub." |
| `README.md:7` (protected), under the "Try it" link | "Nothing you type is sent anywhere." | "Nothing you type is sent, unless you press Explain on a move and agree." |
| `README.md:20` (protected) | "The page's code sends nothing… Nothing you type is sent anywhere." | "The page's code sends nothing unless you press Explain on a move and agree; then it sends that one sentence." and a link to the Privacy page's Explain section |
| `site/README.md:3` | "…its code sends nothing anywhere." | "…its code sends nothing except the one sentence a visitor asks Explain about." |
| `SECURITY.md:3` | "There is no server…" | "The checker has no server. The optional Explain feature has one small service on AWS; its design and limits are in `infra/aws/README.md`." |

**The test, which doesn't depend on this list.** Whenever `api` is set, the site test fails the build if the text of any built page or script (tags removed, whitespace collapsed), `README.md`, `site/README.md` or `SECURITY.md` matches (case-insensitive):

```
goes nowhere|sent (nowhere|anywhere)|sends? (it|your text|nothing) (nowhere|anywhere)|code sends nothing(?! unless| except)|stays? in this tab\.|never leaves|leaves your device|never uploaded|never sends it\.|no script on the page sends|there is no server
```

so a promise added later, or missed here, fails too. Every "Today" sentence above matches it, and no "After" sentence does (the site PR's test checks both lists). While `api` is `null`, it fails if any "unless you press Explain" sentence is present. The same test checks the consent line against `retention` (section 4).

## 10. Tests the site PR adds

In both modes (`api: null` and set): the policy on each page (only the checker page names the API), the one `fetch` in `explain.js`, no `fetch` in `checker.js`, the public sentences (section 9's pattern, not a fixed list), the consent line against `retention`, the hidden button when the rules version isn't listed, consent before any request, `textContent` only, one answer per mark per visit, every error state's message, and keyboard use of the consent box (Escape closes it, focus returns).

## 11. Model-specific drafts and switch discipline

These placeholders are draft copy, not text published on the site. The complete per-model consent and privacy drafts are generated from the code table in [`PRIVACY-DRAFTS.md`](../../handoff/explain/PRIVACY-DRAFTS.md). Regenerate with `node packages/explain/scripts/privacy-drafts.mjs --write`; `--check` and the package test refuse stale wording. Unknown regions or routes fail instead of acquiring guessed privacy wording. Account-console confirmation of the exact profile and all processing destinations remains required.

The switch-on site build must bind its privacy and consent to the selected stack entry, never infer the maker from free-form model output. To switch models later: pause visitor Explain; verify and evaluate the chosen entry under the shared cap; generate consent/privacy from that entry; publish the approved matching site configuration; only then resume. Selecting one stack parameter does not authorize running a model the visitor was not told about. Live model switching is not implemented by this code-only PR, and no new field is added to the one-sentence request here.
