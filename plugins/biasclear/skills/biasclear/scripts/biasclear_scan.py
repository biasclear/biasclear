#!/usr/bin/env python3
"""Run BiasClear's rules on a text and print the marks as JSON.

Usage:
    python3 -I biasclear_scan.py --file text.txt [--domain media]
    python3 -I biasclear_scan.py < text.txt

What it does:
1. Rejoins the bundled rule pack (rules/header.json plus the rules-NN.json
   shards) and checks its rules hash and version against rules/PACK.json
   before anything runs. A missing, damaged or changed pack is refused.
2. Loads the bundled engine (engine/biasclear/) straight from its folder and
   hands it the checked pack in memory. Nothing is written to disk.
3. Prints one JSON object (UTF-8): the counts, the moves found with a plain
   description of each, fixed reminders on how to read the result, and then
   every mark, one per line.

Python standard library only. No network calls, no logging, nothing kept.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # keep no compiled copy of the engine anywhere

import argparse  # noqa: E402
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
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
    "Some rules stay quiet when something shaped like a citation sits beside the claim. The rules check the shape of a citation, not whether the source exists. A citation beside the first copy of a phrase can also quiet a later copy that has none.",
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
        # A byte-order mark at the very start (Notepad and other Windows tools
        # add one) marks the encoding; it is not part of the text.
        text = data.decode("utf-8-sig")
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
    except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
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
    """Scan with the bundled engine, loaded from its folder, using the checked pack."""
    for name in [n for n in sys.modules if n == "biasclear" or n.startswith("biasclear.")]:
        del sys.modules[name]
    # Load the package straight from its folder. No folder is put on sys.path,
    # so no other file can be imported in place of a module the engine uses.
    spec = importlib.util.spec_from_file_location(
        "biasclear", ENGINE_DIR / "__init__.py", submodule_search_locations=[str(ENGINE_DIR)]
    )
    if spec is None or spec.loader is None:
        raise ScanError("could not load the bundled engine; reinstall the plugin")
    package = importlib.util.module_from_spec(spec)
    sys.modules["biasclear"] = package
    try:
        spec.loader.exec_module(package)
        engine = sys.modules["biasclear._engine"]
    except (ImportError, SyntaxError, OSError, KeyError) as exc:
        raise ScanError(f"the bundled engine is missing or damaged ({exc}); reinstall the plugin") from None
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
    # The counts and the moves come first, so a long output still starts with
    # the whole picture; the marks come last.
    return {
        "tool": "BiasClear",
        "rules_version": result["rules_version"],
        "rules_hash": result["rules_hash"],
        "domain": domain or "general",
        "characters": len(text),
        "mark_count": len(marks),
        "move_count": len(moves),
        "moves": moves,
        "reminders": REMINDERS,
        "offsets": "start and end count characters (Unicode code points) from the start of the text.",
        "source": "https://github.com/biasclear/biasclear",
        "marks": marks,
    }


_LINE_BREAKS = {" ": "\\u2028", " ": "\\u2029", "\x85": "\\u0085"}


def _json(value: object) -> str:
    """JSON on one line, even for readers that also break lines at U+2028, U+2029 or NEL."""
    text = json.dumps(value, ensure_ascii=False)
    for char, escape in _LINE_BREAKS.items():
        text = text.replace(char, escape)
    return text


def render(report: dict) -> str:
    """The report as JSON, with each move, reminder and mark on its own line."""
    keys = list(report)
    lines = ["{"]
    for i, key in enumerate(keys):
        value = report[key]
        comma = "," if i < len(keys) - 1 else ""
        name = _json(key)
        if isinstance(value, dict) and value:
            items = list(value.items())
            lines.append(f" {name}: {{")
            for j, (sub, item) in enumerate(items):
                tail = "," if j < len(items) - 1 else ""
                lines.append(f"  {_json(sub)}: {_json(item)}{tail}")
            lines.append(" }" + comma)
        elif isinstance(value, list) and value:
            lines.append(f" {name}: [")
            for j, item in enumerate(value):
                tail = "," if j < len(value) - 1 else ""
                lines.append(f"  {_json(item)}{tail}")
            lines.append(" ]" + comma)
        else:
            lines.append(f" {name}: {_json(value)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


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
    sys.stdout.buffer.write(render(report).encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
