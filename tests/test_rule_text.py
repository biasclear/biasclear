"""Rule names and descriptions describe phrasing, never the writer's motive.

The README promises no verdict on the writer or their intent, and the Field
Guide quotes these texts, so words that claim a motive are not allowed.
"""

from __future__ import annotations

import re

INTENT_WORDS = re.compile(
    r"manipulat|intimidat|silenc|fabricat|deceiv|deceptive|disguis|trick|exploit|coerc|"
    r"designed\s+to|in\s+order\s+to|to\s+avoid|to\s+create\s+an?\s+impression|to\s+discourage|"
    r"to\s+shut\s+down|to\s+bypass|to\s+force|forces?\s+a|weaponi[sz]|propagandi[sz]",
    re.IGNORECASE,
)


def test_names_and_descriptions_state_no_intent(pack):
    found = {
        rule["id"]: m.group(0)
        for rule in pack["rules"]
        for text in (rule["name"], rule["description"])
        if (m := INTENT_WORDS.search(text))
    }
    assert not found, found


def test_the_check_catches_the_old_texts():
    for old in (
        "Sanctions Threat as Silencing Tool",
        "Procedural Gatekeeping to Avoid Substance",
        "More subtle than explicit 'everyone agrees' but equally manipulative.",
        "to intimidate a party into abandoning a non-frivolous argument",
        "typically by overstating, oversimplifying, or fabricating a position",
    ):
        assert INTENT_WORDS.search(old), old
