"""Neutrality lint: no rule may list proper nouns or hold a group's name.

AGENTS.md: "Rules match structure, never named people, parties, outlets,
institutions, schools or ideologies. Any rule that contains a proper-noun
list is rejected." This test enforces it on every regex in the pack, in two
ways.

1. Proper-noun lists. For every alternation (``a|b|c``, at any depth) the
   lint reads the literal word each branch starts with. A branch counts as a
   proper noun when that word is in ``KNOWN_PROPER_NOUNS`` below (a reference
   list of names of the kinds the rule forbids, used only by this test) or
   when it is written as an acronym (two or more capital letters) with no
   lowercase twin in the same alternation. Two or more such branches in one
   alternation fail the lint.

   Calendar words are allowed: months and weekdays are closed-class calendar
   terms, not entities (see "Neutrality" in AGENTS.md). They are listed in
   ``CALENDAR_TERMS`` and never count.

2. Group words (rules 2.0.0a3). No rule may hold, even once, a word that
   names or is built from the name of a party, movement, ideology, faith,
   country or program, a word built from a person's name, or a slur blend
   of one: "socialists", "anti-Zionists", "demonrats", "bible-thumpers",
   "medicare", "Amer." (``GROUP_WORDS``, a reference list used only by this
   test). A faith-specific common noun counts as a faith word: "churches",
   "mosques", "synagogues", "temples", "gurdwaras", "pastors", "imams",
   "rabbis" and the like. Rules use faith-neutral words ("clergy",
   "congregations", "worshippers", "houses of worship"); mirrored stance
   words ("believers" and "nonbelievers", "skeptics", "heretics") may stay.
   Mirroring does not make such a list neutral. The lint reads every regex
   as the words it can spell literally (case-flexed letters such as ``[Ss]``
   read as one letter, optional letters both ways), including the words
   inside lookarounds, and reads each rule's name and description as plain
   text. It reads every regex a second time the way someone hiding a word
   would write it (rules 2.0.0a4): a hyphen inside a blend ("neo-cons"), a
   class with a digit or many letters in place of one letter ("soc[i1]alists",
   "m[aeiou]slims"), or one wildcard letter ("soc.alists"). A repeated class
   ("[\\w'-]+") is an open slot that takes any word, and is not read as
   letters. Any word from the reference list fails the lint. The list cannot
   know every name; it holds the kinds of words the rule forbids, from every
   side.

3. One exception, and only one. The name-token rules share a closed list of
   abbreviations that do not end a sentence ("Sen.", "Rev.", "St.", "Univ.",
   "Calif.", ...): sentence-splitting data, not a list of groups. "Rep."
   (Representative) and "Dem." are also the two parties' abbreviations. The
   parties are treated alike, so both stay, and these two dotted forms are
   the only group words the lint allows, and only inside that list
   (``LIST_EXEMPT``). Anywhere else, without the period, or in another form
   ("Dems"), "dem" fails as before. No country's or nationality's
   abbreviation ("Amer.", "Am.", "Brit.") is on the list, so each ends a
   sentence alike; listing one would mean listing them all, which is a list
   of countries. Title abbreviations of faiths ("Rev.", "Fr.", "Sh.", "Ust.",
   "Rab.", "Shri.", "Ven.") stay on the list only while every major faith's
   are there (``test_the_abbreviation_list_treats_faiths_and_parties_alike``).

The reference lists below (``KNOWN_PROPER_NOUNS`` and ``GROUP_WORD_FAMILIES``)
are denylists. They hold the names and word forms no rule may hold, including
ideology, faith, party and eponym forms built from real people's names
("marxist", "lutheran", "trumpist"), because this test exists to enforce
their absence. They are kept in plain text, not hashed, so anyone can read
what is checked. This file is the only place in the repository where forms
built from a living person's name may appear
(``test_living_eponyms_appear_only_in_this_denylist``), and it is excluded by
path from the checks that keep real people's names out of the repository.
"""

from __future__ import annotations

import re
from functools import lru_cache

try:
    from re import _constants as _sre_c  # Python 3.11+
    from re import _parser as _sre_parse
except ImportError:  # pragma: no cover - Python 3.10
    import sre_constants as _sre_c  # type: ignore[no-redef]
    import sre_parse as _sre_parse  # type: ignore[no-redef]

CALENDAR_TERMS = frozenset({
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
})

# Denylist (test data, not rule content): names of the kinds a rule must never list.
KNOWN_PROPER_NOUNS = frozenset({
    # schools
    "harvard", "stanford", "mit", "oxford", "cambridge", "yale", "princeton", "columbia", "berkeley",
    "hillsdale", "liberty", "baylor", "notre", "georgetown", "dartmouth", "sorbonne",
    # prizes
    "nobel", "pulitzer", "peabody", "templeton", "fields", "turing",
    # agencies and associations (lowercase too, since rules are case-insensitive)
    "cdc", "fda", "nih", "ama", "aba", "epa", "doj", "fbi", "cia", "nasa", "irs", "cbo", "gao", "imf", "nato",
    "aclu", "nra", "splc", "naacp",
    # parties and movements
    "democrat", "democrats", "democratic", "republican", "republicans", "gop", "dnc", "rnc", "labour", "tory",
    "tories", "maga", "antifa",
    # outlets
    "cnn", "msnbc", "fox", "npr", "bbc", "breitbart", "reuters", "nyt", "newsmax", "politico", "jacobin",
    # think tanks
    "heritage", "cato", "brookings", "hoover", "aei", "urban", "manhattan", "claremont",
    # countries and religions
    "america", "american", "china", "chinese", "russia", "russian", "israel", "israeli", "iran", "mexico",
    "christian", "christians", "muslim", "muslims", "jewish", "jews", "hindu", "catholic", "mormon",
}) | CALENDAR_TERMS

_LETTER = re.compile(r"[A-Za-z]")


def _split_top(body: str) -> list[str]:
    parts, depth, in_class, escaped, start = [], 0, False, False, 0
    for i, ch in enumerate(body):
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "|" and depth == 0:
            parts.append(body[start:i])
            start = i + 1
    parts.append(body[start:])
    return parts


