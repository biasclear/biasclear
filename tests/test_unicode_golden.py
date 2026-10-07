"""The Python engine's Unicode semantics, pinned.

tests/golden/unicode_parity.json (made by scripts/make_unicode_golden.py)
holds non-ASCII texts where Python's ``re`` and plain JavaScript regexes
disagree. The TypeScript engine must match Python on them
(packages/engine/test/golden.test.ts and packages/engine/scripts/parity.mjs);
this test keeps the Python side from drifting.
"""

from __future__ import annotations

import pytest

from biasclear import scan
from conftest import ROOT, load_json

UNICODE_GOLDEN = load_json(ROOT / "tests" / "golden" / "unicode_parity.json")


def test_file_matches_the_pack(pack):
    assert UNICODE_GOLDEN["rules_version"] == pack["rules_version"]
    assert len(UNICODE_GOLDEN["cases"]) >= 20
    assert sum(c["native_js_differs"] for c in UNICODE_GOLDEN["cases"]) >= 15
    assert sum(any(ord(ch) > 127 for ch in c["text"]) for c in UNICODE_GOLDEN["cases"]) >= 20


@pytest.mark.parametrize("case", UNICODE_GOLDEN["cases"], ids=lambda c: c["src"])
def test_unicode_case(pack, case):
    result = scan(case["text"], domain="all")
    assert [[m["rule_id"], m["start"], m["end"]] for m in result["moves"]] == case["moves"]
    for m in result["moves"]:
        assert m["match"] == case["text"][m["start"]:m["end"]]
    rule_domain = {r["id"]: r["domain"] for r in pack["rules"]}
    for domain in (None, "general", "legal", "media", "financial"):
        wanted = {"general", domain or "general"}
        got = [[m["rule_id"], m["start"], m["end"]] for m in scan(case["text"], domain=domain)["moves"]]
        assert got == [m for m in case["moves"] if rule_domain[m[0]] in wanted]
