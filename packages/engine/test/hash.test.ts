// rulesHash. scripts/gen-pack.mjs computes it at build time with node:crypto
// (so scan() stays synchronous) and embeds it with the pack. These tests
// recompute it at test time, with Web Crypto (crypto.subtle.digest, as a
// browser would) and with node:crypto. scripts/parity.mjs checks it against
// Python's rules_hash.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACK_JSON, RULES_HASH } from "../src/generated/pack.js";
import { rulePack, scan } from "../src/index.js";
import { PACK_PATH, canonicalJson } from "../scripts/gen-pack.mjs";
import { SLOW } from "./helpers.js";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("rulesHash", () => {
  it("is what scan() reports", () => {
    expect(RULES_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(scan("").rulesHash).toBe(RULES_HASH);
  }, SLOW);

  it("was built from the current rules/biasclear-rules.json", () => {
    const pack: unknown = JSON.parse(readFileSync(PACK_PATH, "utf8"));
    expect(PACK_JSON).toBe(canonicalJson(pack));
    expect(rulePack()).toEqual(pack);
  });

  it("equals SHA-256 of the canonical pack, computed with Web Crypto", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PACK_JSON));
    expect(toHex(digest)).toBe(RULES_HASH);
  });

  it("equals SHA-256 of the canonical pack, computed with node:crypto", () => {
    expect(createHash("sha256").update(PACK_JSON, "utf8").digest("hex")).toBe(RULES_HASH);
  });
});

describe("canonicalJson (RFC 8785)", () => {
  it("sorts keys by UTF-16 code units (RFC 8785, section 3.2.3)", () => {
    const value = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\u{1f600}": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    // (Object.keys would list "1" first, so read the order from the text.)
    const text = canonicalJson(value);
    const keys = Object.keys(value).sort((a, b) => text.indexOf(JSON.stringify(a) + ":") - text.indexOf(JSON.stringify(b) + ":"));
    expect(keys).toEqual(["\r", "1", "\u0080", "\u00f6", "\u20ac", "\u{1f600}", "\ufb33"]);
  });

  it("writes no whitespace and escapes strings as JSON.stringify does", () => {
    expect(canonicalJson({ b: [1, true, null], a: "\u00e9\"\\\n\u001f" })).toBe('{"a":"\u00e9\\"\\\\\\n\\u001f","b":[1,true,null]}');
    expect(canonicalJson([{}, [], ""])).toBe('[{},[],""]');
  });

  it("leaves the embedded pack unchanged when re-serialized", () => {
    // Sorted keys and no whitespace: JSON.stringify of the parsed pack gives
    // the same text back. The byte-for-byte check against Python's canonical
    // form is the hash comparison in scripts/parity.mjs.
    expect(JSON.stringify(JSON.parse(PACK_JSON))).toBe(PACK_JSON);
    expect(canonicalJson(JSON.parse(PACK_JSON))).toBe(PACK_JSON);
  });
});
