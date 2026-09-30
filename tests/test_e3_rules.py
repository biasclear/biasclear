"""Positive and negative examples for every rule E3 added or changed.

Swapped-pair cases for the same rules are in tests/test_symmetry.py. Names
here are test inputs, not rule content; the people, parties, organizations,
faith bodies, outlets, schools, awards and programs are made up.
"""

from __future__ import annotations

import pytest

from biasclear import scan


def raises(text: str, rule_id: str) -> bool:
    return any(m["rule_id"] == rule_id for m in scan(text, domain="all")["moves"])


CASES = {
    "CREDENTIAL_AS_PREMISE": (
        [
            "A Carverton-educated economist says the plan works.",
            "A Wellsmere-trained economist says the plan works.",
            "A state-school-educated nurse says the treatment is safe.",
            "A Lorimer-winning reporter says the story holds up.",
            "A Petworth-winning reporter says the story holds up.",
            "A Nordahl laureate says the policy is sound.",
            "A renowned surgeon insists the procedure is safe.",
            "As a doctor, I know this treatment works.",
            "As an electrician, I can tell you this wiring is fine.",
            "As a leading expert in the field, Dr. Smith's opinion should settle the matter.",
            "With over 30 years of experience, I can tell you this works.",
            "My credentials speak for themselves.",
            "Award-winning Rev. Waddel says the policy works.",
            "A respected Senator Catherine Ortega Marco says the bill is sound.",
            "As a Ph.D., I know this is true.",
            "As a first responder, I know the rule saves lives.",
            "With five years of experience, I know this is wrong.",
            "An ordained minister says the program works.",
            "A community college educated nurse says the plan works.",
            "A yeshiva educated rabbi says the plan works.",
            "An \u00d6rebro educated doctor says the plan works.",
            "Acclaimed author \u0141. Kowalski says the law is wrong.",
            "A Nordahl Prize winner says the plan works.",
            "as a u.s. citizen, i know this is right.",
        ],
        [
            "As a result, we know the plan works.",
            "As a rule, we know very little.",
            "She was educated in Ohio and trained as a nurse.",
            "The economist says the plan works, citing three studies.",
            "He has 30 years of experience in the field.",
            "As a first step, we know the plan works.",
            "A leading cause of death, doctors say, is smoking.",
            "She trained for years and says the plan works.",
            "A respected pastor met Mohammed. He says the plan works.",
            "A respected pastor met John. He says the plan works.",
        ],
    ),
    "INSTITUTIONAL_POSITION_AS_SETTLED": (
        [
            "The CIC has concluded that the program works.",
            "The Varnholt Foundation has concluded that the program works.",
            "The Center on Revenue and Policy Priorities has determined that the cuts failed.",
            "The TFL-CIO has made clear that the deal is dead.",
            "The U.S. Chamber of Industry has confirmed that the rule is harmful.",
            "Critics were loud. The Pellan Institute has found that the tax works.",
            "The agency has concluded that the program works.",
            "Now the unions have concluded that the rule is harmful.",
            "wren oakes has concluded that the policy works.",
            "450.org has concluded that the rule is harmful.",
            "varnell review has concluded that the tax is harmful.",
            "data on progress has concluded that the tax is popular.",
            "brelland research has concluded that the tax is popular.",
            "A new study blamed Lusk. The party has concluded that the plan failed.",
        ],
        [
            "I have found that the program works.",
            "We have found that the program works.",
            "The study has found that the program works.",
            "Based on its own review, the U.S. Treasury has concluded that the policy works.",
            "After the data review, the TIH has concluded that the policy works.",
            "Based on new data, the CIC has concluded that the program works.",
            "According to its survey, the Pellan Institute has found that the tax works.",
            "The CIC has concluded that the program works because infections fell by half.",
            "The TDA has concluded that the drug is safe (Smith, 2020).",
            "The new report has concluded that the program works.",
        ],
    ),
    "NEUTRALITY_CLAIM": (
        [
            "As a neutral third party, we find the claim sound.",
            "As an independent regulatory body, our findings are final.",
            "As an independent think tank, it reviewed the bill.",
            "Our report reflects the evidence objectively.",
            "We reviewed the case impartially and without bias.",
            "As a nonpartisan organization, we reviewed the bill.",
            "As an independent policy research institute, we reviewed the bill.",
        ],
        [
            "The court appointed a neutral third party.",
            "The report reviews the evidence.",
        ],
    ),
    "FIN_CHERRY_PICKED_TIMEFRAME": (
        [
            "Since March the fund has returned 40% a year.",
            "Since the bottom, the index has gained 60 percent.",
            "Since 2020, the Grocers Insurance and Annuity Association fund has returned 12%.",
            "In the last five years the fund has beaten the index.",
        ],
        [
            "Since spring the fund has returned 40% a year.",
            "The fund returned 40% in March.",
        ],
    ),
    "MONOCAUSAL_BLAME": (
        [
            "Because of the Varnholt Foundation everything has fallen apart.",
            "Because of the Center for Ostrevan Progress everything has fallen apart.",
            "It's all the mayor's fault.",
            "It's all the Center for Ostrevan Progress's fault.",
            "It's all Dr. Lucci's fault.",
            "it's all gov. nesbit's fault.",
            "It's all Gordon W. Lusk's fault.",
            "It's all Nico O\u2019Callan's fault.",
            "It's all RallyOn.org's fault.",
        ],
        [
            "Because of the storm, some roads closed.",
            "It's all part of the plan.",
            "It's all over. Nobody said it was his fault.",
        ],
    ),
    "CONSENSUS_AS_EVIDENCE": (
        [
            "The Carverton consensus is clear.",
            "The Bertram Varner University consensus is clear.",
            "All Wellsmere experts say so.",
            "All Quellbrook Institute of Technology experts say so.",
            "The consensus is clear.",
            "STUDIES SHOW that EVERYONE AGREES.",
            "The Tessaly Consensus is clear.",
            "The St. Louis consensus is that the policy works.",
            "Most rabbis agree the text is authentic.",
            "All serious theologians agree that the policy works.",
            "The Tessaly consensus is clear.",
            "Most Chinese agree that the policy works.",
            "All clergy support the ban.",
            "Most Franciscan University of Marrowby scholars agree the text is authentic.",
            "All experts in the field have concluded this is correct.",
        ],
        [
            "The Consensus Quarterly survey came out on Monday.",
            "It's all the Experts Council's fault.",
            "The consensus forecast is 2%.",
            "It's all the fault of scientists.",
            "Nearly all Christian Scientists refused the vaccine.",
            "The Kelsford Consensus found that the tax is harmful.",
            "We visited all of Cuba. Experts say it is poor.",
        ],
    ),
    "INEVITABILITY_FRAME": (
        ["History will show that we were right.", "Progress has shown the way.", "The data aside, time will prove us right."],
        [
            "The Center for Ostrevan Progress has shown that the policy failed.",
            "The Center for Ostrevan Progress will show that the policy failed.",
            "center for ostrevan progress has shown that the tax works.",
            "data on progress will show that the tax works.",
        ],
    ),
    "CLAIM_WITHOUT_CITATION": (
        [
            "Research shows the policy failed.",
            "The survey is clear: research shows the policy failed.",
            "They blamed Harry Heid. Research shows the bill failed.",
            "They blamed the Fed. Research shows the bill failed.",
            "Research shows big gov't hurts growth.",
            "Studies show the policy works, according to Figure XR.",
            "Scripture shows that marriage benefits children.",
            "All Carverton Experts agree the policy works.",
            "Science teaches that marriage helps children.",
            "Research tells us that marriage helps children.",
        ],
        [
            "Brelland Research shows the policy failed.",
            "A paper in Science shows the effect.",
            "Kestrines\u2019 Data shows wages rose.",
            "Studies show the policy works (Texas A&T, 2020).",
            "Studies show the policy works (Brelland Research 2019).",
            "Research shows the bill failed. Id. at 4.",
            "Research shows the bill failed. See 85 Fed. Reg. 1234.",
            "Carverton Univ. Research shows the plan works.",
            "Studies show the policy works (University of Olvanne, Tiverly, 2019).",
            "research shows the tax works (center on revenue and policy priorities 2019).",
        ],
    ),
    "SHAME_LEVER": (
        ["History will judge you.", "Any reasonable person can see it."],
        ["The Museum of Tessalian History will remember the donors."],
    ),
    "DISSENT_DISMISSAL": (
        [
            "That claim is misinformation.",
            "That claim is fake news.",
            "That claim is propaganda.",
            "Only sheeple believe it.",
            "Climate alarmists are wrong again.",
            "The report is a hoax.",
            "Those shills are at it again.",
            "Ignore the climate doomers.",
            "That's just the Big Lie again.",
            "They are election truthers.",
            "Those people are deplorables.",
            "They are election deniers.",
            "Ignore the pro-vaxxers.",
        ],
        [
            "The report was reviewed by three outside experts.",
            "Talking Points Ledger reported that the plan failed.",
            "The Disinformation Oversight Board said the claim is false.",
            "They are anti-racists.",
            # rules 2.0.0a4: a neutral stance word is not a label
            "They are election skeptics.",
        ],
    ),
    "FALSE_BINARY": (
        [
            "Either we follow what the Center on Revenue and Policy Priorities says on this or we pay for it.",
            "If you're not with us, you're against us.",
            "Either you stand with the working families of the Tessalian Federation of Labor and Congress of "
            "Industrial Organizations or you stand against them.",
        ],
        [
            "We could raise taxes, cut spending, or borrow.",
            "I like neither. Either tea. Or coffee.",
            "Either you back Bowen. Or you back chaos.",
        ],
    ),
    "MEDIA_EDITORIAL_AS_NEWS": (
        [
            "The controversial Valloran National Committee plan passed.",
            "The controversial VOP bill passed.",
            "The embattled union refused to comment.",
            "The controversial St. Louis policy passed.",
            "The controversial bishop spoke on Friday.",
            "the controversial super pac spent millions.",
            "the embattled rep. resigned.",
        ],
        ["The Valloran National Committee plan passed."],
    ),
    "COMPETENCE_DISMISSAL": (
        [
            "Critics simply don't understand the Marchmont Institution complexity here.",
            "People who support abortion fail to grasp the economics.",
            "Those who oppose Mt. Carrow fail to grasp the stakes.",
            "Women who oppose abortion fail to grasp the issue.",
            "people who want gun control fail to grasp the issue.",
        ],
        ["Critics say the plan is too expensive."],
    ),
    "MEDIA_EMOTIONAL_LEAD": (
        [
            "The Harborview Post and the New Harbor Times report: shocking new numbers on the border today.",
            "The city council met on Tuesday and approved the budget after a long debate about roads, then heard a shocking report.",
            "Rep. Maribeth Tolson Pascoe and her allies in the House said on Monday that the plan drew a scathing backlash.",
        ],
        [
            "The city council met on Tuesday and approved the budget. Later it heard a shocking report.",
            "Voters blamed Trask. The backlash was fierce.",
            "Voters blamed Wall St. The backlash was fierce.",
        ],
    ),
    "FIN_SURVIVORSHIP_BIAS": (
        [
            "Top funds at the Grocers Insurance and Annuity Association all use this strategy.",
            "Every successful St. Louis investor has studied value.",
        ],
        ["Some funds use this strategy and some do not."],
    ),
    "SOFT_CONSENSUS": (
        [
            "The vast majority of Bertram Varner University economists agree.",
            "The vast majority of U.S. economists agree.",
            "The vast majority of St. Corran doctors agree with the plan.",
        ],
        ["The majority voted on Tuesday."],
    ),
    "VAGUE_INSTITUTIONAL_APPEAL": (
        [
            "Leading organizations in the field endorse the plan.",
            "Labor leaders have warned against the bill.",
            "Key unions urge caution.",
            "They expanded Tovicaid. Leading agencies recommend the change.",
            "Leading companies urge caution on the bill.",
            "Gun rights groups have warned against the bill.",
            "The TCLU leaders have long supported the tax.",
        ],
        ["The organizations met on Tuesday.", "Chinese officials warned that the plan would fail."],
    ),
    "MEDIA_FALSE_BALANCE": (
        [
            "Some say that the Legislative Budget Office got it right, while most economists disagree.",
            "Some say the drug is safe, but most nurses disagree.",
            "Some say the tax cut worked, but the LBO disagrees.",
        ],
        ["The Legislative Budget Office published its estimate on Friday.", "Some say it worked, but I disagree."],
    ),
    "MEDIA_WEASEL_QUANTIFIERS": (
        [
            "Many executives say it failed, and some people believe it was rigged.",
            "Many Americans believe the border is open, and many Texans agree.",
            "Many vop say it failed, and some people agree.",
        ],
        ["Many executives say it failed."],
    ),
    "CAUSAL_TOTALIZATION": (
        [
            "This policy is destroying the planet.",
            "This policy is destroying our democracy.",
            "They destroyed the middle class.",
            "They are destroying our culture.",
            "They are destroying the Second Amendment.",
            "They are destroying Israel.",
            "They are destroying small businesses.",
        ],
        ["They are killing it.", "They are killing time.", "The fire destroyed thousands of homes."],
    ),
    "FEAR_URGENCY": (
        ["This is a border invasion.", "This is a climate catastrophe."],
        [
            "The invasion of Normandy began in June.",
            "Invasion Day rallies drew large crowds.",
            "The Centre for the Mapping of Existential Risk said the plan is sound.",
        ],
    ),
    "MEDIA_SELECTIVE_QUOTATION": (
        [
            'The so-called "environmentalists" pushed their "values" again.',
            'The "pro-life" crowd pushed the "reform" plan.',
            'The "Stout Boys" pushed the "reform".',
            'The so-called "Qu\u00e9b\u00e9cois" pushed their "values" again.',
            'the "reform" of "Project 2029" failed.',
            'the "reform" of "Make Tessaly Great Again" failed.',
            'the "reform" of "B.V.C." failed.',
        ],
        ['He said "we will win this fight today" and left.'],
    ),
    "MEDIA_ANONYMOUS_ATTRIBUTION": (
        ["They praised Harry Heid. Critics say he failed.", "Supporters say the gun law failed."],
        ["Critics say he failed. Id. at 4."],
    ),
    "MORAL_HIGH_GROUND": (
        [
            "We are on the right side of history.",
            "Any decent person would recognize the harm.",
            "Right side of history, they said.",
        ],
        [
            "Dan Kestler's The Right Side of History argues the plan failed.",
            "The plan failed.",
        ],
    ),
    "TOTALIZING_HARM_LANGUAGE": (
        ["They cut Tovicaid. The cuts are destroying everything."],
        ["The cuts are destroying everything (Smith, 2020)."],
    ),
}


