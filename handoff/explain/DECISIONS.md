# Explain (Mode C): what the owner decides

Revision 3, code-only draft, 2026-10-07. Owner decisions D2 and D3 supersede their earlier recommendations; this is not approval to deploy, spend or change the site. Each item says what the choice is, what I recommend, and why, in plain words. The design these feed is `SPEC.md`, next to this file. Code and draft PR preparation are authorized. D1 and the remaining account/release recommendations are future owner decisions; this file does not authorize them.

Items still labeled Recommend are proposals from the source packet, not adopted decisions. The newest explicit directions below take precedence.

---

**D1. Change the privacy promise so Explain is allowed.**
Today the rules say your visitors' text never leaves their browser, and that a hosted AI mode needs that rule rewritten first. Explain breaks the old promise for one sentence, and only when a visitor asks. These texts change:

- **The agent rulebook (`AGENTS.md`)** gets this line in place of the hosted-AI sentence: *"The one hosted exception is Explain (Mode C): only after the visitor presses Explain on a marked move and agrees, the page sends that one sentence to BiasClear's Explain service, which keeps no copy. It is labeled at the button and on the Privacy page, and it follows `ops/BLUEPRINT.md` §4 and the Explain spec."*
- **The same file** adds three things to the list of files only you merge: the `explain/` folder (the service's code, its instructions to the AI, and its Amazon setup), and the two site files that decide what the page sends (`site/js/explain.js`, `site/data/explain.json`).
- **The blueprint** is updated to match D2 to D4 (§4 currently names Opus 5.5, a $50 Anthropic limit, and "AWS not needed"), and its line about the GitHub-to-Amazon login (§5) is corrected to say what is really built (D8).
- **Later, in the release that switches Explain on:** every public page that says text never leaves the browser changes in the same step. That is the Privacy page, two places on the home page, the README (which you merge) and the security note. Their new wording is in `SPEC.md` §12.

**Recommend: yes.** The checker itself doesn't change, and still sends nothing. You merge these because they're protected files.

---

**D2. Swappable, default Grok 4.7.**

**Owner decision, Brad, 2026-10-07:** "make it swappable, yet lets start with grok 4.7".

Use Bedrock Converse and one reviewed table for Grok 4.7, Claude Sonnet 5.5 and GPT-6.1 Sol. One allowlisted stack parameter selects the model. No automatic fallback. Each entry names its maker, exact IDs, source and destinations, verified prices, lowest supported reasoning effort and total output-token bound. Grok's reasoning cannot be assumed off; all reasoning must be included in the $25 cap. Its total billed-token bound is currently unverified, so paid startup remains blocked. Grok remains the default; this is not a switch to another model. Sol's lowest-effort mapping is also unresolved.

Grok ships only if the same-set real evaluation passes even-handedness, injection and claim-preservation review. Report failures to Brad and Claude; neither builder switches models on its own. The present evaluation is a stub, with zero spend and no model-quality claim. The real evaluation requires Brad's yes in the AWS sitting.

---

**D3. Swappable, default Grok 4.7, using the US profiles.**

**Owner decision, Brad, 2026-10-07:** "make it swappable, yet lets start with grok 4.7". The later correction says: "Use the US profiles."

The model catalog shows all three base IDs and cross-region inference. Current AWS cards list `us.xai.grok-4.7`, `us.anthropic.claude-sonnet-5-5` and `us.openai.gpt-6.1-sol`. From source `us-east-1`, each card lists `us-east-1` (N. Virginia), `us-east-2` (Ohio) and `us-west-2` (Oregon) as destinations. These are wider than one region. The Canadian-source rows do not authorize changing this service's source to Canada.

Exact profile availability and destinations still need account-console confirmation; the Grok system-defined profile search returned no rows. This draft documents that gap and does not treat a catalog listing as usable access. No global profiles or silent route change. The privacy draft names the selected model and maker and all three approved locations. Any future destination change requires review and corresponding privacy/IAM changes.

---

**D4. The monthly spending cap.**
Explain stops calling the AI model for the rest of the month once the model has cost this much, counted at full price, whatever credits you have. It also stops for the rest of the day once it has spent one tenth of the cap, so one busy or abusive day can't use the whole month.

The cap covers the AI model, which is almost all of the cost. The small Amazon services around it (the web address, the function, the counters, the logs) have no hard stop. At normal use they cost under $1 a month. If someone flooded the service at its full speed for a whole month, they could add about $15 to $20. **So the worst month you should plan for is about $45.** The budget emails in D5 would reach you along the way.

**Working ceiling: $25 a month, with a daily limit of $2.50.** The owner prioritizes preventing a drain of the account's credits. The absolute permitted overrun remains a clarification, not authorization to relax the ceiling. No number of explanations is promised before reasoning usage is measured. Lowering the cap is one run in GitHub. Raising it above $25 is a small reviewed change plus one number in your setup, done together.

---

**D5. A second, automatic stop from Amazon.**
Amazon's budget tool watches the whole AWS account, ignoring credits and including tax. It emails you when the month reaches half of $30 (the cap plus $5 for small running costs), when it reaches $30, and when Amazon forecasts it will pass $30. The forecast email only starts working after a few weeks, once Amazon has some billing history. At $30 it also switches off Explain's access to the AI model by itself, and Explain stays off until someone checks why and switches it back. Amazon's numbers lag by several hours, so this is a safety net, not the main stop.

It can fire for two reasons: our own counter was wrong, or someone flooded the service and ran up the small charges in D4. Either way, a person should look before Explain comes back.

Because the budget watches the whole account, **use this AWS account for Explain only.**

**Recommend: yes, with emails to hello@biasclear.com.**

---

**D6. Limits per visitor, and one risk to accept.**

**Recommend:**
- 10 explanations per 10 minutes, and 50 per day, from one internet connection.
- 2 per second across everyone.

These keep one person or one script from using up everyone's money. To count per connection, the server stores a scrambled code, never the address itself. The code can't be turned back into the address once the day's secret is thrown away, after about two days.

**The risk:** the 2-per-second limit is shared. One script sending 2 requests a second can fill it, and while it does, every other visitor sees "Explain is busy". Amazon's per-visitor shield for this can't be used with this kind of service. The checker keeps working, because it never needs Explain.

**Recommend: accept this risk.** If it ever happens, you can pause Explain (D8) until it stops.

---

**D7. When to switch it on for visitors.**

**Recommend:**
1. Build it now.
2. Test it live with made-up sentences, with the red team reading every answer side by side. Each test sentence is asked five times, because the AI's wording varies a little each time.
3. Switch the button on only **after** the public launch (week of November 16) and after you say yes.

Explain is not part of the launch floor. The checker, Field Guide, Method, Privacy and About don't need it. Switching it on or off for visitors is one reviewed change in the repository, which you merge.

---

**D8. The one-time setup, how you deploy, and what your approval really does.**

The one-time setup is one sitting of about 25 minutes, clicks only:
- check the credit;
- prove the approved default model and retention through the cap-backed service smoke test;
- confirm a logging switch is off, and set Amazon's data-keeping setting (D13);
- upload one setup file to Amazon;
- create one GitHub "environment" with you as the approver;
- run the first deploy;
- press Amazon's emergency stop once and undo it, so you know it works.

A true one-click link isn't possible for the very first step: Amazon requires the file to be stored in Amazon first, and your account has nothing there yet.

After that, **deploying, pausing and resuming are each two clicks in GitHub:**
1. **Run workflow** (choose deploy, pause or resume)
2. **Approve and deploy**

Pausing changes only the on/off switch. It doesn't rebuild or ship anything new, so it works even when other work is half done. Nothing runs by itself: a change merged into the repository waits until you run a deploy. Selecting an already reviewed and verified model is one allowlisted stack parameter. Adding a model or route, changing settings or raising the cap above $25 requires review and any corresponding setup changes.

No key or password is ever shown, copied or stored. GitHub proves who it is to Amazon each time, and only for runs you approve, from the main branch.

**What your approval does and doesn't do, plainly.** Some fences are locks. Amazon itself stops the service from touching any other model, any other data, or its own permissions, whatever its code says. One fence is a promise. Every agent works through your GitHub account, so GitHub can't tell your clicks from theirs. If an agent started a run and you approved it without noticing, code you didn't mean to ship could go live, and that code could mishandle visitors' sentences. The red team reads every change, and you merge every change to the Explain files, but you can't be expected to read code. So there is one rule, and it is the whole of your job here:

> **Approve only a run you started yourself, just now.** If GitHub emails you about a run waiting for approval that you didn't start, don't approve it. Tell the PM.

Each run's page shows, in plain words, what it will do and what changed since the last deploy, above the approve button.

**Recommend: yes.** The PM prepares the setup file with the project's public GitHub numbers already filled in, so the only things you type are the setup's name (`biasclear-explain-setup`) and your 12-digit AWS account number.

---

**D9. Which AWS sign-in you use for the one-time setup.**

**Recommend: your main (root) sign-in, with two-factor on, for the setup sitting only.** After that you only need to sign in to AWS for the emergency stop, or to read the bill.

AWS advises against using the root sign-in for daily work. Making a separate admin identity first would add about 15 minutes of clicks.

---

**D10. The web address of the Explain service.**

- **Amazon's default address** (a long `…execute-api.us-east-1.amazonaws.com` name): works now, no extra steps.
- **A `biasclear.com` address** (for example `explain.biasclear.com`): needs a certificate and a DNS record at Namecheap. That's about 10 minutes of your clicks, plus waiting.

**Recommend: Amazon's default address at first.** It's shown only in the checker page's security policy and on the Privacy page. Move to a biasclear.com address later if you like.

---

**D11. The AWS credit.**
Claude on Amazon is billed as "AWS Marketplace" usage. Most AWS credits don't cover Marketplace. AWS's Activate terms make one exception, for AI models on Amazon Bedrock. I could read that exception only through search results, not the page itself.

**Recommend:**
1. In the setup sitting, open **Billing → Credits** and send the PM a screenshot of the credit's name, expiry date and "applicable products", so we know it really covers Bedrock.
2. The PM adds a reminder one month before the credit expires.

When the credit runs out, Explain keeps working and charges real money, never more than the cap for the model (D4).

---

**D12. The old Render account.**
The blueprint kept Render "for a possible hosted AI mode". Explain uses AWS instead.

**Historical recommendation only; no closure authorized.** The newer continuity record retains Render. No account or billing change is part of this draft.

---

**D13. Zero data retention only.**

**Owner correction, 2026-10-07:** AWS does not establish whether either default candidate works with retention `none`. The first deploy test must prove it for Grok 4.7. If it requires review retention, stop and report to Brad. Do not switch to `default`, review or sharing, and do not silently select another model.

The logging and retention checks remain before deployment and every 15 minutes in the function, failing closed on unreadable or changed settings. Compatibility is unproven in this code-only pass.

---

**D14. The "plainer way to say it" line.**
Each answer has two parts: how the wording works, and the same sentence written more plainly. The second part is harder to get right. A good rewrite keeps who is speaking and how sure the sentence sounds, and changes only the marked words. A bad one could quietly make the claim weaker or stronger, and it would appear on our page.

**Current release condition:** the live evaluation and Claude's review check every rewrite for claim preservation. Any reversal blocks shipping and is reported to Brad and Claude. Do not automatically disable rewrites, switch models or lower the standard to obtain a pass. The server conservatively drops unsupported rewrites; accepted rewrites are shown in quotation marks as the visitor's sentence, never as BiasClear's own claim.

**Scope of today's authorization:** code and a draft Explain PR, then a separate draft Model Check PR. No AWS changes, deployments, secrets, live calls or site edits. Model Check's question set requires approval before any run.
