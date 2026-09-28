"""Parity with the retired v1 engine, and the v2 golden file.

tests/golden/v1_parity.json records what v1 did on every scannable text in
its tests and calibration corpus (see scripts/make_golden.py). Rules version
2.0.0a2 (ticket E3) changed some rules on purpose; tests/golden/v2_parity.json
lists them as ``changed_rules`` and pins what they do now (see
scripts/make_v2_golden.py and rules/RULE_CHANGES.md). Every other rule must
still raise the same rules as v1 on the same texts, at the same spans.
"""

from __future__ import annotations

import pytest

from biasclear import scan
from conftest import ROOT

# The rules 2.0.0a1 left out, as recorded in v1_parity.json.
V1_EXCLUDED = {"CREDENTIAL_AS_PROOF", "INSTITUTIONAL_NEUTRALITY", "FIN_CHERRY_PICKED_TIMEFRAME"}


def _drop_overlaps(spans):
    kept, last_end = [], -1
    for s, e in sorted(spans, key=lambda x: (x[0], x[0] - x[1])):
        if s >= last_end:
            kept.append([s, e])
            last_end = e
    return kept


@pytest.fixture(scope="module")
def changed(v2_golden) -> set[str]:
    return set(v2_golden["changed_rules"])


def test_golden_covers_every_rule(pack, golden, v2_golden, changed):
    ids = {r["id"] for r in pack["rules"]}
    v1_exercised = {m[0] for case in golden["cases"] for m in case["moves"]}
    assert v1_exercised - changed == ids - changed
    v2_exercised = {m[0] for case in v2_golden["cases"] for m in case["moves"]}
    assert v2_exercised == ids


def test_golden_is_large_enough(golden):
    assert len(golden["cases"]) >= 500
    assert sum(1 for c in golden["cases"] if c["moves"]) >= 150


def test_v1_excluded_rules(pack, golden, changed):
    """2.0.0a1 left three rules out. E3 replaced two with new IDs and restored one."""
    ids = {r["id"] for r in pack["rules"]}
    assert set(golden["excluded_rules"]) == V1_EXCLUDED
    assert not ids & {"CREDENTIAL_AS_PROOF", "INSTITUTIONAL_NEUTRALITY"}
    assert "FIN_CHERRY_PICKED_TIMEFRAME" in ids & changed
    assert {"CREDENTIAL_AS_PREMISE", "INSTITUTIONAL_POSITION_AS_SETTLED", "NEUTRALITY_CLAIM"} <= ids & changed


def test_changed_rules_are_documented(pack, v2_golden, changed):
    assert changed <= {r["id"] for r in pack["rules"]}
    assert v2_golden["rules_version"] == pack["rules_version"]
    notes = (ROOT / "rules" / "RULE_CHANGES.md").read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    for rid in changed:
        assert f"`{rid}`" in notes, rid
        assert f"`{rid}`" in changelog, rid


def test_golden_moves_follow_from_v1_spans(pack, golden):
    """The expected moves are v1's spans with the overlap policy applied."""
    order = {r["id"]: i for i, r in enumerate(pack["rules"])}
    for case in golden["cases"]:
        assert list(case["v1_spans"]) == case["v1_rule_ids"]
        expected = [
            [rid, s, e]
            for rid in case["v1_rule_ids"]
            for s, e in _drop_overlaps(case["v1_spans"][rid])
        ]
        expected.sort(key=lambda m: (m[1], m[1] - m[2], order[m[0]]))
        assert case["moves"] == expected, case["src"]


def test_parity_unchanged_rules(golden, changed):
    """Every rule E3 did not change keeps exact v1 parity."""
    failures = []
    for case in golden["cases"]:
        result = scan(case["text"], domain="all")
        got = [[m["rule_id"], m["start"], m["end"]] for m in result["moves"] if m["rule_id"] not in changed]
        want = [m for m in case["moves"] if m[0] not in changed]
        if got != want:
            failures.append((case["src"], got, want))
        ids = {m["rule_id"] for m in result["moves"]} - changed
        if ids != set(case["v1_rule_ids"]) - changed:
            failures.append((case["src"], sorted(ids), case["v1_rule_ids"]))
        for m in result["moves"]:
            assert m["match"] == case["text"][m["start"]:m["end"]]
    assert not failures, failures[:5]


def test_v2_golden_agrees_with_v1_on_unchanged_rules(golden, v2_golden, changed):
    assert [c["text"] for c in v2_golden["cases"][: len(golden["cases"])]] == [c["text"] for c in golden["cases"]]
    for v1_case, v2_case in zip(golden["cases"], v2_golden["cases"]):
        assert [m for m in v2_case["moves"] if m[0] not in changed] == [
            m for m in v1_case["moves"] if m[0] not in changed
        ], v1_case["src"]


def test_v2_golden_all_rules(v2_golden):
    failures = []
    for case in v2_golden["cases"]:
        result = scan(case["text"], domain="all")
        got = [[m["rule_id"], m["start"], m["end"]] for m in result["moves"]]
        if got != case["moves"]:
            failures.append((case["src"], got, case["moves"]))
    assert not failures, failures[:5]


@pytest.mark.parametrize("domain", [None, "general", "legal", "media", "financial"])
def test_parity_per_domain(pack, golden, v2_golden, changed, domain):
    rule_domain = {r["id"]: r["domain"] for r in pack["rules"]}
    wanted = {"general", domain or "general"}
    for case in golden["cases"]:
        result = scan(case["text"], domain=domain)
        got = [[m["rule_id"], m["start"], m["end"]] for m in result["moves"] if m["rule_id"] not in changed]
        expected = [m for m in case["moves"] if rule_domain[m[0]] in wanted and m[0] not in changed]
        assert got == expected, case["src"]
    for case in v2_golden["cases"]:
        result = scan(case["text"], domain=domain)
        got = [[m["rule_id"], m["start"], m["end"]] for m in result["moves"]]
        assert got == [m for m in case["moves"] if rule_domain[m[0]] in wanted], case["src"]
