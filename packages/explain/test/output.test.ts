// The model's reply, checked (src/output.ts) and composed (src/compose.ts).
// The explanation is never the model's own text: the reply names reviewed
// phrases by id and the server writes the sentence. These tests cover the
// composed answer, every way a reply can be malformed, the free-text answers
// earlier red teams got through (all refused now, by shape), and the rewrite
// ("plainer") checks, which are unchanged.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOES_MAX, UNSAID_MAX, bundledBank, compose, pickLimits, quotable, render, thirdPerson } from "../src/compose.js";
import { bundledEngines, type Domain } from "../src/engines.js";
import { bundledMoves } from "../src/moves.js";
import {
  CONTRAST_WORDS,
  NEGATION_WORDS,
  REWRITE_NEW_WORDS,
  REWRITE_NEW_WORDS_BY_RULE,
  SIDE_PAIRS,
  checkReply,
  type CheckContext,
} from "../src/output.js";
import { sentenceCount, startsSentence } from "../src/text.js";
import { GOOD_PLAINER, SENTENCE } from "./helpers.js";

const engines = bundledEngines();
const engine = engines.builds.get(engines.current)!;
const moves = bundledMoves();
const bank = bundledBank();
const fixture = (name: string): any =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

function ctx(sentence: string, ruleId: string, domain: Domain = "general", mode: CheckContext["mode"] = "how-and-plainer"): CheckContext {
  const marks = engine.scan(sentence, domain);
  const mark = marks.find((m) => m.ruleId === ruleId);
  if (!mark) throw new Error(`fixture not marked: ${sentence}`);
  return {
    mode,
    sentence,
    start: mark.start,
    end: mark.end,
    ruleId,
    domain,
    moveName: moves.get(ruleId)!.name,
    engine,
    sentenceRuleIds: new Set(marks.map((m) => m.ruleId)),
    ruleSpans: marks.filter((m) => m.ruleId === ruleId).map((m) => ({ start: m.start, end: m.end })),
  };
}

/** A model reply holding exactly `payload` as its one text block. */
const reply = (payload: unknown, stop = "end_turn") => ({ content: [{ type: "text", text: JSON.stringify(payload) }], stop_reason: stop });

const firstDoes = (rule: string): string => [...bank.get(rule)!.does.keys()][0]!;
const firstUnsaid = (rule: string): string => [...bank.get(rule)!.unsaid.keys()][0]!;

/**
 * The rewrite checks, through a valid composed choice for the rule. The
 * second argument (an old free-text explanation) is ignored: no free text is
 * shown any more.
 */
function check(c: CheckContext, _how: string, plainer: string | null = GOOD_PLAINER) {
  const payload: Record<string, unknown> = { does: [firstDoes(c.ruleId)], unsaid: [] };
  if (plainer !== null) payload.plainer = plainer;
  return checkReply(reply(payload), plainer === null ? { ...c, mode: "how-only" } : c);
}

const consensus = ctx(SENTENCE, "CONSENSUS_AS_EVIDENCE");
const CITED = "Mayor Okafor says every serious economist agrees the plan will cut rents.";