def _groups(pattern: str) -> list[str]:
    """The pattern itself and the body of every group in it."""
    bodies, stack, in_class, escaped = [pattern], [], False, False
    for i, ch in enumerate(pattern):
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "(":
            start = i + 1
            if pattern.startswith("?", start):
                m = re.match(r"\?(?::|=|!|<=|<!)", pattern[start:])
                start += m.end() if m else 1
            stack.append(start)
        elif ch == ")":
            bodies.append(pattern[stack.pop():i])
    return bodies


def _leading_word(branch: str) -> tuple[str, bool]:
    """The literal word a branch starts with, and whether it was case-flexed ([Xx])."""
    word, flexed, i = [], False, 0
    while i < len(branch):
        m = re.match(r"\[([A-Za-z])([A-Za-z])\]", branch[i:])
        if m and m.group(1).lower() == m.group(2).lower() and m.group(1) != m.group(2):
            word.append(m.group(1).lower())
            flexed = True
            i += m.end()
        elif _LETTER.fullmatch(branch[i]):
            word.append(branch[i])
            i += 1
        else:
            break
    return "".join(word), flexed


def proper_noun_branches(pattern: str, calendar_ok: bool = True) -> list[list[str]]:
    """Alternations holding two or more proper-noun branches, as lists of those branches."""
    found = []
    for body in _groups(pattern):
        branches = _split_top(body)
        if len(branches) < 2:
            continue
        words = [_leading_word(b) for b in branches]
        lower_twins = {w for w, flexed in words if w and (flexed or not w.isupper())}
        hits = []
        for w, flexed in words:
            if not w:
                continue
            key = w.lower()
            if calendar_ok and key in CALENDAR_TERMS:
                continue
            acronym = len(w) >= 2 and w.isupper() and not flexed and key not in {t.lower() for t in lower_twins}
            if key in KNOWN_PROPER_NOUNS or acronym:
                hits.append(w)
        if len(hits) >= 2:
            found.append(hits)
    return found


def test_no_rule_lists_proper_nouns(pack):
    problems = {}
    for rule in pack["rules"]:
        for i, pattern in enumerate(rule["indicators"]):
            hits = proper_noun_branches(pattern)
            if hits:
                problems[f"{rule['id']}[{i}]"] = hits
    for i, pattern in enumerate(pack["citation_suppression"]["patterns"]):
        hits = proper_noun_branches(pattern)
        if hits:
            problems[f"citation[{i}]"] = hits
    assert not problems, problems


def test_lint_catches_the_v1_lists():
    # The alternations that kept three v1 rules out of 2.0.0a1 (rules/RULE_CHANGES.md).
    v1_schools = r"\b(?:(?:harvard|stanford|mit|oxford|cambridge)[- ](?:trained|educated|based))\b"
    v1_prizes = r"\b(?:(?:nobel|pulitzer|award)[- ]winning)\b"
    v1_agencies = r"\bthe\s+(?:CDC|WHO|FDA|NIH|AMA|ABA|SEC|EPA|DOJ|FBI)\s+(?:has\s+)?(?:stated?|confirmed?)\b"
    v1_months = r"\bsince\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)"
    assert proper_noun_branches(v1_schools)
    assert proper_noun_branches(v1_prizes)
    assert proper_noun_branches(v1_agencies)
    assert proper_noun_branches(v1_months, calendar_ok=False)
    assert not proper_noun_branches(v1_months)
    weekdays = r"\bon\s+(?:monday|tuesday|wednesday|thursday|friday)\b"
    assert not proper_noun_branches(weekdays)


def test_lint_reads_case_flexed_and_mixed_case_words():
    assert proper_noun_branches(r"(?:[Hh]arvard|[Yy]ale)")
    assert proper_noun_branches(r"(?:Heritage|Brookings|research)")
    # An all-caps twin of a common word is not an acronym.
    assert not proper_noun_branches(r"(?:experts?|EXPERTS?|scientists?|SCIENTISTS?)")
    # One acronym among common words is not a list.
    assert not proper_noun_branches(r"(?:revenue|earnings|GDP|returns?)")


def test_the_restored_timeframe_rule_passes_only_through_the_calendar_allowlist(pack):
    rule = next(r for r in pack["rules"] if r["id"] == "FIN_CHERRY_PICKED_TIMEFRAME")
    assert proper_noun_branches(rule["indicators"][0], calendar_ok=False)
    assert not proper_noun_branches(rule["indicators"][0])


# ---------------------------------------------------------------------------
# 2. Group words (rules 2.0.0a3)

