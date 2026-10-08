import { createHash } from "node:crypto";

export class CheckError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function refuse(code) { throw new CheckError(code); }
export function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function exact(value, keys) {
  return object(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  if (value === undefined || !["string", "number", "boolean"].includes(typeof value) && value !== null ||
      typeof value === "number" && !Number.isFinite(value)) refuse("E_INVALID_JSON_VALUE");
  return JSON.stringify(value);
}
export const digest = value => createHash("sha256").update(canonical(value)).digest("hex");
export const bytesDigest = value => createHash("sha256").update(value).digest("hex");
export function frozenCopy(value) {
  const copy = JSON.parse(canonical(value));
  const freeze = v => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(copy);
  return copy;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const MODEL_ID = /^us\.[a-z0-9][a-z0-9.-]*$/;
export const validHash = value => typeof value === "string" && HASH.test(value);
export const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

export const NEUTRAL_SET = frozenCopy({ schema: 1, id: "neutral-unit-fixtures", kind: "neutral-fixture", questions: [
  { id: "n01", text: "What color is a ripe banana?" },
  { id: "n02", text: "How many sides does a triangle have?" },
] });
export const NEUTRAL_SET_HASH = digest(NEUTRAL_SET);

export function validateQuestionSet(input) {
  const basicKeys = ["schema", "id", "kind", "questions"];
  const sourceKeys = [...basicKeys, "sourceDraft", "sourceDraftSha256"];
  if (!(exact(input, basicKeys) || exact(input, sourceKeys) && object(input.sourceDraft) && validHash(input.sourceDraftSha256)) || input.schema !== 1 || typeof input.id !== "string" || !ID.test(input.id) ||
      !["neutral-fixture", "owner-draft"].includes(input.kind) || !Array.isArray(input.questions) ||
      input.questions.length < 1 || input.questions.length > 1000) refuse("E_QUESTION_SET");
  const ids = new Set();
  for (const q of input.questions) {
    if (!(exact(q, ["id", "text"]) || exact(q, ["id", "text", "axis", "position", "kind"]) &&
        [q.axis, q.position, q.kind].every(s => typeof s === "string" && s.length > 0 && s.length <= 200)) || typeof q.id !== "string" || !ID.test(q.id) || ids.has(q.id) || typeof q.text !== "string" ||
        q.text.length === 0 || q.text.length > 100_000 || !q.text.isWellFormed()) refuse("E_QUESTION_SET");
    ids.add(q.id);
  }
  if (Object.hasOwn(input, "sourceDraft")) {
    const original = input.sourceDraft;
    if (!Array.isArray(original.questions) || input.kind !== "owner-draft" ||
        original.questionFingerprintSha256 !== bytesDigest(JSON.stringify(original.questions)) ||
        canonical(input.questions) !== canonical(original.questions.map(q => ({ id: q.id, text: q.question,
          axis: q.axis, position: q.position, kind: q.kind })))) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
  }
  const set = frozenCopy(input);
  const hash = digest(set);
  if (set.kind === "neutral-fixture" && hash !== NEUTRAL_SET_HASH) refuse("E_NEUTRAL_FIXTURE_DRIFT");
  return { set, hash };
}

/** Lossless bridge for the archived 28-question draft. This does not approve or execute it. */
export function importQuestionDraft(document, originalBytes) {
  let parsed;
  try { parsed = JSON.parse(typeof originalBytes === "string" ? originalBytes : Buffer.from(originalBytes).toString("utf8")); }
  catch { refuse("E_QUESTION_DRAFT"); }
  if (canonical(parsed) !== canonical(document)) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
  document = parsed; // Preserve source property order for its historical JSON.stringify fingerprint.
  if (!exact(document, ["status", "preparedDate", "ownerApproved", "modelCallsExecuted", "stubQuestionRunsExecuted",
    "missingInstructionEnding", "proposedFirstRun", "questionFingerprintSha256", "questions"]) ||
    document.status !== "unapproved-draft" || document.ownerApproved !== false || !Array.isArray(document.questions) ||
    document.questions.some(q => !exact(q, ["id", "axis", "position", "question", "kind"]))) refuse("E_QUESTION_DRAFT");
  if (document.questionFingerprintSha256 !== bytesDigest(JSON.stringify(document.questions))) refuse("E_QUESTION_DRAFT_FINGERPRINT");
  const set = { schema: 1, id: "oct07-unapproved-draft", kind: "owner-draft",
    sourceDraft: document, sourceDraftSha256: bytesDigest(originalBytes), questions: document.questions.map(q =>
      ({ id: q.id, text: q.question, axis: q.axis, position: q.position, kind: q.kind })) };
  return validateQuestionSet(set).set;
}

function evidence(value, input = false) {
  return object(value) && ["yes", "no", "unknown"].includes(value.state) && typeof value.source === "string" &&
    value.source.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(value.checkedOn) &&
    (!input || value.framingTokens === null || Number.isSafeInteger(value.framingTokens) && value.framingTokens >= 0);
}
function safeSettings(value) {
  // These are the two verified low-effort shapes in the current single Explain table.
  // Accepting a new wire shape requires a review; a registry cannot introduce arbitrary fields.
  return exact(value, ["reasoning_effort"]) && value.reasoning_effort === "low" ||
    exact(value, ["thinking", "output_config"]) && exact(value.thinking, ["type"]) && value.thinking.type === "adaptive" &&
    exact(value.output_config, ["effort"]) && value.output_config.effort === "low";
}

export function validateRegistry(input, selectedIds) {
  if (!exact(input, ["schema", "kind", "provenance", "table", "tableSha256"]) || input.schema !== 1 ||
      input.kind !== "explain-reviewed-registry" || !object(input.provenance) ||
      input.provenance.repository !== "biasclear/biasclear" || input.provenance.path !== "packages/explain/src/models.ts" ||
      !/^[a-f0-9]{40}$/.test(input.provenance.commit) || !validHash(input.provenance.sourceSha256) ||
      !exact(input.table, ["models", "defaultId", "defaultKey"]) || !object(input.table.models) ||
      !validHash(input.tableSha256) || input.tableSha256 !== digest(input.table) ||
      !Array.isArray(selectedIds) || selectedIds.length < 1 || new Set(selectedIds).size !== selectedIds.length) refuse("E_REGISTRY");
  const entries = Object.entries(input.table.models);
  if (entries.length === 0 || entries.length > 100 || !Object.hasOwn(input.table.models, input.table.defaultId) ||
      input.table.models[input.table.defaultId].key !== input.table.defaultKey) refuse("E_REGISTRY");
  const keys = new Set();
  for (const [id, m] of entries) {
    if (!MODEL_ID.test(id) || !object(m) || id !== `us.${m.foundationModelId}` || typeof m.key !== "string" || m.key === "run" || !/^[a-z][a-z0-9]*$/.test(m.key) ||
        keys.has(m.key) || typeof m.displayName !== "string" || !m.displayName || typeof m.provider !== "string" || !m.provider ||
        m.region !== "us-east-1" || m.route !== "us-profile" || canonical(m.destinationRegions) !== canonical(["us-east-1", "us-east-2", "us-west-2"]) ||
        ![m.inputPricePerMillion, m.outputPricePerMillion].every(n => Number.isFinite(n) && n > 0 && Number.isSafeInteger(n * 1000)) ||
        m.maxTokens !== 400 || typeof m.settingsVerified !== "boolean" || typeof m.liveBlockReason !== "string" ||
        !(m.billedMaxTokens === null || Number.isSafeInteger(m.billedMaxTokens) && m.billedMaxTokens >= m.maxTokens) ||
        !evidence(m.reasoningAccounting) || !evidence(m.inputTokenBound, true) || !object(m.requestFields) || !object(m.source)) refuse("E_REGISTRY");
    for (const f of ["profile", "price", "settings"]) {
      if (typeof m.source[f] !== "string" || m.source[f].length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(m.source[`${f}CheckedOn`])) refuse("E_REGISTRY");
    }
    keys.add(m.key);
  }
  for (const id of selectedIds) {
    if (typeof id !== "string" || !Object.hasOwn(input.table.models, id)) refuse("E_UNKNOWN_MODEL");
    const m = input.table.models[id];
    if (!m.settingsVerified || !safeSettings(m.requestFields)) refuse("E_MODEL_SETTINGS_UNVERIFIED");
  }
  return { document: frozenCopy(input), hash: digest(input) };
}

export function runBinding(setHash, registryHash, modelIds, domain) {
  return digest({ schema: 1, mode: "offline", setHash, registryHash, modelIds, domain });
}
export function validateApproval(set, binding, receipt) {
  if (digest(set) === NEUTRAL_SET_HASH) return { kind: "built-in-neutral-fixtures", runHash: binding };
  if (!exact(receipt, ["schema", "kind", "runHash", "approvedBy", "approvedAt", "approvalReference"]) ||
      receipt.schema !== 1 || receipt.kind !== "owner-approval" || receipt.approvedBy !== "owner" ||
      receipt.runHash !== binding || !validDate(receipt.approvedAt) || typeof receipt.approvalReference !== "string" ||
      receipt.approvalReference.length < 1 || receipt.approvalReference.length > 500) refuse("E_OWNER_APPROVAL_REQUIRED");
  return frozenCopy(receipt);
}

export function userOnlyRequest(question, model) {
  return frozenCopy({ messages: [{ role: "user", content: [{ text: question }] }],
    inferenceConfig: { maxTokens: model.maxTokens }, additionalModelRequestFields: model.requestFields });
}