describe("composed answers", () => {
  it("writes the explanation from the chosen phrases, the mark quoted exactly as the visitor wrote it", () => {
    const rule = "CONSENSUS_AS_EVIDENCE";
    const p = bank.get(rule)!;
    const [d1, d2] = [...p.does.keys()];
    const [u1, u2, u3] = [...p.unsaid.keys()];
    const r = checkReply(reply({ does: [d1, d2], unsaid: [u1, u2, u3], plainer: GOOD_PLAINER }), consensus);
    expect(r).toMatchObject({ ok: true, plainerState: "kept" });
    const how = (r as { how: string }).how;
    expect(how).toBe(
      `The words “Every serious economist agrees” ${p.does.get(d1!)}, and ${p.does.get(d2!)}. ` +
        `The sentence does not say ${p.unsaid.get(u1!)}, ${p.unsaid.get(u2!)} or ${p.unsaid.get(u3!)}.`,
    );
  });

  it("leaves out the second sentence when nothing is chosen for it, and works without a rewrite", () => {
    const r = checkReply(reply({ does: [firstDoes("CONSENSUS_AS_EVIDENCE")], unsaid: [] }), { ...consensus, mode: "how-only" });
    expect(r).toMatchObject({ ok: true, plainer: null, plainerState: "off" });
    expect((r as { how: string }).how).not.toMatch(/does not say/u);
  });

  it("uses the singular for a one-word mark", () => {
    expect(render("inevitable", ["present the outcome as already decided"], [])).toBe('The word “inevitable” presents the outcome as already decided.');
    expect(thirdPerson("imply")).toBe("implies");
    expect(thirdPerson("push")).toBe("pushes");
    expect(thirdPerson("treat")).toBe("treats");
    expect(thirdPerson("say")).toBe("says");
  });

  it("joins one, two or three unsaid items plainly", () => {
    expect(render("a b", ["x"], ["p"])).toBe('The words “a b” x. The sentence does not say p.');
    expect(render("a b", ["x"], ["p", "q"])).toBe('The words “a b” x. The sentence does not say p or q.');
    expect(render("a b", ["x", "y"], ["p", "q", "r"])).toBe('The words “a b” x, and y. The sentence does not say p, q or r.');
  });

  it("has a choice for every move the checker can mark, and every composed answer is short plain text", () => {
    for (const id of moves.keys()) {
      const p = bank.get(id);
      expect(p, id).toBeDefined();
      for (const d of p!.does.keys()) {
        const r = compose(id, "Every serious economist agrees", [d], [...p!.unsaid.keys()].slice(0, UNSAID_MAX));
        expect(r.ok, `${id} ${d}`).toBe(true);
      }
    }
  });
});

