"""Count the test facts the website quotes, from the tests themselves.

scripts/build-site.mjs runs this at build time and puts the numbers on the
Method page, so they cannot drift from the tests. It prints one JSON object:

- ``golden``: cases in each file in tests/golden/, and how many of the v2
  cases were written for the E3 rules (``src`` starting "e3:");
- ``symmetry``: from tests/test_symmetry.py, the template pairs that must
  raise the same rules on both sides (``PAIRS``), how many names and labels
  they swap, the red team's pairs (``RED_TEAM``), the known limits
  (``KNOWN_LIMITS``), which run as strict expected failures, and the retired
  pairs (``RETIRED_PAIRS``): pairs that change the kind of word rather than
  the side, kept with a reason and neither run nor counted as limits.

README.md, CHANGELOG.md and rules/RULE_CHANGES.md quote the symmetry counts
too; tests/test_readme.py checks that they match this script.

It imports tests/test_symmetry.py, which needs pytest (``pip install
'.[test]'``), the same as packages/engine/scripts/parity_dump.py.

Usage: python scripts/site_facts.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "src"))

import test_symmetry as sym  # noqa: E402


def main() -> None:
    golden = {}
    for path in sorted((ROOT / "tests" / "golden").glob("*.json")):
        cases = json.loads(path.read_text(encoding="utf-8"))["cases"]
        golden[path.stem] = {
            "cases": len(cases),
            "e3": sum(1 for c in cases if str(c.get("src", "")).startswith("e3:")),
        }
    swapped = sum(len(pairs) for pairs in sym.ENTITY_PAIRS.values()) + len(sym.LABEL_PAIRS)
    facts = {
        "golden": golden,
        "symmetry": {
            "template_pairs": len(sym.PAIRS),
            "swapped_names_and_labels": swapped,
            "groups": len(sym.ENTITY_PAIRS),
            "red_team_pairs": len(sym.RED_TEAM),
            "known_limits": len(sym.KNOWN_LIMITS),
            "retired_pairs": len(sym.RETIRED_PAIRS),
        },
    }
    json.dump(facts, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