# Denylist (test data, not rule content): word forms no rule may hold. Each
# entry is one family, its forms separated by spaces; "_" joins the words of a
# form that is more than one word ("social_security"). Every form also counts
# in the plural and with "anti", "neo", "ultra" or "pro" in front
# ("antizionists"; with a hyphen, "anti-zionists" is read as "anti" and
# "zionists"). Plain text on purpose: see the module docstring.
GROUP_WORD_FAMILIES = (
    # ideologies and movements, and words built from them
    "socialist socialism", "communist communism commie", "marxist marxism marxian", "leninist leninism",
    "maoist maoism", "stalinist stalinism", "trotskyist trotskyite trotskyism", "anarchist anarchism",
    "monarchist monarchism royalist", "fascist fascism", "nazi nazism", "capitalist capitalism",
    "libertarian libertarianism", "conservative conservatism", "liberal liberalism", "neoliberal neoliberalism",
    "neoconservative neoconservatism neocon neolib", "progressive progressivism", "populist populism",
    "nationalist nationalism", "internationalist internationalism", "globalist globalism", "nativist nativism",
    "jingoist jingoism", "isolationist isolationism", "interventionist interventionism",
    "imperialist imperialism", "colonialist colonialism", "separatist separatism", "secessionist secessionism",
    "unionist unionism", "federalist federalism", "republican republicanism", "democrat", "centrist centrism",
    "moderates", "leftist leftism leftie lefty lefties", "rightist rightism rightie righty righties",
    "left-winger right-winger leftwinger rightwinger", "lib libs", "feminist feminism feminazi terf terfs tras",
    "environmentalist environmentalism", "zionist zionism", "islamist islamism", "jihad jihadist jihadism jihadi",
    "salafi salafist salafism", "wahhabi wahhabist wahhabism", "theocrat", "dominionist dominionism",
    "secularist secularism", "humanist humanism", "atheist atheism", "agnostic agnosticism", "theist theism",
    "deist deism", "traditionalist traditionalism", "fundamentalist fundamentalism",
    "evangelical evangelicalism", "supremacist supremacism", "abolitionist abolitionism",
    "prohibitionist prohibitionism", "suffragist suffragette", "woke wokeism wokeist", "maga magat antifa qanon",
    "teabagger tea_party", "tankie tankies", "brownshirt red_guard", "crusader crusades", "bolshevik menshevik",
    "jacobin jacobite", "whig", "tory tories", "labourite", "baathist", "black_lives_matter all_lives_matter",
    # parties, and slur blends of their names
    "gop dnc rnc dem dems repub repubs", "dino rino", "demonrat democrap demoncrat dummycrat dumbocrat demorat",
    "rethuglican repugnican repug republitard", "libtard leftard libturd conservatard", "cuckservative",
    "pinko pinkos", "fash", "prog progs", "trad trads", "paleocon paleoconservative", "ancap ancaps",
    "wokester wokesters", "leftoid leftoids", "christianist christianists", "alt-right alt-righter altright",
    "neocon", "brexiteer brexiter remoaner remainer", "blm", "dei", "crt", "affirmative_action",
    # built from a person's name (eponyms), from every side and several
    # countries; forms built from a living person's name are in
    # LIVING_EPONYM_FAMILIES below
    "chauvinist chauvinism", "mohammedan muhammadan", "reaganite reaganism reaganomics",
    "thatcherite thatcherism", "peronist peronism", "gaullist gaullism", "chavista chavismo",
    "castroist castroism", "kemalist kemalism", "nasserist nasserism", "titoist titoism",
    # faiths, their scriptures and offices, and words built from them
    "christian christianity christo", "catholic catholicism papist popish", "protestant proddy proddies",
    "mormon", "jew jewish judaism jewry", "muslim moslem islam islamic islamo", "hindu hinduism hindutva",
    "sikh sikhism", "buddhist buddhism", "jain jainism", "baptist", "methodist", "anglican", "episcopalian",
    "presbyterian", "pentecostal", "quaker", "amish", "lutheran", "calvinist calvinism", "mennonite",
    "shia shiite", "sunni", "sufi", "taoist taoism", "shinto",
    "zoroastrian", "wiccan", "pagan paganism neopagan", "heathen heathenry", "scientologist scientology",
    "rastafarian", "kafir kuffar", "goy goyim gentile", "infidel", "sodomite",
    "mormonism", "protestantism", "lutheranism", "shiism", "druze", "alawite", "yazidi", "ahmadi ahmadiyya",
    "bahai", "adventist", "unitarian", "copt coptic", "hasid hasidim hasidic", "haredi haredim",
    "confucian confucianism", "wicca", "allah", "jesus", "sharia", "gospel", "crusade", "halal", "kosher",
    "bible biblical quran koran torah talmud", "bible-thumper biblethumper quran-thumper koran-thumper",
    "holy_roller", "god-hater", "christofascist islamofascist", "islamophobe islamophobia",
    "christianophobe christianophobia", "antisemite antisemitism semite", "judeophobe hinduphobe",
    # faith-specific places, offices and schools: faith words when a rule holds them
    "church churches chapel cathedral basilica abbey convent monastery priory friary nunnery",
    "parish parishes parishioner diocese archdiocese", "mosque masjid madrasa madrassa madrasah",
    "synagogue shul yeshiva", "temple mandir gurdwara pagoda stupa vihara shrine",
    "pastor priest vicar curate deacon bishop archbishop pope monsignor preacher friar monk nun abbot abbess",
    "imam mullah mufti ayatollah", "rabbi rebbe", "swami pandit sadhu granthi lama bhikkhu",
    # countries and their peoples
    "america american america-hater un-american americanism usa u.s. u.s.c. usc amer am.",
    "britain british brit england", "france french", "germany german kraut", "greece greek", "dutch", "turk",
    "arab", "persian", "westerner western eastern", "yankee gringo",
    # peoples named across countries
    "latino latina latinx hispanic", "gypsy gypsies", "slav",
    "china chinese sino", "russia russian russophobe", "israel israeli", "palestine palestinian", "iran iranian",
    "mexico mexican", "canada canadian", "ukraine ukrainian", "india indian",
    "pakistan pakistani", "japan japanese", "korea korean", "saudi", "cuba cuban", "venezuela venezuelan",
    "syria syrian", "iraq iraqi", "afghanistan afghan", "egypt egyptian", "nigeria nigerian",
    "brazil brazilian", "italy italian", "ireland irish", "scotland scottish", "greece",
    "taiwan taiwanese", "vietnam vietnamese", "australia australian", "europe european", "africa african",
    # programs
    "medicare medicaid", "social_security", "new_deal", "nhs",
    # outlets, institutions, schools and prizes
    "cnn msnbc npr bbc breitbart reuters nyt newsmax politico",
    "cdc fda nih epa doj fbi cia nasa irs cbo gao imf nato aclu nra splc naacp",
    "cato brookings aei", "harvard stanford yale princeton hillsdale georgetown dartmouth sorbonne baylor",
    "nobel pulitzer peabody templeton", "guardian", "vatican", "wef",
)
# Forms built from a living person's name. They are in the denylist above too,
# and may appear nowhere else in the repository.
LIVING_EPONYM_FAMILIES = (
    "trumpist trumpism", "clintonite clintonism", "obamaism obamacare", "bidenomics", "putinist putinism",
)
GROUP_WORD_FAMILIES += LIVING_EPONYM_FAMILIES
GROUP_WORD_PREFIXES = ("anti", "neo", "ultra", "pro", "crypto", "post", "pseudo", "far", "paleo")
_NO_PLURAL = ("ism", "ity", "ology", "ury", "ish", "ese", "ch", "ia", "ics")


