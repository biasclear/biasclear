// Owner decision D5, 2026-10-09 ("Stay off until someone checks (Recommended)"): when the $30 budget
// action takes the model away, Explain stays off until a person checks, even after AWS resets the action
// at the start of the next budget month. A refusal by an explicit deny (HTTP 403 / AccessDeniedException
// whose message says "explicit deny", as AWS words the budget's deny policy) on the model call or a
// settings read writes the lasting billing#pause. Any other refusal (no model access yet, a Marketplace
// subscription still completing, a missing allow, an expired token, an empty 403), a timeout, a network
// failure, a throttle or a server error never writes it. Offline only.

import { describe, expect, it, vi } from "vitest";
import { TransportError } from "../src/aws/transport.js";
import { BILLING_PAUSE_KEY } from "../src/spend.js";
import { evalEvent, explicitDenyMessage, harness, httpEvent, lastLog, modelReply, noAllowMessage, requestBody, type Harness } from "./helpers.js";

const MONTH = "spend#2026-10";
const DAY = "spendday#2026-10-05";
/** A few minutes into the next budget month, after AWS has reset the budget action. */
const NEXT_MONTH = Date.UTC(2026, 10, 1, 0, 5);
const PROFILE = "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.xai.grok-4.7";
const ERROR_TYPE = "AccessDeniedException:http://internal.amazon.com/coral/com.amazon.bedrock/";
const DENY_TEXT = explicitDenyMessage("bedrock:InvokeModel", PROFILE);
/** The budget's deny policy refusing the model call, as AWS words it. */
const DENIED = { status: 403, errorType: ERROR_TYPE, json: { message: DENY_TEXT } };
/** The same refusal in AWS's other wordings: no policy ARN, a service control policy in capitals under
 * "Message", and a permissions boundary with no error-type header. */
const EXPLICIT_DENIES = [
  DENIED,
  { status: 403, errorType: ERROR_TYPE, json: { message: DENY_TEXT.replace(/: arn:aws:iam:\S*$/u, "") } },
  { status: 403, errorType: ERROR_TYPE, json: { Message: DENY_TEXT.replace(/identity-based policy.*$/u, "service control policy").toUpperCase() } },
  { status: 403, json: { message: DENY_TEXT.replace(/identity-based policy.*$/u, "permissions boundary") } },
];
/** Refusals with no explicit deny. The Marketplace text is paraphrased from AWS re:Post reports. */
const NO_ACCESS = { status: 403, errorType: ERROR_TYPE, json: { message: "You don't have access to the model with the specified model ID." } };
const MARKETPLACE = { status: 403, errorType: ERROR_TYPE, json: { message: "Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) to enable access to this model. Your AWS Marketplace subscription for this model cannot be completed at this time. If you recently fixed this issue, try again after 2 minutes." } };
const NOT_EXPLICIT = [
  ["no model access yet", NO_ACCESS],
  ["a Marketplace subscription still completing", MARKETPLACE],
  ["an expired token", { status: 403, errorType: "ExpiredTokenException", json: { message: "The security token included in the request is expired" } }],
  ["a missing allow", { status: 403, errorType: ERROR_TYPE, json: { message: noAllowMessage("bedrock:InvokeModel", PROFILE) } }],
  ["an empty 403", { status: 403 }],
] as const;

const pauseRecord = (h: Harness) => h.aws.table.items.get(BILLING_PAUSE_KEY);
const debtRows = (h: Harness): string[] => [...h.aws.table.items.keys()].filter((k) => k.startsWith("billingdebt#"));
const events = (h: Harness) => [...h.aws.table.items.entries()].filter(([k]) => k.startsWith("billing#") && k !== BILLING_PAUSE_KEY);

/** A new Lambda instance on the same table and the same fake AWS, on the 1st of the next month. */
function freshInstance(h: Harness): Harness {
  const fresh = harness({ transport: h.aws.transport });
  fresh.clock.ms = NEXT_MONTH;
  return fresh;
}

