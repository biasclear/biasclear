import { describe, expect, it } from "vitest";
import { converseModel, modelRequest, normalizedReply } from "../src/aws/bedrock.js";
import { readConfig } from "../src/config.js";
import { DEFAULT_MODEL_ID, MODELS } from "../src/models.js";
import { ENV, harness, httpEvent, lastLog } from "./helpers.js";

const text = JSON.stringify({how:'The words "Everyone agrees" offer agreement as the reason.',plainer:'Some people say it.'});
const reply = (content: unknown[], usage: Record<string, unknown> = {inputTokens:100,outputTokens:150,totalTokens:250}) =>
  ({output:{message:{role:"assistant",content}},stopReason:"end_turn",usage});

describe("one provider-independent Converse contract", () => {
  for (const [id, model] of Object.entries(MODELS)) {
    it(`${id}: exact request whitelist, fixed settings and no tools/search/grounding`, () => {
      const request = modelRequest("fixed prompt", "one marked sentence", model);
      expect(request.system).toEqual([{text:"fixed prompt"}]);
      expect(request.messages).toEqual([{role:"user",content:[{text:"one marked sentence"}]}]);
      expect(request.inferenceConfig).toEqual({maxTokens:400});
      const fields = Object.keys(request).sort();
      expect(fields).toEqual(Object.keys(model.requestFields).length ?
        ["additionalModelRequestFields","inferenceConfig","messages","system"] : ["inferenceConfig","messages","system"]);
      expect(JSON.stringify(request)).not.toMatch(/toolConfig|toolUse|search|grounding|web|cachePoint/iu);
    });
  }

  it("uses one Converse POST, counts reasoning output once and drops private reasoning", async () => {
    let calls = 0;
    const outcome = await converseModel(async call => {
      calls++;
      expect(call.path).toBe(`/model/${DEFAULT_MODEL_ID}/converse`);
      expect(call.timeoutMs).toBe(20_000);
      return {status:200,headers:{},body:JSON.stringify(reply([
        {reasoningContent:{reasoningText:{text:"private reasoning",signature:"test-signature"}}},{text},
      ]))};
    }, "us-east-1", DEFAULT_MODEL_ID, modelRequest("prompt","sentence",MODELS[DEFAULT_MODEL_ID]!));
    expect(calls).toBe(1);
    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") throw new Error("missing reply");
    expect(outcome.inTok).toBe(100);
    expect(outcome.outTok).toBe(150); // total output including reasoning, never added a second time
    expect(outcome.reply).toEqual({stop_reason:"end_turn",content:[{type:"text",text}]});
    expect(JSON.stringify(outcome.reply)).not.toContain("private reasoning");
  });

  it("charges all cached-input usage at the full rate and refuses unexplained totals", async () => {
    const call = async (usage: Record<string, unknown>) => converseModel(async () => ({status:200,headers:{},body:JSON.stringify(reply([{text}],usage))}),
      "us-east-1", DEFAULT_MODEL_ID, modelRequest("p","s",MODELS[DEFAULT_MODEL_ID]!));
    const cached = await call({inputTokens:100,outputTokens:20,cacheReadInputTokens:30,cacheWriteInputTokens:10,totalTokens:160});
    expect(cached).toMatchObject({kind:"reply",inTok:140,outTok:20});
    expect(await call({inputTokens:100,outputTokens:20,totalTokens:500})).toMatchObject({kind:"maybe-billed",code:"E_MODEL_NO_USAGE"});
  });

  it("refuses tool/search/unknown blocks and more than one text block", () => {
    for (const extra of [{toolUse:{name:"search"}},{searchResult:"anything"},{citationsContent:{}},{image:{}},{text:"second"},{reasoningContent:{other:"unknown"}}]) {
      expect(normalizedReply(reply([{text},extra])).content).toEqual([]);
    }
    expect(normalizedReply({...reply([{text}]),output:{message:{role:"user",content:[{text}]}}}).content).toEqual([]);
  });
});

describe("live startup refuses unresolved default/alternative settings", () => {
  it("keeps Grok default, but calls no AWS when billed reasoning cannot be bounded", async () => {
    expect(DEFAULT_MODEL_ID).toBe("us.xai.grok-4.7");
    expect(readConfig(ENV)).toBeUndefined();
    const h = harness({config:readConfig(ENV)});
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_CONFIG");
    expect(h.aws.calls).toEqual([]);
  });
  it("accepts only documented total-bound Sonnet, exact region/rates and zero retention", () => {
    const env = {...ENV,EXPLAIN_MODEL_ID:"us.anthropic.claude-sonnet-5-5",EXPLAIN_PRICE_OUT:"11.00"};
    expect(readConfig(env)?.modelId).toBe(env.EXPLAIN_MODEL_ID);
    for (const changes of [{EXPLAIN_MODEL_ID:"unknown"},{AWS_REGION:"us-west-2"},{EXPLAIN_PRICE_OUT:"1"},{EXPLAIN_RETENTION_MODE:"default"},
      {EXPLAIN_MODEL_ID:"us.openai.gpt-6.1-sol"}]) expect(readConfig({...env,...changes})).toBeUndefined();
  });
});
