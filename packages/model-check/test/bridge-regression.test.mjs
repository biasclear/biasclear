import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bytesDigest, canonical, digest, importQuestionDraft, NEUTRAL_SET, runBinding,
  validateApproval, validateQuestionSet } from "../src/contracts.mjs";

const ARCHIVE_BYTES = await readFile(new URL("../drafts/questions.draft.json", import.meta.url));
const ARCHIVE_TEXT = ARCHIVE_BYTES.toString("utf8");
const ARCHIVE_HASH = "2a52b833ecc865856882ddae6340f64d368ef825fab53882e1f256c87c4f71af";
const QUESTION_FINGERPRINT = "e7854b60af9fc2208bb2134d22e77f59ba3af1850b9e038b0c6c4be14d098e67";
const bridge = () => importQuestionDraft(JSON.parse(ARCHIVE_TEXT), ARCHIVE_BYTES);

// These tests validate archive integrity only. They import no run function or
// adapter and never execute the unapproved archived questions, even as replays.
test("archived bridge survives repeated validation and JSON round trips", () => {
  assert.equal(bytesDigest(ARCHIVE_BYTES), ARCHIVE_HASH);
  const imported = bridge();
  const first = validateQuestionSet(imported);
  const second = validateQuestionSet(first.set);
  const roundTrip = validateQuestionSet(JSON.parse(JSON.stringify(second.set)));
  assert.equal(first.hash, second.hash);
  assert.equal(second.hash, roundTrip.hash);
  assert.deepEqual(imported, roundTrip.set);
  assert.equal(roundTrip.set.sourceDraftText, ARCHIVE_TEXT);
  assert.equal(roundTrip.set.sourceDraftSha256, ARCHIVE_HASH);
  assert.equal(roundTrip.set.id, `draft-${ARCHIVE_HASH.slice(0, 32)}`);
  assert.equal(roundTrip.set.sourceDraft.questionFingerprintSha256, QUESTION_FINGERPRINT);
  assert.equal(bytesDigest(JSON.stringify(JSON.parse(roundTrip.set.sourceDraftText).questions)), QUESTION_FINGERPRINT);
  // The frozen metadata is sorted; it cannot substitute for the original text.
  assert.notEqual(bytesDigest(JSON.stringify(roundTrip.set.sourceDraft.questions)), QUESTION_FINGERPRINT);
  assert.equal(Object.isFrozen(roundTrip.set.sourceDraft), true);
  assert.equal(roundTrip.set.sourceDraft.ownerApproved, false);
});

test("bridge refuses altered source bytes, hashes and copied metadata", () => {
  for (const change of [
    set => { set.sourceDraftText += "\n"; },
    set => { set.sourceDraftSha256 = "0".repeat(64); },
    set => { set.sourceDraft.preparedDate = "2026-10-08"; },
    set => { set.sourceDraft.ownerApproved = true; },
    set => { set.sourceDraft.status = "approved"; },
    set => { set.id = "oct07-unapproved-draft"; },
    set => { set.questions[0].text += " "; },
    set => { set.questions.reverse(); },
  ]) {
    const changed = structuredClone(bridge());
    change(changed);
    assert.throws(() => validateQuestionSet(changed), { code: "E_QUESTION_DRAFT_SOURCE_MISMATCH" });
  }
});

