"""Copy the engine and the rule pack into the Claude plugin, or check the copy.

The Claude plugin in ``plugins/biasclear/`` carries its own copy of the Python
engine and of the rule pack, so that it runs anywhere Claude can run Python,
with nothing to install and nothing to fetch. This script makes that copy from
the one source of truth:

- ``src/biasclear/__init__.py`` and ``src/biasclear/_engine.py`` are copied
  byte for byte into ``skills/biasclear/engine/biasclear/``.
- ``src/biasclear/data/biasclear-rules.json`` is written as a header file and
  a few shard files of whole rules, each well under 256 KiB, because the
  Claude plugin directory holds larger files for a reviewer. ``PACK.json``
  records the rules version, the rules hash and the shard names. The skill
  rejoins the shards and checks the hash before it scans anything.
- ``LICENSE`` and ``rules/LICENSE`` are copied in.
- The plugin's ``version`` in ``.claude-plugin/plugin.json`` is set from the
  package version, the whole rules version and a hash of everything the
  plugin ships. Claude Code moves an installed plugin to a new version when
  it updates the plugin (by itself only if auto-update is on for the
  plugin's marketplace), so any change to any file in the plugin can reach
  installed copies.
  Package 2.0.0a1 with rules 2.0.0a5 gives
  2.0.0-alpha.1.rules.2.0.0.0.5+files.<the hash's first 8 hex digits>.

The plugin may hold only the files this script writes and the ones written by
hand (``HAND_WRITTEN``); ``--check`` reports any other file.

Usage::

    python scripts/sync_claude_plugin.py          # write the copy
    python scripts/sync_claude_plugin.py --check  # exit 1 if the copy is stale

Run it after any change to the engine, the rule pack or the plugin's files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "biasclear"
PLUGIN = ROOT / "plugins" / "biasclear"
SKILL = PLUGIN / "skills" / "biasclear"
PLUGIN_JSON = PLUGIN / ".claude-plugin" / "plugin.json"
ENGINE_FILES = ("__init__.py", "_engine.py")
SHARD_LIMIT = 200_000  # bytes; the directory's review threshold is 256 KiB
GENERATED_DIRS = (SKILL / "engine" / "biasclear", SKILL / "rules")
# Plugin files written by hand, relative to the plugin folder. plugin.json is
# written by hand too, except its version, which this script sets.
HAND_WRITTEN = (
    "README.md",
    "assets/icon.png",
    "skills/biasclear/SKILL.md",
    "skills/biasclear/scripts/biasclear_scan.py",
)
_VERSION = r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(a|b|rc)(0|[1-9]\d*))?"
_STAGE = {"a": 0, "b": 1, "rc": 2, None: 3}  # final comes after rc


def _dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def _canonical_hash(pack: dict) -> str:
    canonical = json.dumps(pack, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _semver(version: str) -> str:
    """PEP 440 'X.Y.Z' or 'X.Y.ZaN'/'bN'/'rcN' as SemVer 'X.Y.Z[-alpha.N]'."""
    m = re.fullmatch(_VERSION, version)
    if not m:
        raise SystemExit(f"cannot turn version {version!r} into a plugin version")
    base = ".".join(m.group(1, 2, 3))
    if m.group(4):
        base += "-" + {"a": "alpha", "b": "beta", "rc": "rc"}[m.group(4)] + "." + m.group(5)
    return base


def plugin_version(package: str, rules: str, files_sha256: str) -> str:
    """The package version, the whole rules version as numbers, and a files hash.

    The rules part sits in the pre-release, so versions rise in SemVer order
    as the rules move from a5 to a6, b1, rc1 and final, and on to 2.0.1 and
    2.1.0. The hash of the plugin's files sits in the build metadata, so any
    other change still gives a different version string.
    """
    m = re.fullmatch(_VERSION, rules)
    if not m:
        raise SystemExit(f"cannot turn rules version {rules!r} into a plugin version")
    major, minor, patch, stage, number = m.groups()
    rules_part = f"rules.{major}.{minor}.{patch}.{_STAGE[stage]}.{number or 0}"
    base = _semver(package)
    sep = "." if "-" in base else "-"
    return f"{base}{sep}{rules_part}+files.{files_sha256[:8]}"


def files_hash(generated: dict[Path, bytes], card: dict) -> str:
    """sha256 over everything the plugin ships, except plugin.json's version.

    It covers the generated files as they are to be written, the files written
    by hand, and plugin.json's other fields. Each entry adds its path and its
    length, so no two different sets of files hash alike by moving bytes.
    Text is hashed with LF line ends, as git checks it out, so a file saved
    with CRLF on one computer doesn't give a different version there.
    """
    missing = [rel for rel in HAND_WRITTEN if not (PLUGIN / rel).is_file()]
    if missing:
        raise SystemExit("missing hand-written plugin files: " + ", ".join(missing))
    entries = {path.relative_to(PLUGIN).as_posix(): data for path, data in generated.items()}
    for rel in HAND_WRITTEN:
        entries[rel] = (PLUGIN / rel).read_bytes()
    fields = {key: value for key, value in card.items() if key != "version"}
    entries[PLUGIN_JSON.relative_to(PLUGIN).as_posix()] = json.dumps(
        fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    digest = hashlib.sha256()
    for rel in sorted(entries):
        data = entries[rel] if rel.endswith(".png") else entries[rel].replace(b"\r\n", b"\n")
        digest.update(rel.encode("utf-8") + b"\0" + str(len(data)).encode("ascii") + b"\0" + data)
    return digest.hexdigest()


def planned_files() -> dict[Path, bytes]:
    """Every generated file in the plugin, with its exact bytes."""
    package_version = re.search(
        r'^__version__ = "([^"]+)"', (SRC / "__init__.py").read_text(encoding="utf-8"), re.M
    ).group(1)
    pack = json.loads((SRC / "data" / "biasclear-rules.json").read_text(encoding="utf-8"))

    files: dict[Path, bytes] = {}
    for name in ENGINE_FILES:
        files[SKILL / "engine" / "biasclear" / name] = (SRC / name).read_bytes()
    files[PLUGIN / "LICENSE"] = (ROOT / "LICENSE").read_bytes()
    files[SKILL / "rules" / "LICENSE"] = (ROOT / "rules" / "LICENSE").read_bytes()

    header = {key: value for key, value in pack.items() if key != "rules"}
    files[SKILL / "rules" / "header.json"] = _dump(header).encode("utf-8")
    shards: list[list[dict]] = [[]]
    for rule in pack["rules"]:
        trial = shards[-1] + [rule]
        if shards[-1] and len(_dump(trial).encode("utf-8")) > SHARD_LIMIT:
            shards.append([rule])
        else:
            shards[-1] = trial
    names = []
    for number, shard in enumerate(shards, start=1):
        name = f"rules-{number:02d}.json"
        names.append(name)
        files[SKILL / "rules" / name] = _dump(shard).encode("utf-8")

    # The header and the shards, read back from the bytes to be written, must
    # rejoin into exactly the source pack.
    rejoined = json.loads(files[SKILL / "rules" / "header.json"])
    rejoined["rules"] = [rule for name in names for rule in json.loads(files[SKILL / "rules" / name])]
    if _canonical_hash(rejoined) != _canonical_hash(pack):
        raise SystemExit("the rule pack shards do not rejoin into the source pack")
    manifest = {"rules_version": pack["rules_version"], "rules_hash": _canonical_hash(pack), "shards": names}
    files[SKILL / "rules" / "PACK.json"] = _dump(manifest).encode("utf-8")

    card = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
    card["version"] = plugin_version(package_version, pack["rules_version"], files_hash(files, card))
    files[PLUGIN_JSON] = _dump(card).encode("utf-8")
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="report a stale copy instead of writing it")
    args = parser.parse_args(argv)

    files = planned_files()
    expected = set(files) | {PLUGIN / rel for rel in HAND_WRITTEN}
    # A symlink is never expected, even at an expected path: the directory
    # refuses symlinks, and writing through one could change a file elsewhere.
    unexpected = sorted(p for p in PLUGIN.rglob("*") if p.is_symlink() or (p.is_file() and p not in expected))
    generated_strays = [p for p in unexpected if any(folder in p.parents for folder in GENERATED_DIRS)]
    other_strays = [p for p in unexpected if p not in generated_strays]

    if args.check:
        problems = [str(p.relative_to(ROOT)) for p, data in files.items()
                    if not p.exists() or p.read_bytes() != data]
        problems += [f"{p.relative_to(ROOT)} (not generated or written by hand; remove it)" for p in unexpected]
        if problems:
            print("The Claude plugin's copy is out of date. Run: python scripts/sync_claude_plugin.py")
            for problem in problems:
                print(f"  {problem}")
            return 1
        print("The Claude plugin's copy matches the source.")
        return 0

    for path in generated_strays:
        path.unlink()
        print(f"removed {path.relative_to(ROOT)}")
    for path, data in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)
            print(f"wrote {path.relative_to(ROOT)}")
    if other_strays:
        print("These files are neither generated nor written by hand. Remove them, or add them to HAND_WRITTEN:")
        for path in other_strays:
            print(f"  {path.relative_to(ROOT)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