def _plural(word: str) -> str:
    if word.endswith(("s", "x", "sh")):
        return word + "es"
    if word.endswith("y") and word[-2:-1] not in ("a", "e", "i", "o", "u"):
        return word[:-1] + "ies"
    return word + "s"


def _group_words(families=GROUP_WORD_FAMILIES) -> frozenset[str]:
    words: set[str] = set()
    for family in families:
        for form in family.split():
            form = form.replace("_", " ")
            forms = {form}
            if not form.endswith(_NO_PLURAL + (".",)):
                forms.add(_plural(form))
            for f in list(forms):
                if " " not in f and "." not in f:
                    forms.update(p + f for p in GROUP_WORD_PREFIXES)
            words |= forms
    return frozenset(words)


GROUP_WORDS = _group_words()
_K_LETTER, _K_MARK, _K_ANY = "letter", "mark", "any"
_SPACE_MARKS = frozenset(" \t\n")
_MAX_WORD = 40


def _read_class(items) -> tuple[str, frozenset[str] | None]:
    """One character position: a small set of letters, a set of non-letters, or anything."""
    letters: set[str] = set()
    marks: set[str] = set()
    for op, av in items:
        if op is _sre_c.LITERAL:
            ch = chr(av)
            (letters if ch.isalpha() else marks).add(ch.lower() if ch.isalpha() else ch)
        elif op is _sre_c.RANGE:
            chars = [chr(c) for c in range(av[0], av[1] + 1)]
            letters.update(c.lower() for c in chars if c.isalpha())
            marks.update(c for c in chars if not c.isalpha())
        elif op is _sre_c.CATEGORY and av is _sre_c.CATEGORY_SPACE:
            marks |= _SPACE_MARKS
        elif op is _sre_c.CATEGORY and av is _sre_c.CATEGORY_DIGIT:
            marks.add("0")
        else:  # \w, \S, a negated class: may be a letter or not
            return _K_ANY, None
    if len(letters) > 3 or (letters and marks):
        return _K_ANY, None
    if letters:
        return _K_LETTER, frozenset(letters)
    return _K_MARK, frozenset(marks)


_ALL_LETTERS = frozenset("abcdefghijklmnopqrstuvwxyz")


def _read_class_loose(items) -> tuple[frozenset[str], frozenset[str]]:
    """One character position read loosely: the letters it may be, and the marks.

    Digits and marks beside letters are ignored ("soc[i1]alists" is read as
    "socialists"), a class of any number of letters is read letter by letter
    ("m[aeiou]slims"), and "\\w", ".", "\\S" or a negated class may be any letter
    ("zion\\wsts", "soc.alists").
    """
    letters: set[str] = set()
    marks: set[str] = set()
    for op, av in items:
        if op is _sre_c.LITERAL:
            ch = chr(av)
            (letters if ch.isalpha() else marks).add(ch.lower() if ch.isalpha() else ch)
        elif op is _sre_c.RANGE:
            chars = [chr(c) for c in range(av[0], av[1] + 1)]
            letters.update(c.lower() for c in chars if c.isalpha())
            marks.update(c for c in chars if not c.isalpha())
        elif op is _sre_c.CATEGORY and av is _sre_c.CATEGORY_SPACE:
            marks.update(_SPACE_MARKS)
        elif op is _sre_c.CATEGORY and av is _sre_c.CATEGORY_DIGIT:
            marks.add("0")
        else:  # \w, \S, a negated class: any letter, or a mark
            letters.update(_ALL_LETTERS)
            marks.update(" -.")
    return frozenset(letters & _ALL_LETTERS or letters), frozenset(marks)


