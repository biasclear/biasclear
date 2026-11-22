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
  package version and the rules version, so that a rules update reaches
  installed copies: package 2.0.0a1 with rules 2.0.0a5 gives 2.0.0-alpha.1.5.
  A change to the engine alone reaches installed copies only with a new
  package version.

Usage::

    python scripts/sync_claude_plugin.py          # write the copy
    python scripts/sync_claude_plugin.py --check  # exit 1 if the copy is stale

Run it after any change to the engine or the rule pack.
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
ENGINE_FILES = ("__init__.py", "_engine.py")
SHARD_LIMIT = 200_000  # bytes; the directory's review threshold is 256 KiB
GENERATED_DIRS = (SKILL / "engine" / "biasclear", SKILL / "rules")


def _dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def _canonical_hash(pack: dict) -> str:
    canonical = json.dumps(pack, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _semver(version: str) -> str:
    """PEP 440 'X.Y.Z' or 'X.Y.ZaN'/'bN'/'rcN' as SemVer 'X.Y.Z[-alpha.N]'."""
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:(a|b|rc)(\d+))?", version)
    if not m:
        raise SystemExit(f"cannot turn version {version!r} into a plugin version")
    base = ".".join(m.group(1, 2, 3))
    if m.group(4):
        base += "-" + {"a": "alpha", "b": "beta", "rc": "rc"}[m.group(4)] + "." + m.group(5)
    return base


def plugin_version(package: str, rules: str) -> str:
    """The package version with the rules version's last number appended."""
    rules_number = re.findall(r"\d+", rules)[-1]
    base = _semver(package)
    return f"{base}.{rules_number}" if "-" in base else f"{base}-rules.{rules_number}"


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

    plugin_json = PLUGIN / ".claude-plugin" / "plugin.json"
    card = json.loads(plugin_json.read_text(encoding="utf-8"))
    card["version"] = plugin_version(package_version, pack["rules_version"])
    files[plugin_json] = _dump(card).encode("utf-8")
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="report a stale copy instead of writing it")
    args = parser.parse_args(argv)

    files = planned_files()
    unexpected = sorted(
        path for folder in GENERATED_DIRS if folder.is_dir()
        for path in folder.rglob("*") if path.is_file() and path not in files
    )

    if args.check:
        problems = [str(p.relative_to(ROOT)) for p, data in files.items()
                    if not p.exists() or p.read_bytes() != data]
        problems += [f"{p.relative_to(ROOT)} (not generated; remove it)" for p in unexpected]
        if problems:
            print("The Claude plugin's copy is out of date. Run: python scripts/sync_claude_plugin.py")
            for problem in problems:
                print(f"  {problem}")
            return 1
        print("The Claude plugin's copy matches the source.")
        return 0

    for path in unexpected:
        path.unlink()
        print(f"removed {path.relative_to(ROOT)}")
    for path, data in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)
            print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
