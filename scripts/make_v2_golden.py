"""Build the v2 golden file (tests/golden/v2_parity.json) and the E3 report.

``tests/golden/v1_parity.json`` records what the retired v1 engine did. Rules
version 2.0.0a2 (ticket E3) changed some rules on purpose, so that they read
names more alike (see ``rules/RULE_CHANGES.md``). For those rules v1
parity no longer applies, so this file pins what the current pack does on the
same texts instead. Rules that E3 did not change keep exact v1 parity
(``tests/test_parity.py`` and ``packages/engine/test/golden.test.ts``).

For every v1 golden text, plus a few texts written for E3 (``E3_TEXTS``),
``moves`` is what ``scan(text, domain="all")`` returns, as
``[rule_id, start, end]`` in code points, for every rule.

``--report`` prints the before and after table for the changed rules: on how
many golden texts v1 raised each rule, on how many the current pack raises
it, and which texts gained or lost it. For the three rules that 2.0.0a1 left
out, v1's side is only known from the v1 engine, so pass ``--v1`` with a v1
checkout (the ``v1-final`` tag) to fill it in.

Usage (from the root of this repo):
    python scripts/make_v2_golden.py
    python scripts/make_v2_golden.py --report [--v1 /path/to/v1-checkout]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from biasclear import rule_pack, scan  # noqa: E402

V1_GOLDEN = ROOT / "tests" / "golden" / "v1_parity.json"
OUT = ROOT / "tests" / "golden" / "v2_parity.json"

# Every rule whose matching changed in E3, with the reason. Rules that only
# got a new name or description are not listed: their IDs and spans are
# unchanged, so v1 parity still holds for them. Mirrored in
# rules/RULE_CHANGES.md.
CHANGED_RULES = {
    "CONSENSUS_AS_EVIDENCE": "'all/most <up to 16 name tokens> <any group word> agree/support/think ...' counts, with or without a plural s; 'the <slot> consensus' needs a verb or preposition after it; a capitalized 'Consensus' counts when no capitalized word follows Round 3: 'overwhelmingly agree' takes any subject, like 'unanimously'; 'every <any word> knows' counts; a capitalized 'All'/'Most' inside a name ('Tovicare for All') and a capitalized name word that looks like a pronoun ('Granite One', 'The Which') are read as names Round 4: 'all' right after 'for' ends a phrase ('justice for all experts agree', 'fairness for all americans says'), and a capitalized 'All' before a capitalized closed-class word ('All In For Fairness') starts a name Round 5: the name slot holds 16 tokens, with commas and parenthesized words; a capitalized 'All'/'Most' counts only at the start of a sentence, read the same after every word ('Vallorans. Most' like 'conservatives. Most'), and inside one starts a name ('Leaders at All Saints say'); 'the all' and 'the most' are not quantifiers; 'Most' before a style of address ('Most Rev.') is part of it; 'the <name> consensus has found that' is left to INSTITUTIONAL_POSITION_AS_SETTLED Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "CLAIM_WITHOUT_CITATION": "a capitalized source noun counts only at the start of a sentence, not at the end of a name (after a word or a title abbreviation such as 'Univ.'); 'experts' counts in any case; every source noun (studies, research, science, data, evidence, scripture, tradition) takes the same verbs; citation look-alikes fixed Round 3: wisdom, doctrine and teaching join the source nouns; a citation counts when any part of it is within reach, and its name may hold '/', '+', '*', '@', '#', curly quotes, dashes, bracketed or parenthesized acronyms, numbers and ';' Round 4: a plural source takes a plural verb ('studies show'); 'studies shows' is a name that ends in 'Studies' ('the center for frontier studies shows'); a study, research or experts named after the noun ('a study by <any name> shows', 'experts at <any name> say') read like ones named before it ('a <name> study shows'); 'elders' reads like 'experts' Round 5: 'elders' no longer counts (an office, like 'chiefs' and 'priests'); a name after 'a study by / experts at' holds 16 tokens and parenthesized words; a citation's name may be written in any script, start with any letter and hold '%' and '!'; scripture references of every tradition ('(Qur'an 2:177)', '(Sanhedrin 37a)') and more organization abbreviations ('Fdn.') are read as citations and names Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): a case name counts as a citation with or without the period after 'v' ('Doe v Roe', 'R v Doe'), and reporters written without periods count like dotted ones ('(2019) 17 SCC 912', '2019 SCC 97', 'BVerfGE 912, 404')",
    "DISSENT_DISMISSAL": "label list mirrored in two rounds (fake news, propaganda, snowflakes, bigots, heresy, witch hunt, big lie; then deplorables, hacks, extremists, fascists, racists, rinos, wingnuts, smears, infidels, sacrilege, skeptics, pro-vaxxers); a capitalized label inside a capitalized name ('Talking Points Ledger') does not count Round 3: every label's mirror (dinos, commies, nazis, socialists, nationalists, supremacists, tankies, magats, '-tards', '-thug-', woke mob, coastal elites, rioters, looters, groomers, crybabies, tree-huggers, reactionaries, leftists, globalists, sexists and other -ists and -phobes, heathens, pagans, unbelievers, goyim, blasphemers, jihadists, crusaders, fundamentalists, bible-thumpers, believers); 'no serious <any noun> believes'; 'neo-'/'eco-' prefixes count ('anti-', 'non-' do not); a capitalized label counts after a capitalized word ('The Marxists') Round 4: three mirrored classes; insults count anywhere (with new mirrors: demonrats, feminazis, gun nuts, rednecks, limousine liberals, brownshirts, fat cats, cucks, terfs, nativists, jingoists, papists, warmists, covidiots, charlatans, scientism, ...); a group's own name (socialist, libertarian, communist, nationalist, unionist, pagan, believer, skeptic, dino, ...) counts only where the text applies it as a label ('just / a bunch of <label>', 'called them <label>', 'they are <label>', 'those <label>', 'Only <label>'); claim labels (misinformation, talking points, fringe) count at the end of a phrase, not inside a name; 'Ignore the <anything>' counts with any object Round 5: each label's missing mirror (incels, soyboys, NPCs, race hustlers, culture warriors, Red Guards, neolibs, welfare queens, unelected bureaucrats, dummycrats, repugs, islamofascists, chauvinists, Karens, TRAs, '<anything>-thumpers/-bashers/-haters', '<any word> mob'; Maoists, Stalinists, Trotskyists, a label built from a politician's name, Salafists, theocrats, traditionalists, theists, evangelicals, elitists, activists, advocates, boomers, bros, lefties, union bosses as labels; 'loyalists' dropped); a plural label counts in a labeling frame before any word ('a bunch of nationalists wrote'); 'anti-' and 'islamo-' prefixes in a frame; neopronouns; 'no serious <noun phrase> believes'; 'Ignore the <up to 16 words>'; three indicators, with the same moves Site review (rules 2.0.0a3): 'monarchists' beside 'anarchists' (round 5 brought 'theists' and 'anti-' before a group's own name, which the site review also found) Name-free rules (2.0.0a3): no group's name, party blend, faith or country word in any list; dismissal words that can be aimed at anyone count anywhere (crackpots, trolls, useful idiots, ideologues, propagandists added); role words (radicals, fanatics, heretics, skeptics, activists, partisans, bots, union bosses, ...) count where applied as a label; open frames take any word ('only a ___ would say', 'of course the ___ would say that', 'that's just what the ___ want you to think', 'Typical ___s!'); the object of 'Ignore the' is one to three words that are not function words, or a capitalized name, and ends the clause; 'book banners' and 'book burners' beside 'groomers', the common-word insult aimed at the other side Fix round 1 (2.0.0a4): the 'Typical ___!' frame takes any one to three words or a capitalized name, whatever its ending ('Typical Israelis!' like 'Typical Palestinians!', 'Typical Swiss!', 'Typical QNN!'), before an exclamation mark only; insults take their missing mirrors (pro-maskers, goons, jackboots, bootlickers, agitators, freeloaders, moochers, city slickers, snobs, yuppies, elitists, young punks, brats, old fogeys, harpies, shrews, pearl-clutchers, '<any word> nuts', '-botherers'); 'gun nuts' became '<any word> nuts'; stance and civic role words (activists, advocates, partisans, apologists, skeptics) are no longer labels; 'bosses' and 'censors' as labels; an order to disregard a thing ('the previous email', 'the typos') and a share of a group ('only a third of') do not count; a claim label that is a sentence's topic ('covers misinformation') does not count",
    "FALSE_BINARY": "character windows replaced by word gaps; 'either ... or' takes up to 32 words of one sentence, with sentence ends read the same for every name Round 5: more closed-class abbreviations continue a sentence ('Dcn.', 'Bro.'), and a party-state tag ('D-Calif.') ends one like 'R-Ohio.' Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "SHAME_LEVER": "'History will ...' counts only at the start of a sentence; 'Right Side of History' inside a capitalized title does not count Round 3: 'any reasonable/decent <any noun> would/knows' and 'all educated <any noun> know' count, not only 'person'; adjudicators ('any reasonable jury') do not Round 5: 'any reasonable <noun phrase of up to three words> would' ('any reasonable New Yorker'); a capitalized word that ends its sentence ('Kestrines.') does not make 'Right side of history' part of a name",
    "INEVITABILITY_FRAME": "'history / the future / progress / time' count at the start of a clause, in any case, not after another word ('Center for Ostrevan Progress', 'data on progress') Fix round 1 (2.0.0a4): 'tradition' beside 'history', 'progress' and 'time'",
    "SOFT_CONSENSUS": "five-word \\w+ slot replaced by a 16-word gap of name tokens Round 3: citations with long names now suppress it Round 5: the gap holds commas and parenthesized words ('Gay, Lesbian and Straight Learning Network', 'whitcombe (ill.) faculty') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): citations without periods quiet it (see CLAIM_WITHOUT_CITATION)",
    "COMPETENCE_DISMISSAL": "'<anyone> who <any words> fail to grasp' counts, not listed subjects and verbs; 16-word gaps Round 3: any subject before 'oppose ... fail to grasp'; faith, wisdom, judgment, insight, discernment and maturity join expertise Round 5: the gaps hold 16 tokens, commas and parenthesized words, and more closed-class abbreviations ('Tpr. Lopez') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "VAGUE_INSTITUTIONAL_APPEAL": "'leading/top/key <any plural group noun>' and '<any one-word qualifier> leaders/groups have warned' count, not fixed lists of nouns and sectors; 16-word gap of name tokens Round 3: group nouns without a plural s (Chinese, French, laity, Jewry, children, elderly); a capitalized intensifier that starts a name ('Key Circle members', 'Major League Stickball players') does not count; unions, companies, firms and others beside groups, a bare group noun at the start of a clause, and qualifiers with '+', '/', '#', '@' Round 4: an intensifier right after a preposition, with or without an article ('committee for a responsible public budget'), is inside a phrase and does not count Round 5: a capitalized intensifier counts only right before its group noun, whatever the case of a modifier ('Top Black economists' like 'Top white economists'); any noun right before the plural verb is a group ('Prominent M\u0101ori agree', 'leading ulema agree'); a word ending in -ss, -us or -is is not a plural ('business'); connectors inside a capitalized name ('Tovicare for All supporters'), commas and parenthesized words between a lowercase intensifier and the noun; a qualifier before 'leaders' may hold a colon, a curly quote or a combining mark Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): a capitalized name right after the intensifier is the group itself, whatever its ending or length ('leading Hindus', 'prominent Swiss', 'top Pakistanis')",
    "MONOCAUSAL_BLAME": "'because of' gap widened from three words to 16 words; the fault slot takes possessives and names with periods Round 3: state abbreviations ('Calif.') do not end the sentence Round 4: the fault slot takes names with commas ('the Tradition, Family and Homeland society's fault'), except a comma before a conjunction Round 5: the fault slot takes parenthesized words ('maumee (ohio)'s fault') and more closed-class abbreviations ('Bro. Smith's', 'Sh. Ahmed's') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "MEDIA_EDITORIAL_AS_NEWS": "a loaded adjective before any word counts, not a fixed list of nouns Round 5: more closed-class abbreviations continue a sentence ('Sis.') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "MEDIA_FALSE_BALANCE": "character windows replaced by word gaps of up to 16 words; any voice (not 'I' or 'you') counts as the other side",
    "MEDIA_EMOTIONAL_LEAD": "the first 50 characters replaced by the first sentence, with sentence ends read the same for every name Round 3: state abbreviations ('Conn.') do not end the sentence Round 5: more closed-class abbreviations continue the first sentence ('Bro.', 'Sis.', 'Eld.'), and a party-state tag ('D-Calif.', 'R-Fla.') ends it like 'R-Ohio.' Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): leading whitespace is read one way, so a long run of it is read in linear time",
    "MEDIA_WEASEL_QUANTIFIERS": "'many/some <up to eight words> say/believe/agree' counts, not only listed or plural nouns Round 5: the words before the verb are name tokens, up to 16 ('Many D.C. residents', 'Many LGBTQ+ people', 'Many BVU/BSU voters', 'Many members of the Church of Silver Dawn of Second-hour Pilgrims'); the rule is case-flexed under the s flag like the other name-token rules Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "MEDIA_SELECTIVE_QUOTATION": "a quoted label is any short quote (3 to 40 characters) of words with letters, digits, '#', inner periods and hyphens",
    "CAUSAL_TOTALIZATION": "objects mirrored in two rounds (the planet, the environment, our democracy; then our culture, values, faith, the family, the church, borders, jobs, small businesses, the rule of law, any amendment); a capitalized name counts as an object Round 3: every faith's houses of worship, gendered and family nouns, teachers, veterans, farms, forests, oceans, pensions, wages, the safety net, sovereignty, privacy, heritage, language, customs, morals, marriages, the poor, hospitals, neighborhoods; any adjective before 'civilization' or 'cultures'; family farms beside small businesses Round 4: any noun after 'our' ('our immigrants', 'our unborn children', 'our coal industry'); every object's counterpart after other determiners and bare (the unborn, the elderly, seniors, corporations, investors, mines, troops, madrasas, yeshivas, secularism, homeland, medicare, equality, justice, capitalism, the free market) Round 5: a listed object takes up to two modifiers, with or without a determiner ('progressive values', 'the coal industry', 'trans kids', 'women's health'); every object's counterpart (the rich, the wealthy, the young, movements, communities, health, 'the right to <anything>', seminaries, madrassas, masjids, shuls, mandirs, pagodas, convents, universities, colleges, charities, the media, gurus, lamas, scientists); a group named in lowercase counts without a determiner ('evangelicals' like 'Catholics'); a name that starts with a digit or with a capital after a lowercase prefix ('12 Weeks for Life', 'theKora') counts like a capitalized one Name-free rules (2.0.0a3): no program, system, faith or stance names among the objects (medicare, medicaid, social security, capitalism, socialism, secularism, evangelicals, atheists, agnostics, secularists, believers left); any word ending in '-ism' is an object; '<anyone> is the (root) cause of / to blame for all / every / everything <anything>' counts; no faith-specific noun among the objects: 'the clergy', 'the congregations', 'worshippers' and 'houses / places of worship' count for every faith, and 'the churches', 'the mosques' or 'the rabbis' for none Fix round 1 (2.0.0a4): any noun phrase of one to three words that ends the clause after a determiner, and any bare plural, is an object ('the welfare state', 'the landlords', 'plumbers'), in place of lists that held one side's objects; the closed bare list takes its mirrors (tradition, morality, marriage, decency, citizens, locals, employers, bosses, ...); 'western' left the list",
    "FEAR_URGENCY": "'invasion' counts, except in 'invasion of'; a capitalized fear word inside a capitalized name ('Invasion Day', 'Existential Risk') does not count Round 5: a capitalized adjective ('Catastrophic') is read by the word before it only ('Catastrophic Black unemployment' like 'Catastrophic white unemployment'); a word that ends its sentence ('VOP.') does not make the next word part of a name, and a word that starts with a digit does ('Project 2029 Catastrophe'); 'genocide' and 'coup' join 'invasion' Fix round 1 (2.0.0a4): 'occupation' beside 'invasion', after 'the', 'this', 'an' or an adjective such as 'military', and not as a job",
    "MEDIA_ANONYMOUS_ATTRIBUTION": "supporters, proponents, backers, advocates and opponents count like critics; citation look-alikes (Heid., Tovicaid., the Fed.) no longer suppress it Round 3: any noun after 'unnamed/anonymous/unidentified'; loyalists and believers beside supporters and skeptics; congregants and parishioners beside insiders; citations with long names now suppress it Round 5: foes, fans, allies, activists, abolitionists, prohibitionists, atheists, agnostics and nonbelievers beside the other stance words; employees, staffers and alumni beside insiders, congregants and parishioners; citations in any script Name-free rules (2.0.0a3): atheists, agnostics, abolitionists and prohibitionists left the stance words (names of a faith stance or a movement); 'worshippers' in place of a faith's 'parishioners' Fix round 1 (2.0.0a4): dissidents, lobbyists, managers and members beside loyalists, activists, employees and congregants",
    "MORAL_HIGH_GROUND": "'right side of history' inside a capitalized title ('The Right Side of History') does not count Round 3: any noun between the adjective and 'would see/recognize' ('every decent patriot'), except adjudicators Round 5: 'any decent <noun phrase of up to three words> would see'; a capitalized word that ends its sentence ('Vallorans.') does not make the next sentence's first words part of a name",
    "TOTALIZING_HARM_LANGUAGE": "unchanged regex; citation look-alikes (Heid., Tovicaid., the Fed.) no longer suppress it Round 3: citations with long names now suppress it Round 5: citations in any script, with '%' and '!', and scripture references of every tradition now suppress it Fix round 1 (2.0.0a4): citations without periods quiet it (see CLAIM_WITHOUT_CITATION)",
    "FIN_SURVIVORSHIP_BIAS": "character windows replaced by word gaps of up to 16 words Round 3: 'every successful <any role> has ...', not a list of finance jobs Round 5: the slot after 'every successful' holds 16 tokens, commas and parenthesized words; more closed-class abbreviations continue a sentence ('Ctr.') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles",
    "CREDENTIAL_AS_PREMISE": "new: replaces v1's CREDENTIAL_AS_PROOF, with no named schools or prizes; any word before 'educated/trained' Round 3: any capitalized award name before 'winner/recipient/laureate' and before 'Fellow'; a capitalized credential adjective whose name runs straight to the verb ('Leading Stage says') is a name; capitalized idiom words ('As a Whole Larder employee') are names; state and school abbreviations ('Ga.', 'Theol.') do not end the sentence Round 5: slots hold 16 tokens, commas and parenthesized words; the name run after a capitalized credential adjective takes short lowercase particles and connectors ('Bill de Vallon', 'University of Kelsor at Wexley'), digits ('12 Weeks for Life') and lowercase prefixes ('al-Saadi', 'theKora'); 'Scholar' beside 'Fellow' ('Ashcombe Scholar'); military decorations beside prizes in lowercase ('crest of honor recipient', 'scarlet heart recipient'); neopronouns ('As a doctor, xe knows') Site review (rules 2.0.0a3): the award name before '-winning', 'winner', 'recipient', 'Fellow' or 'Scholar' starts a token and holds up to 40 characters, so the rule no longer rereads a long run from every word boundary inside it (quadratic time) Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): '<any word> recipient(s)' counts, not four listed decoration words ('param vir chakra recipient' like 'purple heart recipient')",
    "INSTITUTIONAL_POSITION_AS_SETTLED": "new: replaces the named-agency part of v1's INSTITUTIONAL_NEUTRALITY with any subject, capitalized or not; an evidence noun inside a name ('Data on Progress', 'Varnell Review') does not block it Round 3: a capitalized evidence noun in a name before the subject ('with Varnell Review', 'in Women's Studies') does not block it; a capitalized pronoun-like word after a capitalized word or 'for' ('Granite One', 'Tovicare for All') is a name Round 4: 'all' after 'for' is part of the subject's name ('justice for all has concluded that'), like a capitalized 'All' Round 5: an evidence word before the subject blocks it only when it heads its phrase ('after a review of the data,'), not when it modifies another noun ('after a hearth research council briefing'); more closed-class abbreviations continue a sentence ('Sts. Cyril') Name-free rules (2.0.0a3): 'Amer.' and 'Am.' (a country's name) left the closed list of abbreviations, like every other country's; 'Dem.' stays beside 'Rep.', and 'Rab.' joined the titles Fix round 1 (2.0.0a4): a sentence end followed by a closing quote or bracket ends the sentence body too, so a long run of quoted dialogue is read in linear time (it took seconds to minutes)",
    "NEUTRALITY_CLAIM": "new: the structural part of v1's INSTITUTIONAL_NEUTRALITY ('as a neutral/independent/nonpartisan <any noun phrase>,')",
    "FIN_CHERRY_PICKED_TIMEFRAME": "restored: month names are calendar words; character windows replaced by word gaps",
    "APPEAL_TO_TRADITION": "round 3: every kind of inherited authority after 'time-honored/long-standing/age-old' (doctrine, teaching, scripture, law, belief, norm, convention, precedent, faith, rule), not only practice, tradition and custom",
    "EMOTIONAL_SUBSTITUTION": "round 3: 'no decent/moral <any noun> could/would' ('no decent man', 'no moral Christian'), not only person, human and individual; adjudicators ('no reasonable jury could') do not count Round 5: 'no decent <noun phrase of up to three words> could' ('no decent Latter-day Saint') Fix round 1 (2.0.0a4): 'think of the unborn / babies / kids' beside 'think of the children'",
    "DISMISSAL_BY_REFRAMING": "round 5: neopronouns ('what ze's really saying') beside 'they', 'he' and 'she'",
    "LEGAL_SANCTIONS_THREAT": "fix round 1 (2.0.0a4): no country's statute or rule number ('28 U.S.C. § 1927', 'Rule 11'); the wording that raises sanctions counts the same in every jurisdiction",
}

# Changed rules whose v1 counterpart was left out of 2.0.0a1, so v1_parity.json
# does not record it. v1's side comes from --v1.
LEFT_OUT_OF_2_0_0A1 = {"CREDENTIAL_AS_PREMISE", "NEUTRALITY_CLAIM", "FIN_CHERRY_PICKED_TIMEFRAME"}
# New moves with no v1 rule to compare with. (v1's INSTITUTIONAL_NEUTRALITY
# matched this shape only for a fixed list of agencies.)
NO_V1_COUNTERPART = {"INSTITUTIONAL_POSITION_AS_SETTLED"}

# Extra texts for the rules E3 added or changed, so every rule in the pack is
# exercised by a golden text. Names here are test inputs, not rule content;
# the people, parties, organizations, faith bodies, outlets, schools, awards and programs
# are made up (as in tests/test_symmetry.py).
E3_TEXTS = [
    "The Varnholt Foundation has concluded that the program works.",
    "The Center on Revenue and Policy Priorities has concluded that the program works.",
    "The CIC has made clear that the program works.",
    "Based on five years of data, the CIC has concluded that the program works.",
    "The Pellan Institute has concluded that the program works because costs fell by a third.",
    "A Wellsmere-educated economist says the plan works.",
    "A Quellbrook Institute of Technology-trained engineer says the bridge is safe.",
    "As a nurse, I know this treatment works.",
    "As a result, we know the plan works.",
    "My credentials speak for themselves.",
    "As a neutral third party, we find the claim sound.",
    "Since March the fund has returned 40% a year.",
    "Since spring the fund has returned 40% a year.",
    "In the last five years the Grocers Insurance and Annuity Association fund has beaten the index.",
    "The Center for Ostrevan Progress has shown that the policy failed.",
    "History has shown that the policy failed.",
    "Brelland Research shows that the policy failed.",
    "Research shows that the policy failed.",
    "The Consensus Quarterly survey came out on Monday.",
    "The Bertram Varner University consensus is clear.",
    "STUDIES SHOW that EVERYONE AGREES.",
    "Because of the Center for Ostrevan Progress everything has fallen apart.",
    "It's all the mayor's fault.",
    "That claim is fake news, and the rest is a hoax pushed by shills.",
    "The controversial Valloran National Committee plan passed.",
    "Critics simply don't understand the Varnholt Foundation complexity here.",
    "Either we follow what the Center on Revenue and Policy Priorities says on this or we pay for it.",
    "The Harborview Post and the New Harbor Times report: shocking new numbers on the border today.",
    "Top funds at the Grocers Insurance and Annuity Association all use this strategy.",
    "Some say that the Legislative Budget Office got it right, while most economists disagree.",
    # red-team pairs (tests/test_symmetry.py, RED_TEAM_PAIRS)
    "Now the unions have concluded that the rule is harmful.",
    "It's all Harold Trask Jr.'s fault.",
    "They blamed Harry Heid. Research shows the bill failed.",
    "Studies show the policy works (Texas A&T, 2020).",
    "The embattled union refused to comment.",
    "Labor leaders have warned against the bill.",
    "Many executives say it failed, and some people believe it was rigged.",
    "The so-called \"environmentalists\" pushed their \"values\" again.",
    "This policy is destroying the planet.",
    "This is a border invasion.",
    "They praised Harry Heid. Critics say he failed.",
    "They cut Tovicaid. The cuts are destroying everything.",
    "Rep. Maribeth Tolson Pascoe and her allies in the House said on Monday that the plan drew a scathing backlash.",
    # red team, second round (tests/test_symmetry.py, RED_TEAM_ROUND_2)
    "Voters blamed Trask. The backlash was fierce.",
    "A new study blamed Lusk. The party has concluded that the plan failed.",
    "data on progress has concluded that the tax is popular.",
    "the vast majority of tjw jr. supporters agree.",
    "Leading companies urge caution on the bill.",
    "Gun rights groups have warned against the bill.",
    "As a nonpartisan organization, we reviewed the bill.",
    "Those people are deplorables.",
    "They are destroying our culture.",
    "Women who oppose abortion fail to grasp the issue.",
    "Most Chinese agree that the policy works.",
    "Some say the tax cut worked, but the LBO disagrees.",
    "the \"reform\" of \"Project 2029\" failed.",
    "The controversial bishop spoke on Friday.",
    "A community college educated nurse says the plan works.",
    "Supporters say the gun law failed.",
    "Talking Points Ledger reported that the plan failed.",
    "Invasion Day rallies drew large crowds.",
    "Dan Kestler's The Right Side of History argues the plan failed.",
    "We are on the right side of history.",
    "center for ostrevan progress has shown that the tax works.",
    "Science teaches that marriage helps children.",
    "research shows the policy failed, per texas v. u.s.",
    # red team, third round (tests/test_symmetry.py, RED_TEAM_ROUND_3)
    "The DINOs in the Senate blocked the bill.",
    "Senate Communists blocked the bill.",
    "Of course Tovicare for All would say that.",
    "Every American knows the bill works.",
    "Theologians overwhelmingly agree that the policy works.",
    "unions warned that the bill would hurt families.",
    "It's all Calif. Kestrines's fault.",
    "Experts agree that the policy reduced poverty in every state that adopted it over the past decade "
    "(Center on Revenue and Policy Priorities, 2021).",
    "Research shows the minimum wage hike cost no jobs (Holtzer/Opinaria 2021).",
    "A Lorimer winner says the policy works.",
    "As a Whole Larder employee, I know this policy hurts workers.",
    "Granite One has concluded that the rule is harmful.",
    "Writers with Varnell Review have concluded that the policy works.",
    "Key Circle members support the bill.",
    "Leading Stage says the rule works.",
    "LGBTQ+ groups have long endorsed the bill.",
    "They are destroying our mosques.",
    "Leading Chinese urge caution on the bill.",
    "Unnamed clerics said the plan failed.",
    "Christians oppose the bill but fail to grasp it.",
    "Any reasonable Christian knows this.",
    "No decent man would say that.",
    "No reasonable jury could find him guilty.",
    "Time-honored doctrine dictates that we act.",
    "Every successful farmer has studied value.",
    "They lack the wisdom to judge.",
    # red team, fourth round (tests/test_symmetry.py, RED_TEAM_ROUND_4)
    "socialists said the plan works.",
    "They're just a bunch of libertarians.",
    "Ignore the gentiles.",
    "Those demonrats blocked the bill.",
    "the global disinformation registry opposes the bill.",
    "That claim is disinformation.",
    "fairness for all americans says the bill is sound.",
    "justice for all has concluded that the policy works.",
    "the center for frontier studies shows the policy works.",
    "the committee for a responsible public budget experts agree the policy works.",
    "It's all the Tradition, Family and Homeland society's fault.",
    "This policy is destroying our unborn children.",
    "a study by the tber shows the tax works.",
    "tribal elders agree the policy works.",
    # red team, fifth round (tests/test_symmetry.py, RED_TEAM_ROUND_5)
    "Most members of the National Association for the Advancement of Tessalian People agree the bill works.",
    "The bill was backed by Vallorans. Most economists agree it works.",
    "Leaders at All Saints say the plan is sound.",
    "The Kelsford Consensus has found that the policy works.",
    "Studies show the bill failed (\u00c9ric Vaudour 2019).",
    "Scripture teaches that charity is a duty (Qur'an 2:177).",
    "Respected Mayor Bill de Vallon says the plan works.",
    "Ashcombe Scholar Jane Doe says the war was justified.",
    "Top Black economists agree the plan works.",
    "Prominent M\u0101ori agree the law is unfair.",
    "Now, leading Tovicare for All supporters urge caution on the bill.",
    "This policy is destroying progressive values.",
    "They're just welfare queens.",
    "A bunch of nationalists wrote the bill.",
    "Catastrophic Black unemployment followed the law.",
    "The Project 2029 Catastrophe was predictable.",
    "The bill came from Rep. Ro Kapoor, D-Calif. Critics voiced fury over it.",
    "Dem. Leaders said the plan faced a fierce backlash.",
    "after a hearth research council briefing, lawmakers have concluded that the bill is harmful.",
    "Many U.S. voters say the bill is harmful, and many experts agree.",
    "Foes say the bill is harmful.",
    "What ze's really saying is that the law is unfair.",
    "Any reasonable New Yorker would agree that the law is unfair.",
    "No decent Latter-day Saint could support this bill.",
    "Those who oppose the Tessalian Federation of State, County and Municipal Employees fail to grasp the stakes.",
    "it's all maumee (ohio)'s fault.",
    "Either you stand with Dcn. Smith or you stand against him.",
    "The overwhelming majority of members of the Gay, Lesbian and Straight Learning Network agree the bill works.",
    # name-free rules (rules 2.0.0a3); names here are made up
    "Only a socialist would say that.",
    "Of course the union would say that.",
    "That's just what the government wants you to think.",
    "Typical politicians!",
    "Ignore the Quellbrook Collective for Working Families.",
    "They're just socialists.",
    "They're just kids.",
    "Ignore the noise from the fan.",
    "Of course the kids want pizza.",
    "They're just crackpots, and the trolls agree.",
    "Capitalism is the cause of all our problems.",
    "They are destroying socialism.",
    "They are destroying the Quillmoor Health Plan.",
    "atheists say the ruling is unjust.",
    # party abbreviations alike, faith-neutral words and counterpart insults
    # (rules 2.0.0a3)
    "Rep. Leaders said the plan faced a fierce backlash.",
    "Rab. Cohen said the plan faced a fierce backlash.",
    "Based on its review, the Brit. Guild Assn. has concluded that the rule is harmful.",
    "They are destroying the houses of worship.",
    "They are destroying the churches.",
    "Worshippers say the new rule is unfair.",
    "Those book banners are at it again.",
    # the red team's first fix round (rules 2.0.0a4)
    "Typical Israelis!",
    "Typical Swiss!",
    "Typical results.",
    "Today, prominent Swiss agree the plan is fair.",
    "This law is destroying the landlords.",
    "This law is destroying plumbers.",
    "Please ignore the previous email.",
    "She studies disinformation.",
    "Counsel should consider Rule 11 before filing again.",
    "Studies show the policy works. See 2019 SCC 97.",
    "Studies show the policy works, as held in Doe v Roe.",
    "a param vir chakra recipient says the war was just.",
    "Tradition is on our side in this fight.",
    "Union members say the plan will fail.",
    "This occupation must be stopped now.",
    "\u201cWhy?\u201d \u201cYes.\u201d The agency has concluded that the rule is harmful.",
    "   Shocking new numbers today: the plan failed.",
]


def moves_for(text: str) -> list[list]:
    return [[m["rule_id"], m["start"], m["end"]] for m in scan(text, domain="all")["moves"]]


def build() -> dict:
    v1 = json.loads(V1_GOLDEN.read_text(encoding="utf-8"))
    pack = rule_pack()
    ids = {r["id"] for r in pack["rules"]}
    missing = set(CHANGED_RULES) - ids
    if missing:
        raise SystemExit(f"changed rules not in the pack: {sorted(missing)}")
    return {
        "about": (
            "What the current rule pack returns on every v1 golden text (and on the e3: texts "
            "written for the rules E3 added or changed), for domain 'all', as "
            "[rule_id, start, end] in Unicode code points. changed_rules are the rules whose "
            "matching changed after v1 (rules/RULE_CHANGES.md); for them this file replaces v1 "
            "parity. For every other rule the moves here equal v1_parity.json's."
        ),
        "generated_by": "scripts/make_v2_golden.py",
        "rules_version": pack["rules_version"],
        "changed_rules": sorted(CHANGED_RULES),
        "cases": [
            {"src": c["src"], "text": c["text"], "moves": moves_for(c["text"])}
            for c in v1["cases"]
        ] + [
            {"src": f"e3:{i:02d}", "text": text, "moves": moves_for(text)}
            for i, text in enumerate(E3_TEXTS, 1)
        ],
    }


def v1_decisions(v1_root: Path, texts: list[str]) -> list[set[str]]:
    """Rule IDs the v1 engine raises on each text (domain 'auto', as in v1_parity.json)."""
    path = v1_root / "biasclear" / "frozen_core.py"
    spec = importlib.util.spec_from_file_location("v1_frozen_core", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["v1_frozen_core"] = module
    spec.loader.exec_module(module)
    core = module.frozen_core
    return [
        {f.pattern_id for f in core.evaluate(t, domain="auto").flags if f.category == "structural"}
        for t in texts
    ]


def report(golden: dict, v1_root: Path | None) -> None:
    v1 = json.loads(V1_GOLDEN.read_text(encoding="utf-8"))
    texts = [c["text"] for c in v1["cases"]]
    before = [set(c["v1_rule_ids"]) for c in v1["cases"]]
    if v1_root is not None:
        full = v1_decisions(v1_root, texts)
        replaced = {"CREDENTIAL_AS_PREMISE": "CREDENTIAL_AS_PROOF",
                    "NEUTRALITY_CLAIM": "INSTITUTIONAL_NEUTRALITY"}
        for i, ids in enumerate(full):
            for new, old in replaced.items():
                if old in ids:
                    before[i].add(new)
            if "FIN_CHERRY_PICKED_TIMEFRAME" in ids:
                before[i].add("FIN_CHERRY_PICKED_TIMEFRAME")
    after = [{m[0] for m in c["moves"]} for c in golden["cases"][:len(texts)]]
    print(f"{len(texts)} golden texts, rules version {golden['rules_version']}")
    v1_moves = [c["moves"] for c in v1["cases"]]
    print("| Rule | v1 texts | v2 texts | Gained | Lost | Same text, other spans |")
    print("|---|---|---|---|---|---|")
    for rid in golden["changed_rules"]:
        b = {i for i, s in enumerate(before) if rid in s}
        a = {i for i, s in enumerate(after) if rid in s}
        if rid in NO_V1_COUNTERPART or (rid in LEFT_OUT_OF_2_0_0A1 and v1_root is None):
            print(f"| `{rid}` | - | {len(a)} | - | - | - |")
            continue
        if rid in LEFT_OUT_OF_2_0_0A1:
            moved = "-"
        else:
            moved = sum(
                1 for i in a & b
                if [m for m in v1_moves[i] if m[0] == rid] != [m for m in golden["cases"][i]["moves"] if m[0] == rid]
            )
        print(f"| `{rid}` | {len(b)} | {len(a)} | {len(a - b)} | {len(b - a)} | {moved} |")
    print()
    for rid in golden["changed_rules"]:
        b = {i for i, s in enumerate(before) if rid in s}
        a = {i for i, s in enumerate(after) if rid in s}
        if rid in NO_V1_COUNTERPART or (rid in LEFT_OUT_OF_2_0_0A1 and v1_root is None):
            b = a
        moved = []
        if rid not in LEFT_OUT_OF_2_0_0A1 and rid not in NO_V1_COUNTERPART:
            moved = sorted(
                i for i in a & b
                if [m for m in v1_moves[i] if m[0] == rid] != [m for m in golden["cases"][i]["moves"] if m[0] == rid]
            )
        for label, idx in (("gained", sorted(a - b)), ("lost", sorted(b - a)), ("other spans", moved)):
            for i in idx:
                case = v1["cases"][i]
                spans = [case["text"][s:e] for r, s, e in golden["cases"][i]["moves"] if r == rid]
                snippet = re.sub(r"\s+", " ", case["text"])[:110]
                print(f"{rid} {label}: {case['src']}: {spans or ''} :: {snippet}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report", action="store_true", help="print the before and after table")
    ap.add_argument("--v1", type=Path, help="v1 checkout, for v1's side of the left-out rules")
    args = ap.parse_args()
    golden = build()
    if args.report:
        report(golden, args.v1)
        return 0
    OUT.write_text(json.dumps(golden, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")
    flagged = sum(1 for c in golden["cases"] if c["moves"])
    print(f"cases: {len(golden['cases'])} ({flagged} with moves); changed rules: {len(CHANGED_RULES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