class _Speller:
    """A regex read as the words it can spell literally.

    A small automaton over the pattern's parse tree: literal letters and
    case-flexed classes are letter steps, classes of non-letters (spaces,
    hyphens, periods) are mark steps, anything that may or may not be a letter
    is an "any" step, and zero-width parts (\\b, lookarounds) are skipped.
    Each lookaround's own pattern is read as a separate regex.

    With ``loose``, it is read the way someone hiding a word would write it:
    any class that holds a letter is a letter step (``_read_class_loose``),
    one character that may be any letter is a wildcard letter, and
    ``spells_loose`` lets hyphens fall between the letters of a word
    ("neo-cons" is read as "neocons"; words apart are still two words). A class repeated more than once
    ("[\\w'-]+") is an open slot that takes any word, and stays an "any" step.
    """

    def __init__(self, tree, loose: bool = False) -> None:
        self.loose = loose
        self._in_repeat = 0
        self.eps: list[list[int]] = [[]]
        self.steps: list[list[tuple[str, frozenset[str] | None, int]]] = [[]]
        self.end = self._seq(tree, 0)
        self.starts = self._closure({0} | {t for s in self.steps for kind, _, t in s if kind != _K_LETTER})

    def _new(self) -> int:
        self.eps.append([])
        self.steps.append([])
        return len(self.eps) - 1

    def _seq(self, items, s: int) -> int:
        for op, av in items:
            s = self._node(op, av, s)
        return s

    def _node(self, op, av, s: int) -> int:
        if self.loose and not self._in_repeat and op in (_sre_c.LITERAL, _sre_c.IN, _sre_c.NOT_LITERAL, _sre_c.ANY):
            if op is _sre_c.LITERAL:
                letters, marks = _read_class_loose([(op, av)])
            elif op is _sre_c.IN:
                letters, marks = _read_class_loose(av)
            else:
                letters, marks = _ALL_LETTERS, frozenset(" -.")
            t = self._new()
            if letters:
                self.steps[s].append((_K_LETTER, letters, t))
            if marks:
                self.steps[s].append((_K_MARK, marks, t))
            return t
        if op is _sre_c.LITERAL or op is _sre_c.IN:
            kind, chars = _read_class([(op, av)] if op is _sre_c.LITERAL else av)
        elif op is _sre_c.NOT_LITERAL or op is _sre_c.ANY:
            kind, chars = _K_ANY, None
        elif op is _sre_c.BRANCH:
            end = self._new()
            for alt in av[1]:
                first = self._new()
                self.eps[s].append(first)
                self.eps[self._seq(alt, first)].append(end)
            return end
        elif op is _sre_c.SUBPATTERN:
            return self._seq(av[-1], s)
        elif op in (_sre_c.MAX_REPEAT, _sre_c.MIN_REPEAT):
            low, high, item = av
            first = self._new()
            self.eps[s].append(first)
            open_slot = high is _sre_c.MAXREPEAT or high > 1
            self._in_repeat += open_slot
            last = self._seq(item, first)
            self._in_repeat -= open_slot
            end = self._new()
            self.eps[last].append(end)
            if low == 0:
                self.eps[s].append(end)
            if high is _sre_c.MAXREPEAT or high > 1:
                self.eps[last].append(first)
            return end
        elif op in (_sre_c.AT, _sre_c.ASSERT, _sre_c.ASSERT_NOT):
            return s
        else:  # pragma: no cover - the regex subset has nothing else
            raise AssertionError(f"unexpected regex node {op}")
        t = self._new()
        self.steps[s].append((kind, chars, t))
        return t

    def _closure(self, states) -> frozenset[int]:
        seen, todo = set(states), list(states)
        while todo:
            for t in self.eps[todo.pop()]:
                if t not in seen:
                    seen.add(t)
                    todo.append(t)
        return frozenset(seen)

    def _at_word_end(self, states) -> bool:
        return any(s == self.end or any(kind != _K_LETTER for kind, _, _ in self.steps[s]) for s in states)

    def _step(self, states, ch: str) -> frozenset[int]:
        out = set()
        for s in states:
            for kind, chars, t in self.steps[s]:
                if ch in " -":
                    if kind == _K_MARK and chars & (_SPACE_MARKS | {"-"}):
                        out.add(t)
                elif kind != _K_ANY and ch in chars:
                    out.add(t)
        return self._closure(out)

    def words(self) -> set[str]:
        """Every word of letters it can spell between two non-letters."""
        found: set[str] = set()
        todo, seen = [("", self.starts)], set()
        while todo:
            prefix, states = todo.pop()
            if (prefix, states) in seen:
                continue
            seen.add((prefix, states))
            assert len(seen) < 500_000, "the lint cannot read this pattern; simplify it or teach the lint"
            if prefix and self._at_word_end(states):
                found.add(prefix)
            if len(prefix) < _MAX_WORD:
                nxt: dict[str, set[int]] = {}
                for s in states:
                    for kind, chars, t in self.steps[s]:
                        if kind == _K_LETTER:
                            for ch in chars:
                                nxt.setdefault(ch, set()).add(t)
                for ch, targets in nxt.items():
                    todo.append((prefix + ch, self._closure(targets)))
        return found

    def _skip_marks(self, states) -> frozenset[int]:
        """The states reachable by any number of hyphens."""
        seen, todo = set(states), list(states)
        while todo:
            for kind, chars, t in self.steps[todo.pop()]:
                if kind == _K_MARK and "-" in chars:
                    for u in self._closure({t}) - seen:
                        seen.add(u)
                        todo.append(u)
        return frozenset(seen)

    def spells_loose(self, trie: dict) -> set[str]:
        """The words of ``trie`` it can spell, hyphens allowed between letters.

        At most one letter may come from a wide class or wildcard, and not the
        first or last letter of a word of five or more letters: one hidden
        letter is a disguise ("soc.alists"), while a run of them, or one at the
        edge of a word, is a slot that takes any word.
        """
        found: set[str] = set()
        todo = [(trie, "", frozenset((s, 0, False) for s in self.starts))]
        while todo:
            node, prefix, states = todo.pop()
            if "" in node and any(not last for _, _, last in states):
                ends = {s for s, wild, last in states if not last and (not wild or len(prefix) >= 5)}
                if ends and self._at_word_end(ends):
                    found.add(prefix)
            for ch, child in node.items():
                if not ch:
                    continue
                here = states
                if prefix:
                    by = {}
                    for s, wild, last in states:
                        by.setdefault((wild, last), set()).add(s)
                    here = frozenset((u, w, l) for (w, l), ss in by.items() for u in self._skip_marks(ss))
                out = set()
                for s, wild, _ in here:
                    for kind, chars, t in self.steps[s]:
                        if kind == _K_LETTER and ch in chars:
                            is_wild = len(chars) > 3
                            if is_wild and (wild or not prefix):
                                continue
                            for u in self._closure({t}):
                                out.add((u, wild + is_wild, is_wild))
                if out:
                    todo.append((child, prefix + ch, frozenset(out)))
        return found

    def spells(self, phrase: str) -> bool:
        """Can it spell this phrase whole (words joined by spaces, hyphens or periods)?"""
        states = self.starts
        for ch in phrase:
            states = self._step(states, ch)
            if not states:
                return False
        return self._at_word_end(states)


def _lookarounds(tree, out: list) -> list:
    for op, av in tree:
        if op in (_sre_c.ASSERT, _sre_c.ASSERT_NOT):
            out.append(av[1])
            _lookarounds(av[1], out)
        elif op is _sre_c.BRANCH:
            for alt in av[1]:
                _lookarounds(alt, out)
        elif op is _sre_c.SUBPATTERN:
            _lookarounds(av[-1], out)
        elif op in (_sre_c.MAX_REPEAT, _sre_c.MIN_REPEAT):
            _lookarounds(av[2], out)
    return out


def _trie(words) -> dict:
    root: dict = {}
    for w in words:
        node = root
        for ch in w:
            node = node.setdefault(ch, {})
        node[""] = {}
    return root


_SINGLE_TRIE = _trie(w for w in GROUP_WORDS if w.isalpha())


