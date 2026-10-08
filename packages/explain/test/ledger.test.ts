// Failure-focused synthetic verification, not proof of Bedrock billing behavior.
import { describe, expect, it } from "vitest";
import { type EvaluationResult } from "../src/app.js";
import { fetchTransport, TransportError } from "../src/aws/transport.js";
import { Ddb } from "../src/aws/dynamodb.js";
import { converseModel, modelRequest } from "../src/aws/bedrock.js";
import { readConfig } from "../src/config.js";
import { MODELS } from "../src/models.js";
import { BILLING_PAUSE_KEY, persistBillingPause, reserve, settle, spendKeys } from "../src/spend.js";
import { ENV, FakeAws, config, evalEvent, harness, httpEvent, lastLog, modelReply } from "./helpers.js";

const now = Date.UTC(2026, 9, 7, 14);
const cfg = config();

describe("atomic and durable billing fences", () => {
  it("rolls back the first counter when the second cap condition rejects", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport, cfg.region, cfg.table);
    const keys = spendKeys(now);
    aws.table.items.set(keys.day, {pk:{S:keys.day},m:{N:String(cfg.dailyMicros)}});
    expect(await reserve(ddb,cfg,now,100)).toEqual({ok:false,which:"day"});
    expect(aws.table.items.has(keys.month)).toBe(false);
    expect([...aws.table.items.keys()].filter(k=>k.startsWith("billing#"))).toEqual([]);
  });

  it("pause and reservation are serialized in the same transaction, closing the read/write race", async () => {
    const h = harness();
    h.aws.table.fault = (op,payload) => {
      if (op === "TransactWriteItems" && JSON.stringify(payload).includes("ConditionCheck")) {
        h.aws.table.items.set(BILLING_PAUSE_KEY,{pk:{S:BILLING_PAUSE_KEY},reason:{S:"E_SETTLE"}});
      }
      return undefined;
    };
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).code).toBe("E_BILLING_PAUSE");
    expect(h.aws.modelCalls).toHaveLength(0);
    for (const key of Object.values(spendKeys(h.clock.ms))) expect(h.aws.table.num(key,"m")).toBeUndefined();
  });

  it("records both actual counters after lost settlement acknowledgment, without retrying ADD", async () => {
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport,cfg.region,cfg.table);
    const r = await reserve(ddb,cfg,now,10000);
    if (!r.ok) throw new Error("reservation missing");
    aws.table.fault = (op)=>op === "TransactWriteItems" ? "response-lost" : undefined;
    expect(await settle(ddb,r.reservation,3000)).toBe(true);
    expect(await settle(ddb,r.reservation,3000)).toBe(true); // condition rejects duplicate, committed event proves result
    for (const key of [r.reservation.month,r.reservation.day]) expect(aws.table.num(key,"m")).toBe(3000);
    expect(aws.table.ops.filter(op=>op === "TransactWriteItems")).toHaveLength(3);
    expect(aws.table.ops.filter(op=>op === "UpdateItem")).toHaveLength(0);
    expect(await settle(ddb,r.reservation,4000)).toBe(false); // contradictory duplicate never changes cost
  });

  it("a committed reservation with a lost acknowledgment permits one model attempt", async () => {
    const h = harness();
    h.aws.table.fault = (op,payload)=>op === "TransactWriteItems" && JSON.stringify(payload).includes("ConditionCheck") ? "response-lost" : undefined;
    expect((await h.call(httpEvent())).statusCode).toBe(200);
    expect(h.aws.modelCalls).toHaveLength(1);
  });

  for (const actual of [3000,15000]) it(`settlement component failure is atomic for actual=${actual}`,async()=>{
    const aws = new FakeAws();
    const ddb = new Ddb(aws.transport,cfg.region,cfg.table);
    const r = await reserve(ddb,cfg,now,10000);
    if (!r.ok) throw new Error("reservation missing");
    aws.table.fault = (op,payload)=>op === "UpdateItem" && (payload.Key as {pk:{S:string}}).pk.S === r.reservation.day ? "network" : undefined;
    expect(await settle(ddb,r.reservation,actual)).toBe(false);
    for (const key of [r.reservation.month,r.reservation.day]) expect(aws.table.num(key,"m")).toBe(10000);
    expect((aws.table.items.get(r.reservation.event)?.state as {S:string}).S).toBe("reserved");
  });

  it("an overrun records real cost and pauses without exposing the answer; fresh instances remain stopped", async () => {
    const h = harness();
    h.aws.model=()=>({status:200,json:modelReply({inTok:50000,outTok:400})});
    const result = await h.handler(evalEvent()) as EvaluationResult;
    expect(result.status).toBe(503);
    expect(result.evaluation).toMatchObject({modelCalled:true,billedBoundViolated:true,pausePersisted:true,actualMicros:112640});
    expect(result.body).toEqual({v:1,error:"paused"});
    const line=lastLog(h);
    expect(line.actualMicros).toBe(112640);
    expect(line.reservedMicros).toBeLessThan(112640);
    expect(h.aws.table.items.get(BILLING_PAUSE_KEY)?.ttl).toBeUndefined();
    const fresh = harness({transport:h.aws.transport});
    fresh.clock.ms=Date.UTC(2026,10,8);
    expect((await fresh.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(fresh).code).toBe("E_BILLING_PAUSE");
    expect(h.aws.modelCalls).toHaveLength(1);
  });

  it("output-bound failure pauses even when unused input makes the total price fit", async()=>{
    const h=harness();
    h.aws.model=()=>({status:200,json:modelReply({inTok:1,outTok:401})});
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h)).toMatchObject({code:"E_PROVIDER_BOUND",billedBoundViolated:1,pausePersisted:1});
    expect(lastLog(h).actualMicros).toBeLessThan(lastLog(h).reservedMicros as number);
  });

  it("unknown usage and failed settlement preserve unresolved reservations and stop future calls",async()=>{
    for (const unknown of [true,false]) {
      const h=harness();
      h.aws.model=()=>{
        if (!unknown) h.aws.table.fault=(op,p)=>op === "TransactWriteItems" && JSON.stringify(p).includes(":settled") ? "throttle" : undefined;
        return {status:200,json:modelReply(unknown ? {usage:null} : {})};
      };
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(lastLog(h).pausePersisted).toBe(1);
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(h.aws.modelCalls).toHaveLength(1);
      const events=[...h.aws.table.items.values()].filter(i=>(i.state as {S:string}|undefined)?.S === "reserved");
      expect(events).toHaveLength(1);
      for (const key of Object.values(spendKeys(h.clock.ms))) expect(h.aws.table.num(key,"m")).toBe(lastLog(h).micros ?? Number((events[0]!.reserved as {N:string}).N));
    }
  });

  it("persists each concurrent unresolved actual cost beyond the single pause record",async()=>{
    const aws=new FakeAws();const ddb=new Ddb(aws.transport,cfg.region,cfg.table);
    const a=await reserve(ddb,cfg,now,10000);const b=await reserve(ddb,cfg,now,10000);
    if (!a.ok || !b.ok) throw new Error("reservation missing");
    const results=await Promise.all([a.reservation,b.reservation].map((r,i)=>persistBillingPause(ddb,{
      reason:"E_SETTLE",nowMs:now,reservedMicros:r.micros,actualMicros:15000+i,event:r.event})));
    expect(results).toEqual([true,true]);
    const debts=[...aws.table.items.entries()].filter(([key])=>key.startsWith("billingdebt#"));
    expect(debts).toHaveLength(2);
    expect(debts.map(([,item])=>Number((item.actual as {N:string}).N)).sort()).toEqual([15000,15001]);
    for (const [,item] of debts) expect(item.ttl).toBeUndefined();
    expect((await reserve(ddb,cfg,now,1))).toEqual({ok:false,which:"pause"});
  });

  it("lost pause acknowledgment is recovered only when both pause and this event debt exist",async()=>{
    // 314 L2: the pause and debt are PutItem writes now, so the lost acknowledgment is injected there.
    const aws=new FakeAws();const ddb=new Ddb(aws.transport,cfg.region,cfg.table);
    const r=await reserve(ddb,cfg,now,10000);if(!r.ok) throw new Error("reservation missing");
    aws.table.ops.length=0;
    aws.table.fault=(op)=>op === "PutItem" ? "response-lost" : undefined;
    expect(await persistBillingPause(ddb,{reason:"E_SETTLE",nowMs:now,reservedMicros:10000,actualMicros:15000,event:r.reservation.event})).toBe(true);
    expect(aws.table.ops.filter(o=>o === "PutItem")).toHaveLength(2); // each written once; its reply was lost
    expect(aws.table.ops.filter(o=>o === "GetItem")).toHaveLength(2); // and proved by a consistent read
    expect(aws.table.items.has(BILLING_PAUSE_KEY)).toBe(true);
    expect([...aws.table.items.keys()].filter(k=>k.startsWith("billingdebt#"))).toHaveLength(1);
    expect(aws.table.num(r.reservation.month,"m")).toBe(10000); // no counter is touched
    expect(aws.table.num(r.reservation.day,"m")).toBe(10000);
  });

  it("reports failed durable pause honestly and still stops this instance",async()=>{
    const h=harness();
    h.aws.model=()=>{
      h.aws.table.fault=(op,p)=>op === "PutItem" && (p.Item as {pk:{S:string}}).pk.S === BILLING_PAUSE_KEY ? "network" : undefined;
      return "network";
    };
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(lastLog(h).pausePersisted).toBe(0);
    expect(h.aws.table.items.has(BILLING_PAUSE_KEY)).toBe(false);
    h.clock.advance(100*86400000);
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(h.aws.modelCalls).toHaveLength(1);
  });
});

