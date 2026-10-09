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
  input = frozenCopy(input);
  const basicKeys = ["schema", "id", "kind", "questions"];
  const sourceKeys = [...basicKeys, "sourceDraft", "sourceDraftText", "sourceDraftSha256"];
  if (!(exact(input, basicKeys) || exact(input, sourceKeys) && object(input.sourceDraft) &&
      typeof input.sourceDraftText === "string" && validHash(input.sourceDraftSha256)) || input.schema !== 1 || typeof input.id !== "string" || !ID.test(input.id) ||
      !["neutral-fixture", "owner-draft"].includes(input.kind) || !Array.isArray(input.questions) ||
      input.questions.length < 1 || input.questions.length > 1000) refuse("E_QUESTION_SET");
  const ids = new Set();
  for (const q of input.questions) {
    if (!(exact(q, ["id", "text"]) || exact(q, ["id", "text", "axis", "position", "kind"]) &&
        [q.axis, q.position, q.kind].every(s => typeof s === "string" && s.length > 0 && s.length <= 200)) || typeof q.id !== "string" || !ID.test(q.id) || ids.has(q.id) || typeof q.text !== "string" ||
        q.text.length === 0 || q.text.length > 100_000 || !q.text.isWellFormed()) refuse("E_QUESTION_SET");
    ids.add(q.id);
  }
  // These IDs describe bridged historical bytes, never an arbitrary plain set.
  if (!Object.hasOwn(input, "sourceDraft") && /^(?:draft-|oct07-)/u.test(input.id)) refuse("E_QUESTION_SET");
  if (Object.hasOwn(input, "sourceDraft")) {
    // Canonical copies sort object keys. Reparse the bound source text instead of
    // relying on those copies for the archive's property-order fingerprint.
    if (bytesDigest(input.sourceDraftText) !== input.sourceDraftSha256) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
    const original = parseQuestionDraft(input.sourceDraftText);
    if (canonical(original) !== canonical(input.sourceDraft) || input.kind !== "owner-draft" ||
        input.id !== questionDraftId(input.sourceDraftSha256) ||
        canonical(input.questions) !== canonical(original.questions.map(q => ({ id: q.id, text: q.question,
          axis: q.axis, position: q.position, kind: q.kind })))) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
  }
  const set = frozenCopy(input);
  const hash = digest(set);
  if (set.kind === "neutral-fixture" && hash !== NEUTRAL_SET_HASH) refuse("E_NEUTRAL_FIXTURE_DRIFT");
  return { set, hash };
}

function parseQuestionDraft(sourceText) {
  let document;
  try { document = JSON.parse(sourceText); }
  catch { refuse("E_QUESTION_DRAFT"); }
  if (!exact(document, ["status", "preparedDate", "ownerApproved", "modelCallsExecuted", "stubQuestionRunsExecuted",
    "missingInstructionEnding", "proposedFirstRun", "questionFingerprintSha256", "questions"]) ||
    document.status !== "unapproved-draft" || document.ownerApproved !== false || !Array.isArray(document.questions) ||
    document.questions.some(q => !exact(q, ["id", "axis", "position", "question", "kind"]))) refuse("E_QUESTION_DRAFT");
  if (document.questionFingerprintSha256 !== bytesDigest(JSON.stringify(document.questions))) refuse("E_QUESTION_DRAFT_FINGERPRINT");
  return document;
}

function questionDraftId(sourceHash) {
  return `draft-${sourceHash.slice(0, 32)}`;
}