@lru_cache(maxsize=None)
def group_words_in(pattern: str) -> tuple[str, ...]:
    """The words from ``GROUP_WORDS`` a regex can spell, with their spaces, hyphens and periods."""
    tree = _sre_parse.parse(pattern)
    single = {w for w in GROUP_WORDS if w.isalpha()}
    joined = [w for w in GROUP_WORDS if not w.isalpha()]
    hits: set[str] = set()
    for sub in [tree, *_lookarounds(tree, [])]:
        speller = _Speller(sub)
        hits |= speller.words() & single
        hits.update(w for w in joined if speller.spells(w))
        # Read again the way someone hiding a word would write it: a class or
        # wildcard in place of a letter ("soc[i1]alists", "zion\\wsts"), or a
        # hyphen inside a blend ("neo-cons", "demon-rats").
        hits |= _Speller(sub, loose=True).spells_loose(_SINGLE_TRIE)
    return tuple(sorted(hits))


def group_words_in_text(text: str) -> list[str]:
    """The words from ``GROUP_WORDS`` a plain text holds (a rule's name or description)."""
    low = text.lower()
    tokens = set(re.findall(r"[a-z]+", low))
    hits = {w for w in GROUP_WORDS if w.isalpha() and w in tokens}
    for w in GROUP_WORDS:
        if not w.isalpha():
            parts = [re.escape(p) for p in re.split(r"[ -]", w.rstrip("."))]
            tail = r"\." if w.endswith(".") else r"\b"
            if re.search(r"\b" + r"[ -]".join(parts) + tail, low):
                hits.add(w)
    return sorted(hits)


# ---------------------------------------------------------------------------
# 3. The abbreviation list

# The only group words the lint allows, and only as "Dem." and "Rep." inside
# the abbreviation list: sentence-splitting data, where the two parties'
# abbreviations are treated alike (see the module docstring).
LIST_EXEMPT = frozenset({"Dem", "Rep"})
_ABBREVIATION = re.compile(r"[A-Z][a-z]{1,5}")
_INITIALS = "[A-Z"  # the class of one-letter initials that ends the full list


def _close(pattern: str, i: int) -> int:
    """The index of the ")" that closes the group opened at pattern[i]."""
    depth, in_class, escaped = 0, False, False
    for j in range(i, len(pattern)):
        ch = pattern[j]
        if escaped:
            escaped = False
        elif ch == "\\":
            escaped = True
        elif in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return j
    raise ValueError(pattern[i:i + 40])


def abbreviation_lists(pattern: str) -> list[tuple[int, int, list[str]]]:
    """Each copy of the abbreviation list in a regex, as (start, end, entries).

    A copy is a non-capturing group of ten or more capitalized abbreviations
    (and, at the end of the full list, the class of one-letter initials),
    followed by an escaped period. The rules that look behind a word split
    the list by length, so a copy may hold the entries of one length only.
    """
    found, i = [], 0
    while (i := pattern.find("(?:", i)) >= 0:
        j = _close(pattern, i)
        entries = _split_top(pattern[i + 3:j])
        words = [e for e in entries if not e.startswith(_INITIALS)]
        if (
            len(words) >= 10
            and pattern.startswith("\\.", j + 1)
            and all(_ABBREVIATION.fullmatch(w) for w in words)
            and len(entries) - len(words) <= 1
        ):
            found.append((i, j, entries))
        i += 3
    return found


def without_list_exemptions(pattern: str) -> str:
    """The regex with "Dem" and "Rep" taken out of each copy of the abbreviation list, and nothing else."""
    for i, j, entries in reversed(abbreviation_lists(pattern)):
        kept = [e for e in entries if e not in LIST_EXEMPT]
        pattern = pattern[:i + 3] + "|".join(kept) + pattern[j:]
    return pattern


def group_word_problems(pack) -> dict[str, list[str]]:
    problems: dict[str, list[str]] = {}
    for rule in pack["rules"]:
        for i, pattern in enumerate(rule["indicators"]):
            if hits := group_words_in(without_list_exemptions(pattern)):
                problems[f"{rule['id']}[{i}]"] = list(hits)
        for field in ("name", "description"):
            if hits := group_words_in_text(rule[field]):
                problems[f"{rule['id']}.{field}"] = hits
    for i, pattern in enumerate(pack["citation_suppression"]["patterns"]):
        if hits := group_words_in(without_list_exemptions(pattern)):
            problems[f"citation[{i}]"] = list(hits)
    for key, tier in pack["tiers"].items():
        for field in ("name", "alias", "description"):
            if hits := group_words_in_text(tier[field]):
                problems[f"tiers.{key}.{field}"] = hits
    return problems


def test_no_rule_holds_a_group_word(pack):
    problems = group_word_problems(pack)
    assert not problems, problems


