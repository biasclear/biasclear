"""Build the Unicode golden file (tests/golden/unicode_parity.json).

The v1 golden file is almost all ASCII, so parity on it can pass while the
engines differ on real text. These cases pin what both engines must do on
non-ASCII text, where Python's ``re`` and plain JavaScript ``RegExp`` read
the same pattern differently:

- ``\\w``, ``\\b`` and ``\\d`` are Unicode-aware (Python), not ASCII-only;
- ``\\s`` is ``str.isspace()``: it includes U+001C to U+001F and U+0085 and
  excludes U+FEFF;
- ``.``, ``{m,n}``, lookbehind widths and the citation window count code
  points, not UTF-16 units;
- under the ``i`` flag, ``i`` also matches U+0130 and U+0131, ``s`` matches
  U+017F and ``k`` matches U+212A;
- the citation lookup's index quirks are kept as they are.

The TypeScript engine follows these semantics (option (a) of ticket E2:
emulate Python). The expected moves come from the Python engine, for domain
``"all"``, with code point offsets, like ``v1_parity.json``. Each case says
whether plain JavaScript regexes (no translation, UTF-16 counting) would
give different moves; ``packages/engine/test/golden.test.ts`` checks that
claim, so every case marked ``true`` really separates the two readings.

Usage (from the root of this repo):
    python scripts/make_unicode_golden.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from biasclear import rule_pack, scan  # noqa: E402

OUT = ROOT / "tests" / "golden" / "unicode_parity.json"

SMILE = "\U0001F642"
FILLER_AND = " and" * 35  # 140 characters that trigger nothing

# (note, text, native_js_differs, rule IDs the Python engine must raise)
CASES: list[tuple[str, str, bool, set[str]]] = [
    (
        "\\b after a match: U+00E9 is a word character, so 'agrees' does not end a word.",
        "Everyone agrees\u00e9 with the plan.",
        True,
        set(),
    ),
    (
        "\\b before a match: U+00E9 is a word character, so 'Everyone' does not start a word.",
        "The panel said \u00e9Everyone agrees with it.",
        True,
        set(),
    ),
    (
        "A combining mark (U+0301) is not a word character, so the boundary holds.",
        "Everyone agrees\u0301 with the plan.",
        False,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
    (
        "A letter outside the BMP (U+1D400) is a word character, so no boundary before 'Everyone'.",
        "\U0001D400Everyone agrees.",
        True,
        set(),
    ),
    (
        "A CJK ideograph is a word character, so no boundary before 'Everyone'.",
        "\u4e13\u5bb6Everyone agrees.",
        True,
        set(),
    ),
    (
        "Offsets after an emoji ZWJ sequence: U+200D is not a word character.",
        "\U0001F469\u200d\U0001F469\u200d\U0001F467 Everyone agrees.",
        False,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
    (
        "MEDIA_BURIED_QUALIFIER's .{5,150}? counts code points: 100 emoji fit; 200 UTF-16 units would not.",
        "x" * 200 + " However, " + SMILE * 100 + " no evidence was found.",
        True,
        {"MEDIA_BURIED_QUALIFIER"},
    ),
    (
        "MEDIA_BURIED_QUALIFIER's (?<=.{200}) counts code points: 151 are not enough, though they are 301 UTF-16 units.",
        SMILE * 150 + " However, the report could not be verified.",
        True,
        set(),
    ),
    (
        "MEDIA_BURIED_QUALIFIER with exactly 200 code points before the qualifier.",
        "x" * 190 + SMILE * 9 + " However, the report could not be verified.",
        False,
        {"MEDIA_BURIED_QUALIFIER"},
    ),
    (
        "FALSE_BINARY's 'either ... or' takes up to 32 words: U+FEFF is not \\s, so 'one\\ufefftwo' is one word and "
        "the gap is 32 words; where U+FEFF counts as a space it would be 33.",
        "Either one\ufefftwo " + " ".join(["word"] * 31) + " or we lose.",
        True,
        {"FALSE_BINARY"},
    ),
    (
        "\\d matches any decimal digit: Arabic-Indic digits in FIN_ANCHORING.",
        "The stock is down \u0665\u0660% from its all-time high.",
        True,
        {"FIN_ANCHORING"},
    ),
    (
        "\\d in a citation pattern: an Arabic-Indic digit in brackets is a citation, so the claim is suppressed.",
        "Studies show [\u0663] that sleep helps.",
        True,
        set(),
    ),
    (
        "\\s includes U+001C (INFORMATION SEPARATOR FOUR).",
        "Everyone\x1cagrees with the plan.",
        True,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
    (
        "\\s includes U+0085 (NEXT LINE).",
        "Everyone\x85agrees with the plan.",
        True,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
    (
        "\\s excludes U+FEFF (ZERO WIDTH NO-BREAK SPACE), which JavaScript's \\s includes.",
        "Everyone\ufeffagrees with the plan.",
        True,
        set(),
    ),
    (
        "\\s includes U+00A0 (NO-BREAK SPACE) in both languages.",
        "Everyone\u00a0agrees with the plan.",
        False,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
    (
        ". with the s flag matches U+2028 (LINE SEPARATOR).",
        "Either we act\u2028now or never.",
        False,
        {"FALSE_BINARY", "FEAR_URGENCY"},
    ),
    (
        "Under i, 's' matches U+017F (LONG S).",
        "The town was totally de\u017ftroyed.",
        True,
        {"TOTALIZING_HARM_LANGUAGE"},
    ),
    (
        "Under i, 'k' matches U+212A (KELVIN SIGN).",
        "Just thin\u212a of the children.",
        True,
        {"EMOTIONAL_SUBSTITUTION"},
    ),
    (
        "Under i, 'i' matches U+0131 (DOTLESS I).",
        "The town was utterly ru\u0131ned.",
        True,
        {"TOTALIZING_HARM_LANGUAGE"},
    ),
    (
        "Under i, 'i' matches U+0130 (CAPITAL I WITH DOT ABOVE).",
        "The town was utterly ru\u0130ned.",
        True,
        {"TOTALIZING_HARM_LANGUAGE"},
    ),
    (
        "Under i, [a-z] matches U+0130 and U+0131 (MEDIA_SELECTIVE_QUOTATION needs two matches).",
        "Their \u201c\u0130deal\u201d plan and the \u201c\u0131deal\u201d approach.",
        True,
        {"MEDIA_SELECTIVE_QUOTATION"},
    ),
    (
        "\\W is Unicode-aware: a scare-quoted label with accented letters ([^\\W\\d_]) counts toward "
        "MEDIA_SELECTIVE_QUOTATION's two quotes; where \\W is ASCII-only it would not.",
        'The so-called "Qu\u00e9b\u00e9cois" pushed their "values" again.',
        True,
        {"MEDIA_SELECTIVE_QUOTATION"},
    ),
    (
        "The citation window counts code points: the citation is 106 code points (206 UTF-16 units) past the claim.",
        "Studies show that " + SMILE * 100 + " (Smith, 2020).",
        True,
        set(),
    ),
    (
        "Lookup quirk: U+0130 lowercases to two code points, and the index found in the lowercased "
        "text is used in the original, so the window shifts right and reaches this citation.",
        "\u0130" * 60 + " studies show" + FILLER_AND + " (Smith, 2020).",
        False,
        set(),
    ),
    (
        "Control for the case above: without the shift, the same citation is out of reach.",
        "I" * 60 + " studies show" + FILLER_AND + " (Smith, 2020).",
        False,
        {"CLAIM_WITHOUT_CITATION"},
    ),
    (
        "A lone surrogate counts as one code point and is not a word character.",
        "\ud800 Everyone agrees.",
        False,
        {"CONSENSUS_AS_EVIDENCE"},
    ),
]


def main() -> int:
    cases = []
    for i, (note, text, native_js_differs, expected_ids) in enumerate(CASES, start=1):
        moves = [[m["rule_id"], m["start"], m["end"]] for m in scan(text, domain="all")["moves"]]
        ids = {m[0] for m in moves}
        if ids != expected_ids:
            raise SystemExit(f"unicode:{i:02d}: expected {sorted(expected_ids)}, got {sorted(ids)}")
        cases.append({
            "src": f"unicode:{i:02d}",
            "note": note,
            "native_js_differs": native_js_differs,
            "text": text,
            "moves": moves,
        })
    golden = {
        "about": (
            "Non-ASCII cases that pin the engines' Unicode semantics (Python's re, which the "
            "TypeScript engine emulates). moves are what scan() returns for domain 'all', as "
            "[rule_id, start, end] in Unicode code points. native_js_differs says whether plain "
            "JavaScript regexes (no translation, UTF-16 counting) would return different moves."
        ),
        "generated_by": "scripts/make_unicode_golden.py",
        "rules_version": rule_pack()["rules_version"],
        "cases": cases,
    }
    OUT.write_text(json.dumps(golden, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
