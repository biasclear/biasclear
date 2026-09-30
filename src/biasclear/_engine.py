"""The rule engine: load the bundled rule pack and scan text against it.

Deterministic and synchronous. No network, no file writes, no logging.
The only I/O is reading the rule pack that ships inside this package.
"""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any, NamedTuple, Optional

MAX_INPUT_CHARS = 200_000
"""Longest accepted input, in characters (Unicode code points)."""

DOMAINS = ("general", "legal", "media", "financial", "all")
"""Accepted ``domain`` values. ``None`` means ``"general"``."""

_FLAG_BITS = {"i": re.IGNORECASE, "s": re.DOTALL}
_TIERS = ("1", "2", "3")


class _Rule(NamedTuple):
    order: int  # position in the pack; breaks ties in the output order
    id: str
    name: str
    tier: int
    domain: str
    severity: str
    indicators: tuple[re.Pattern[str], ...]
    min_matches: int
    suppress_if_cited: bool


class _Engine(NamedTuple):
    pack_json: str
    rules_version: str
    rules_hash: str
    rules: tuple[_Rule, ...]
    citation_patterns: tuple[re.Pattern[str], ...]
    citation_window: int


def _flags(letters: str) -> int:
    bits = 0
    for letter in letters:
        if letter not in _FLAG_BITS:
            raise ValueError(f"unsupported regex flag {letter!r} in rule pack")
        bits |= _FLAG_BITS[letter]
    return bits


def canonical_json(value: Any) -> str:
    """Canonical JSON used for ``rules_hash``.

    Sorted keys, no insignificant whitespace, UTF-8 characters written as-is.
    For a pack that holds only strings, integers, booleans, arrays and objects
    with ASCII keys, this matches RFC 8785 (JSON Canonicalization Scheme).
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


@lru_cache(maxsize=1)
def _engine() -> _Engine:
    raw = (
        resources.files("biasclear")
        .joinpath("data")
        .joinpath("biasclear-rules.json")
        .read_text(encoding="utf-8")
    )
    pack = json.loads(raw)
    canonical = canonical_json(pack)
    rules = []
    for order, r in enumerate(pack["rules"]):
        bits = _flags(r["flags"])
        rules.append(_Rule(
            order=order,
            id=r["id"],
            name=r["name"],
            tier=r["pit_tier"],
            domain=r["domain"],
            severity=r["severity"],
            indicators=tuple(re.compile(p, bits) for p in r["indicators"]),
            min_matches=r["min_matches"],
            suppress_if_cited=r["suppress_if_cited"],
        ))
    cs = pack["citation_suppression"]
    cs_bits = _flags(cs["flags"])
    return _Engine(
        pack_json=canonical,
        rules_version=pack["rules_version"],
        rules_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        rules=tuple(rules),
        citation_patterns=tuple(re.compile(p, cs_bits) for p in cs["patterns"]),
        citation_window=cs["window"],
    )


def rule_pack() -> dict[str, Any]:
    """Return a fresh copy of the bundled rule pack."""
    pack: dict[str, Any] = json.loads(_engine().pack_json)
    return pack


CITATION_REACH = 1000
"""How far past the citation window a citation that starts or ends inside it
may run, in characters (code points). A citation's length (a long name in
it) does not decide whether it is seen."""


def _has_nearby_citation(engine: _Engine, text: str, text_lower: str, fragment: str) -> bool:
    """Is there a citation within ``window`` characters of the fragment?

    As in v1 ``FrozenCore._has_nearby_citation``, it looks up the *first*
    case-insensitive occurrence of the matched fragment (not the match's own
    position) and takes ``window`` characters on each side of it. Unlike v1
    (rules version 2.0.0a2, ticket E3), a citation counts when any part of it
    falls inside that window: the search runs over the window plus
    ``CITATION_REACH`` characters on each side, so a citation with a long
    organization name is found as whole as one with a short name.
    """
    idx = text_lower.find(fragment.lower())
    if idx == -1:
        return False
    start = max(0, idx - engine.citation_window)
    end = min(len(text), idx + len(fragment) + engine.citation_window)
    base = max(0, start - CITATION_REACH)
    context = text[base:min(len(text), end + CITATION_REACH)]
    lo, hi = start - base, end - base
    for pattern in engine.citation_patterns:
        for m in pattern.finditer(context):
            if m.start() >= hi:
                break
            if m.end() > lo:
                return True
    return False


def _drop_overlaps(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Sort by start, then longest first; keep a span only if it starts at or
    after the end of the last kept span."""
    kept: list[tuple[int, int]] = []
    last_end = -1
    for start, end in sorted(spans, key=lambda s: (s[0], s[0] - s[1])):
        if start >= last_end:
            kept.append((start, end))
            last_end = end
    return kept


def scan(text: str, domain: Optional[str] = None) -> dict[str, Any]:
    """Scan ``text`` and name the structural moves it makes.

    Args:
        text: The text to scan. At most ``MAX_INPUT_CHARS`` characters.
        domain: ``None`` or ``"general"`` for the general rules only;
            ``"legal"``, ``"media"`` or ``"financial"`` to add that domain's
            rules; ``"all"`` for every rule.

    Returns:
        A dict with ``rules_version``, ``rules_hash``, ``moves`` and
        ``counts``. Each move is ``{rule_id, name, tier, domain, severity,
        start, end, match}``; ``start`` and ``end`` are code point offsets
        into ``text`` and ``match == text[start:end]``. ``counts`` maps each
        tier (``"1"``, ``"2"``, ``"3"``) to its number of moves.

    Raises:
        TypeError: ``text`` is not a ``str``.
        ValueError: ``text`` is too long, or ``domain`` is unknown.
    """
    if not isinstance(text, str):
        raise TypeError(f"text must be str, not {type(text).__name__}")
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(
            f"text is {len(text)} characters; the limit is {MAX_INPUT_CHARS}"
        )
    if domain is None:
        domain = "general"
    if domain not in DOMAINS:
        raise ValueError(f"unknown domain {domain!r}; expected one of {DOMAINS}")

    engine = _engine()
    text_lower: Optional[str] = None
    found: list[tuple[int, int, int, _Rule]] = []
    for rule in engine.rules:
        if domain != "all" and rule.domain not in ("general", domain):
            continue
        spans: list[tuple[int, int]] = []
        for pattern in rule.indicators:
            for m in pattern.finditer(text):
                start, end = m.span()
                if end > start:  # never report or count a zero-length match
                    spans.append((start, end))
        # min_matches counts every match from every indicator, as v1 did.
        if len(spans) < rule.min_matches:
            continue
        if rule.suppress_if_cited:
            if text_lower is None:
                text_lower = text.lower()
            if all(
                _has_nearby_citation(engine, text, text_lower, text[s:e])
                for s, e in spans
            ):
                continue
        for start, end in _drop_overlaps(spans):
            found.append((start, end, rule.order, rule))

    found.sort(key=lambda f: (f[0], f[0] - f[1], f[2]))
    counts = {tier: 0 for tier in _TIERS}
    moves = []
    for start, end, _, rule in found:
        counts[str(rule.tier)] += 1
        moves.append({
            "rule_id": rule.id,
            "name": rule.name,
            "tier": rule.tier,
            "domain": rule.domain,
            "severity": rule.severity,
            "start": start,
            "end": end,
            "match": text[start:end],
        })
    return {
        "rules_version": engine.rules_version,
        "rules_hash": engine.rules_hash,
        "moves": moves,
        "counts": counts,
    }