/** Lossless bridge for the archived 28-question draft. This does not approve or execute it. */
export function importQuestionDraft(document, originalBytes) {
  let sourceText;
  try { sourceText = typeof originalBytes === "string" ? originalBytes : Buffer.from(originalBytes).toString("utf8"); }
  catch { refuse("E_QUESTION_DRAFT"); }
  // A decoded string must represent the original UTF-8 bytes exactly.
  if (!sourceText.isWellFormed() || bytesDigest(sourceText) !== bytesDigest(originalBytes)) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
  const parsed = parseQuestionDraft(sourceText);
  if (canonical(parsed) !== canonical(document)) refuse("E_QUESTION_DRAFT_SOURCE_MISMATCH");
  document = parsed;
  const set = { schema: 1, id: questionDraftId(bytesDigest(originalBytes)), kind: "owner-draft",
    sourceDraft: document, sourceDraftText: sourceText, sourceDraftSha256: bytesDigest(originalBytes), questions: document.questions.map(q =>
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

function safePrice(value) {
  if (!Number.isFinite(value) || value <= 0) return false;
  const thousandths = value * 1000, rounded = Math.round(thousandths);
  // Arithmetic uses the same rounded thousandths. Allow binary float noise,
  // while refusing unsupported fractional precision and unsafe unit values.
  return Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(thousandths - rounded) < 1e-6;
}

// These content triples were read from local Git objects during review. They
// bind accepted content, not the caller's identity or claimed repository access.
const REVIEWED_REGISTRY_PINS = [
  { commit: "19eebb338ad5676075c4ab5a971eec6d379ef1bc",
    sourceSha256: "b7d4cd785fad2ab611eb1089fd1ad81223bb07887b01e4eabeedfa0531f58ae0",
    tableSha256: "1bba1367aded6a9dc94cd17d7b120872219623835b2c997f3758e7228404dcd9" },
  { commit: "dfcc8d3ef148420054a222de92d4f36cc6bb87b0",
    sourceSha256: "18686c745e90dc84155de9397bc98c744d281d4a3751a5fdd0cae8a9c99c48e8",
    tableSha256: "1bba1367aded6a9dc94cd17d7b120872219623835b2c997f3758e7228404dcd9" },
];

function validRegistryProvenance(input) {
  const p = input.provenance;
  if (input.kind === "synthetic-offline-registry") {
    return exact(p, ["kind", "fixture", "reviewedSource"]) && p.kind === "synthetic-unit-fixture" &&
      p.fixture === "neutral-test-registry" && p.reviewedSource === false;
  }
  return input.kind === "explain-reviewed-registry" &&
    exact(p, ["repository", "path", "commit", "sourceSha256", "commitVerification"]) &&
    p.repository === "biasclear/biasclear" && p.path === "packages/explain/src/models.ts" &&
    p.commitVerification === "operator-asserted" && REVIEWED_REGISTRY_PINS.some(pin =>
      p.commit === pin.commit && p.sourceSha256 === pin.sourceSha256 && input.tableSha256 === pin.tableSha256);
}

export function validateRegistry(input, selectedIds) {
  input = frozenCopy(input);
  selectedIds = frozenCopy(selectedIds);
  if (!exact(input, ["schema", "kind", "provenance", "table", "tableSha256"]) || input.schema !== 1 ||
      !validRegistryProvenance(input) ||
      !exact(input.table, ["models", "defaultId", "defaultKey"]) || !object(input.table.models) ||
      !validHash(input.tableSha256) || input.tableSha256 !== digest(input.table) ||
      !Array.isArray(selectedIds) || selectedIds.length < 1 || new Set(selectedIds).size !== selectedIds.length) refuse("E_REGISTRY");
  const entries = Object.entries(input.table.models);
  if (entries.length === 0 || entries.length > 100 || !Object.hasOwn(input.table.models, input.table.defaultId) ||
      input.table.models[input.table.defaultId].key !== input.table.defaultKey) refuse("E_REGISTRY");
  const keys = new Set();
  for (const [id, m] of entries) {
    if (input.kind === "synthetic-offline-registry" &&
        (!id.startsWith("us.fixture.") || m?.provider !== "Synthetic fixture")) refuse("E_REGISTRY");
    if (!MODEL_ID.test(id) || !object(m) || id !== `us.${m.foundationModelId}` || typeof m.key !== "string" || m.key === "run" || !/^[a-z][a-z0-9]*$/.test(m.key) ||
        keys.has(m.key) || typeof m.displayName !== "string" || !m.displayName || typeof m.provider !== "string" || !m.provider ||
        m.region !== "us-east-1" || m.route !== "us-profile" || canonical(m.destinationRegions) !== canonical(["us-east-1", "us-east-2", "us-west-2"]) ||
        ![m.inputPricePerMillion, m.outputPricePerMillion].every(safePrice) ||
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
  if (receipt !== undefined) receipt = frozenCopy(receipt);
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