# The red team's third round (tests/test_symmetry.py, RED_TEAM_ROUND_3).
ROUND_3_CASES = {
    "DISSENT_DISMISSAL": (
        [
            "The woke mob showed up at the rally.",
            "Those people are transphobes.",
            "No serious theologian believes that.",
            "They are eco-extremists.",
        ],
        [
            "The anti-racists marched downtown.",
            "The Young Communists League met on Monday.",
            # Since the fourth round a group's own name counts only where the
            # text applies it as a label.
            "The neo-Nazis marched downtown on Saturday.",
            "The Marxists want power.",
            "Senate Communists blocked the bill.",
            "She put mustard on the custard.",
            "No serious injuries were reported.",
        ],
    ),
    "CONSENSUS_AS_EVIDENCE": (
        [
            "Theologians overwhelmingly agree that the policy works.",
            "Every American knows the bill works.",
            "Most analysts at Granite One agree the rule is harmful.",
            "Most fans of The Which agree the song is great.",
            "Most Ga. Poly engineers agree the bridge is safe.",
        ],
        [
            "Of course Tovicare for All would say that.",
            "Critics of Tovicare for All don't understand it.",
            "Most people who know him agree.",
        ],
    ),
    "CLAIM_WITHOUT_CITATION": (
        [
            "Age-old wisdom tells us to wait.",
            "Studies show the policy works (see the appendix).",
        ],
        [
            "Experts agree that the policy reduced poverty in every state that adopted it over the past decade "
            "(Tessalian Federation of Labor and Congress of Industrial Organizations, 2021).",
            "Research shows the minimum wage hike cost no jobs (Holtzer/Opinaria 2021).",
            "Research shows the minimum wage hike cost no jobs (Northern Poverty Law Center — NPLC, 2021).",
            "Research shows the minimum wage hike cost no jobs (Center for Ostrevan Progress [COP], 2021).",
            "Research shows the minimum wage hike cost no jobs (Tallis Family Foundation (TFF) 2021).",
            "Studies show the tax cuts paid for themselves (KNC; VNC, 2021).",
            "Studies show the policy works (Ibn Ta‘lan University, 2020).",
            "Studies show the policy works (@AOR, 2023).",
        ],
    ),
    "INSTITUTIONAL_POSITION_AS_SETTLED": (
        [
            "Granite One has concluded that the rule is harmful.",
            "Tovicare for All has concluded that the rule is harmful.",
            "Writers with Varnell Review have concluded that the policy works.",
            "Scholars from the Institute for Civic Studies have concluded that the policy works.",
        ],
        [
            "After reviewing the data, the board has concluded that the rule is harmful.",
            "One has found that the rule is harmful.",
        ],
    ),
    "VAGUE_INSTITUTIONAL_APPEAL": (
        [
            "unions warned that the bill would hurt families.",
            "oil companies warned that the rule would hurt families.",
            "LGBTQ+ groups have long endorsed the bill.",
            "#UsToo groups have long endorsed the bill.",
            "Leading Chinese urge caution on the bill.",
            "Prominent children urge caution on the bill.",
            "Leading laity urge reform of the church.",
        ],
        [
            "Key Circle members support the bill.",
            "Major League Stickball players support the bill.",
            "Citizens for Responsible Power Solutions members support the bill.",
            "the unions warned that the bill would hurt families.",
        ],
    ),
    "CREDENTIAL_AS_PREMISE": (
        [
            "A Lorimer winner says the policy works.",
            "A Crest of Honor recipient says the war was just.",
            "A MacGarvey Fellow says the policy works.",
            "As a Whole Larder employee, I know this policy hurts workers.",
            "As a First Step Bill advocate, I know this law works.",
            "An award-winning Ga. Poly engineer says the bridge is safe.",
            "A respected Brenmark Theol. Sem. professor says the text is authentic.",
            "A renowned Carverton economist says the plan works.",
        ],
        [
            "Leading Stage says the rule works.",
            "The Chartered Institute of Personnel and Training says the rule works.",
            "The National Council of Registered Nurses says the rule works.",
            "As a whole, I know this policy hurts workers.",
        ],
    ),
    "CAUSAL_TOTALIZATION": (
        [
            "They are destroying our mosques.",
            "They are destroying our synagogues.",
            "They are destroying our daughters.",
            "They are destroying the social safety net.",
            "They are killing our sovereignty.",
            "They are destroying indigenous cultures.",
            "They destroyed family farms.",
            "They destroyed the poor.",
        ],
        ["They restored our mosques."],
    ),
    "MEDIA_ANONYMOUS_ATTRIBUTION": (
        [
            "Unnamed clerics said the plan failed.",
            "Anonymous priests said the plan failed.",
            "Loyalists say the bill works.",
            "Congregants say the church will split.",
            "Believers say the miracle was staged.",
        ],
        ["The priests said the plan failed."],
    ),
    "COMPETENCE_DISMISSAL": (
        [
            "Christians oppose the bill but fail to grasp it.",
            "Women question the ruling and misunderstand it.",
            "They lack the wisdom to judge.",
            "They lack the faith to judge.",
        ],
        ["They lack the money to pay."],
    ),
    "SHAME_LEVER": (
        [
            "Any reasonable Christian knows this.",
            "Any decent Muslim would agree.",
            "All educated women know this.",
        ],
        ["The jury must be sure beyond any reasonable doubt.", "Any reasonable jury would agree."],
    ),
    "MORAL_HIGH_GROUND": (
        ["Every decent patriot would recognize this.", "No moral Christian could understand this."],
        ["No reasonable court would see it that way."],
    ),
    "EMOTIONAL_SUBSTITUTION": (
        [
            "No decent man would say that.",
            "No moral Christian could understand this.",
            "No decent person would say that.",
        ],
        ["No reasonable jury could find him guilty.", "No reasonable court would do that."],
    ),
    "APPEAL_TO_TRADITION": (
        [
            "Time-honored doctrine dictates that we act.",
            "Age-old teaching demands it.",
            "Long-standing law requires this.",
            "Time-honored tradition dictates that we act.",
        ],
        ["The law requires this.", "Age-old trees line the road."],
    ),
    "FIN_SURVIVORSHIP_BIAS": (
        ["Every successful farmer has studied value.", "All legendary preachers followed this rule."],
        ["Every farmer has a story."],
    ),
}

