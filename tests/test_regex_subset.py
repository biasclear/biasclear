"""Every regex in the pack must be in the common subset of Python ``re`` and
JavaScript ``RegExp``, so the Python engine and the browser engine read the
same rules the same way.

Static checks run everywhere. The cross-engine check runs the pack through
Node (when installed) on every golden text and requires identical spans.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess

import pytest

from biasclear import scan
from conftest import GOLDEN_PATH, PACK_PATH, ROOT

try:
    from re import _parser as sre_parse  # Python 3.11+
except ImportError:  # pragma: no cover - Python 3.10
    import sre_parse  # type: ignore[no-redef]

FLAG_BITS = {"i": re.IGNORECASE, "s": re.DOTALL}
# Escapes both engines read the same way (inside and outside classes).
ALLOWED_ESCAPES = set("bBdDsSwWtnrfv") | set("^$\\.*+?()[]{}|/-")
QUANTIFIER_BRACE = re.compile(r"\{\d+(,\d*)?\}")


def all_regexes(pack):
    for rule in pack["rules"]:
        for i, pattern in enumerate(rule["indicators"]):
            yield f"{rule['id']}[{i}]", pattern, rule["flags"]
    cs = pack["citation_suppression"]
    for i, pattern in enumerate(cs["patterns"]):
        yield f"citation[{i}]", pattern, cs["flags"]


def subset_violations(pattern: str, flags: str) -> list[str]:
    """Walk the pattern once and report constructs outside the subset."""
    problems = []
    i, in_class, n = 0, False, len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\":
            nxt = pattern[i + 1] if i + 1 < n else ""
            if nxt == "u" and re.fullmatch(r"[0-9A-Fa-f]{4}", pattern[i + 2:i + 6]):
                i += 6
                continue
            if nxt == "x" and re.fullmatch(r"[0-9A-Fa-f]{2}", pattern[i + 2:i + 4]):
                i += 4
                continue
            if nxt not in ALLOWED_ESCAPES:
                problems.append(f"escape \\{nxt} at {i}")
            if nxt == "b" and in_class:
                problems.append(f"\\b inside a class at {i}")
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            elif ch == "[":
                problems.append(f"nested '[' in class at {i}")
            elif pattern.startswith(("&&", "--", "~~"), i):
                problems.append(f"set operation in class at {i}")
            i += 1
            continue
        if ch == "[":
            in_class = True
            if pattern.startswith("[:", i) or pattern.startswith("[^:", i):
                problems.append(f"POSIX class at {i}")
            i += 1
            continue
        if ch == "(":
            if not pattern.startswith("(?", i):
                problems.append(f"capturing group at {i}")
            elif not pattern.startswith(("(?:", "(?=", "(?!", "(?<=", "(?<!"), i):
                problems.append(f"group syntax {pattern[i:i + 4]!r} at {i}")
        elif ch == "{":
            m = QUANTIFIER_BRACE.match(pattern, i)
            if not m:
                problems.append(f"literal '{{' at {i}")
            else:
                i = m.end()
                if i < n and pattern[i] == "+":
                    problems.append(f"possessive quantifier at {i}")
                continue
        elif ch == "}":
            problems.append(f"literal '}}' at {i}")
        elif ch in "*+?" and i + 1 < n and pattern[i + 1] == "+":
            problems.append(f"possessive quantifier at {i}")
        elif ch == "$":
            problems.append(f"'$' at {i} (Python also matches before a final newline)")
        elif ch == "." and "s" not in flags:
            problems.append(f"'.' at {i} without the s flag (engines differ on line breaks)")
        i += 1
    if in_class:
        problems.append("unterminated class")
    return problems


def compile_py(pattern: str, flags: str) -> re.Pattern:
    bits = 0
    for letter in flags:
        bits |= FLAG_BITS[letter]
    return re.compile(pattern, bits)


def test_static_subset(pack):
    problems = {
        where: found
        for where, pattern, flags in all_regexes(pack)
        if (found := subset_violations(pattern, flags))
    }
    assert not problems, problems


def test_checker_catches_constructs_outside_the_subset():
    bad = {
        r"(?i)studies show": "group syntax",
        r"studies (show)": "capturing group",
        r"(?P<x>a)": "group syntax",
        r"a++": "possessive",
        r"a{2}+": "possessive",
        r"(?>ab)": "group syntax",
        r"\Aab": "escape",
        r"ab\Z": "escape",
        r"(a)\1": "capturing group",
        r"a$": "'$'",
        r"a{": "literal",
        r"[[:alpha:]]": "class",
        r"\p{L}": "escape",
    }
    for pattern, expected in bad.items():
        found = " ".join(subset_violations(pattern, "is"))
        assert expected in found, (pattern, found)
    assert "without the s flag" in " ".join(subset_violations("a.b", "i"))
    assert subset_violations(r"(?<=.{200})\bx(?:y|z)?[\w\s.']{1,3}“", "is") == []


def test_python_compiles_every_regex_with_no_groups(pack):
    for where, pattern, flags in all_regexes(pack):
        compiled = compile_py(pattern, flags)  # also rejects variable-width lookbehind
        assert compiled.groups == 0, where


def test_no_indicator_can_match_the_empty_string(pack):
    """So the engine's zero-length guard never changes v1's counts."""
    for rule in pack["rules"]:
        for i, pattern in enumerate(rule["indicators"]):
            bits = compile_py(pattern, rule["flags"]).flags
            low, _ = sre_parse.parse(pattern, bits).getwidth()
            assert low > 0, f"{rule['id']}[{i}] can match zero characters"


# Rules that read capital letters (E3). Some tell a name from a common word
# by its capitals ("Talking Points Ledger", "Invasion Day"); the rest share the
# name token, which lets a name hold an abbreviation period only where it
# cannot end a sentence ("Sen. Harlan", "St. Louis", "gov. nesbit"), so a slot
# does not run past the end of a sentence. They spell every other letter as
# [Xx], so they match like the i flag elsewhere.
CASE_SENSITIVE_RULES = {
    "CONSENSUS_AS_EVIDENCE",
    "CLAIM_WITHOUT_CITATION",
    "SHAME_LEVER",
    "INEVITABILITY_FRAME",
    "INSTITUTIONAL_POSITION_AS_SETTLED",
    "CREDENTIAL_AS_PREMISE",
    "MONOCAUSAL_BLAME",
    "SOFT_CONSENSUS",
    "COMPETENCE_DISMISSAL",
    "VAGUE_INSTITUTIONAL_APPEAL",
    "MEDIA_EDITORIAL_AS_NEWS",
    "MEDIA_EMOTIONAL_LEAD",
    "MEDIA_WEASEL_QUANTIFIERS",
    "FALSE_BINARY",
    "FIN_SURVIVORSHIP_BIAS",
    "DISSENT_DISMISSAL",
    "FEAR_URGENCY",
    "MORAL_HIGH_GROUND",
    "CAUSAL_TOTALIZATION",
}


def test_flags_are_explicit(pack):
    for rule in pack["rules"]:
        expected = "s" if rule["id"] in CASE_SENSITIVE_RULES else "is"
        assert rule["flags"] == expected, rule["id"]
    assert pack["citation_suppression"]["flags"] == "i"


def _py_spans(pack, text):
    rules = {}
    for rule in pack["rules"]:
        found = []
        for pattern in rule["indicators"]:
            found += [[m.start(), m.end()] for m in compile_py(pattern, rule["flags"]).finditer(text)]
        rules[rule["id"]] = found
    cs = pack["citation_suppression"]
    citations = [
        [[m.start(), m.end()] for m in compile_py(p, cs["flags"]).finditer(text)]
        for p in cs["patterns"]
    ]
    return rules, citations


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_javascript_reads_every_regex_the_same_way(pack, golden):
    proc = subprocess.run(
        [shutil.which("node"), str(ROOT / "tests" / "portability.mjs"), str(PACK_PATH), str(GOLDEN_PATH)],
        capture_output=True, text=True, encoding="utf-8", check=True, timeout=300,
    )
    js = json.loads(proc.stdout)
    assert js["compile_errors"] == []
    assert js["rules_hash"] == scan("")["rules_hash"]
    mismatches = []
    for case, js_case in zip(golden["cases"], js["cases"]):
        rules, citations = _py_spans(pack, case["text"])
        if rules != js_case["rules"] or citations != js_case["citations"]:
            mismatches.append(case["src"])
    assert len(js["cases"]) == len(golden["cases"])
    assert not mismatches, mismatches[:10]
