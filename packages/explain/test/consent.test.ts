// The consent a page showed must name the model that answers (314 M3). A tab opened under Grok's
// consent keeps sending after the owner pauses, publishes Sonnet's consent and resumes; the service
// must refuse it before any table read, spend or model call, so the page can reload and ask again.

import { describe, expect, it } from "vitest";
import { consentFingerprint, MODELS } from "../src/models.js";
import { smokeRequests } from "../ops/ops.js";
import { consentFor, evalEvent, harness, httpEvent, lastLog, modelReply, requestBody } from "./helpers.js";

const GROK = "us.xai.grok-4.7";
const SONNET = "us.anthropic.claude-sonnet-5-5";
const sonnetServer = () => harness({ env: { EXPLAIN_MODEL_ID: SONNET, EXPLAIN_PRICE_OUT: "11.00" } });

describe("consent bound to the request (314 M3)", () => {
  it("refuses an old tab's request after a model change, before any table read or model call (Jarvis's stale-tab probe)", async () => {
    const oldTabRequest = httpEvent(); // carries Grok's consent fingerprint
    expect((await harness().call(oldTabRequest)).statusCode).toBe(200);
    const sonnet = sonnetServer();
    const later = await sonnet.call(oldTabRequest);
    expect(later.statusCode).toBe(409);
    expect(later.json).toEqual({ v: 1, error: "consent" });
    expect(lastLog(sonnet).code).toBe("E_CONSENT");
    expect(sonnet.aws.table.ops).toEqual([]);
    expect(sonnet.aws.modelCalls).toEqual([]);
  });

  it("answers a page that shows the current model's consent", async () => {
    const r = await sonnetServer().call(httpEvent({ body: requestBody({ consent: consentFor(SONNET) }) }));
    expect(r.statusCode).toBe(200);
    expect(r.json.model).toBe(MODELS[SONNET]!.displayName);
  });

  it("refuses a visitor request without the fingerprint, or with a malformed one", async () => {
    const { consent: _drop, ...noConsent } = requestBody();
    for (const body of [noConsent, requestBody({ consent: "grok47" }), requestBody({ consent: 7 }), requestBody({ consent: `${consentFor()}0` })]) {
      const h = harness();
      const r = await h.call(httpEvent({ body }));
      expect(r.statusCode).toBe(400);
      expect(lastLog(h).code).toBe("E_SHAPE");
      expect(h.aws.table.ops).toEqual([]);
    }
  });

  it("refuses a well-formed fingerprint for any other model or consent version", async () => {
    for (const consent of [consentFor(SONNET), consentFingerprint(GROK, { ...MODELS[GROK]!, provider: "Someone else" }), consentFor().replace(/^c1-/, "c2-")]) {
      const h = harness();
      expect((await h.call(httpEvent({ body: requestBody({ consent }) }))).statusCode).toBe(409);
      expect(h.aws.modelCalls).toEqual([]);
    }
  });

  it("lets the key-authorized evaluation omit the fingerprint, and checks one it sends", async () => {
    const { consent: _drop, ...noConsent } = requestBody();
    const plain = sonnetServer();
    expect(((await plain.handler(evalEvent(noConsent))) as { status: number }).status).toBe(200);
    const stale = sonnetServer();
    expect(((await stale.handler(evalEvent(requestBody()))) as { status: number }).status).toBe(409);
    expect(stale.aws.modelCalls).toEqual([]);
  });
});

describe("the deploy's public test calls with the fingerprint ops.sh adds", () => {
  it("still get 422 for the non-mark and a checked answer for the mark", async () => {
    const s = smokeRequests();
    const h = harness();
    const notAMark = await h.call(httpEvent({ body: { ...s.notAMark, consent: consentFor() } }));
    expect(notAMark.statusCode).toBe(422);
    expect(lastLog(h).code).toBe("E_NOT_A_MARK");
    const marked = harness();
    marked.aws.model = () => ({ status: 200, json: modelReply({ plainer: s.marked.sentence as string }) });
    expect((await marked.call(httpEvent({ body: { ...s.marked, consent: consentFor() } }))).statusCode).toBe(200);
  });
});