describe("model evidence and every processing destination",()=>{
  for (const [id,model] of Object.entries(MODELS)) it(`${model.key} refuses unknown accounting and input evidence before AWS`,async()=>{
    const env={...ENV,EXPLAIN_MODEL_ID:id,EXPLAIN_PRICE_OUT:String(model.outputPricePerMillion)};
    expect(readConfig(env)).toBeUndefined();
    const h=harness({models:MODELS,config:{...cfg,modelId:id,outNanosPerToken:model.outputPricePerMillion*1000}});
    expect((await h.call(httpEvent())).statusCode).toBe(503);
    expect(h.aws.calls).toEqual([]);
    let called=false;
    const outcome=await converseModel(async()=>{called=true;throw new Error("unreachable");},model.region,id,modelRequest("p","s",model));
    expect(outcome).toMatchObject({kind:"not-billed",code:"E_CONFIG"});
    expect(called).toBe(false);
  });

  for (const region of ["us-east-1","us-east-2","us-west-2"]) it(`retention ${region} must be readable and none`,async()=>{
    for (const mode of ["default","fail"]) {
      const h=harness();h.aws.regionalRetention[region]=mode;
      expect((await h.call(httpEvent())).statusCode).toBe(503);
      expect(h.aws.modelCalls).toHaveLength(0);
      expect(h.aws.table.ops).toEqual([]);
      expect(lastLog(h).code).toBe(mode === "fail" ? "E_SETTINGS_READ" : "E_SETTINGS_RETENTION");
    }
  });

  it("concurrent requests await the unfinished regional privacy proof", async()=>{
    const h = harness();
    const delegate = h.aws.transport;
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    h.deps.transport = async (call) => {
      if (call.path === "/data-retention") await pending;
      return delegate(call);
    };
    h.aws.regionalRetention["us-west-2"] = "default";
    const first = h.call(httpEvent());
    const second = h.call(httpEvent());
    await Promise.resolve();
    expect(h.aws.modelCalls).toHaveLength(0);
    expect(h.aws.table.ops).toEqual([]);
    resume();
    expect((await first).statusCode).toBe(503);
    expect((await second).statusCode).toBe(503);
    expect(h.aws.modelCalls).toHaveLength(0);
    expect(h.aws.settingsReads).toBe(4);
  });

  it("signs regional retention reads for their endpoint region", async()=>{
    const scopes: string[] = [];
    const transport = fetchTransport({region:"us-east-1",now:()=>now,
      // Deliberately synthetic offline signer inputs, never account credentials.
      env:{AWS_ACCESS_KEY_ID:"fixture",AWS_SECRET_ACCESS_KEY:"fixture",AWS_SESSION_TOKEN:"fixture"},
      fetchImpl:async (_url, init) => {
        const auth=(init!.headers as Record<string,string>).authorization!;
        scopes.push(auth.split(",")[0]!.split("/").slice(-3).join("/"));
        return new Response("{}",{status:200});
      }});
    for (const region of ["us-east-1","us-east-2","us-west-2"]) await transport({service:"bedrock",region,
      host:`bedrock.${region}.amazonaws.com`,method:"GET",path:"/data-retention",headers:{},body:"",timeoutMs:100});
    expect(scopes).toEqual(["us-east-1/bedrock/aws4_request","us-east-2/bedrock/aws4_request","us-west-2/bedrock/aws4_request"]);
  });

  it("propagates raw provider stop and text truncation only to the private evaluation", async()=>{
    const h=harness();h.aws.model=()=>({status:200,json:modelReply({text:"x".repeat(4001),stop_reason:"max_tokens"})});
    const result=await h.handler(evalEvent()) as EvaluationResult;
    expect(result.evaluation).toMatchObject({modelCalled:true,providerStopReason:"max_tokens",providerTextChars:4001,providerTextTruncated:true});
    expect(result.evaluation.providerText).toHaveLength(4000);
    expect(JSON.stringify(lastLog(h))).not.toContain("providerText");
  });

  it("missing temporary credentials are not counted as a provider attempt",async()=>{
    const h=harness();
    const delegate=h.aws.transport;
    h.deps.transport=async(call)=>{
      if (call.host.startsWith("bedrock-runtime.")) throw new TransportError("credentials");
      return delegate(call);
    };
    const result=await h.handler(evalEvent()) as EvaluationResult;
    expect(result.evaluation.modelCalled).toBe(false);
    expect(h.aws.modelCalls).toHaveLength(0);
  });

  it("reads invocation logging only in source region and retention in all destinations",async()=>{
    const h=harness();expect((await h.call(httpEvent())).statusCode).toBe(200);
    expect(h.aws.calls.filter(c=>c.path==="/logging/modelinvocations").map(c=>c.host)).toEqual(["bedrock.us-east-1.amazonaws.com"]);
    expect(h.aws.calls.filter(c=>c.path==="/data-retention").map(c=>c.host).sort()).toEqual([
      "bedrock.us-east-1.amazonaws.com","bedrock.us-east-2.amazonaws.com","bedrock.us-west-2.amazonaws.com"]);
  });
});
