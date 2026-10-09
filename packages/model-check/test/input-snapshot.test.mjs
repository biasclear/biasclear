import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, NEUTRAL_SET, runBinding } from "../src/contracts.mjs";
import { createReplayStub, runModelCheck } from "../src/offline.mjs";

const reviewedRegistry = async () => JSON.parse(await readFile(
  new URL("./fixtures/reviewed-registry.json", import.meta.url), "utf8"));

function adapter(modelId, questions = NEUTRAL_SET.questions) {
  return createReplayStub({ schema: 1, kind: "offline-replay-fixtures", replies: { [modelId]:
    Object.fromEntries(questions.map(q => [q.id, {
      output: { message: { role: "assistant", content: [{ text: "A neutral synthetic answer." }] } },
      stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 8 },
    }])) } });
}

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-input-snapshot-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("registry snapshot reads a mutable settings getter once and sends the reviewed value", () => withTemp(async directory => {
  const document = await reviewedRegistry(), modelId = document.table.defaultId;
  const originalFields = structuredClone(document.table.models[modelId].requestFields);
  assert.deepEqual(originalFields, { reasoning_effort: "low" });
  let reads = 0;
  Object.defineProperty(document.table.models[modelId], "requestFields", { enumerable: true, configurable: true,
    // Three low reads would let a caller without the entry snapshot pass the
    // table digest and settings validation, then swap during the returned copy.
    get() { return ++reads <= 3 ? originalFields : { reasoning_effort: "high" }; } });
  const stub = adapter(modelId), artifactDirectory = join(directory, "output");
  const report = await runModelCheck({ registry: document, modelIds: [modelId], questionSet: NEUTRAL_SET,
    adapter: stub, artifactDirectory });
  assert.equal(reads, 1, "caller settings must be read only by the entry snapshot");
  assert.equal(report.complete, true);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(stub.calls.length, NEUTRAL_SET.questions.length);
  assert.deepEqual(report.registry.table.models[modelId].requestFields, originalFields);
  for (const call of stub.calls) assert.deepEqual(call.request.additionalModelRequestFields, originalFields);
  const saved = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
  assert.deepEqual(saved.registry.table.models[modelId].requestFields, originalFields);
  for (const row of saved.rows) assert.deepEqual(row.settings.additionalModelRequestFields, originalFields);
}));

test("receipt snapshot keeps the validated approver when a caller getter changes later", () => withTemp(async directory => {
  const document = await reviewedRegistry(), modelId = document.table.defaultId;
  const questionSet = { ...structuredClone(NEUTRAL_SET), id: "snapshot-neutral-questions", kind: "owner-draft" };
  const approval = { schema: 1, kind: "owner-approval",
    runHash: runBinding(digest(questionSet), digest(document), [modelId], "general"),
    approvedAt: "2020-01-01T00:00:00.000Z",
    approvalReference: "Synthetic unit receipt for neutral questions; no actual owner approval is claimed." };
  let reads = 0;
  Object.defineProperty(approval, "approvedBy", { enumerable: true, configurable: true,
    get() { return ++reads === 1 ? "owner" : "assistant"; } });
  const stub = adapter(modelId, questionSet.questions), artifactDirectory = join(directory, "output");
  const report = await runModelCheck({ registry: document, modelIds: [modelId], questionSet, approval,
    adapter: stub, artifactDirectory });
  assert.equal(reads, 1, "caller approval must be read only by the entry snapshot");
  assert.equal(report.complete, true);
  assert.equal(report.actualCostUsd, 0);
  assert.equal(stub.calls.length, questionSet.questions.length);
  assert.equal(report.approval.approvedBy, "owner");
  assert.equal(report.approval.authenticated, false);
  const saved = JSON.parse(await readFile(join(artifactDirectory, "run.json"), "utf8"));
  assert.equal(saved.approval.approvedBy, "owner");
  assert.equal(saved.approval.authenticated, false);
}));
