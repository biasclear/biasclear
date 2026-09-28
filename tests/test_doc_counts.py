"""CHANGELOG.md and rules/RULE_CHANGES.md quote only counts that tests keep true.

Every number in the public docs comes from scripts/site_facts.py, a build
script or a test (the README's are checked in tests/test_readme.py). This file
checks the current counts that the CHANGELOG and RULE_CHANGES quote against
the rule pack, the golden files and the symmetry suite, and pins the window
sizes they quote on the rules themselves. Older counts in their history
sections are dated ("measured 2026-09-28"), and tests/test_readme.py checks
that an undated count of known limits or retired pairs is the current one.
"""

from __future__ import annotations

import json
import re

import pytest

from biasclear import rule_pack, scan
from conftest import ROOT, require_repo_files

CHANGELOG = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
RULE_CHANGES = (ROOT / "rules" / "RULE_CHANGES.md").read_text(encoding="utf-8")
# The rules E3 added (new IDs) or restored; every other rule was carried over from v1.
NEW_OR_RESTORED = {
    "CREDENTIAL_AS_PREMISE",
    "INSTITUTIONAL_POSITION_AS_SETTLED",
    "NEUTRALITY_CLAIM",
    "FIN_CHERRY_PICKED_TIMEFRAME",
}


def _golden(name: str) -> dict:
    return json.loads((ROOT / "tests" / "golden" / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def facts() -> dict:
    import test_symmetry as sym

    pack = rule_pack()
    v1 = _golden("v1_parity")
    v2 = _golden("v2_parity")
    changed = set(v2["changed_rules"])
    assert NEW_OR_RESTORED <= changed
    rules = len(pack["rules"])
    return {
        "pack": pack,
        "rules": rules,
        "kept": rules - len(NEW_OR_RESTORED),
        "v1_rules": rules - len(NEW_OR_RESTORED) + len(v1["excluded_rules"]),
        "changed": changed,
        "v1_texts": len(v1["cases"]),
        "e3_texts": sum(1 for c in v2["cases"] if c["src"].startswith("e3:")),
        "template_pairs": len(sym.PAIRS),
        "red_team_pairs": len(sym.RED_TEAM),
        "entity_pairs": sum(len(p) for p in sym.ENTITY_PAIRS.values()),
        "groups": len(sym.ENTITY_PAIRS),
        "templates": len(sym.TEMPLATES) + len(sym.ORG_TEMPLATES),
        "label_pairs": len(sym.LABEL_PAIRS),
        "known_limits": len(sym.KNOWN_LIMITS),
        "topics": len(sym.ENTITY_PAIRS["pro and anti positions on contested topics"]),
    }


def _passing(f: dict) -> str:
    return (
        f"{f['template_pairs'] + f['red_team_pairs']:,} swapped pairs raise the same rules on both sides "
        f"({f['template_pairs']:,} template pairs and {f['red_team_pairs']:,} red-team pairs), "
        f"{f['known_limits']} known limits are listed with their reasons"
    )


@pytest.mark.parametrize("doc", ["CHANGELOG.md", "rules/RULE_CHANGES.md"])
def test_both_docs_count_the_pairs_that_pass(doc, facts):
    text = CHANGELOG if doc == "CHANGELOG.md" else RULE_CHANGES
    assert _passing(facts) in text, f"{doc} should say: {_passing(facts)}"


def _renamed_rows() -> list[tuple[str, str, str]]:
    m = re.search(r"^\| Rule \| Old name \| New name \|\n\|---\|---\|---\|\n((?:\|.*\n)+)", RULE_CHANGES, re.MULTILINE)
    assert m, "rules/RULE_CHANGES.md has no table of renamed rules"
    rows = []
    for line in m.group(1).splitlines():
        cells = [c.strip() for c in line.strip("|").split("|")]
        rows.append((cells[0].strip("`"), cells[1], cells[2]))
    return rows


def _redescribed() -> list[str]:
    m = re.search(r"as were those of (\d+) more: (.*?) \(the last two", RULE_CHANGES)
    assert m, "rules/RULE_CHANGES.md should list the other rules whose descriptions were rewritten"
    ids = re.findall(r"`([A-Z_]+)`", m.group(2))
    assert len(ids) == int(m.group(1))
    return ids


def test_changelog_counts(facts):
    f = facts
    renamed, redescribed = _renamed_rows(), _redescribed()
    for phrase in (
        f"`rules/biasclear-rules.json`: {f['rules']} deterministic rules",
        f"Parity: these {len(f['changed'])} rules leave the v1 parity check",
        f"The other {f['rules'] - len(f['changed'])} rules keep exact v1 parity",
        f"the {f['v1_texts']} v1 texts plus {f['e3_texts']} E3 texts",
        f"{f['entity_pairs']} swapped name pairs in {f['groups']} groups",
        f"each run through up to {f['templates']} templates, plus {f['label_pairs']} label mirror pairs",
        f"Of the {f['kept']} rules carried over from v1, {len(renamed)} renamed",
        f"and {len(renamed) + len(redescribed)} with a rewritten description",
        f"parity with v1 on {f['v1_texts']} texts",
        f"pro and anti positions on {f['topics']} contested topics",
    ):
        assert phrase in CHANGELOG, f"CHANGELOG.md should say: {phrase}"


def test_rule_changes_counts(facts):
    import test_regex_subset

    f = facts
    for phrase in (
        f"differs from v1's {f['v1_rules']} deterministic rules",
        f"changes what {len(f['changed']) - len(NEW_OR_RESTORED)} of the {f['kept']} rules it kept can mark",
        f"{len(test_regex_subset.CASE_SENSITIVE_RULES)} rules have the flags `s` instead of `is`",
        f"the {f['e3_texts']} `e3:` texts in `tests/golden/v2_parity.json`",
        f"lists {len(f['changed'])} rules as `changed_rules`",
    ):
        assert phrase in RULE_CHANGES, f"rules/RULE_CHANGES.md should say: {phrase}"
    # "23 through their patterns, and TOTALIZING_HARM_LANGUAGE through the citation fixes alone"
    assert "TOTALIZING_HARM_LANGUAGE" in f["changed"]


def test_renamed_and_redescribed_rules(facts):
    names = {r["id"]: r["name"] for r in facts["pack"]["rules"]}
    renamed, redescribed = _renamed_rows(), _redescribed()
    for rid, _old, new in renamed:
        assert names.get(rid) == new, f"{rid} is named {names.get(rid)!r} in the pack, not {new!r}"
    assert f"The descriptions of these {len(renamed)} rules were also rewritten" in RULE_CHANGES
    ids = [rid for rid, _, _ in renamed] + redescribed
    assert len(set(ids)) == len(ids)
    assert set(ids) <= set(names) - NEW_OR_RESTORED
    assert f"So {len(ids)} of the {facts['kept']} rules carried over from v1 have a new description" in RULE_CHANGES


def test_changed_rules_table_covers_every_changed_rule(facts):
    m = re.search(r"^\| Rule \| Before \| Now \(rules [^)]+\) \|\n\|---\|---\|---\|\n((?:\|.*\n)+)", RULE_CHANGES, re.MULTILINE)
    assert m, "rules/RULE_CHANGES.md has no 'Every rule that changed' table"
    rows = [line.split("|")[1].strip().strip("`") for line in m.group(1).splitlines()]
    assert len(rows) == len(set(rows))
    assert set(rows) == facts["changed"]
    assert f"Now (rules {facts['pack']['rules_version']})" in m.group(0)


def _raises(rule_id: str, text: str) -> bool:
    return rule_id in {m["rule_id"] for m in scan(text, domain="all")["moves"]}


def _name(tokens: int) -> str:
    return " ".join(["Varn"] * tokens)


def test_window_sizes_the_docs_quote():
    """Name slots and gaps hold 16 tokens; "either ... or" holds 32 words."""
    for n, fits in ((16, True), (17, False)):
        assert _raises("MONOCAUSAL_BLAME", f"Because of {_name(n)} everything has fallen apart.") is fits
        assert _raises("CONSENSUS_AS_EVIDENCE", f"All {_name(n)} experts agree the plan works.") is fits
        assert _raises("CREDENTIAL_AS_PREMISE", f"A respected {_name(n)} says the tax works.") is fits
    for n, fits in ((32, True), (33, False)):
        assert _raises("FALSE_BINARY", "Either " + " ".join(["go"] * n) + " or we fail.") is fits
    assert 'Name slots and gaps hold up to 16 name tokens (32 words for "either ... or"' in CHANGELOG
    assert "name slots and gaps hold up to 16 tokens" in CHANGELOG
    assert "- **Slot**: up to 16 name tokens" in RULE_CHANGES
    assert "- **Gap**: up to 16 words" in RULE_CHANGES
    assert '"either ... or" allows up to 32 words of one sentence' in RULE_CHANGES
    assert "name slots and gaps hold up to 16 tokens" in RULE_CHANGES


def test_shorter_bounds_the_docs_quote(facts):
    """Eight modifiers after a lowercase "leading", four words after "every", award names, the citation window."""
    # lowercase modifiers: since rules 2.0.0a4 a capitalized name right after "leading" is the group itself
    for n, fits in ((8, True), (9, False)):
        assert _raises("VAGUE_INSTITUTIONAL_APPEAL", f"Now, leading {_name(n).lower()} economists agree the plan works.") is fits
    for n, fits in ((4, True), (5, False)):
        assert _raises("CONSENSUS_AS_EVIDENCE", f"Every {_name(n)} knows the plan works.") is fits
    for n, fits in ((40, True), (41, False)):
        assert _raises("CREDENTIAL_AS_PREMISE", "A V" + "a" * n + " winner says the plan works.") is fits
    assert "eight modifiers between a lowercase \"leading\", \"top\" or \"key\" and its group noun" in RULE_CHANGES
    assert '8 modifiers after a lowercase "leading", "top" or "key"' in RULE_CHANGES
    assert 'and four words after "every"' in RULE_CHANGES
    for doc in (CHANGELOG, RULE_CHANGES):
        assert "holds a capital letter and up to 40 more characters" in doc
    window = facts["pack"]["citation_suppression"]["window"]
    assert f"within {window} characters of the claim" in CHANGELOG
    assert f"when a citation sits within {window} characters" in RULE_CHANGES


def test_redos_limits_the_changelog_quotes():
    require_repo_files("packages/engine/test/redos.test.ts")
    guard = (ROOT / "packages" / "engine" / "test" / "redos.test.ts").read_text(encoding="utf-8")
    length = int(re.search(r"const LENGTH = ([\d_]+);", guard).group(1).replace("_", ""))
    limit = int(re.search(r"const LIMIT_MS = (\d+);", guard).group(1))
    assert f"{limit} ms on each {length:,}-character string" in CHANGELOG
    assert f"under the {limit} ms limit" in RULE_CHANGES


def _report_rows() -> dict[str, list[str]]:
    """The before-and-after table as scripts/make_v2_golden.py --report prints it, without a v1 checkout."""
    import contextlib
    import importlib.util
    import io

    spec = importlib.util.spec_from_file_location("make_v2_golden", ROOT / "scripts" / "make_v2_golden.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        module.report(module.build(), None)
    return {
        cells[0].strip("`"): cells[1:]
        for line in out.getvalue().splitlines()
        if line.startswith("| `")
        for cells in [[c.strip() for c in line.strip("|").split("|")]]
    }


@pytest.mark.parametrize("doc", ["CHANGELOG.md", "rules/RULE_CHANGES.md"])
def test_before_and_after_tables_match_the_report(doc):
    """Every cell the report computes without the v1 checkout is the table's (the three rules left out of 2.0.0a1
    need --v1 for their v1 side, so only their v2 count is checked)."""
    text = CHANGELOG if doc == "CHANGELOG.md" else RULE_CHANGES
    m = re.search(r"^\| Rule \| v1 texts \| v2 texts \| Gained \| Lost \| Same text, other spans \|\n\|[-|]+\|\n((?:\|.*\n)+)", text, re.MULTILINE)
    assert m, f"{doc} has no before-and-after table"
    table = {
        cells[0].strip("`"): cells[1:]
        for line in m.group(1).splitlines()
        for cells in [[c.strip() for c in line.strip("|").split("|")]]
    }
    report = _report_rows()
    assert set(table) == set(report), sorted(set(table) ^ set(report))
    for rid, cells in report.items():
        if cells[0] == "-":
            assert table[rid][1] == cells[1], (doc, rid, table[rid], cells)
        else:
            assert table[rid] == cells, (doc, rid, table[rid], cells)


def test_method_page_numbers_are_the_rules_and_the_ci():
    """The Method page's window sizes, its "two or more" matches and the Python versions CI runs."""
    require_repo_files("site/pages/method.html", ".github/workflows/ci.yml")
    method = (ROOT / "site" / "pages" / "method.html").read_text(encoding="utf-8")
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    # the 16 and the 32 are checked on the rules in test_window_sizes_the_docs_quote
    assert "holds at most 16 words (32 for &ldquo;either &hellip; or&rdquo;" in method
    versions = re.search(r"for v in ((?:3\.\d+ ?)+); do\n\s+echo \"::group::Python \$v\"", ci).group(1).split()
    assert f"It runs on Python {versions[0]} to {versions[-1]} on every change." in method
    minimum = {r["min_matches"] for r in rule_pack()["rules"] if r["min_matches"] > 1}
    assert minimum == {2} and "rules need two or more matches before they mark anything" in method