test("a bridge ID binds its source bytes, and a synthetic bridge still needs a separate receipt", () => {
  const document = { status: "unapproved-draft", preparedDate: "2026-10-08", ownerApproved: false,
    modelCallsExecuted: 0, stubQuestionRunsExecuted: 0, missingInstructionEnding: "synthetic fixture",
    proposedFirstRun: { questionsPerModel: 2, models: 1, answersPerQuestion: 1, plannedCalls: 2 },
    questionFingerprintSha256: "", questions: NEUTRAL_SET.questions.map(q => ({ id: q.id,
      axis: "neutral-unit-fixture", position: "control", question: q.text, kind: "plain-control" })) };
  document.questionFingerprintSha256 = bytesDigest(JSON.stringify(document.questions));
  const sourceText = JSON.stringify(document);
  const first = importQuestionDraft(document, sourceText);
  const binding = runBinding(digest(first), "0".repeat(64), ["us.fixture.alpha"], "general");
  assert.throws(() => validateApproval(first, binding, undefined), { code: "E_OWNER_APPROVAL_REQUIRED" });
  assert.equal(first.sourceDraft.ownerApproved, false);

  const relabelled = structuredClone(first);
  relabelled.id = "oct07-unapproved-draft";
  assert.throws(() => validateQuestionSet(relabelled), { code: "E_QUESTION_DRAFT_SOURCE_MISMATCH" });

  // Harmless formatting produces different bytes and therefore a different ID.
  const spaced = importQuestionDraft(document, `${sourceText}\n`);
  assert.notEqual(first.id, spaced.id);
  const staleId = structuredClone(spaced); staleId.id = first.id;
  assert.throws(() => validateQuestionSet(staleId), { code: "E_QUESTION_DRAFT_SOURCE_MISMATCH" });
  assert.notEqual(digest(first), digest(spaced));
  // Neither synthetic set, nor the archived set, is passed to an adapter here.
});

test("a plain question set cannot use the historical bridge ID namespaces", () => {
  for (const id of [`draft-${ARCHIVE_HASH.slice(0, 32)}`, "draft-synthetic", "oct07-unapproved-draft"]) {
    const plain = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft", id };
    assert.throws(() => validateQuestionSet(plain), { code: "E_QUESTION_SET" }, id);
  }
  const control = { ...structuredClone(NEUTRAL_SET), kind: "owner-draft", id: "neutral-owner-draft" };
  assert.equal(validateQuestionSet(control).set.id, control.id);
  assert.equal(validateQuestionSet(bridge()).set.id, `draft-${ARCHIVE_HASH.slice(0, 32)}`);
});

test("hand-built bridge cannot change archive status or approval even with matching source hashes", () => {
  for (const change of [
    document => { document.ownerApproved = true; },
    document => { document.status = "approved"; },
    document => { document.unexpectedMetadata = "added"; },
  ]) {
    const changed = structuredClone(bridge());
    const document = JSON.parse(ARCHIVE_TEXT);
    change(document);
    changed.sourceDraft = document;
    changed.sourceDraftText = JSON.stringify(document);
    changed.sourceDraftSha256 = bytesDigest(changed.sourceDraftText);
    assert.throws(() => validateQuestionSet(changed), { code: "E_QUESTION_DRAFT" });
  }
});

test("source reparsing rejects stale historical fingerprints and malformed JSON", () => {
  const reordered = structuredClone(bridge());
  reordered.sourceDraftText = canonical(JSON.parse(ARCHIVE_TEXT));
  reordered.sourceDraftSha256 = bytesDigest(reordered.sourceDraftText);
  assert.throws(() => validateQuestionSet(reordered), { code: "E_QUESTION_DRAFT_FINGERPRINT" });

  const changed = structuredClone(bridge());
  const document = JSON.parse(ARCHIVE_TEXT);
  document.questions[0].question += " ";
  changed.sourceDraft = document;
  changed.sourceDraftText = JSON.stringify(document);
  changed.sourceDraftSha256 = bytesDigest(changed.sourceDraftText);
  assert.throws(() => validateQuestionSet(changed), { code: "E_QUESTION_DRAFT_FINGERPRINT" });

  const malformed = structuredClone(bridge());
  malformed.sourceDraftText = "{";
  malformed.sourceDraftSha256 = bytesDigest(malformed.sourceDraftText);
  assert.throws(() => validateQuestionSet(malformed), { code: "E_QUESTION_DRAFT" });
});

test("import requires exact UTF-8 source and retains text supplied as a string", () => {
  const stringImport = importQuestionDraft(JSON.parse(ARCHIVE_TEXT), ARCHIVE_TEXT);
  assert.deepEqual(stringImport, bridge());
  assert.equal(validateQuestionSet(stringImport).set.sourceDraftText, ARCHIVE_TEXT);

  const invalidBytes = Buffer.from(ARCHIVE_BYTES);
  invalidBytes[ARCHIVE_TEXT.indexOf("unapproved-draft")] = 0xff;
  assert.throws(() => importQuestionDraft(JSON.parse(ARCHIVE_TEXT), invalidBytes), { code: "E_QUESTION_DRAFT_SOURCE_MISMATCH" });
});