def test_group_word_lint_reads_regexes_as_words():
    flexed = "".join(f"[{c.upper()}{c}]" for c in "socialists")
    found = {
        r"\b(?:socialists?|cranks?)\b": ("socialist", "socialists"),
        flexed: ("socialists",),
        r"(?:neo|eco|ultra|anti)-?(?:zionists?)": ("antizionist", "zionist", "zionists"),
        r"\bdemon?rats?\b": ("demonrat", "demonrats"),
        r"(?:christo|islamo)-?fascists?": ("christo", "christofascist", "fascist", "islamofascists"),
        r"bible[- ]thumpers?": ("bible", "bible-thumper", "bible-thumpers"),
        r"(?:[Aa][Mm][Ee][Rr][Ii][Cc][Aa])[- ][Hh][Aa][Tt][Ee][Rr][Ss]": ("america", "america-haters"),
        r"(?:healthcare|social\s+security|justice)": ("social security",),
        r"(?:Univ|Amer|Wm)\.(?=\s)": ("amer",),
        r"(?:St|Am|Mt)\.\s": ("am.",),
        r"(?<![Aa][Nn][Tt][Ii]-)(?<!\bmedicare\s)cuts?": ("medicare",),
        r"\b(?:church(?:es)?|mosques?|synagogues?|unions)\b": ("church", "churches", "mosque", "synagogues"),
        r"(?:pastors|priests|imams|rabbis|clergy)": ("pastors", "priests", "imams", "rabbis"),
        r"(?:insiders?|parishioners?)\s+say": ("parishioner", "parishioners"),
        r"\b(?:trump|reagan)(?:ists?|ites?)\b": ("trumpist", "trumpists", "reaganite"),
    }
    for pattern, expected in found.items():
        hits = group_words_in(pattern)
        for word in expected:
            assert word in hits, (pattern, word, hits)
    # common dismissal words, role words, word shapes and whole-word checks
    for clean in (
        r"\b(?:cranks?|shills?|radicals?|fanatics?|heretics?|skeptics?|activists?|zealots?)\b",
        r"\b[\w'’-]+isms?\b",
        r"(?<=[\w'’][- ])(?:thumpers?|bashers?|haters?)",
        r"\b(?:history|territory|victory|nationwide|republic|democracy|unions?|liberty|progress)\b",
        r"\b(?:I|we)\s+am\s+(?:sure|certain)\b",
        r"(?:Rep|Sen|Gov|Natl|Evang|Wm)\.",
        # faith-neutral words, and stance words mirrored for both sides
        r"\b(?:clergy|congregations?|worshipp?ers|(?:houses?|places?)\s+of\s+worship|faith|religions?)\b",
        r"\b(?:(?:non-?|un)?believers?|skeptics?|heretics?|elders|ministers)\b",
    ):
        assert group_words_in(clean) == (), (clean, group_words_in(clean))


def test_group_word_lint_catches_a_group_word_added_to_the_pack(pack):
    """Mutation check: one group word added to one rule fails the lint."""
    import copy

    for word in ("socialists?", "demonrats?", "[Mm][Aa][Gg][Aa][Tt][Ss]?", r"bible[- ]thumpers?"):
        mutated = copy.deepcopy(pack)
        rule = next(r for r in mutated["rules"] if r["id"] == "DISSENT_DISMISSAL")
        rule["indicators"][0] = rule["indicators"][0].replace("(?:", f"(?:{word}|", 1)
        assert "DISSENT_DISMISSAL[0]" in group_word_problems(mutated), word
    mutated = copy.deepcopy(pack)
    rule = next(r for r in mutated["rules"] if r["id"] == "CAUSAL_TOTALIZATION")
    rule["description"] += " For example, 'they are destroying medicare'."
    assert group_word_problems(mutated) == {"CAUSAL_TOTALIZATION.description": ["medicare"]}
    # a faith-specific noun among CAUSAL_TOTALIZATION's objects
    mutated = copy.deepcopy(pack)
    rule = next(r for r in mutated["rules"] if r["id"] == "CAUSAL_TOTALIZATION")
    assert rule["indicators"][0].count("|clergy|") == 2
    rule["indicators"][0] = rule["indicators"][0].replace("|clergy|", "|clergy|church(?:es)?|")
    assert group_word_problems(mutated) == {"CAUSAL_TOTALIZATION[0]": ["church", "churches"]}


def test_group_word_lint_sees_through_disguises(pack):
    """Mutation check: a group word written to slip past a plain reading still fails the lint.

    The red team's first fix round inserted each of these into
    DISSENT_DISMISSAL[0]; the lint read none of them before rules 2.0.0a4.
    """
    import copy

    disguised = (
        # a hyphen inside a blend
        "neo-cons", "demon-rats", "alt-right(?:ers)?", "re-pugs",
        # a class with a digit, a wide class, a wildcard
        "soc[i1]alists", "m[aeiou]slims", r"soc.alists", r"zion\wsts",
        # prefixes beyond anti, neo, ultra and pro
        "cryptofascists", "postmarxists", "pseudochristians", "farleftists",
        # forms the families were missing
        "demorats", "pinkos", "paleocons", "ancaps", "wokesters", "leftoids", "republitards", "christianists",
        "mormonism", "protestantism", "americanism", "lutheranism", "shiism",
        "druze", "alawites", "yazidis", "ahmadis", "bahais", "adventists", "unitarians", "copts", "hasidim",
        "haredim", "confucians", "wicca", "allah", r"jesus\s+freaks", "sharia", "gospel", "crusade", "halal",
        "kosher", "french", "germans", "greeks", "dutch", "turks", "arabs", "persians", "westerners", "yankees",
        "gringos", "krauts", r"U\.S\.", r"U\.?S\.?C\.?", "latinos", "hispanics", "gypsies", "slavs",
        "brexiteers", "remoaners", "BLM", "DEI", "CRT", r"affirmative\s+action", "guardian", "vatican", "WEF",
        "western", "eastern",
    )
    # each one among the dismissal words of a small rule, which reads fast
    for word in disguised:
        assert group_words_in(rf"\b(?:cranks?|{word}|shills?)\b(?!-\w)"), word
    # and a few inside the real rule
    for word in ("neo-cons", "soc[i1]alists", r"zion\wsts", "cryptofascists", r"U\.?S\.?C\.?"):
        mutated = copy.deepcopy(pack)
        rule = next(r for r in mutated["rules"] if r["id"] == "DISSENT_DISMISSAL")
        rule["indicators"][0] = rule["indicators"][0].replace("(?:", f"(?:{word}|", 1)
        assert "DISSENT_DISMISSAL[0]" in group_word_problems(mutated), word
    # open slots still take any word: a repeated class or wildcard is not a disguise
    for clean in (r"\b[\w'’-]+isms?\b", r"(?:\w+\s+){0,3}ists", r"[A-Z][\w'’&.-]{0,40}[- ]winners?", r"\b\w{3}\b"):
        assert group_words_in(clean) == (), (clean, group_words_in(clean))


