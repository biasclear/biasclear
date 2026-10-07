import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODELS } from "../src/models.js";
import { DRAFT_FILE, privacyDraft, renderDrafts } from "../scripts/privacy-drafts.mjs";

describe("model-bound unpublished privacy copy", () => {
  it("binds maker, route and every location to each reviewed model", () => {
    for (const [id, model] of Object.entries(MODELS)) {
      const draft = privacyDraft(id, model);
      for (const text of [draft.consent, draft.privacy]) {
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
