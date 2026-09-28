"""Python half of the parity check (scripts/parity.mjs runs it).

Reads a JSON request on stdin ({"probes": [[pattern, flags], ...]}) and
writes one JSON document to stdout with:

- ``texts``: every text in tests/golden/*.json and every text in the
  symmetry tests (tests/test_symmetry.py), each with the Python engine's
  scan() result for domain None, "general", "legal", "media", "financial"
  and "all";
- ``pairs``: the symmetry pairs, as indexes into ``texts`` (every pair must
  raise the same rules on both sides): ``symmetric`` for the template pairs,
  whose first side must raise at least one rule, and ``red_team`` for the
  red team's pairs, some of which raise nothing on either side;
- ``probes``: for each regex probe, the code points it matches on its own
  (``re.fullmatch``), as ranges;
- ``assigned``: the code points this Python's Unicode database assigns;
- ``lower``: every assigned code point whose ``str.lower()`` differs.

It imports the engine from this repo's src/ and the symmetry tests from
tests/, so it needs pytest (``pip install '.[test]'``).
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "src"))

import biasclear  # noqa: E402
from biasclear import scan  # noqa: E402

DOMAINS = [None, "general", "legal", "media", "financial", "all"]
FLAG_BITS = {"i": re.IGNORECASE, "s": re.DOTALL}
SURROGATES = range(0xD800, 0xE000)
# Every code point except the surrogates, in order; index i is code point
# i below U+D800 and i + 0x800 above.
ALL = "".join(chr(c) for c in range(0x110000) if c not in SURROGATES)


def to_code_point(index: int) -> int:
    return index if index < 0xD800 else index + 0x800


def ranges(points: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for cp in sorted(points):
        if out and out[-1][1] + 1 == cp:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def probe(pattern: str, flags: str) -> list[list[int]]:
    """Code points c with re.fullmatch(pattern, chr(c), flags)."""
    bits = 0
    for letter in flags:
        bits |= FLAG_BITS[letter]
    one = re.compile(pattern, bits)
    runs = re.compile(f"(?:{pattern})+", bits)
    points: list[int] = []
    for m in runs.finditer(ALL):
        for i in range(m.start(), m.end()):
            points.append(to_code_point(i))
    # The run search assumes the probe matches exactly one character.
    for cp in points[:: max(1, len(points) // 64)]:
        assert one.fullmatch(chr(cp)), (pattern, flags, cp)
    points.extend(c for c in SURROGATES if one.fullmatch(chr(c)))
    return ranges(points)


def golden_texts() -> list[tuple[str, str]]:
    texts = []
    for path in sorted((ROOT / "tests" / "golden").glob("*.json")):
        for case in json.loads(path.read_text(encoding="utf-8"))["cases"]:
            texts.append((f"{path.name}:{case['src']}", case["text"]))
    return texts


def symmetry() -> dict[str, list[tuple[str, str]]]:
    import test_symmetry as t

    return {"symmetric": list(t.ALL_PAIRS), "red_team": list(t.RED_TEAM_ALL)}


def main() -> int:
    request = json.loads(sys.stdin.buffer.read().decode("utf-8"))

    texts: list[dict] = []
    index: dict[str, int] = {}

    def add(src: str, text: str) -> int:
        if text not in index:
            index[text] = len(texts)
            texts.append({
                "src": src,
                "text": text,
                "results": [scan(text, domain=d) for d in DOMAINS],
            })
        return index[text]

    golden = [add(src, text) for src, text in golden_texts()]
    pairs = {
        group: [[add(f"symmetry:{group}", a), add(f"symmetry:{group}", b)] for a, b in found]
        for group, found in symmetry().items()
    }

    json.dump(
        {
            "python": sys.version.split()[0],
            "unicode": unicodedata.unidata_version,
            "engine_file": str(Path(biasclear.__file__).resolve().relative_to(ROOT)),
            "domains": DOMAINS,
            "golden": golden,
            "texts": texts,
            "pairs": pairs,
            "probes": [probe(p, f) for p, f in request["probes"]],
            "assigned": ranges([c for c in range(0x110000) if unicodedata.category(chr(c)) != "Cn"]),
            "lower": {
                str(c): chr(c).lower()
                for c in range(0x110000)
                if unicodedata.category(chr(c)) != "Cn" and chr(c).lower() != chr(c)
            },
        },
        sys.stdout,
        ensure_ascii=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
