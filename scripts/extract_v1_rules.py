"""Extract the v1 frozen-core rules into the v2 rule pack.

One-time provenance script. It reads ``biasclear/frozen_core.py`` from a v1
checkout (the ``v1-final`` tag), never imports the rest of the v1 package, and
writes ``rules/biasclear-rules.json``. The pack is the source of truth from
now on; this script only records how it was first produced.

Usage:
    python -B scripts/extract_v1_rules.py --v1 /path/to/v1-checkout

Rules that contain an alternation of two or more proper nouns are left out
(see ``EXCLUDED`` below and ``rules/RULE_CHANGES.md``). This produced rules
version 2.0.0a1; later versions edit the pack directly (ticket E3 onward).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

RULES_VERSION = "2.0.0a1"
SCHEMA_VERSION = "1"

# Rules left out of the pack, with the reason. Mirrored in rules/RULE_CHANGES.md.
EXCLUDED = {
    "CREDENTIAL_AS_PROOF": (
        "Alternations of named schools (harvard|stanford|mit|oxford|cambridge) "
        "and named prizes (nobel|pulitzer)."
    ),
    "INSTITUTIONAL_NEUTRALITY": (
        "Alternation of named agencies and associations "
        "(CDC|WHO|FDA|NIH|AMA|ABA|SEC|EPA|DOJ|FBI)."
    ),
    "FIN_CHERRY_PICKED_TIMEFRAME": (
        "Alternation of the twelve month names, which are proper nouns. "
        "No neutrality risk, but the rule is literal."
    ),
}

# v1 compiled every structural indicator with re.IGNORECASE | re.DOTALL.
RULE_FLAGS = "is"
# v1 compiled the citation regex with re.IGNORECASE only.
CITATION_FLAGS = "i"

DOMAIN_LISTS = (
    ("general", "STRUCTURAL_PATTERNS"),
    ("legal", "LEGAL_STRUCTURAL_PATTERNS"),
    ("media", "MEDIA_STRUCTURAL_PATTERNS"),
    ("financial", "FINANCIAL_STRUCTURAL_PATTERNS"),
)


def load_v1_frozen_core(v1_root: Path):
    """Load v1 frozen_core.py by file path (stdlib imports only)."""
    path = v1_root / "biasclear" / "frozen_core.py"
    spec = importlib.util.spec_from_file_location("v1_frozen_core", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["v1_frozen_core"] = module
    spec.loader.exec_module(module)
    return module


def split_top_level_alternation(pattern: str) -> list[str]:
    """Split ``(?:a|b|c)`` into ``[a, b, c]`` at the outermost level."""
    if not (pattern.startswith("(?:") and pattern.endswith(")")):
        raise ValueError("expected a pattern wrapped in one non-capturing group")
    body = pattern[3:-1]
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
            if depth < 0:
                raise ValueError("outer group closes early")
        elif ch == "|" and depth == 0:
            parts.append(body[start:i])
            start = i + 1
    parts.append(body[start:])
    if depth != 0:
        raise ValueError("unbalanced groups")
    return parts


def build_pack(fc) -> tuple[dict, list[str]]:
    seen_ids: set[str] = set()
    rules = []
    for domain, attr in DOMAIN_LISTS:
        for p in getattr(fc, attr):
            if p.id in seen_ids:
                raise ValueError(f"duplicate rule id {p.id}")
            seen_ids.add(p.id)
            if p.id in EXCLUDED:
                continue
            for regex in p.indicators:
                compiled = re.compile(regex, re.IGNORECASE | re.DOTALL)
                if compiled.groups:
                    raise ValueError(f"{p.id}: capturing group changes findall()")
            rules.append({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "pit_tier": p.pit_tier,
                "domain": domain,
                "severity": p.severity,
                "principle": p.principle,
                "indicators": list(p.indicators),
                "min_matches": p.min_matches,
                "suppress_if_cited": bool(p.suppress_if_cited),
                "flags": RULE_FLAGS,
            })
    missing = set(EXCLUDED) - seen_ids
    if missing:
        raise ValueError(f"excluded ids not found in v1: {sorted(missing)}")

    citation = fc.FrozenCore._CITATION_PATTERNS
    if citation.flags & re.DOTALL or not citation.flags & re.IGNORECASE:
        raise ValueError("unexpected citation regex flags")
    window = fc.FrozenCore._has_nearby_citation.__defaults__[0]

    tiers = {
        str(n): {"name": t["name"], "alias": t["alias"], "description": t["description"]}
        for n, t in fc.PIT_TIERS.items()
    }
    pack = {
        "schema_version": SCHEMA_VERSION,
        "rules_version": RULES_VERSION,
        "tiers": tiers,
        "citation_suppression": {
            "window": window,
            "flags": CITATION_FLAGS,
            "patterns": split_top_level_alternation(citation.pattern),
        },
        "rules": rules,
    }
    return pack, sorted(seen_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--v1", required=True, type=Path, help="path to a v1 checkout")
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parent.parent / "rules" / "biasclear-rules.json")
    args = parser.parse_args()
    fc = load_v1_frozen_core(args.v1)
    pack, all_ids = build_pack(fc)
    args.out.write_text(json.dumps(pack, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"v1 rules: {len(all_ids)}; in pack: {len(pack['rules'])}; excluded: {sorted(EXCLUDED)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
