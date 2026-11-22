#!/usr/bin/env python3
"""Run BiasClear's rules on a text and print the marks as JSON.

Usage:
    python3 -I biasclear_scan.py --file text.txt [--domain media]
    python3 -I biasclear_scan.py < text.txt

What it does:
1. Rejoins the bundled rule pack (rules/header.json plus the rules-NN.json
   shards) and checks its rules hash and version against rules/PACK.json
   before anything runs. A missing, damaged or changed pack is refused.
2. Imports the bundled engine (engine/biasclear/) where it sits and hands it
   the checked pack in memory. Nothing is written to disk.
3. Prints one JSON object (UTF-8): every mark, the moves found with a plain
   description of each, and fixed reminders on how to read the result.

Python standard library only. No network calls, no logging, nothing kept.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # keep no compiled copy of the engine anywhere

import argparse  # noqa: E402
import hashlib  # noqa: E402
import importlib  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = SKILL_DIR / "engine" / "biasclear"
RULES_DIR = SKILL_DIR / "rules"
DOMAINS = ("general", "legal", "media", "financial", "all")
MAX_CHARS = 200_000

REMINDERS = [
    "A mark is a prompt to look closer, not a finding.",
    "BiasClear reads wording only. It does not judge whether anything is true, and it does not judge people or sides.",
    "No marks does not mean no persuasion. The rules miss persuasion put in other words, tone and insinuation.",
    "How often the rules are right on new text has not been measured yet.",
    "Some rules stay quiet when something shaped like a citation sits beside the claim. The rules check the shape of a citation, not whether the source exists.",
    "A quoted phrase is marked the same as one the writer uses.",
    "The swapped-side tests still list known gaps, where the same kind of wording is marked when it is aimed at one side and not the other (rules/RULE_CHANGES.md in the BiasClear repository).",
    "The rules are written for English.",
    "A tier says how a move works, not how serious it is.",
]


class ScanError(Exception):
    """A problem the person running the scan should see in plain words."""


def read_text(path: str | None) -> str:
    """Read UTF-8 text from a file or from standard input, strictly."""
    max_bytes = 4 * MAX_CHARS
    if path is None:
        data = sys.stdin.buffer.read(max_bytes + 1)
    else:
        try:
            with open(path, "rb") as handle:
                data = handle.read(max_bytes + 1)
        except OSError as exc:
            raise ScanError(f"could not read {path}: {exc.strerror or exc}") from None
    if len(data) > max_bytes:
        raise ScanError(f"the text is longer than {MAX_CHARS:,} characters")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ScanError(f"the text is not valid UTF-8 ({exc.reason} at byte {exc.start}); save it as UTF-8 and try again") from None
    if len(text) > MAX_CHARS:
        raise ScanError(f"the text is longer than {MAX_CHARS:,} characters")
    return text


def load_pack() -> tuple[dict, dict]:
    """Rejoin the bundled rule pack and check it. Returns (manifest, pack)."""
    try:
        manifest = json.loads((RULES_DIR / "PACK.json").read_text(encoding="utf-8"))
        pack = json.loads((RULES_DIR / "header.json").read_text(encoding="utf-8"))
        rules: list = []
        for name in manifest["shards"]:
            if not isinstance(name, str) or "/" in name or "\\" in name or not name.startswith("rules-"):
                raise ScanError(f"unexpected shard name in PACK.json: {name!r}")
            rules.extend(json.loads((RULES_DIR / name).read_text(encoding="utf-8")))
        pack["rules"] = rules
        canonical = json.dumps(pack, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        matches = digest == manifest["rules_hash"] and pack["rules_version"] == manifest["rules_version"]
    except ScanError:
        raise
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ScanError(f"the bundled rule pack is missing or damaged ({exc}); reinstall the plugin") from None
    if not matches:
        raise ScanError("the bundled rule pack does not match its recorded fingerprint; reinstall the plugin")
    return manifest, pack


class _PackInMemory:
    """Stands in for importlib.resources inside the bundled engine.

    The engine reads its pack with
    resources.files("biasclear").joinpath("data").joinpath(...).read_text().
    This hands it the rejoined pack that load_pack() has already checked, so
    nothing is written anywhere.
    """

    def __init__(self, text: str) -> None:
        self._text = text

    def files(self, _package: str) -> "_PackInMemory":
        return self

    def joinpath(self, *_parts: str) -> "_PackInMemory":
        return self

    def read_text(self, encoding: str = "utf-8") -> str:
        return self._text


def run_engine(pack: dict, manifest: dict, text: str, domain: str | None) -> dict:
    """Scan with the bundled engine, imported in place, using the checked pack."""
    for name in [n for n in sys.modules if n == "biasclear" or n.startswith("biasclear.")]:
        del sys.modules[name]
    sys.path.insert(0, str(ENGINE_DIR.parent))
    try:
        engine = importlib.import_module("biasclear._engine")
    finally:
        sys.path.remove(str(ENGINE_DIR.parent))
    if Path(engine.__file__).resolve().parent != ENGINE_DIR.resolve():
        raise ScanError("could not load the bundled engine")
    engine.resources = _PackInMemory(json.dumps(pack, ensure_ascii=False))
    try:
        result = engine.scan(text, domain=domain)
    except (OSError, ValueError, KeyError) as exc:
        raise ScanError(f"the bundled engine could not run ({exc}); reinstall the plugin") from None
    if result["rules_hash"] != manifest["rules_hash"] or result["rules_version"] != manifest["rules_version"]:
        raise ScanError("the bundled rule pack does not match its recorded fingerprint; reinstall the plugin")
    return result


def build_report(text: str, domain: str | None) -> dict:
    manifest, pack = load_pack()
    result = run_engine(pack, manifest, text, domain)
    rules = {rule["id"]: rule for rule in pack["rules"]}
    tiers = pack["tiers"]
    marks = []
    moves: dict[str, dict] = {}
    for move in result["moves"]:
        marks.append({
            "text": move["match"],
            "move": move["name"],
            "rule_id": move["rule_id"],
            "start": move["start"],
            "end": move["end"],
        })
        found = moves.setdefault(move["rule_id"], {
            "move": move["name"],
            "what_it_does": rules.get(move["rule_id"], {}).get("description", ""),
            "tier": move["tier"],
            "tier_name": tiers[str(move["tier"])]["name"],
            "domain": move["domain"],
            "marks": 0,
        })
        found["marks"] += 1
    return {
        "tool": "BiasClear",
        "rules_version": result["rules_version"],
        "rules_hash": result["rules_hash"],
        "domain": domain or "general",
        "characters": len(text),
        "mark_count": len(marks),
        "move_count": len(moves),
        "marks": marks,
        "moves": moves,
        "offsets": "start and end count characters (Unicode code points) from the start of the text.",
        "reminders": REMINDERS,
        "source": "https://github.com/biasclear/biasclear",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run BiasClear's rules on a text and print the marks as JSON.")
    parser.add_argument("--file", help="a UTF-8 text file to scan (default: read standard input)")
    parser.add_argument("--domain", choices=DOMAINS, default=None,
                        help="add a domain's rules to the general rules (media = news); 'all' runs every rule")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 9):
        print("biasclear: needs Python 3.9 or newer", file=sys.stderr)
        return 2
    try:
        report = build_report(read_text(args.file), args.domain)
    except ScanError as exc:
        print(f"biasclear: {exc}", file=sys.stderr)
        return 2
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