# The red team's fourth round (tests/test_symmetry.py, RED_TEAM_ROUND_4).
ROUND_4_CASES = {
    "DISSENT_DISMISSAL": (
        [
            "Ignore the boomers.",
            "Ignore the gentiles.",
            "ignore the climate activists.",
            "Ignore the MTGAts.",
            "Those gun nuts are at it again.",
            "That claim is disinformation.",
            "They spread misinformation about vaccines.",
            "That's just talking points.",
        ],
        [
            "socialists said the plan works.",
            "Senator Pask, a Libertarian, said the plan works.",
            "Senator Salters, a Democratic Socialist, said the plan works.",
            "the socialist party opposes the bill.",
            "irish nationalists opposes the bill.",
            "the pagan fellowship opposes the bill.",
            "the skeptics guild opposes the bill.",
            "the global disinformation registry opposes the bill.",
            "talking points ledger opposes the bill.",
            "the kelsford fringe opposes the bill.",
            "the hack guild opposes the bill.",
            "dino rozzi says the policy works.",
            "sweet thug says the policy works.",
            "bone thugs-n-cadence says the policy works.",
            "we met the marxists on monday.",
            "We cannot ignore the evidence.",
            "Senator Pask is a libertarian.",
            "Plaintiff asks the court to summarily dismiss these frivolous claims.",
        ],
    ),
    "CONSENSUS_AS_EVIDENCE": (
        ["All Americans agree the policy works.", "most economists agree the policy works."],
        [
            "fairness for all americans says the bill is sound.",
            "All In For Fairness says the bill is sound.",
            "justice for all experts agree the policy works.",
        ],
    ),
    "INSTITUTIONAL_POSITION_AS_SETTLED": (
        ["justice for all has concluded that the policy works."],
        [],
    ),
    "CLAIM_WITHOUT_CITATION": (
        [
            "Studies show the policy works.",
            "studies have shown the policy works.",
            "A study shows it works.",
            # a name after the source noun reads like one before it
            "a study by the tber shows the tax works.",
            "a study by the tessalian bureau of economic research shows the tax works.",
            "A study by the Tessalian Bureau of Economic Research (TBER) shows the tax works.",
            "A study by the Tradition, Family and Homeland society shows the tax works.",
            "Research from Carverton shows the tax works.",
            "Studies by the Varnholt Foundation show the tax works.",
            "Experts at the ICF say the tax works.",
        ],
        [
            "the center for frontier studies shows the policy works.",
            "the institute for household studies shows marriage helps.",
            "A study by Smith et al. (2020) shows the tax works.",
            "A report from the Varnholt Foundation shows the tax works.",
            "A study in the journal shows the tax works.",
            "Pedestrian volume data from March 2025 counts show an average of 220 daily crossings.",
            "The elderly agree the policy works.",
            "Our elders taught us this.",
            # (The fifth round dropped "elders", an office like "chiefs" and
            # "priests"; see ROUND_5_CASES.)
            "tribal elders agree the policy works.",
            "Elders say the old way was better.",
        ],
    ),
    "VAGUE_INSTITUTIONAL_APPEAL": (
        ["leading economists agree the plan works.", "responsible scientists agree the plan works."],
        ["the committee for a responsible public budget experts agree the policy works."],
    ),
    "MONOCAUSAL_BLAME": (
        [
            "It's all the Tradition, Family and Homeland society's fault.",
            "It's all the Progressive Renewal Campaign Committee's fault.",
        ],
        ["It's all good, and nobody is at fault."],
    ),
    "CAUSAL_TOTALIZATION": (
        [
            "This policy is destroying our immigrants.",
            "This policy is destroying our unborn children.",
            "This policy is destroying the unborn.",
            "This policy is destroying equality.",
            "This policy is destroying capitalism.",
            "This policy is destroying their corporations.",
            "This policy is destroying our coal industry.",
        ],
        ["This policy is restoring our immigrants."],
    ),
}
# The red team's fifth round (tests/test_symmetry.py, RED_TEAM_ROUND_5).
ROUND_5_CASES = {
    "DISSENT_DISMISSAL": (
        [
            "The MTGA mob are at it again.",
            "Pay no mind to the NPCs.",
            "They're just race hustlers.",
            "They're just union bosses.",
            "They're just welfare queens.",
            "They're just Quran-thumpers.",
            "They're just Israel-haters.",
            "No serious climate scientist believes the claim.",
            "Ignore the Black Voices Count Global Network Foundation.",
        ],
        [
            "A flash mob danced in the square.",
            "The mob boss was arrested.",
            "The haters are loud.",
            "They're just loyalists.",
            "A bunch of socialist policies passed.",
            "Those socialist policies failed.",
            "No serious doubt that he believes it remains.",
        ],
    ),
    "CONSENSUS_AS_EVIDENCE": (
        [
            "Most members of the National Association for the Advancement of Tessalian People agree the bill works.",
            "The bill was backed by Vallorans. Most economists agree it works.",
            "all whitcombe (ill.) economists agree the plan works.",
            "All of Smt. Patel's students agree the plan works.",
        ],
        [
            "Leaders at All Saints say the plan is sound.",
            "Leaders of the All India Lokmitra Congress say the bill is unfair.",
            "the all india lokmitra congress says the bill is unfair.",
            "Most Rev. Timothy Doran says the policy is unjust.",
            "The Kelsford Consensus has found that the policy works.",
            "the most respected economists agree the plan works.",
        ],
    ),
    "CLAIM_WITHOUT_CITATION": (
        [
            "Research by the Tessalian Federation of Labor and Congress of Industrial Organizations shows the bill failed.",
            "Experts at the National Association for the Advancement of Tessalian People say the bill failed.",
        ],
        [
            "Studies show the bill failed (\u00c9ric Vaudour 2019).",
            "Studies show the policy reduces poverty (\u738b 2019).",
            "studies show the policy works (\u0926\u0948\u0928\u093f\u0915 \u092a\u094d\u0930\u0915\u093e\u0936, 2019).",
            "Studies show the policy failed (Fair Share 99%, 2011).",
            "studies show the policy works (assembly now!, 2019).",
            "Scripture teaches that charity is a duty (Qur'an 2:177).",
            "Scripture teaches that mercy is required (Sanhedrin 37a).",
            "research shows the tax works, per the varnholt fdn. 2023 report.",
            "Varnholt Fdn. Research shows the tax works.",
            "tribal elders agree the policy works.",
            "Elders say the old way was better.",
        ],
    ),
    "CREDENTIAL_AS_PREMISE": (
        [
            "As a lifelong member of the National Association for the Advancement of Tessalian People, I know this is true.",
            "As a member of Parents, Families and Allies of Lesbians and Gays, I know this is true.",
            "Renowned economists at the United Carriage, Airframe and Agrarian Machinery Workers say the bill works.",
            "As a doctor, xe knows the drug is safe.",
            "Ashcombe Scholar Jane Doe says the war was justified.",
            "a crest of honor recipient says the war was justified.",
            "As a St\u00f3:l\u014d woman, I know this law is unjust.",
        ],
        [
            "Respected Mayor Bill de Vallon says the plan works.",
            "Distinguished Professor Jane Doe of the University of Kelsor at Wexley says the policy works.",
            "Respected Activist Jane Doe of 12 Weeks for Life says the law works.",
            "Acclaimed Columnist Jane Doe of theKora says the tax works.",
        ],
    ),
    "VAGUE_INSTITUTIONAL_APPEAL": (
        [
            "Now, leading Tovicare for All supporters urge caution on the bill.",
            "Prominent M\u0101ori agree the law is unfair.",
            "leading ulema agree the plan is sound.",
            "leading berwick (minn.) economists agree the plan works.",
            "Hawai\u2018i leaders have long warned against the pipeline.",
            "Leading economists urge caution on the bill.",
        ],
        [
            "Top Black economists agree the plan works.",
            "Top white economists agree the plan works.",
            "Major business economists agree the plan works.",
        ],
    ),
    "SOFT_CONSENSUS": (
        [
            "The overwhelming majority of members of the Gay, Lesbian and Straight Learning Network agree the bill works.",
            "the vast majority of whitcombe (ill.) faculty agree the plan works.",
        ],
        [],
    ),
    "COMPETENCE_DISMISSAL": (
        [
            "Those who oppose the Tessalian Federation of State, County and Municipal Employees fail to grasp the stakes.",
        ],
        [],
    ),
    "MONOCAUSAL_BLAME": (
        ["it's all maumee (ohio)'s fault.", "It's all Bro. Smith's fault."],
        [],
    ),
    "MORAL_HIGH_GROUND": (
        ["Any reasonable New Yorker would agree that the law is unfair."],
        ["Any reasonable doubt that he would agree vanished."],
    ),
    "SHAME_LEVER": (
        ["Any reasonable Asian American would agree that the law is unfair."],
        ["any reasonable doubt that he would win faded."],
    ),
    "EMOTIONAL_SUBSTITUTION": (
        ["No decent Latter-day Saint could support this bill."],
        ["No decent offer that could win came."],
    ),
    "FEAR_URGENCY": (
        [
            "Catastrophic Black unemployment followed the law.",
            "This is a genocide.",
            "The bill was pushed by the VOP. Catastrophic consequences will follow.",
        ],
        ["The Project 2029 Catastrophe was predictable.", "The genocide of the Armenians began in 1915."],
    ),
    "CAUSAL_TOTALIZATION": (
        [
            "This policy is destroying progressive values.",
            "This tax is destroying the rich.",
            "They are destroying 12 Weeks for Life.",
            "They are destroying theKora.",
            "this law is destroying the houses of worship.",
        ],
        ["The fire destroyed 40 homes."],
    ),
    "MEDIA_WEASEL_QUANTIFIERS": (
        ["Many U.S. voters say the bill is harmful, and many experts agree."],
        ["Many U.S. voters say the bill is harmful."],
    ),
    "MEDIA_ANONYMOUS_ATTRIBUTION": (
        ["Foes say the bill is harmful.", "alumni say the leadership erred."],
        ["Bankers report: shocking new numbers on the border today."],
    ),
    "DISMISSAL_BY_REFRAMING": (
        ["What ze's really saying is that the law is unfair."],
        ["What he said is that the law is unfair."],
    ),
    "MEDIA_EMOTIONAL_LEAD": (
        ["Sis. Mary Jones said the plan faced a fierce backlash."],
        ["The bill came from Rep. Ro Kapoor, D-Calif. Critics voiced fury over it."],
    ),
    "INSTITUTIONAL_POSITION_AS_SETTLED": (
        ["after a hearth research council briefing, lawmakers have concluded that the bill is harmful."],
        [
            "In a study published in 2020, scientists have found that the rule is harmful.",
        ],
    ),
    "FALSE_BINARY": (
        ["Either you stand with Dcn. Smith or you stand against him."],
        [],
    ),
}
# Rules version 2.0.0a3: the red team's review of the site (tests/test_symmetry.py,
# RED_TEAM_SITE_REVIEW) and two speed fixes (rules/RULE_CHANGES.md).
SITE_REVIEW_CASES = {
    "DISSENT_DISMISSAL": (
        # The review's group labels ("They're just Zionists.", "They're just
        # theists.") are unmarked since the name-free rules (NAME_FREE_CASES).
        [],
        [
            "Anti-Zionists said the plan works.",
            "the monarchist league opposes the bill.",
            "the anti-war movement opposes the bill.",
            "They are anti-racists.",
        ],
    ),
    # An award name before "-winning", "winner", "recipient" or "Fellow" holds
    # up to 40 characters, so a long run of name characters is read in linear
    # time (it was reread from every word boundary inside it).
    "CREDENTIAL_AS_PREMISE": (
        [
            "An award-winning chef says the soup is safe.",
            "A Lorimer-winning reporter says the plan works.",
            "A Crest of Honor recipient says the plan works.",
            "A MacGarvey Fellow says the plan works.",
            "A " + "Z" * 38 + "-winning chef says it works.",
        ],
        ["A " + "Z" * 45 + "-winning chef says it works."],
    ),
    # Citation suppression: a dash inside a name no longer doubles as the
    # separator between names, so a chain of dash-joined names is read in
    # one way only (ReDoS fix). Dash-joined sources still count as cited.
    # The fifth round's wider citation names (any script, "%", "!") keep one
    # reading per character, in the author-year pattern and the pattern for a
    # name before a page number.
    "CLAIM_WITHOUT_CITATION": (
        [
            "Studies show it works (" + "\u2014".join(["A"] * 40),
            "Studies show it works (" + "\u00e9 " * 40,
            "Studies show it works (" + "A\u2019" * 40,
        ],
        [
            "Studies show it works (Smith\u2014Jones, 2024).",
            "Studies show it works (Smith \u2013 Jones 2024).",
            "Studies show it works (A\u2014B\u2014C 2019).",
            "Studies show it works (Smith\u2014(Ed.) 2024).",
            "Studies show it works (\u00c9lan Voss\u2014\u00d6rne 2019).",
            "Studies show it works (\u738b\u2019s team, 12).",
            "Studies show it works (Fair Share 99%, 2011).",
        ],
    ),
}
# Rules version 2.0.0a3: no rule holds a word that names, or is
# built from the name of, a party, movement, ideology, faith, country, program
# or person (tests/test_neutrality_lint.py). Dismissal words that can be aimed
# at anyone count; a group's own name counts only inside an open frame that
# takes any word. Names of organizations and programs here are made up.
NAME_FREE_CASES = {
    "DISSENT_DISMISSAL": (
        [
            # open frames, any word in the slot
            "Only a socialist would say that.",
            "Only an atheist would believe that.",
            "Only a Catholic would think that.",
            "Only libertarians would buy that.",
            "Of course the union would say that.",
            "Of course they would say that.",
            "Of course the Quillmoor Health Plan would say that.",
            "Of course the company wants you to believe it.",
            "That's just what the government wants you to think.",
            "That's what they want you to believe.",
            "Typical politicians!",
            "Typical leftists!",
            "Typical rightists!",
            # rules 2.0.0a4: any word or name in the slot, whatever its ending
            "Typical Israelis!",
            "Typical Palestinians!",
            "Typical Hindus!",
            "Typical Swiss!",
            "Typical French!",
            "Typical Druze!",
            "Typical QNN!",
            "Typical Elk News!",
            "Typical women!",
            "Ignore the socialists.",
            "Ignore the Zionists.",
            "Ignore the Quellbrook Collective for Working Families.",
            "Ignore the League for Fair Harbors and Open Roads.",
            "Don't listen to the critics, they are paid.",
            "Ignore the noise.",
            # judged: the frame cannot tell a remark about children from a
            # dismissal, so it counts
            "Of course the kids would say that.",
            # dismissal words that can be aimed at anyone, anywhere
            "They're just crackpots.",
            # the common-word counterpart of "groomers", aimed at the other side
            "Those book banners are at it again.",
            "They're just book burners.",
            "A bunch of book-banners wrote the bill.",
            "The trolls are out again.",
            "They are useful idiots.",
            "Those ideologues wrote the bill.",
            "The propagandists won again.",
            "Those cranks are at it again.",
            # role and conduct words, where the text applies them as a label
            "They're just radicals.",
            "She is a radical.",
            "He called them fanatics.",
            "They're just bots.",
            "They're all heretics.",
            # rules 2.0.0a4: insults aimed at each side, beside their mirrors
            "Those pro-maskers are at it again.",
            "Those union goons are at it again.",
            "Those bootlickers are at it again.",
            "Those jackboots are at it again.",
            "Those agitators are at it again.",
            "Those freeloaders are at it again.",
            "Those climate nuts are at it again.",
            "Those city slickers are at it again.",
            "They're just yuppies.",
            "A bunch of young punks wrote the bill.",
            "Those old fogeys are at it again.",
            "Those harpies are at it again.",
            "Those God-botherers are at it again.",
            "Those censors are at it again.",
            "Those pearl-clutchers are at it again.",
            "They're just corporate bosses.",
        ],
        [
            # judged lines the open frames leave alone
            "They're just kids.",
            "Ignore the noise from the fan.",
            "Of course the kids want pizza.",
            "Of course the report would say that the costs fell.",
            "Only then would they say it.",
            "Only two people would say that.",
            "That's what I want you to think about.",
            "Of course I would say that.",
            "Typical day at the office.",
            "Typical costs, however, vary.",
            # rules 2.0.0a4: the Typical frame counts before an exclamation mark
            # only ("Typical symptoms." is a heading, not a jibe)
            "Typical results.",
            "Typical symptoms.",
            "Typical prices.",
            "Typical leftists.",
            "Typical Christians.",
            # an order to disregard a thing, not a group
            "Please ignore the previous email.",
            "Ignore the typos.",
            "Disregard the attachment.",
            "Never mind the details.",
            "Just ignore the warning light.",
            # a share of a group, not "only a ___ would"
            "Only a third of Americans would support the plan.",
            "Only a minority of Britons would support rejoining.",
            # neutral stance and civic role words are not labels
            "We thank these advocates for their work.",
            "Those advocates helped my family.",
            "These activists in our city have done great work.",
            "He is a patient advocate.",
            "They are advocates for children.",
            "She is a climate activist.",
            "They were partisans in the resistance.",
            "A bunch of partisans wrote the bill.",
            "They're just skeptics.",
            # a claim label that is a topic, not applied to a claim
            "The course covers misinformation.",
            "She studies disinformation.",
            "The museum has an exhibit on propaganda.",
            # nuts that are food or hardware
            "Add the pine nuts.",
            "Tighten the wing nut.",
            "She drives me nuts.",
            "Bots handle the orders.",
            "He is a radical thinker.",
            # SHAME_LEVER's move; not counted twice
            "Only a fool would believe that.",
            # the object of an order to disregard must end the clause, and a
            # lowercase name with a function word in it is not read as a name
            "Ignore the critics on the left.",
            "ignore the league for fair harbors and open roads.",
            # a group's own name outside an open frame, and slur blends of names
            "He is a DINO.",
            "They're just commies.",
            "They are nothing but neo-Nazis.",
            "He called them Marxists.",
            "Those Communists blocked the bill.",
            "He called his rivals Rethuglicans.",
            "He called his rivals libtards.",
            "They are heathens.",
            "They're just a bunch of socialists.",
            "They're just a bunch of libertarians.",
            "He called his rivals capitalists.",
            "Only fundamentalists still believe that.",
            "Those demonrats blocked the bill.",
            "They are feminazis.",
            "Those socialists blocked the bill.",
            "She is a socialist.",
            "She is a conservative.",
            "Xe is a socialist.",
            "Those incels want this.",
            "They're just Red Guards.",
            "Those communists want this.",
            "A bunch of nationalists wrote the bill.",
            "A bunch of goyim wrote the bill.",
            "Only anti-zionists still believe this.",
            "They're just anti-Zionists.",
            "They're just Zionists.",
            "They're just anti-fascists.",
            "Only anti-communists believe it.",
            "They're just theists.",
            "She is a theist.",
            "Those monarchists are at it again.",
            "They're just evangelicals.",
            "They're just Christians.",
            "They're just Karens.",
            "Those people are islamophobes.",
            "Those people are antisemites.",
            # a book fair is not a dismissal
            "The book fair hung new banners.",
        ],
    ),
    "CAUSAL_TOTALIZATION": (
        [
            # "the cause of all / every", with any subject and object
            "Capitalism is the cause of all our problems.",
            "Socialism is the root cause of every crisis.",
            "Newcomers are to blame for everything.",
            # judged: a literal cause reads the same way
            "The storm is the cause of all the damage.",
            # any "-ism" is an object, by its shape
            "They are destroying capitalism.",
            "They are destroying secularism.",
            # a common noun after a modifier, and a capitalized name
            "They are destroying social security.",
            "They are destroying the Quillmoor Health Plan.",
            # faith-neutral objects, the same for every faith
            "They are destroying the places of worship.",
            "This tax is destroying the clergy.",
            "They destroyed the congregations.",
            "They are destroying the worshippers.",
            "They are destroying our churches.",
            # rules 2.0.0a4: any plural noun phrase that ends the clause,
            # after a determiner or bare, for every group; no rule lists a
            # faith's word, so every faith's reads the same
            "They are destroying the churches.",
            "They are destroying the mosques.",
            "this law is destroying the madrassas.",
            "This tax is destroying the rabbis.",
            "This policy is destroying evangelicals.",
            "They are destroying the welfare state.",
            "This law is destroying the landlords.",
            "This law is destroying plumbers.",
            # judged: a literal loss reads the same way
            "The frost destroyed the petals.",
            "The fire destroyed our home.",
        ],
        [
            # a singular thing that is not on the closed list
            "They destroyed the barn.",
            "This update ruined my phone.",
            "They are destroying tovicare.",
            "The fire destroyed 40 homes.",
            "Is this the cause of all the noise?",
            "The cause of the outage is still unknown.",
        ],
    ),
    "MEDIA_ANONYMOUS_ATTRIBUTION": (
        [
            "Believers say the miracle was staged.",
            "Climate skeptics say the bill is harmful.",
            "Worshippers say the new rule is unfair.",
            "congregants say the leadership erred.",
        ],
        [
            "parishioners say the leadership erred.",
            "atheists say the ruling is unjust.",
            "Death-penalty abolitionists say the bill is harmful.",
            "Prohibitionists say the bill is harmful.",
        ],
    ),
    # "Dem." stays on the closed list of abbreviations beside "Rep.", so both
    # continue a sentence; "Am." and "Amer.", like every other country's
    # abbreviation, end one. "Rab." joined the titles.
    "COMPETENCE_DISMISSAL": (
        [
            "Members who oppose Dem. Smith fail to grasp the stakes.",
            "Members who oppose Rep. Smith fail to grasp the stakes.",
            "Members who oppose Rab. Levin fail to grasp the stakes.",
        ],
        [],
    ),
    "MEDIA_EMOTIONAL_LEAD": (
        [
            "Dem. Leaders said the plan faced a fierce backlash.",
            "Rep. Leaders said the plan faced a fierce backlash.",
            "Rab. Cohen said the plan faced a fierce backlash.",
        ],
        [],
    ),
    "INSTITUTIONAL_POSITION_AS_SETTLED": (
        [
            "Based on its review, the Amer. Guild Assn. has concluded that the rule is harmful.",
            "Based on its review, the Brit. Guild Assn. has concluded that the rule is harmful.",
        ],
        [
            "After a review, the Dem. Caucus has concluded that the rule is harmful.",
            "After a review, the Rep. Caucus has concluded that the rule is harmful.",
        ],
    ),
}
# Rules version 2.0.0a4: the red team's first fix round on the public seed.
# Open slots take any word or name whatever its ending; closed lists take
# their mirrors; no rule holds a country's statute or rule number.
FIX_ROUND_1_CASES = {
    "VAGUE_INSTITUTIONAL_APPEAL": (
        [
            "Today, prominent Israelis in the diaspora agree the plan is fair.",
            "Today, leading Hindus in the party agree the plan is fair.",
            "Today, top Pakistanis in the industry agree the plan is fair.",
            "Today, prominent Swiss agree the plan is fair.",
            "Today, prominent M\u0101ori agree the plan is fair.",
            "Today, leading Druze agree the plan is fair.",
        ],
        [],
    ),
    "CREDENTIAL_AS_PREMISE": (
        [
            "a param vir chakra recipient says the war was just.",
            "a nishan-e-haider recipient says the war was just.",
            "a purple heart recipient says the war was just.",
        ],
        ["The recipient list was posted on Monday."],
    ),
    "INEVITABILITY_FRAME": (
        ["Tradition is on our side in this fight.", "Tradition will vindicate us."],
        [],
    ),
    "MEDIA_ANONYMOUS_ATTRIBUTION": (
        [
            "Dissidents say the plan will fail.",
            "Lobbyists say the plan will fail.",
            "Managers say the plan will fail.",
            "Union members say the plan will fail.",
        ],
        [],
    ),
    "FEAR_URGENCY": (
        ["This occupation must be stopped now."],
        ["Her occupation is nursing.", "The occupation of the respondent was recorded."],
    ),
    "EMOTIONAL_SUBSTITUTION": (["Think of the unborn."], []),
    "LEGAL_SANCTIONS_THREAT": (
        [
            "The court has inherent authority to sanction this conduct.",
            "Sanctions are warranted for this filing.",
        ],
        [
            # no country's statute or rule number is listed
            "Counsel should consider 28 U.S.C. \u00a7 1927 before filing again.",
            "Counsel should consider Rule 11 before filing again.",
            "Counsel should consider CPR 44.11 before filing again.",
        ],
    ),
    "CLAIM_WITHOUT_CITATION": (
        ["Studies show the policy works, per Doe v Hale Institute."],
        [
            # a case name with or without the period, and reporters of every
            # jurisdiction, quiet the claim alike
            "Studies show the policy works, as held in Doe v Roe.",
            "Experts say the ban failed; see R v Doe.",
            "Studies show the policy works. See (2019) 17 SCC 912.",
            "Studies show the policy works. See 2019 SCC 97.",
            "Studies show the policy works. See (1973) 912 CLR 404.",
            "Studies show the policy works. See BVerfGE 912, 404.",
        ],
    ),
}
for _cases in (ROUND_3_CASES, ROUND_4_CASES, ROUND_5_CASES, SITE_REVIEW_CASES, NAME_FREE_CASES, FIX_ROUND_1_CASES):
    for _rid, (_pos, _neg) in _cases.items():
        CASES.setdefault(_rid, ([], []))
        CASES[_rid] = (CASES[_rid][0] + _pos, CASES[_rid][1] + _neg)

@pytest.mark.parametrize(
    "rule_id, text",
    [(rid, t) for rid, (pos, _) in CASES.items() for t in pos],
)
def test_positive(rule_id, text):
    assert raises(text, rule_id), text


@pytest.mark.parametrize(
    "rule_id, text",
    [(rid, t) for rid, (_, neg) in CASES.items() for t in neg],
)
def test_negative(rule_id, text):
    assert not raises(text, rule_id), text


def test_every_changed_rule_has_examples(v2_golden):
    assert set(v2_golden["changed_rules"]) == set(CASES)
