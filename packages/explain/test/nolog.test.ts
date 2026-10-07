// No user text reaches any log (SPEC §10, §16 "canary no-log tests"). A
// marker string is pushed through every path that can fail, with every
// console method and both output streams captured; neither the marker, nor
// an error message, nor a stack may appear anywhere.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRegistry, type EngineBuild } from "../src/engines.js";
import { formatLine } from "../src/log.js";
import {
  GOOD_PLAINER,
  RULE,
  RULES_VERSION,
  evalEvent,
  harness,
  httpEvent,
  modelReply,
  requestBody,
  type Harness,
} from "./helpers.js";

const CANARY = "Zq7Canary";
const CANARY_SENTENCE = `Every serious economist agrees that the ${CANARY} plan will lower rents within two years.`;

let captured: string[] = [];

beforeEach(() => {
  captured = [];
  const grab = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
  };
  for (const m of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    vi.spyOn(console, m).mockImplementation(grab);
  }
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function everything(h: Harness): string {
  return [...h.logs, ...captured].join("\n");
}

function expectClean(h: Harness): void {
  const all = everything(h);
  expect(all).not.toContain(CANARY);
  expect(all).not.toMatch(/\bat .+:\d+:\d+/); // a stack frame
  expect(all).not.toMatch(/SyntaxError|RangeError|TypeError|Unexpected token|is not valid JSON/);
  // One line per request, and only the fixed fields.
  for (const line of h.logs) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      expect(["outcome", "status", "ms", "code", "rule", "rules", "model", "inTok", "outTok", "micros", "overrun", "plainer", "evaluation"]).toContain(key);
    }
  }
}

function canaryBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return requestBody({ sentence: CANARY_SENTENCE, ...over });
}

describe("no user text in any log", () => {
  it("a successful answer (the reply carries the sentence's words)", async () => {
    const h = harness();
    h.aws.model = () => ({
      status: 200,
      json: modelReply({
        how: `The words "Every serious economist agrees" ask the reader to trust agreement about the ${CANARY} plan.`,
        plainer: `Many economists say that the ${CANARY} plan will lower rents within two years.`,
      }),
    });
    const r = await h.call(httpEvent({ body: canaryBody() }));
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(CANARY);
    expectClean(h);
  });

  it("malformed JSON", async () => {
    const h = harness();
    await h.call(httpEvent({ rawBody: `{"sentence": "${CANARY}` }));
    expectClean(h);
  });

  it("an oversize body", async () => {
    const h = harness();
    await h.call(httpEvent({ rawBody: `{"sentence": "${CANARY.repeat(500)}"}` }));
    expectClean(h);
  });

  it("a validator failure", async () => {
    const h = harness();
    await h.call(httpEvent({ body: canaryBody({ sentence: `${CANARY}\u0000` }) }));
    await h.call(httpEvent({ body: canaryBody({ rule: CANARY.toUpperCase() }) }));
    await h.call(httpEvent({ body: canaryBody({ rules: CANARY }) }));
    await h.call(httpEvent({ body: { ...canaryBody(), [CANARY]: CANARY } }));
    expectClean(h);
  });

  it("an engine error whose message quotes the text", async () => {
    const real = harness().deps.engines.builds.get(RULES_VERSION)!;
    const throwing: EngineBuild = {
      ...real,
      scan: (text) => {
        throw new RangeError(`cannot scan ${text}`);
      },
    };
    const h = harness({ engines: makeRegistry([throwing]) });
    const r = await h.call(httpEvent({ body: canaryBody() }));
    expect(r.statusCode).toBe(422);
    expectClean(h);
  });

  it("a model reply that contains the canary and fails its checks", async () => {
    for (const how of [`${CANARY} is true.`, `<b>${CANARY}</b>`, `Senator ${CANARY} says so.`]) {
      const h = harness();
      h.aws.model = () => ({ status: 200, json: modelReply({ how, plainer: GOOD_PLAINER }) });
      const r = await h.call(httpEvent({ body: canaryBody() }));
      expect(r.statusCode).toBe(502);
      expectClean(h);
    }
  });

  it("a model reply that isn't JSON", async () => {
    const h = harness();
    h.aws.model = () => ({ status: 200, json: modelReply({ text: `{"how": "${CANARY}` }) });
    await h.call(httpEvent({ body: canaryBody() }));
    expectClean(h);
  });

  it("a Bedrock error whose body quotes the input", async () => {
    const h = harness();
    h.aws.model = () => ({ status: 400, errorType: "ValidationException", json: { message: `bad input ${CANARY}` } });
    await h.call(httpEvent({ body: canaryBody() }));
    expectClean(h);
  });

  it("a Bedrock refusal the function reads (route or retention) whose body quotes the input", async () => {
    for (const message of [`data retention ${CANARY}`, `inference profile ${CANARY}`]) {
      const h = harness();
      h.aws.model = () => ({ status: 400, errorType: "ValidationException", json: { message } });
      await h.call(httpEvent({ body: canaryBody() }));
      expectClean(h);
    }
  });

  it("a Bedrock timeout", async () => {
    const h = harness();
    h.aws.model = () => "timeout";
    await h.call(httpEvent({ body: canaryBody() }));
    expectClean(h);
  });

  it("a DynamoDB error", async () => {
    const h = harness();
    h.aws.table.fault = () => "throttle";
    await h.call(httpEvent({ body: canaryBody() }));
    expectClean(h);
  });

  it("an error thrown from deep inside the handler", async () => {
    const h = harness({
      randomBytes: () => {
        throw new Error(`deep failure ${CANARY}`);
      },
    });
    const r = await h.call(httpEvent({ body: canaryBody() }));
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain(CANARY);
    expect(JSON.parse(h.logs[0]!).code).toBe("E_INTERNAL");
    expectClean(h);
  });

  it("a transport that throws with the request in its message", async () => {
    const h = harness({
      transport: async (call) => {
        throw new Error(`failed ${call.body}`);
      },
    });
    const r = await h.call(httpEvent({ body: canaryBody() }));
    expect(r.statusCode).toBe(503);
    expectClean(h);
  });

  it("the evaluation's direct invoke logs no text either", async () => {
    const h = harness();
    await h.handler(evalEvent(canaryBody()));
    expectClean(h);
  });

  it("the logger drops unknown values from the request", () => {
    const line = formatLine(
      { outcome: "invalid", status: 400, ms: 1, rule: CANARY, rules: CANARY, model: CANARY, code: CANARY as never },
      { rules: new Set([RULE]), rulesVersions: new Set([RULES_VERSION]), models: new Set(["sonnet-5"]) },
    );
    expect(line).not.toContain(CANARY);
    expect(JSON.parse(line)).toEqual({ outcome: "invalid", status: 400, ms: 1, code: "E_INTERNAL", rule: "other", rules: "other", model: "other" });
  });
});
