// The reviewed phrase bank (data/explain-phrases.json) that composed
// explanations are written from. Every phrase is the visitor-facing text, so
// the bank itself is held to the prompt's rules: it describes wording, never
// the claim, names no one and takes no side.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOES_MIN, bankFrom, bundledBank, pickLimits, render, withinLimits } from "../src/compose.js";
import { bundledMoves } from "../src/moves.js";
import { SIDE_FAMILIES } from "../src/output.js";

const bank = bundledBank();
const moves = bundledMoves();
const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../data/explain-phrases.json", import.meta.url)), "utf8"));

/** Words no phrase may use: verdicts on a claim, judgements of people, motives, orders, the reader or model in person. */
const BANNED =
  /\b(?:true|truth|false|right|wrong|correct|accurate|likely|unlikely|probable|good|bad|better|worse|best|worst|settled|proven|valid|fair|unfair|honest|dishonest|lie|lies|liar|lying|propaganda|fallacy|bias|biased|misleading|misinformation|disinformation|manipulat\w*|trick\w*|wants?|tries|trying|hides?|hiding|agenda|motives?|should|must|ought|you|your|yours|i|we|our|us|me|my|fool|foolish|stupid|idiot\w*|evil|shameful|disgrace\w*|racist|sexist|hateful|biasclear)\b/iu;

describe("the phrase bank", () => {
  it("covers every move exactly, with 4 to 6 does phrases and 4 to 8 unsaid items each", () => {
    expect(new Set(Object.keys(raw.moves))).toEqual(new Set(moves.keys()));
    for (const [id, p] of bank) {
      expect(p.does.size, id).toBeGreaterThanOrEqual(4);
      expect(p.does.size, id).toBeLessThanOrEqual(6);
      expect(p.unsaid.size, id).toBeGreaterThanOrEqual(4);
      expect(p.unsaid.size, id).toBeLessThanOrEqual(8);
    }
  });

  it("holds every phrase to the rules: short, plain, no verdict, judgement, motive, order, name, number or side", () => {
    for (const [id, p] of bank) {
      for (const text of [...p.does.values(), ...p.unsaid.values()]) {
        const where = `${id}: ${text}`;
        expect(text.split(/\s+/u).length, where).toBeLessThanOrEqual(12);
        // A word the move's own short line uses ("Makes disagreeing feel foolish") describes the lever, not a person.
        const own = new Set(moves.get(id)!.short.toLowerCase().match(/[a-z]+/gu) ?? []);
        const hits = (text.match(new RegExp(BANNED.source, "giu")) ?? []).filter((w) => !own.has(w.toLowerCase()));
        expect(hits, where).toEqual([]);
        expect(text, where).not.toMatch(/\d/u);
        expect(text, where).toMatch(/^[a-z][a-z ,'\-]*$/u); // lowercase plain words: no names, quotes, links or markup
        for (const [family, pattern] of SIDE_FAMILIES) expect(pattern.test(text), `${where} (${family})`).toBe(false);
      }
    }
  });

  it("writes grammatical sentences for a one-word and a several-word mark", () => {
    for (const [id, p] of bank) {
      for (const text of p.does.values()) {
        const many = render("every serious economist agrees", [text], []);
        const one = render("inevitable", [text], []);
        expect(many, id).toBe(`The words “every serious economist agrees” ${text}.`);
        expect(one.startsWith('The word “inevitable” '), id).toBe(true);
        // The first verb takes -s for one word, and nothing else changes.
        expect(one.split(" ").slice(4).join(" "), id).toBe(text.split(" ").slice(1).join(" ") + ".");
      }
    }
  });

  // Word-count accounting is unchanged: the limits (400 characters, 60 words, 3 sentences) count the
  // whole explanation as shown, the quoted mark included. pickLimits sizes each request's picks so
  // that every choice within them fits; here every such choice is rendered and measured.
  it("fits every choice within the per-mark pick limits, for marks of 1 to 30 words", () => {
    const subsets = (ids: string[], max: number): string[][] => {
      const out: string[][] = [[]];
      for (const id of ids) for (const s of [...out]) if (s.length < max) out.push([...s, id]);
      return out;
    };
    for (const [id, p] of bank) {
      for (const n of [1, 4, 8, 12, 18, 30]) {
        const mark = Array.from({ length: n }, (_, i) => (i % 2 ? "unquestionably" : "everyone")).join(" ");
        const limits = pickLimits(id, mark);
        if (limits === undefined) {
          expect(withinLimits(render(mark, [[...p.does.values()].sort((a, b) => a.length - b.length)[0]!], [])), `${id} ${n}`).toBe(false);
          continue;
        }
        for (const d of subsets([...p.does.values()], limits.does).filter((s) => s.length >= DOES_MIN)) {
          for (const u of subsets([...p.unsaid.values()], limits.unsaid)) {
            expect(withinLimits(render(mark, d, u)), `${id} ${n} ${d.length}+${u.length}`).toBe(true);
          }
        }
      }
    }
  });

  it("leaves every move room for one phrase and two unsaid items with an eight-word mark", () => {
    const mark = "unquestionably everyone unquestionably everyone unquestionably everyone unquestionably everyone";
    for (const id of bank.keys()) {
      const limits = pickLimits(id, mark);
      expect(limits, id).toBeDefined();
      expect(limits!.unsaid, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("refuses a malformed bank instead of guessing", () => {
    expect(() => bankFrom({})).toThrow();
    expect(() => bankFrom({ moves: { X: { does: { x1: "treat it" }, unsaid: {} } } })).toThrow();
    expect(() => bankFrom({ moves: { X: { does: {}, unsaid: { u1: "who" } } } })).toThrow();
    expect(() => bankFrom({ moves: { X: { does: { d1: "" }, unsaid: {} } } })).toThrow();
  });
});
