// The billing-anomaly metric filter (infra/aws/explain.yaml) against the handler's real log lines,
// stored the way Lambda stores them (306 d). With LogFormat JSON, console.log(string) becomes the
// string value of "message" in {timestamp, level, requestId, message}; a top-level JSON selector can't
// see inside it. Offline only: real alarm operation is unproven until the AWS sitting.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_PAUSE_KEY } from "../src/spend.js";
import { ConflictAws } from "./conflicts.js";
import { harness, httpEvent, modelReply, type Harness } from "./helpers.js";

const yaml = readFileSync(decodeURIComponent(new URL("../../../infra/aws/explain.yaml", import.meta.url).pathname), "utf8");
const pattern = /FilterPattern: '([^']+)'/.exec(yaml)![1]!;

/** CloudWatch filter semantics for the two pattern kinds this template has used. */
function matches(event: string): boolean {
  if (pattern.startsWith("{")) {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(event) as Record<string, unknown>; } catch { return false; } // JSON selectors never match non-JSON
    return [...pattern.matchAll(/\(\$\.(\w+) = ("[^"]*"|-?\d+)\)/g)]
      .some(([, field, raw]) => obj[field!] === (raw!.startsWith('"') ? raw!.slice(1, -1) : Number(raw)));
  }
  const terms = pattern.split(" ").map((t) => t.replace(/^\?/, ""));
  if (!terms.every((t) => /^\w+$/.test(t))) throw new Error(`unsupported filter pattern ${pattern}`);
  return terms.some((t) => new RegExp(`(?<!\\w)${t}(?!\\w)`).test(event));
}

function stored(line: string): string[] {
  const envelope = { timestamp: "2026-10-07T00:00:00.000Z", level: "INFO", requestId: "00000000-0000-0000-0000-000000000000" };
  return [
    JSON.stringify({ ...envelope, message: line }), // LogFormat JSON (explain.yaml), console.log(string) (src/log.ts)
    `${envelope.timestamp}\t${envelope.requestId}\tINFO\t${line}`, // LogFormat Text
  ];
}

const lastLine = (h: Harness): string => h.logs.at(-1)!;

describe("the billing-anomaly filter sees anomaly lines as Lambda stores them (306 d)", () => {
  it("is set to JSON log format, the case the filter must survive", () => {
    expect(yaml).toMatch(/LogFormat: JSON/);
  });

  it("matches a bound breach, a failed settlement whose pause didn't persist, and unknown usage", async () => {
    const lines: string[] = [];
    const breach = harness();
    breach.aws.model = () => ({ status: 200, json: modelReply({ outTok: 5_000 }) });
    await breach.call(httpEvent());
    lines.push(lastLine(breach));

    const ca = new ConflictAws();
    ca.forceConflict = (body) => JSON.stringify(body).includes(":settled");
    const unsettled = harness({ transport: ca.transport });
    ca.aws.table.fault = (op, p) => op === "PutItem" && (p.Item as { pk: { S: string } }).pk.S === BILLING_PAUSE_KEY ? "network" : undefined;
    await unsettled.call(httpEvent());
    lines.push(lastLine(unsettled));

    const unknown = harness();
    unknown.aws.model = () => ({ status: 200, json: modelReply({ usage: null }) });
    await unknown.call(httpEvent());
    lines.push(lastLine(unknown));

    expect(lines.map((l) => (JSON.parse(l) as { code: string }).code)).toEqual(["E_PROVIDER_BOUND", "E_SETTLE", "E_MODEL_NO_USAGE"]);
    expect((JSON.parse(lines[1]!) as { pausePersisted: number }).pausePersisted).toBe(0);
    for (const line of lines) for (const event of stored(line)) expect(matches(event), event).toBe(true);
  });

  it("stays quiet for an answer and for ordinary refusals", async () => {
    const lines: string[] = [];
    const ok = harness();
    await ok.call(httpEvent());
    lines.push(lastLine(ok));
    const shape = harness();
    shape.aws.model = () => ({ status: 200, json: modelReply({ text: "not JSON" }) });
    await shape.call(httpEvent());
    lines.push(lastLine(shape));
    expect(lines.map((l) => (JSON.parse(l) as { outcome: string }).outcome)).toEqual(["ok", "no_answer"]);
    for (const line of lines) for (const event of stored(line)) expect(matches(event), event).toBe(false);
  });
});