describe("an explicit deny from Bedrock keeps Explain off until a person checks (D5, 2026-10-09)", () => {
  it("the model call refused by an explicit deny: writes the lasting pause, gives the reservation back and answers paused", async () => {
    for (const reply of EXPLICIT_DENIES) {
      const h = harness();
      h.aws.model = () => reply;
      const r = await h.call(httpEvent());
      expect(r.statusCode).toBe(503);
      expect(r.json).toEqual({ v: 1, error: "paused" });
      const log = lastLog(h);
      expect(log.code).toBe("E_BEDROCK_DENIED");
      expect(log.pausePersisted).toBe(1);
      expect(log.micros).toBe(0);
      expect(log.actualMicros).toBe(0);
      // The fence alone: nothing is owed, so no debt row and no event in it.
      expect(pauseRecord(h)).toEqual({
        pk: { S: BILLING_PAUSE_KEY }, reason: { S: "E_BEDROCK_DENIED" }, at: { N: String(Math.floor(h.clock.ms / 1000)) }, reserved: { N: "0" },
      });
      expect(debtRows(h)).toEqual([]);
      expect(h.aws.table.num(MONTH, "m")).toBe(0);
      expect(h.aws.table.num(DAY, "m")).toBe(0);
      expect(events(h).map(([, item]) => item.state)).toEqual([{ S: "settled" }]);
      expect(h.aws.modelCalls).toHaveLength(1);
    }
  });

  it("stays off after AWS gives the model back on the 1st, on this instance and on fresh ones", async () => {
    const h = harness();
    h.aws.model = () => DENIED;
    await h.call(httpEvent());
    h.aws.model = () => ({ status: 200, json: modelReply() }); // AWS reset the action: the model is back
    h.clock.ms = NEXT_MONTH; // past the old 15-minute pause, into the next budget month
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_PAUSE_FLAG");

    const fresh = freshInstance(h);
    const r = await fresh.call(httpEvent());
    expect(r.statusCode).toBe(503);
    expect(r.json).toEqual({ v: 1, error: "paused" });
    expect(lastLog(fresh).code).toBe("E_BILLING_PAUSE");
    // The deploy workflow's direct evaluation invoke is held off too.
    const evaluation = (await freshInstance(h).handler(evalEvent(requestBody()))) as { status: number; evaluation: { code?: string } };
    expect(evaluation.status).toBe(503);
    expect(evaluation.evaluation.code).toBe("E_BILLING_PAUSE");
    expect(h.aws.modelCalls).toHaveLength(1);
    expect(h.aws.table.num("spend#2026-11", "m")).toBeUndefined();
    expect(pauseRecord(h)?.reason).toEqual({ S: "E_BEDROCK_DENIED" });
  });

  it("a settings read refused by an explicit deny: writes the lasting pause before any spend or model call", async () => {
    const h = harness();
    h.aws.settings = "denied";
    const r = await h.call(httpEvent());
    expect(r.statusCode).toBe(503);
    expect(r.json).toEqual({ v: 1, error: "paused" });
    expect(lastLog(h).code).toBe("E_BEDROCK_DENIED");
    expect(lastLog(h).pausePersisted).toBe(1);
    expect(pauseRecord(h)?.reason).toEqual({ S: "E_BEDROCK_DENIED" });
    expect(pauseRecord(h)?.reserved).toEqual({ N: "0" });
    expect(h.aws.table.ops).toEqual(["PutItem"]); // the fence only: no reservation, counters or debt row
    expect(h.aws.modelCalls).toHaveLength(0);

    h.aws.settings = { logging: {}, retention: "none" }; // AWS reset the action
    h.clock.ms = NEXT_MONTH;
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_PAUSE_FLAG");
    const fresh = freshInstance(h);
    expect((await fresh.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(fresh).code).toBe("E_BILLING_PAUSE");
    expect(h.aws.modelCalls).toHaveLength(0);
  });

  it("one explicit deny among the settings reads wins, even when another read failed or was refused first", async () => {
    for (const first of ["fail", "refused"] as const) {
      const h = harness();
      h.aws.regionalRetention["us-east-2"] = first; // answered before the explicit deny below
      h.aws.regionalRetention["us-west-2"] = "denied";
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(lastLog(h).code).toBe("E_BEDROCK_DENIED");
      expect(pauseRecord(h)?.reason).toEqual({ S: "E_BEDROCK_DENIED" });
    }
  });

  it("says pausePersisted=0 and keeps this instance paused when the fence can't be written", async () => {
    const h = harness();
    h.aws.settings = "denied";
    h.aws.table.fault = (op) => (op === "PutItem" ? "network" : undefined);
    vi.useFakeTimers(); // the fence write fails on every try, for the 4 s retry window
    try {
      const pending = h.call(httpEvent());
      await vi.runAllTimersAsync();
      expect((await pending).statusCode).toBe(503);
    } finally {
      vi.useRealTimers();
    }
    expect(lastLog(h).code).toBe("E_BEDROCK_DENIED");
    expect(lastLog(h).pausePersisted).toBe(0);
    expect(pauseRecord(h)).toBeUndefined();
    h.aws.table.fault = undefined;
    h.aws.settings = { logging: {}, retention: "none" };
    h.clock.ms = NEXT_MONTH;
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_PAUSE_FLAG");
  });
});

describe("other refusals and failures never write the lasting pause", () => {
  for (const [label, reply] of NOT_EXPLICIT) {
    it(`a model call refused with ${label}: not billed, this instance pauses for 15 minutes, nothing lasting`, async () => {
      const h = harness();
      h.aws.model = () => reply;
      const r = await h.call(httpEvent());
      expect(r.statusCode).toBe(503);
      expect(r.json).toEqual({ v: 1, error: "paused" });
      expect(lastLog(h).code).toBe("E_MODEL_DENIED");
      expect(lastLog(h).pausePersisted).toBeUndefined();
      expect(pauseRecord(h)).toBeUndefined();
      expect(h.aws.table.num(MONTH, "m")).toBe(0);
      h.aws.model = () => ({ status: 200, json: modelReply() });
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(lastLog(h).code).toBe("E_PAUSE_FLAG");
      h.clock.advance(15 * 60 * 1000);
      expect((await h.call(httpEvent())).statusCode).toBe(200);
    });
  }

  it("a first deploy before the model's access and Marketplace subscription are ready leaves no lasting pause", async () => {
    // The deploy's direct test call, three times: before the model is switched on (setup step 3), just
    // after (AWS still completing a third-party model's Marketplace subscription), and minutes later.
    const call = async (h: Harness) => (await h.handler(evalEvent(requestBody()))) as { status: number; evaluation: { code?: string } };
    const first = harness();
    first.aws.model = () => NO_ACCESS;
    expect(await call(first)).toMatchObject({ status: 503, evaluation: { code: "E_MODEL_DENIED" } });
    first.aws.model = () => MARKETPLACE;
    const second = harness({ transport: first.aws.transport }); // each deploy runs on a new instance
    expect(await call(second)).toMatchObject({ status: 503, evaluation: { code: "E_MODEL_DENIED" } });
    first.aws.model = () => ({ status: 200, json: modelReply() });
    const third = harness({ transport: first.aws.transport });
    third.clock.advance(3 * 60 * 1000);
    expect(await call(third)).toMatchObject({ status: 200 });
    expect(pauseRecord(first)).toBeUndefined();
    expect(debtRows(first)).toEqual([]);
    expect(first.aws.modelCalls).toHaveLength(3);
  });

  it("a throttled model call: busy, the reservation back, nothing lasting", async () => {
    const h = harness();
    h.aws.model = () => ({ status: 429, errorType: "ThrottlingException" });
    const r = await h.call(httpEvent());
    expect(r.statusCode).toBe(503);
    expect(r.json).toEqual({ v: 1, error: "busy" });
    expect(lastLog(h).code).toBe("E_MODEL_THROTTLED");
    expect(lastLog(h).pausePersisted).toBeUndefined();
    expect(pauseRecord(h)).toBeUndefined();
    expect(h.aws.table.num(MONTH, "m")).toBe(0);
    h.aws.model = () => ({ status: 200, json: modelReply() });
    expect((await h.call(httpEvent())).statusCode).toBe(200);
  });

  it("a model timeout, network failure or server error keeps its own billing-anomaly pause, unchanged", async () => {
    // These may have been billed, so they have always kept the reservation and written the fence with
    // the event's debt row (SPEC §8). That is unchanged; they are never taken for a refusal.
    const cases = [["timeout", "E_MODEL_TIMEOUT"], ["network", "E_MODEL_NETWORK"], [{ status: 500 }, "E_MODEL_ERROR"],
      [{ status: 503, errorType: "ServiceUnavailableException" }, "E_MODEL_ERROR"]] as const;
    for (const [outcome, code] of cases) {
      const h = harness();
      h.aws.model = () => outcome;
      await h.call(httpEvent());
      expect(lastLog(h).code).toBe(code);
      expect(pauseRecord(h)?.reason).toEqual({ S: code });
      expect(debtRows(h)).toHaveLength(1);
    }
  });

  it("no credentials to sign with is not Bedrock's refusal: this instance only, nothing lasting", async () => {
    const h = harness();
    const delegate = h.aws.transport;
    h.deps.transport = async (call) => {
      if (call.host.startsWith("bedrock-runtime.")) throw new TransportError("credentials");
      return delegate(call);
    };
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_MODEL_DENIED");
    expect(pauseRecord(h)).toBeUndefined();
    expect(h.aws.table.num(MONTH, "m")).toBe(0);
  });

  const settingsFailures = { timeout: "a timeout", network: "a network failure", fail: "a server error", throttled: "a throttle",
    refused: "a refusal without an explicit deny" } as const;
  for (const [failure, label] of Object.entries(settingsFailures) as Array<[keyof typeof settingsFailures, string]>) {
    it(`a settings read that gets ${label} pauses this instance for 15 minutes only`, async () => {
      const h = harness();
      const delegate = h.aws.transport;
      if (failure === "throttled") {
        h.deps.transport = async (call) => call.host.startsWith("bedrock.")
          ? { status: 429, headers: { "x-amzn-errortype": "ThrottlingException" }, body: "{}" } : delegate(call);
      } else {
        h.aws.settings = failure;
      }
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(lastLog(h).code).toBe("E_SETTINGS_READ");
      expect(lastLog(h).pausePersisted).toBeUndefined();
      expect(h.aws.table.ops).toEqual([]);
      h.deps.transport = delegate;
      h.aws.settings = { logging: {}, retention: "none" };
      h.clock.advance(15 * 60 * 1000);
      expect((await h.call(httpEvent())).statusCode).toBe(200);
    });
  }

  it("the other set-up refusals keep their 15-minute instance pause and write nothing lasting", async () => {
    const cases = [
      [{ status: 404, errorType: "ResourceNotFoundException" }, "E_MODEL_NOT_FOUND"],
      [{ status: 400, errorType: "ValidationException", json: { message: "This model is not available under the account's data retention setting." } }, "E_MODEL_RETENTION"],
    ] as const;
    for (const [reply, code] of cases) {
      const h = harness();
      h.aws.model = () => reply;
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(lastLog(h).code).toBe(code);
      expect(pauseRecord(h)).toBeUndefined();
      h.aws.model = () => ({ status: 200, json: modelReply() });
      h.clock.advance(15 * 60 * 1000);
      expect((await h.call(httpEvent())).statusCode).toBe(200);
    }
  });
});
