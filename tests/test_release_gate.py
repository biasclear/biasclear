"""Release gate: nothing the sdist ships names the owner's personal GitHub account.

A file uploaded to PyPI can't be changed, and the sdist ships the README, the
CHANGELOG, the tests and the scripts. This gate fails if any file that ships
in the sdist holds the owner's personal GitHub handle or a GitHub Sponsors
link, and names each file and line.

It runs wherever pytest runs:

- from the repository (CI's ``test`` job and release.yml's ``release-test``
  job), where the shipped files are read from the hatch build config in
  pyproject.toml, the way hatchling picks them;
- from the unpacked sdist (release.yml's ``sdist-test`` job), where every
  file the sdist holds is read.

The wheel ships a subset of the sdist (the package, the PyPI readme, the
licenses and metadata made from pyproject.toml), so it is covered too.

The author's name in the README's BibTeX citation (its ``author = {...}``
line) is allowed: it is the paper's author, the one place
tests/test_readme.py lets the README name a person, not an account. This gate
looks only for the handle and Sponsors links, and checks that it does not
flag that line.

The handle and the link are built from pieces below, so this file does not
match itself.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from conftest import ROOT

HANDLE = "bws" + "82"
SPONSORS = "github.com/" + "sponsors"
FORBIDDEN = (
    ("personal GitHub handle", re.compile(re.escape(HANDLE).encode(), re.IGNORECASE)),
    ("GitHub Sponsors link", re.compile(re.escape(SPONSORS).encode() + rb"(?![\w-])", re.IGNORECASE)),
)

# Python writes compiled copies of this file, where the pieces above are joined
# again, into __pycache__; hatchling never ships those (its global exclude).
SKIPPED_DIRS = {".git", "__pycache__"}
COMPILED = re.compile(r"\.py[cdo]$")

# The parts of the hatch build config this gate reads. Anything else there
# could change what ships, so the gate stops and asks to be taught it.
KNOWN_HATCH_KEYS = {
    "tool.hatch": {"build"},
    "tool.hatch.build": {"targets"},
    "tool.hatch.build.targets": {"wheel", "sdist"},
    "tool.hatch.build.targets.sdist": {"include", "exclude"},
}


def _strings(array: str) -> list[str]:
    body = "\n".join(line for line in array.splitlines() if not line.strip().startswith("#"))
    return re.findall(r'"([^"\\]*)"', body)


def _table(text: str, name: str) -> str:
    m = re.search(rf"^\[{re.escape(name)}\]\n(.*?)(?=^\[|\Z)", text, re.DOTALL | re.MULTILINE)
    assert m, f"pyproject.toml has no [{name}] table"
    return m.group(1)


def _array(table: str, key: str) -> list[str] | None:
    m = re.search(rf"^{re.escape(key)} = \[(.*?)\]", table, re.DOTALL | re.MULTILINE)
    return _strings(m.group(1)) if m else None


def build_config(text: str) -> dict:
    """The settings hatchling uses to pick the sdist's files, read from pyproject.toml's text.

    Read with regular expressions, like the other tests here, so it works on
    Python 3.10, which has no tomllib; test_gate_reads_the_build_config
    checks it against tomllib where there is one.
    """
    project = _table(text, "project")
    readme = re.search(r'^readme = "([^"]+)"$', project, re.MULTILINE)
    assert readme, "the gate expects project.readme to be one file name"
    sdist = _table(text, "tool.hatch.build.targets.sdist")
    tables = re.findall(r"^\[(tool\.hatch[^\]]*)\]$", text, re.MULTILINE)
    assert set(tables) <= {"tool.hatch.build.targets.wheel", "tool.hatch.build.targets.sdist"}, (
        f"the gate doesn't know these hatch tables yet: {tables}"
    )
    keys = set(re.findall(r"^([\w-]+) =", sdist, re.MULTILINE))
    assert keys <= KNOWN_HATCH_KEYS["tool.hatch.build.targets.sdist"], f"the gate doesn't know {sorted(keys)}"
    return {
        "readme": readme.group(1),
        "license-files": _array(project, "license-files") or [],
        "include": _array(sdist, "include") or [],
        "exclude": _array(sdist, "exclude") or [],
    }


def _glob(pattern: str) -> re.Pattern:
    """One include or exclude pattern (gitignore style, as hatchling reads them) as a regex over a relative path.

    A pattern that matches a folder also matches everything inside it.
    """
    assert not pattern.startswith("!") and "\\" not in pattern, f"the gate doesn't handle {pattern!r}"
    folder_only = pattern.endswith("/")
    body = pattern.strip("/")
    anchored = pattern.startswith("/") or "/" in body
    out, i = "", 0
    while i < len(body):
        if body.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif body.startswith("**", i):
            out, i = out + ".*", i + 2
        elif body[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif body[i] == "?":
            out, i = out + "[^/]", i + 1
        elif body[i] == "[":
            end = body.index("]", i + 1)
            out, i = out + "[" + body[i + 1:end].replace("!", "^", 1) + "]", end + 1
        else:
            out, i = out + re.escape(body[i]), i + 1
    return re.compile(("^" if anchored else "^(?:.*/)?") + out + ("/.*$" if folder_only else "(?:/.*)?$"))


def _walk(root: Path):
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIPPED_DIRS)
        for name in sorted(files):
            if not COMPILED.search(name):
                yield (Path(folder) / name).relative_to(root).as_posix()


def shipped_files(root: Path) -> list[str]:
    """Every file the sdist ships, relative to root.

    In an unpacked sdist (it has PKG-INFO at the top), that is every file in
    it. In the repository, it is what hatchling selects: the files the sdist
    include patterns match, minus the exclude patterns, plus the files
    hatchling always adds (pyproject.toml, .gitignore, the readme and the
    license files). Files .gitignore leaves out are not subtracted here, so
    in a working copy the gate can only read more files than ship, never
    fewer; in a clean checkout the two lists are the same.
    """
    if (root / "PKG-INFO").is_file():
        return list(_walk(root))
    for extra in ("hatch.toml", "hatch_build.py"):
        assert not (root / extra).exists(), f"the gate doesn't read {extra} yet"
    config = build_config((root / "pyproject.toml").read_text(encoding="utf-8"))
    include = [_glob(p) for p in config["include"]]
    exclude = [_glob(p) for p in config["exclude"]]
    assert include, "the sdist has no include patterns, so the gate can't tell what ships"
    selected = {
        path for path in _walk(root)
        if any(p.match(path) for p in include) and not any(p.match(path) for p in exclude)
    }
    for forced in ("pyproject.toml", ".gitignore", config["readme"], *config["license-files"]):
        assert not re.search(r"[*?\[]", forced), f"the gate doesn't expand {forced!r}"
        if (root / forced).is_file():
            selected.add(forced)
    return sorted(selected)


def hits(data: bytes) -> list[tuple[int, str]]:
    """(line number, what) for each forbidden string in data."""
    found = []
    for what, pattern in FORBIDDEN:
        for m in pattern.finditer(data):
            found.append((data.count(b"\n", 0, m.start()) + 1, what))
    return sorted(found)


def test_gate_reads_the_build_config():
    """The regex reading of pyproject.toml agrees with a real TOML parser, and knows every hatch setting there."""
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    config = build_config(text)
    try:
        import tomllib
    except ImportError:  # Python 3.10: the regex reading is all there is
        assert config["include"] and config["readme"]
        return
    data = tomllib.loads(text)
    project = data["project"]
    sdist = data["tool"]["hatch"]["build"]["targets"]["sdist"]
    assert config == {
        "readme": project["readme"],
        "license-files": project.get("license-files", []),
        "include": sdist.get("include", []),
        "exclude": sdist.get("exclude", []),
    }
    for name, allowed in KNOWN_HATCH_KEYS.items():
        table = data
        for part in name.split("."):
            table = table.get(part, {})
        assert set(table) <= allowed, f"the gate doesn't know {name} keys {sorted(set(table) - allowed)}"


def test_gate_reads_what_ships():
    """The file list is not empty and holds what the sdist must hold, and nothing the build config leaves out."""
    files = shipped_files(ROOT)
    for must in (
        "pyproject.toml", ".gitignore", "README.md", "CHANGELOG.md", "LICENSE", "rules/LICENSE",
        "docs/PYPI_README.md", "rules/biasclear-rules.json", "src/biasclear/_engine.py",
        "src/biasclear/data/biasclear-rules.json", "tests/test_release_gate.py",
    ):
        assert must in files, f"{must} ships in the sdist, but the gate doesn't read it"
    if (ROOT / "PKG-INFO").is_file():
        assert "PKG-INFO" in files
    else:
        for left_out in (".github/FUNDING.yml", "packages/engine/package-lock.json", "site/index.html"):
            assert left_out not in files, f"{left_out} doesn't ship, but the gate reads it"
        assert not [f for f in files if f.startswith("scripts/") and f.endswith((".mjs", ".d.mts"))]
    assert not [f for f in files if "__pycache__" in f.split("/") or COMPILED.search(f)]


def test_gate_finds_the_handle_and_the_link():
    """The gate is not blind: it finds the handle in any case and a Sponsors link, but not the citation's author line."""
    assert hits(b"x\n@" + HANDLE.upper().encode() + b"\n") == [(2, "personal GitHub handle")]
    assert hits(b"see https://" + SPONSORS.encode() + b"/someone") == [(1, "GitHub Sponsors link")]
    assert hits(b"[sponsor](https://www." + SPONSORS.upper().encode() + b"/x)") == [(1, "GitHub Sponsors link")]
    assert hits(b"https://" + SPONSORS.encode() + b"hip and more") == []
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    author = re.search(r"```bibtex\n.*?(author\s*=\s*\{[^}]*\})", readme, re.DOTALL)
    assert author, "README.md has no BibTeX author line"
    assert hits(author.group(1).encode()) == []
    assert hits(Path(__file__).read_bytes()) == []


def test_nothing_that_ships_names_the_personal_account():
    found = []
    for rel in shipped_files(ROOT):
        for line, what in hits((ROOT / rel).read_bytes()):
            found.append(f"{rel}:{line}: {what}")
    assert not found, "These would ship in the sdist for good:\n" + "\n".join(found)
