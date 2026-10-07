import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATE, compare, listPrices, templateDefault } from "../scripts/check-prices.mjs";
import { DEFAULT_MODEL_ID, MODELS } from "../src/models.js";

const sources = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/prices-us-east-1.json", import.meta.url)), "utf8"));
const yaml = readFileSync(TEMPLATE, "utf8");

describe("reviewed geographic Standard prices", () => {
  it("reads all three primary sources without Global or cache discounts", () => {
    expect(listPrices(sources, "us.xai.grok-4.7")).toEqual({input:2.2,output:6.6});
    expect(listPrices(sources, "us.anthropic.claude-sonnet-5-5")).toEqual({input:2.2,output:11});
    expect(listPrices(sources, "us.openai.gpt-6.1-sol")).toEqual({input:2.2,output:11});
    expect(compare(yaml, sources).ok).toBe(true);
    expect(templateDefault(yaml, "Model")).toBe(MODELS[DEFAULT_MODEL_ID]!.key);
  });

  it("refuses a changed price and never switches to another model", () => {
    const changed = structuredClone(sources);
    changed.cards[DEFAULT_MODEL_ID].html = changed.cards[DEFAULT_MODEL_ID].html.replace("$6.60", "$9.90");
    const result = compare(yaml, changed);
    expect(result.ok).toBe(false);
    expect(result.defaultKey).toBe("grok47");
  });

  it("fails closed for missing Standard rows, unknown models and changed table shape", () => {
    const missing = structuredClone(sources);
    missing.cards[DEFAULT_MODEL_ID].html = missing.cards[DEFAULT_MODEL_ID].html.replace("Geo CRIS", "Other");
    expect(() => listPrices(missing, DEFAULT_MODEL_ID)).toThrow();
    expect(() => listPrices(sources, "global.xai.grok-4.7")).toThrow();
    expect(() => listPrices({}, "us.anthropic.claude-sonnet-5-5")).toThrow();
  });
});
