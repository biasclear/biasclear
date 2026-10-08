import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODELS, consentFingerprint } from "../src/models.js";
import { SALT_TTL_MS } from "../src/ratelimit.js";
import { SETTINGS_INTERVAL_MS } from "../src/state.js";
import { DAY_MS } from "../src/time.js";
import { DRAFT_FILE, consentFingerprintOf, privacyDraft, renderDrafts } from "../scripts/privacy-drafts.mjs";

describe("model-bound unpublished privacy copy", () => {
  it("binds maker, route and every location to each reviewed model", () => {
    for (const [id, model] of Object.entries(MODELS)) {
      const draft = privacyDraft(id, model);
      for (const text of [draft.consentText, draft.privacy]) {
        expect(text).toContain(model.displayName);
        expect(text).toContain(model.provider);
        expect(text).toContain("Amazon Bedrock");
        for (const region of model.destinationRegions) expect(text).toContain(region);
      }
      expect(draft.privacy).toContain(id);
      expect(draft.privacy).toContain("BiasClear does not request");
      expect(draft.privacy).toContain("Publishing this wording requires");
    }
  });

  it("says how long a settings change takes to stop Explain and what happens to the network address (306)", () => {
    // The copy is held to the code: each instance rechecks settings every SETTINGS_INTERVAL_MS, and the salt that
    // could link a stored hash to an address expires after SALT_TTL_MS.
    expect(SETTINGS_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(SALT_TTL_MS).toBe(2 * DAY_MS);
    for (const [id, model] of Object.entries(MODELS)) {
      const draft = privacyDraft(id, model);
      expect(draft.consentText).toContain("Explain stops within 15 minutes if that setting changes");
      expect(draft.consentText).not.toContain("Explain pauses if that setting changes");
      expect(draft.consentText).toContain("network address");
      for (const words of ["network address", "salted hash", "The address itself is never stored or logged", "expires after two days", "within 15 minutes"]) {
        expect(draft.privacy).toContain(words);
      }
    }
  });

  it("gives each model one consent fingerprint, the same in the service and in the site/deploy tools (314 M3)", () => {
    const seen = new Set<string>();
    for (const [id, model] of Object.entries(MODELS)) {
      const fingerprint = consentFingerprint(id, model);
      expect(fingerprint).toMatch(/^c1-[0-9a-f]{16}$/);
      expect(consentFingerprintOf(id, model)).toBe(fingerprint);
      expect(privacyDraft(id, model).consent).toBe(fingerprint);
      expect(readFileSync(DRAFT_FILE, "utf8")).toContain(fingerprint);
      seen.add(fingerprint);
      // Any change to what the consent names changes the fingerprint.
      for (const changed of [{ ...model, provider: "Other" }, { ...model, displayName: "Other" }, { ...model, destinationRegions: ["us-east-1"] }]) {
        expect(consentFingerprint(id, changed)).not.toBe(fingerprint);
      }
      expect(consentFingerprint(`${id}x`, model)).not.toBe(fingerprint);
    }
    expect(seen.size).toBe(Object.keys(MODELS).length);
  });

  it("refuses unknown or global locations rather than guessing privacy words", () => {
    const model = MODELS["us.xai.grok-4.7"]!;
    expect(() => privacyDraft("global.xai.grok-4.7", model)).toThrow();
    expect(() => privacyDraft("global.xai.grok-4.7", { ...model, route: "global-profile" })).toThrow();
    expect(() => privacyDraft("us.xai.grok-4.7", { ...model, destinationRegions: ["eu-west-1"] })).toThrow();
  });

  it("detects stale generated drafts without changing the public site", () => {
    expect(readFileSync(DRAFT_FILE, "utf8")).toBe(renderDrafts());
  });
});
