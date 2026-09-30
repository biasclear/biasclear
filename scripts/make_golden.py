"""Build the v1 parity golden file (tests/golden/v1_parity.json).

Runs the retired v1 engine from a v1 checkout (the ``v1-final`` tag) over
every scannable text in its ``tests/`` and ``calibration/corpus/`` folders,
plus a few edge cases written for this repo, and records what v1 did. Only
the resulting JSON is committed; no v1 code is copied.

v1 reported only a rule's first matched fragment, so spans are recovered by
running v1's own regexes with ``re.finditer`` and v1's flags. The script
checks that this reproduces v1's decisions (``FrozenCore.evaluate``) and v1's
first fragment exactly, for every text and every domain, and stops if not.

Usage (from the root of this repo; nothing is written to the v1 checkout):
    PYTHONDONTWRITEBYTECODE=1 python -B scripts/make_golden.py --v1 /path/to/v1 \
        --rename /path/to/name-map.json

Names: v1's texts name real people, parties, organizations and outlets. The
committed file holds them renamed: ``--rename`` replaces each real name with a
made-up name of the same shape (same token count, capitals, particles,
initials and punctuation, and any rule word the name holds) before v1 reads
the text, so v1's decisions and spans are those of the renamed text. The map
lists the real names, so it is kept outside the repository; it is JSON,
``{"names": [{"real": ..., "fake": ...}, ...], "keep": [...]}``, matched as
whole words, longest first, with each ``keep`` phrase left as it is. Without
``--rename`` the script writes v1's texts as v1 has them.

So the committed file can be rebuilt byte for byte only with that private
map. That is accepted: the file records what v1 did, the renamed texts are
all in it, and ``tests/test_parity.py`` checks the current engine against it
without the map. Anyone can run this script with a map of their own; the
texts it writes then differ only in the names.

The committed file was made with rules version 2.0.0a1, the pack as
extract_v1_rules.py writes it from a v1 checkout (the ``v1-final`` tag).
Later rules versions changed some rules on purpose, and no public commit
holds the 2.0.0a1 pack, so to reproduce the file, run extract_v1_rules.py on
a v1 checkout and this script on the pack it writes. The rules changed since
are checked against tests/golden/v2_parity.json instead
(scripts/make_v2_golden.py).

Texts are "scannable" when they are string literals of three or more words,
or corpus samples. Some are left out on purpose; see ``EXCLUDED_SOURCES``.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "rules" / "biasclear-rules.json"
OUT = ROOT / "tests" / "golden" / "v1_parity.json"

# Texts left out of the golden file. Reasons are categories on purpose: this
# file must not repeat the personal data it keeps out.
PERSONAL_NAME = "names a real, identifiable person"
LITIGATION = "dated litigation specifics; could echo a real legal matter"
EXCLUDED_SOURCES = {
    "tests/test_frozen_core.py:415": PERSONAL_NAME,
    "tests/test_frozen_core.py:656": PERSONAL_NAME,
    "tests/test_frozen_core.py:780": PERSONAL_NAME,
    "tests/test_frozen_core.py:789": PERSONAL_NAME,
    "tests/test_calibration.py:464": LITIGATION,
    "calibration/corpus/general_corpus.txt#5": PERSONAL_NAME,
    "calibration/corpus/legal_corpus.txt#0": LITIGATION,
    "calibration/corpus/legal_corpus.txt#1": LITIGATION,
    "calibration/corpus/legal_corpus.txt#2": PERSONAL_NAME,
    "calibration/corpus/legal_corpus.txt#5": PERSONAL_NAME,
    "calibration/corpus/legal_corpus.txt#6": LITIGATION,
    "calibration/corpus/legal_corpus.txt#8": PERSONAL_NAME,
    "calibration/corpus/legal_corpus.txt#40": PERSONAL_NAME,
    "calibration/corpus/media_corpus.txt#0": PERSONAL_NAME,
    "calibration/corpus/media_corpus.txt#13": PERSONAL_NAME,
    "calibration/corpus/media_corpus.txt#16": PERSONAL_NAME,
}

_LEAD = (
    "The committee met on a weekday afternoon to review the quarterly budget, "
    "the maintenance schedule for the east wing, the staffing plan for the "
    "spring term, and a request from the parents' association about parking. "
)
_GAP = " The rest of this paragraph is filler text that only exists to push the next sentence far enough away. " * 2

# Edge cases written for v2 (not from v1). v1 is still what labels them.
EDGE_CASES = [
    "",
    "   \n\t  ",
    "STUDIES SHOW that EVERYONE AGREES.",
    "Their “reform” plan and the “balanced” approach, plus a “smart” policy.",
    "\U0001F642\U0001F642 Everyone agrees this is fine. \U0001F642 Either we act now or we lose.",
    "Studies show that it works, and experts say so too.",
    "Either we act\r\nnow or never.\r\nIt is all their fault.",
    _LEAD + "However, the central claim could not be confirmed by anyone.",
    "Shocking: the quarterly report is finally out.",
    "Studies show nothing yet." + _GAP + "Studies show (Smith, 2024) a small effect.",
    "Studies show (Smith, 2024) a small effect." + _GAP + "Studies show nothing yet.",
    "Sanctions should be considered for this filing.",
    "Critics claimed it was late.",
    "Critics claimed it was late, and they insisted it was rushed.",
    "We strive to ensure quality. We are deeply committed to it.",
    "We strive to ensure quality.",
    "Café owners say the naïve plan works. Experts say so.",
    "Everyone agrees. Everyone agrees. Everyone agrees.",
]

WORDS = re.compile(r"\S+")
SKIP = re.compile(r"@|bc_|https?://")


def load_by_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_renamer(path: Path | None):
    """A function that swaps each real name in a text for its made-up name (see the docstring)."""
    if path is None:
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    table = {e["real"]: e["fake"] for e in data["names"]}
    for phrase in data.get("keep", []):
        table[phrase] = phrase

    def bounded(key: str) -> str:
        left = r"(?<!\w)" if re.match(r"\w", key[0]) else ""
        right = r"(?!\w)" if re.match(r"\w", key[-1]) else ""
        return left + re.escape(key) + right

    rx = re.compile("|".join(bounded(k) for k in sorted(table, key=len, reverse=True)))
    return lambda text: rx.sub(lambda m: table[m.group(0)], text)


def collect_texts(v1: Path, rename=None) -> tuple[list[dict], list[dict]]:
    parser = load_by_path("v1_corpus_parser", v1 / "calibration" / "corpus_parser.py")
    candidates = []
    for f in sorted((v1 / "tests").glob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        nodes = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        for n in sorted(nodes, key=lambda n: (n.lineno, n.col_offset)):
            if len(WORDS.findall(n.value)) >= 3 and not SKIP.search(n.value):
                candidates.append({"src": f"tests/{f.name}:{n.lineno}", "text": n.value})
    for f in sorted((v1 / "calibration" / "corpus").glob("*.txt")):
        for i, sample in enumerate(parser.parse_corpus(f)):
            candidates.append({"src": f"calibration/corpus/{f.name}#{i}", "text": sample.text})
    for i, text in enumerate(EDGE_CASES, 1):
        candidates.append({"src": f"edge:{i:02d}", "text": text})

    if rename is not None:
        for c in candidates:
            c["text"] = rename(c["text"])
    kept, excluded, seen = [], [], set()
    for c in candidates:
        if c["src"] in EXCLUDED_SOURCES:
            excluded.append({"src": c["src"], "reason": EXCLUDED_SOURCES[c["src"]]})
        elif c["text"] not in seen:
            seen.add(c["text"])
            kept.append(c)
    missing = set(EXCLUDED_SOURCES) - {e["src"] for e in excluded}
    if missing:
        raise SystemExit(f"exclusion list names sources that were not found: {sorted(missing)}")
    return kept, excluded


def drop_overlaps(spans):
    kept, last_end = [], -1
    for s, e in sorted(spans, key=lambda x: (x[0], x[0] - x[1])):
        if s >= last_end:
            kept.append([s, e])
            last_end = e
    return kept


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--v1", required=True, type=Path)
    ap.add_argument("--rename", type=Path, help="name map kept outside the repo (see the docstring)")
    args = ap.parse_args()
    v1 = args.v1.resolve()

    fc_path = v1 / "biasclear" / "frozen_core.py"
    fc = load_by_path("v1_frozen_core", fc_path)
    core = fc.frozen_core
    blob = fc_path.read_bytes()
    blob_sha = hashlib.sha1(b"blob %d\0" % len(blob) + blob).hexdigest()

    pack = json.loads(PACK.read_text(encoding="utf-8"))
    if pack["rules_version"] != "2.0.0a1":
        raise SystemExit("run this on the 2.0.0a1 pack (see the docstring); later packs changed rules on purpose")
    pack_ids = [r["id"] for r in pack["rules"]]
    order = {rid: i for i, rid in enumerate(pack_ids)}
    v1_lists = (("general", fc.STRUCTURAL_PATTERNS), ("legal", fc.LEGAL_STRUCTURAL_PATTERNS),
                ("media", fc.MEDIA_STRUCTURAL_PATTERNS), ("financial", fc.FINANCIAL_STRUCTURAL_PATTERNS))
    v1_patterns = [p for _, patterns in v1_lists for p in patterns]
    v1_domain = {p.id: d for d, patterns in v1_lists for p in patterns}
    v1_by_id = {p.id: p for p in v1_patterns}
    excluded_rules = [p.id for p in v1_patterns if p.id not in order]
    for rid in pack_ids:  # the pack must still carry v1's regexes verbatim
        rule = next(r for r in pack["rules"] if r["id"] == rid)
        if rule["indicators"] != list(v1_by_id[rid].indicators):
            raise SystemExit(f"{rid}: pack regexes differ from v1")
    flags = re.IGNORECASE | re.DOTALL

    rename = load_renamer(args.rename)
    texts, excluded = collect_texts(v1, rename)
    cases = []
    for item in texts:
        text = item["text"]
        # v1's decisions, straight from v1's engine.
        v1_flags = [f for f in core.evaluate(text, domain="auto").flags if f.category == "structural"]
        v1_ids = [f.pattern_id for f in v1_flags]
        first_fragment = {f.pattern_id: f.matched_text for f in v1_flags}
        # Recover spans with v1's regexes and v1's flags, then re-derive v1's decisions.
        derived, spans = [], {}
        for p in v1_patterns:
            found = []
            for rx in p.indicators:
                ms = list(re.finditer(rx, text, flags))
                if [m.group(0) for m in ms] != re.findall(rx, text, flags):
                    raise SystemExit(f"{p.id}: finditer and findall disagree")
                if any(m.end() == m.start() for m in ms):
                    raise SystemExit(f"{p.id}: zero-length match in {item['src']}")
                found.extend([m.start(), m.end()] for m in ms)
            if len(found) < p.min_matches:
                continue
            if p.suppress_if_cited and all(core._has_nearby_citation(text, text[s:e]) for s, e in found):
                continue
            derived.append(p.id)
            spans[p.id] = found
            if text[found[0][0]:found[0][1]][:120] != first_fragment[p.id]:
                raise SystemExit(f"{p.id}: first fragment differs from v1 in {item['src']}")
        if derived != v1_ids:
            raise SystemExit(f"re-derived decisions differ from v1 in {item['src']}: {derived} vs {v1_ids}")
        for d in ("general", "legal", "media", "financial"):
            per_domain = [f.pattern_id for f in core.evaluate(text, domain=d).flags
                          if f.category == "structural"]
            if per_domain != [i for i in v1_ids if v1_domain[i] in ("general", d)]:
                raise SystemExit(f"domain {d}: rule decisions are not independent in {item['src']}")

        kept_ids = [i for i in v1_ids if i in order]
        moves = []
        for rid in kept_ids:
            moves.extend([rid, s, e] for s, e in drop_overlaps(spans[rid]))
        moves.sort(key=lambda m: (m[1], m[1] - m[2], order[m[0]]))
        cases.append({
            "src": item["src"],
            "text": text,
            "v1_rule_ids": kept_ids,
            "v1_spans": {rid: spans[rid] for rid in kept_ids},
            "moves": moves,
        })

    golden = {
        "about": (
            "What the retired v1 engine did on every scannable text in its tests and "
            "calibration corpus, plus edge cases. For each case: v1_rule_ids are the rules "
            "v1 raised (excluded rules removed); v1_spans are every match of those rules' "
            "v1 regexes, in indicator order; moves are what v2 must return for domain "
            "'all': per rule, sort by start then longest and drop overlaps, then sort all "
            "moves by start, longest, and pack order. Offsets are Unicode code points."
            + (" Real names of people, parties, organizations and outlets in the texts are "
               "replaced with made-up names of the same shape before v1 reads them "
               "(scripts/make_golden.py --rename)." if rename is not None else "")
        ),
        "generated_by": "scripts/make_golden.py",
        "v1_core_version": fc.CORE_VERSION,
        "v1_frozen_core_git_blob": blob_sha,
        "rules_version": pack["rules_version"],
        "excluded_rules": excluded_rules,
        "excluded_texts": excluded,
        "cases": cases,
    }
    OUT.write_text(json.dumps(golden, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")
    flagged = sum(1 for c in cases if c["moves"])
    print(f"cases: {len(cases)} ({flagged} with moves); excluded texts: {len(excluded)}; "
          f"excluded rules: {excluded_rules}; v1 frozen_core blob {blob_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