describe("replies that are refused", () => {
  const rule = "CONSENSUS_AS_EVIDENCE";
  const d = firstDoes(rule);
  const u = firstUnsaid(rule);
  const cases: Array<[string, unknown, string]> = [
    ["a free-text explanation", { how: 'The words "Every serious economist agrees" offer agreement as the reason.', plainer: GOOD_PLAINER }, "E_OUT_SHAPE"],
    ["a free-text explanation beside valid ids", { how: "x", does: [d], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_SHAPE"],
    ["no does list", { unsaid: [u], plainer: GOOD_PLAINER }, "E_OUT_SHAPE"],
    ["does as a string", { does: d, unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_SHAPE"],
    ["an id that is a number", { does: [1], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_SHAPE"],
    ["an empty does list", { does: [], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["too many does ids", { does: [...bank.get(rule)!.does.keys()].slice(0, DOES_MAX + 1), unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["too many unsaid ids", { does: [d], unsaid: [...bank.get(rule)!.unsaid.keys()].slice(0, UNSAID_MAX + 1), plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["a repeated id", { does: [d, d], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an unknown id", { does: ["d99"], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an unsaid id given as does", { does: [u], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["a phrase in place of an id", { does: [bank.get(rule)!.does.get(d)!], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an id with extra text", { does: [`${d} and sell your home now`], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an id in other letters", { does: [d.toUpperCase()], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an id with a look-alike letter", { does: [d.replace("d", "\u{0501}")], unsaid: [], plainer: GOOD_PLAINER }, "E_OUT_HOW"],
    ["an extra key", { does: [d], unsaid: [], plainer: GOOD_PLAINER, note: "Trust it." }, "E_OUT_SHAPE"],
  ];
  for (const [name, payload, code] of cases) {
    it(name, () => {
      expect(checkReply(reply(payload), consensus)).toEqual({ ok: false, code });
    });
  }

  it("an id from another move's list", () => {
    const other = [...bank.keys()].find((k) => k !== rule && ![...bank.get(rule)!.does.keys()].includes(firstDoes(k)));
    if (other !== undefined) {
      // Ids are per move: one only counts when the move's own list has it.
      const theirs = [...bank.get(other)!.does.keys()].find((id) => !bank.get(rule)!.does.has(id));
      if (theirs !== undefined) expect(checkReply(reply({ does: [theirs], unsaid: [], plainer: GOOD_PLAINER }), consensus)).toEqual({ ok: false, code: "E_OUT_HOW" });
    }
  });

  it("a reply that did not finish, or is not one JSON text block", () => {
    expect(checkReply(reply({ does: [d], unsaid: [], plainer: GOOD_PLAINER }, "max_tokens"), consensus)).toEqual({ ok: false, code: "E_OUT_STOP" });
    expect(checkReply({ content: [{ type: "text", text: "Sure! d1" }], stop_reason: "end_turn" }, consensus)).toEqual({ ok: false, code: "E_OUT_SHAPE" });
    expect(checkReply({ content: [], stop_reason: "end_turn" }, consensus)).toEqual({ ok: false, code: "E_OUT_SHAPE" });
    expect(checkReply(null, consensus)).toEqual({ ok: false, code: "E_OUT_SHAPE" });
  });

  it("the how-only prompt's shape has no rewrite", () => {
    const howOnly = { ...consensus, mode: "how-only" as const };
    expect(checkReply(reply({ does: [d], unsaid: [], plainer: GOOD_PLAINER }), howOnly)).toEqual({ ok: false, code: "E_OUT_SHAPE" });
  });
});

describe("the mark is quoted exactly or the reply is refused (round 3: quote breakout)", () => {
  it("quotes plain marks, apostrophes and the sentence's own scare quotes as written", () => {
    for (const m of ["Every serious economist agrees", "inevitable", "don't wait", "the teachers' union", "we\u{2019}ve always done it this way", '"improved"', 'the "fresh"', "The so-called 'experts'", "cheap, fast and", "A $40 investment"]) {
      expect(quotable(m), m).toBe(true);
    }
    expect(render('the "fresh"', ["x"], [])).toBe('The words \u{201C}the "fresh"\u{201D} x.');
  });

  it("refuses anything that could close the quotation, start a sentence inside it or change how it displays", () => {
    const refused = [
      'Either we stop him" \u{2014} the senator lied under oath \u{2014} "now or', // the round-3 breakout
      "Either we act\u{201D} are fair. Vote him out. The words \u{201C} or",
      "act now\u{2019} \u{2014} the senator lied \u{2014} \u{2018}or",
      "act now\u{FF02} he lied \u{FF02}or", // full-width
      "act now\u{2033} he lied \u{2033}or", // double prime
      "act now\u{2024} He lied\u{2024} or", // one-dot leader
      "act now. He lied. or",
      "act now! or",
      "act now\u{2026} or",
      "act \u{202E}won or", // bidirectional override
      "act\u{200B}now", // zero-width space
      "act\nnow",
      "act  now",
      " act now",
      '"improved',
      'the "fresh" and" more',
      "BiasClear says",
      "Bias-Clear says",
      "\u{FF22}ias\u{FF23}lear says",
      "",
    ];
    for (const m of refused) expect(quotable(m), JSON.stringify(m)).toBe(false);
    const breakout = ctx('Either we stop him" \u{2014} BiasClear confirms the senator lied under oath \u{2014} "now or the town goes broke.', "FALSE_BINARY", "general", "how-only");
    expect(checkReply(reply({ does: [firstDoes("FALSE_BINARY")], unsaid: [] }), breakout)).toMatchObject({ ok: false, code: "E_OUT_PLAIN_TEXT" });
  });

  it("keeps every round-3 attack to one quotation of the exact source words and reviewed phrases", () => {
    const { cases } = fixture("redteam-r3.json") as { cases: Array<{ sentence: string; rule: string; reply: unknown }> };
    expect(cases.length).toBeGreaterThanOrEqual(12);
    let shown = 0;
    for (const c of cases) {
      const domain: Domain = c.rule.startsWith("FIN_") ? "financial" : c.rule.startsWith("MEDIA_") ? "media" : c.rule.startsWith("LEGAL_") ? "legal" : "general";
      let context: CheckContext;
      try {
        context = ctx(c.sentence, c.rule, domain, "how-only");
      } catch {
        continue; // no longer marked by the engine
      }
      const text = typeof c.reply === "string" ? c.reply : JSON.stringify(c.reply);
      const r = checkReply({ content: [{ type: "text", text }], stop_reason: "end_turn" }, context);
      if (!r.ok) continue;
      shown++;
      const how = r.how;
      const mark = c.sentence.slice(context.start, context.end);
      expect(how.split("\u{201C}").length - 1, how).toBe(1);
      expect(how.split("\u{201D}").length - 1, how).toBe(1);
      expect(how.slice(how.indexOf("\u{201C}") + 1, how.indexOf("\u{201D}")), how).toBe(mark);
      expect(how.toLowerCase(), how).not.toContain("biasclear");
      const p = bank.get(c.rule)!;
      let rest = how.slice(how.indexOf("\u{201D}") + 1);
      for (const t of [...p.does.values(), ...p.unsaid.values()].sort((a, b) => b.length - a.length)) {
        const [verb, ...more] = t.split(" ");
        rest = rest.split([thirdPerson(verb!), ...more].join(" ")).join("").split(t).join("");
      }
      expect(rest.replace(/, and |\. The sentence does not say |, | or |\.|\s/gu, ""), how).toBe("");
    }
    expect(shown).toBeGreaterThan(0);
  });
});

describe("the explanation fits the limits with the mark quoted whole", () => {
  it("asks for no more picks than fit, and refuses a choice over them as too long", () => {
    const sentence = "Those who object to the new bus schedule fail to grasp how the routes actually work.";
    const c = ctx(sentence, "COMPETENCE_DISMISSAL", "general", "how-only");
    const limits = pickLimits("COMPETENCE_DISMISSAL", sentence.slice(c.start, c.end))!;
    expect(limits.does + limits.unsaid).toBeLessThan(5);
    const p = bank.get("COMPETENCE_DISMISSAL")!;
    const over = { does: [...p.does.keys()].slice(0, 2), unsaid: [...p.unsaid.keys()].slice(0, 3) };
    expect(checkReply(reply(over), c)).toMatchObject({ ok: false, code: "E_OUT_HOW" });
    const within = { does: [...p.does.keys()].slice(0, limits.does), unsaid: [...p.unsaid.keys()].slice(0, limits.unsaid) };
    expect(checkReply(reply(within), c).ok).toBe(true);
  });

  it("refuses a mark too long for even one phrase, without shortening it", () => {
    const long = Array.from({ length: 58 }, (_, i) => `word${i}`).join(" ");
    expect(pickLimits("FALSE_BINARY", long)).toBeUndefined();
    expect(compose("FALSE_BINARY", long, [firstDoes("FALSE_BINARY")], [])).toEqual({ ok: false, reason: "long" });
  });
});

describe("free-text answers that got through earlier checkers are refused (both modes)", () => {
  type Case = { sentence: string; rule: string; domain?: Domain; how: string; plainer?: string | null };
  const sets: Array<[string, Case[]]> = [
    ["round 1 (Drive 298, 173 cases)", (fixture("redteam-bypasses.json") as { cases: Case[] }).cases],
    ["round 2 (controlled grammar, 308 confirmed cases)", (fixture("redteam-r2.json") as { cases: Case[] }).cases],
  ];
  for (const [name, cases] of sets) {
    it(name, () => {
      expect(cases.length).toBeGreaterThan(100);
      for (const c of cases) {
        let context: CheckContext;
        try {
          context = ctx(c.sentence, c.rule, c.domain ?? "general");
        } catch {
          continue; // a sentence the engine no longer marks for that rule can't reach the model at all
        }
        expect(checkReply(reply({ how: c.how }), { ...context, mode: "how-only" }).ok, c.how).toBe(false);
        expect(checkReply(reply({ how: c.how, plainer: c.sentence }), context).ok, c.how).toBe(false);
      }
    });
  }
});

describe("a rewrite may not bring in a side or group the sentence lacks, for either side alike", () => {
  const SAMPLE: Record<string, string> = {
    left: "the left", right: "the right", progressive: "progressives", conservative: "conservatives",
    liberal: "liberals", libertarian: "libertarians", socialist: "socialists", capitalist: "capitalists",
    communist: "communists", fascist: "fascists", marxist: "marxists", nazi: "nazis", populist: "populists",
    establishment: "the establishment", nationalist: "nationalists", globalist: "globalists", democrat: "democrats",
    republican: "republicans", woke: "woke groups", maga: "maga groups", antifa: "antifa", "alt-right": "the alt-right",
    feminist: "feminists", traditionalist: "traditionalists", activist: "activists", lobbyist: "lobbyists",
    elite: "elites", "ordinary people": "ordinary voters", radical: "radicals", moderate: "moderates",
    immigrant: "immigrants", "native-born": "natives", union: "unions", business: "big business",
    worker: "workers", employer: "employers", landlord: "landlords", tenant: "tenants", wealthy: "the wealthy",
    poor: "the poor", alarmist: "alarmists", denier: "deniers", urban: "city dwellers", rural: "rural voters",
    young: "millennials", old: "boomers", men: "men", women: "women", police: "the police", protesters: "protesters",
    religious: "believers", secular: "secularists",
  };
  for (const [[a], [b]] of SIDE_PAIRS) {
    it(`${a} / ${b}`, () => {
      const results = [a, b].map((g) =>
        check(consensus, "", `Many economists say that the Harlan Valley plan will lower rents for ${SAMPLE[g!]} within two years.`),
      );
      expect(results[0]!.ok ? "ok" : results[0]!.code).toBe(results[1]!.ok ? "ok" : results[1]!.code);
    });
  }
});

describe("rewrites that are dropped (plainer: null)", () => {
  const cited = ctx(CITED, "CONSENSUS_AS_EVIDENCE");
  const how = 'The words "every serious economist agrees" offer agreement as the reason to accept the forecast.';
  const cases: Array<[string, string, string]> = [
    ["drops the cited speaker", "Economists say the plan will cut rents.", "P_SPEAKER"],
    ["changes \"will\" to \"may\"", "Mayor Okafor says economists think the plan may cut rents.", "P_CERTAINTY"],
    ["drops \"will\"", "Mayor Okafor says economists think the plan cuts rents.", "P_CERTAINTY"],
    ["adds a new move", "Mayor Okafor says the plan will cut rents, so act now.", "P_MOVE"],
    ["keeps the move", "Mayor Okafor says every serious economist agrees the plan will cut rents.", "P_MOVE"],
  ];
  for (const [name, plainer, state] of cases) {
    it(name, () => {
      expect(check(cited, how, plainer)).toMatchObject({ ok: true, plainer: null, plainerState: state });
    });
  }

  it("keeps a rewrite that keeps the speaker and the certainty", () => {
    const plainer = "Mayor Okafor says economists think the plan will cut rents.";
    expect(check(cited, how, plainer)).toMatchObject({ ok: true, plainer, plainerState: "kept" });
  });
});

describe("text helpers", () => {
  it("counts sentences in plain prose", () => {
    expect(sentenceCount("One. Two! Three?")).toBe(3);
    expect(sentenceCount('He said "stop." Then left.')).toBe(2);
    expect(sentenceCount("No end")).toBe(1);
  });

  it("knows which words start a sentence", () => {
    const t = 'First word. "Second" here, not Third.';
    expect(startsSentence(t, 0)).toBe(true);
    expect(startsSentence(t, t.indexOf("Second"))).toBe(true);
    expect(startsSentence(t, t.indexOf("Third"))).toBe(false);
  });
});

describe("rewrites that turn the claim around (RT: kept as 'the same sentence')", () => {
  const how = 'The words "Studies show" point to research without naming it, so the reader has to take the claim on trust.';
  const cases: Array<[string, string, string]> = [
    ["Studies show immigrants raise crime rates.", "Immigrants lower crime rates.", "raise becomes lower"],
    ["Studies show immigrants raise crime rates.", "Immigrants do not raise crime rates.", "a not is added"],
    ["Studies show gun owners lower crime rates.", "Gun owners do not lower crime rates.", "a not is added (mirror)"],
    ["Studies show gun owners lower crime rates.", "Gun owners no longer lower crime rates.", "a no is added"],
    ["Studies show all gun owners lower crime rates.", "Some gun owners lower crime rates.", "all becomes some"],
  ];
  for (const [sentence, plainer, name] of cases) {
    it(`drops the rewrite when ${name}`, () => {
      expect(check(ctx(sentence, "CLAIM_WITHOUT_CITATION"), how, plainer)).toMatchObject({ ok: true, plainer: null, plainerState: "P_CLAIM" });
    });
  }

  it("keeps a marked-span rewrite and drops a reordered paraphrase", () => {
    const c = ctx("Studies show immigrants raise crime rates.", "CLAIM_WITHOUT_CITATION");
    expect(check(c, how, "Immigrants raise crime rates, according to some studies.")).toMatchObject({ plainer: null, plainerState: "P_CLAIM" });
    expect(check(c, how, "Some studies say immigrants raise crime rates.")).toMatchObject({ plainerState: "kept" });
  });

  it("drops a rewrite that also changes unmarked grammar", () => {
    const c = ctx("Critics of the conservative mayor are spreading misinformation.", "DISSENT_DISMISSAL");
    const h = 'The word "misinformation" labels the critics’ view instead of answering it.';
    expect(check(c, h, "Critics of the conservative mayor disagree with the mayor.")).toMatchObject({ plainer: null, plainerState: "P_CLAIM" });
  });

  it("counts the negations outside the mark exactly: the mark's own \"No\" may go, no \"not\" may come in", () => {
    const sentence = "No serious scientist disputes that the Harlan plan will cut rents.";
    const c = ctx(sentence, "DISSENT_DISMISSAL");
    const h = 'The words "No serious scientist disputes" treat the absence of dissent as proof.';
    expect(check(c, h, "Some scientists say that the Harlan plan will cut rents.")).toMatchObject({ plainerState: "kept" });
    expect(check(c, h, "Some scientists say that the Harlan plan will not cut rents.")).toMatchObject({ plainerState: "P_CLAIM" });
    expect(check(c, h, "Scientists do not dispute that the Harlan plan will cut rents.")).toMatchObject({ plainerState: "P_CLAIM" });
  });
});

describe("honest explanations still pass; unsupported rewrites are omitted", () => {
  const cases: Array<[string, string, string, string, string]> = [
    ["Every serious economist agrees the Harlan plan will cut rents.", "CONSENSUS_AS_EVIDENCE",
      'The words "Every serious economist agrees" offer agreement as the reason to believe the forecast, without saying what evidence is behind it.',
      "Some economists say the Harlan plan will cut rents.", "kept"],
    ["Critics of the progressive mayor are spreading misinformation.", "DISSENT_DISMISSAL",
      'Calling the view "misinformation" sets it aside without answering it.',
      "Critics of the progressive mayor disagree with the mayor.", "P_CLAIM"],
    ["Any decent person can see that left-wing activists are right.", "MORAL_HIGH_GROUND",
      "The words 'Any decent person can see' tie agreement to being decent, so disagreeing feels like a moral failing rather than a different reading.",
      "Left-wing activists are right.", "P_CLAIM"],
    ["We must act now to stop the left before it is too late.", "FEAR_URGENCY",
      'The words "act now" and "too late" set a deadline without saying what happens if the reader waits.',
      "We must stop the left.", "P_CLAIM"],
    ["The Center for Ostrevan Progress has concluded that the tax cut will pay for itself.", "INSTITUTIONAL_POSITION_AS_SETTLED",
      'The words "has concluded that" present the finding as settled without the reasons or evidence behind it.',
      "The Center for Ostrevan Progress says the tax cut will pay for itself.", "P_CLAIM"],
    ["Only a fool would still doubt that the company protects workers.", "SHAME_LEVER",
      "Doubting the claim is framed as foolish by 'Only a fool', which gives no reason.",
      "Some people still doubt that the company protects workers.", "P_CLAIM"],
  ];
  for (const [sentence, rule, how, plainer, state] of cases) {
    it(`${rule}: ${sentence}`, () => {
      expect(check(ctx(sentence, rule), how, plainer)).toMatchObject({ ok: true, plainerState: state });
    });
  }

});

describe("rewrites that take a side, turn the claim around or keep the move in other words (RT2: kept as 'the same sentence')", () => {
  const how = 'The words "Every serious economist agrees" offer agreement as the reason.';
  it("drops a rewrite that reverses the consensus", () => {
    for (const plainer of [
      "A few economists claim that the Harlan Valley plan will lower rents within two years, though most doubt it.",
      "Economists disagree whether the Harlan Valley plan will lower rents within two years.",
      "Economists disagree that the Harlan Valley plan will lower rents within two years.",
      "Most economists doubt that the Harlan Valley plan will lower rents within two years.",
      "Many economists say that the Harlan Valley plan will lower rents within two years, but others say it will not.",
    ]) {
      expect(check(consensus, how, plainer), plainer).toMatchObject({ ok: true, plainer: null, plainerState: "P_CLAIM" });
    }
    expect(check(consensus, how, GOOD_PLAINER)).toMatchObject({ plainerState: "kept" });
    expect(check(consensus, how, "Some economists say that the Harlan Valley plan will lower rents within two years.")).toMatchObject({ plainerState: "kept" });
  });

  for (const side of ["Conservatives", "Progressives"]) {
    const c = ctx(`${side} who oppose the Marchmont plan are spreading misinformation.`, "DISSENT_DISMISSAL");
    const h = 'The word "misinformation" labels the view instead of answering it.';
    it(`${side}: refuses or drops a rewrite that takes a side or keeps the label in a synonym`, () => {
      for (const tail of ["have good reasons", "are sadly wrongheaded", "are spreading falsehoods"]) {
        expect(check(c, h, `${side} who oppose the Marchmont plan ${tail}.`), tail).toEqual({ ok: false, code: "E_OUT_VERDICT" });
      }
      for (const tail of ["have strong objections", "are spreading untruths", "are right about it", "raise real concerns"]) {
        const r = check(c, h, `${side} who oppose the Marchmont plan ${tail}.`);
        expect(r.ok ? r.plainerState : r.code, tail).not.toBe("kept");
      }
      expect(check(c, h, `${side} who oppose the Marchmont plan disagree with it.`)).toMatchObject({ plainer: null, plainerState: "P_CLAIM" });
    });
  }

  it("refuses contrast words in a rewrite even where a move's own list might allow them, and every list stays neutral", () => {
    for (const w of CONTRAST_WORDS) {
      expect(REWRITE_NEW_WORDS.has(w), w).toBe(false);
      for (const list of Object.values(REWRITE_NEW_WORDS_BY_RULE)) expect(list, w).not.toContain(w);
    }
    for (const list of Object.values(REWRITE_NEW_WORDS_BY_RULE)) {
      for (const w of list) expect(NEGATION_WORDS.has(w), w).toBe(false);
    }
  });
});

describe("rewrite order and grammar are protected, beyond a bag of content words", () => {
  const fixtures = [
    ["Every serious economist agrees that landlords pay tenants each month from the same fund.", "Many economists say that tenants pay landlords each month from the same fund."],
    ["Every serious economist agrees that tenants pay landlords each month from the same fund.", "Many economists say that landlords pay tenants each month from the same fund."],
    ["Every serious economist agrees that they do not support us with taxpayer money during the vote.", "Many economists say that we do not support them with taxpayer money during the vote."],
    ["Every serious economist agrees that rents will not rise when wages fall.", "Many economists say that rents will rise when wages will not fall."],
    ["Every serious economist agrees that rents will rise before wages fall.", "Many economists say that wages will fall before rents rise."],
    ["Every serious economist agrees that the plan will lower rents by two percent.", "Many economists say that the plan will lower rents to two percent."],
  ];
  for (const [sentence, rewrite] of fixtures) {
    it(`omits a rewrite that changes the claim: ${rewrite}`, () => {
      const c = ctx(sentence!, "CONSENSUS_AS_EVIDENCE");
      expect(check(c, 'The words "Every serious economist agrees" offer agreement as a reason to accept the claim.', rewrite!)).toMatchObject({ ok: true, plainer: null, plainerState: "P_CLAIM" });
    });
  }
  it("keeps a reviewed framing change with the entire claim untouched", () => {
    const sentence = "Every serious economist agrees that rents will not rise when wages fall.";
    const rewrite = "Some economists say that rents will not rise when wages fall.";
    expect(check(ctx(sentence, "CONSENSUS_AS_EVIDENCE"), "", rewrite)).toMatchObject({ ok: true, plainer: rewrite, plainerState: "kept" });
  });
});