def test_the_list_exemption_is_exact(pack):
    """"Dem." and "Rep." pass inside the abbreviation list, and nowhere else."""
    import copy

    def with_rule(rule_id: str, i: int, change) -> dict:
        mutated = copy.deepcopy(pack)
        rule = next(r for r in mutated["rules"] if r["id"] == rule_id)
        rule["indicators"][i] = change(rule["indicators"][i])
        return group_word_problems(mutated)

    assert group_word_problems(pack) == {}
    # outside the list, with or without the period, in any case
    for word in (r"Dem\.", "Dems?", "[Dd][Ee][Mm]", "[Dd][Ee][Mm][Ss]?"):
        found = with_rule("DISSENT_DISMISSAL", 0, lambda p: p.replace("(?:", f"(?:{word}|", 1))
        assert "dem" in found.get("DISSENT_DISMISSAL[0]", []), word
    # inside the list, a country's abbreviation or another form of a party's
    for word in ("Amer", "Am", "Dems", "Gop"):
        found = with_rule("MEDIA_EMOTIONAL_LEAD", 0, lambda p: p.replace("|Del|Dem|Det|", f"|Del|Dem|{word}|Det|"))
        assert found.get("MEDIA_EMOTIONAL_LEAD[0]"), word
    # the list followed by anything but a period is not the list
    found = with_rule("MEDIA_EMOTIONAL_LEAD", 0, lambda p: p.replace(r"|Wm)\.", "|Wm),", 1))
    assert "dem" in found.get("MEDIA_EMOTIONAL_LEAD[0]", [])
    # a short alternation is not the list
    found = with_rule("DISSENT_DISMISSAL", 0, lambda p: p.replace("(?:", r"(?:(?:Dem|Rep)\.\s+|", 1))
    assert "dem" in found.get("DISSENT_DISMISSAL[0]", [])


# Country and nationality abbreviations, none of which may be on the list.
# ("Fr." and "Ind." are on it as a title, Father, and a state, Indiana; the
# same spellings for French and Indian are a known limit in
# tests/test_symmetry.py.)
NATIONALITY_ABBREVIATIONS = frozenset({
    "Am", "Amer", "Brit", "Can", "Canad", "Austl", "Aust", "Ger", "Mex", "Chin", "Jap", "Jpn", "Russ", "Isr",
    "Ital", "Span", "Eng", "Scot", "Ir", "Irl", "Afr", "Eur", "Ukr", "Pak", "Braz", "Nig", "Kor", "Viet",
})
# Titles of every major faith that the list must hold if it holds any. A
# rabbi's "R." and a Sardar's "S." are read as one-letter initials.
FAITH_TITLES = {
    "Christian": {"Rev", "Fr", "Sr", "Br", "Bro", "Sis", "Bp", "Msgr", "Pst", "Eld"},
    "Muslim": {"Sh", "Shk", "Ust"},
    "Jewish": {"Rab"},
    "Hindu": {"Shri", "Sri", "Smt"},
    "Buddhist": {"Ven"},
}


def test_the_abbreviation_list_treats_faiths_and_parties_alike(pack):
    patterns = [p for r in pack["rules"] for p in r["indicators"]] + pack["citation_suppression"]["patterns"]
    copies = [entries for p in patterns for _, _, entries in abbreviation_lists(p)]
    full = [set(c) for c in copies if any(e.startswith(_INITIALS) for e in c)]
    assert len(full) >= 20, len(full)
    # one list: every full copy is the same, and every copy split by length
    # holds exactly the full list's words of that length
    words = {e for e in full[0] if not e.startswith(_INITIALS)}
    assert all(c == full[0] for c in full)
    for c in copies:
        if not any(e.startswith(_INITIALS) for e in c):
            assert set(c) == {w for w in words if len(w) == len(c[0])}, sorted(c)
    # the two parties alike, and no country or nationality
    assert LIST_EXEMPT <= words
    assert not words & NATIONALITY_ABBREVIATIONS, sorted(words & NATIONALITY_ABBREVIATIONS)
    # every major faith's titles, and the one-letter initials
    for faith, titles in FAITH_TITLES.items():
        assert titles <= words, (faith, sorted(titles - words))


def test_living_eponyms_appear_only_in_this_denylist():
    """Forms built from a living person's name appear in this file and nowhere else in the repository."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    words = _group_words(LIVING_EPONYM_FAMILIES)
    pattern = re.compile(r"(?<![a-z])(?:" + "|".join(sorted(map(re.escape, words), key=len, reverse=True)) + r")(?![a-z])")
    skip_dirs = {".git", "node_modules", "_site", "dist", "__pycache__", ".venv", "venv", ".pytest_cache"}
    found = []
    for path in root.rglob("*"):
        if not path.is_file() or skip_dirs & set(path.relative_to(root).parts) or path == Path(__file__).resolve():
            continue
        if path.suffix.lower() in {".png", ".woff2", ".ico", ".db", ".gz", ".zip", ".pdf"}:
            continue
        try:
            text = path.read_text(encoding="utf-8").lower()
        except (UnicodeDecodeError, OSError):
            continue
        found += [f"{path.relative_to(root)}: {m.group(0)}" for m in pattern.finditer(text)]
    assert not found, found


def test_group_words_hold_every_form():
    for word in (
        "socialists", "anti-socialists", "antisocialists", "neo-nazis", "ultranationalists", "pro-zionists",
        "zionism", "magats", "demonrats", "democraps", "dummycrats", "rethuglicans", "repugnicans", "libtards",
        "commies", "christofascists", "islamofascists", "bible-thumpers", "mohammedans",
        "america-haters", "medicare", "medicaid", "social security", "capitalism", "atheists", "theists",
        "evangelicals", "abolitionists", "amer", "am.", "dem", "trumpists", "reaganomics", "churches",
        "mosques", "synagogues", "gurdwaras", "rabbis", "imams", "pastors", "parishioners",
        # rules 2.0.0a4
        "neocons", "cryptofascists", "postmarxists", "pseudochristians", "farleftists", "paleocons", "westerners",
        "western", "u.s.", "u.s.c.", "usc", "americanism", "druze", "latinos", "brexiteers", "vatican",
    ):
        hyphenated = word.split("-", 1)
        assert word in GROUP_WORDS or (
            len(hyphenated) == 2 and hyphenated[0] in GROUP_WORD_PREFIXES and hyphenated[1] in GROUP_WORDS
        ), word
