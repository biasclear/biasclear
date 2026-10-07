"""The README says only what is true today.

Its usage example runs and prints exactly what it shows; its shell command
works; every example move is marked by the rule it names; every number
matches the rule pack, the package and the tests; every relative link and
image resolves; and it names no one beyond the paper's citation.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import struct
import subprocess
import sys

import pytest

import biasclear
from biasclear import rule_pack, scan
from conftest import ROOT, require_repo_files

README = (ROOT / "README.md").read_text(encoding="utf-8")
CHANGELOG = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
ROMAN = {"I": 1, "II": 2, "III": 3}


def section(title: str) -> str:
    m = re.search(rf"^## {re.escape(title)}\n(.*?)(?=^## |\Z)", README, re.DOTALL | re.MULTILINE)
    assert m, f"README has no '## {title}' section"
    return m.group(1)


def test_readme_example_output():
    m = re.search(r"```python\n(.*?)```\s*```text\n(.*?)```", README, re.DOTALL)
    assert m, "README needs a python block followed by a text block with its output"
    code, expected = m.group(1), m.group(2)
    assert len(code.strip().splitlines()) <= 5
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(compile(code, "README.md", "exec"), {})
    assert out.getvalue() == expected


def test_readme_shell_commands_work(tmp_path):
    shell = section("Install and use")
    assert 'echo "Studies show this works." | python -m biasclear\n' in shell
    assert "python -m biasclear --domain all < draft.txt\n" in shell
    env = {**os.environ, "PYTHONPATH": str(ROOT / "src")}
    run = subprocess.run(
        [sys.executable, "-m", "biasclear"], input=b"Studies show this works.\n",
        capture_output=True, env=env, cwd=tmp_path, check=True,
    )
    result = json.loads(run.stdout)
    assert [(m["rule_id"], m["match"]) for m in result["moves"]] == [("CLAIM_WITHOUT_CITATION", "Studies show")]
    run = subprocess.run(
        [sys.executable, "-m", "biasclear", "--domain", "all"], input="Sources close to the deal say it is dead.".encode(),
        capture_output=True, env=env, cwd=tmp_path, check=True,
    )
    assert json.loads(run.stdout)["moves"]


def test_readme_examples_are_marked_by_the_rules_they_name():
    require_repo_files("site/data/moves.json")
    names = json.loads((ROOT / "site" / "data" / "moves.json").read_text(encoding="utf-8"))["moves"]
    by_name = {v["name"]: k for k, v in names.items()}
    pack = rule_pack()
    tier_of = {r["id"]: r["pit_tier"] for r in pack["rules"]}
    tier, seen = None, {1: 0, 2: 0, 3: 0}
    for line in section("What it catches").splitlines():
        head = re.match(r"\*\*Tier (I{1,3}), (\w+): .+\.\*\*$", line)
        if head:
            tier = ROMAN[head.group(1)]
            assert head.group(2) == pack["tiers"][str(tier)]["name"].lower()
            continue
        item = re.match(r'- (.+?): "(.+)"$', line)
        if not item:
            continue
        name, quoted = item.groups()
        assert name in by_name, f"{name!r} is not a move name in site/data/moves.json"
        rule_id = by_name[name]
        spans = re.findall(r"\*\*(.+?)\*\*", quoted)
        assert len(spans) == 1, quoted
        text = quoted.replace("**", "")
        moves = [(m["rule_id"], m["match"]) for m in scan(text)["moves"]]
        assert moves == [(rule_id, spans[0])], f"{text!r} gives {moves}"
        assert tier_of[rule_id] == tier, f"{name} is listed under the wrong tier"
        seen[tier] += 1
    assert all(n >= 2 for n in seen.values()), seen


def test_readme_numbers_match_the_pack_the_package_and_the_tests():
    import test_symmetry as sym

    pack = rule_pack()
    rules = pack["rules"]
    general = sum(1 for r in rules if r["domain"] == "general")
    version = pack["rules_version"]
    template_pairs = len(sym.PAIRS)
    swapped = sum(len(p) for p in sym.ENTITY_PAIRS.values()) + len(sym.LABEL_PAIRS)
    for phrase in (
        f"It is an alpha: {len(rules)} rules, rules version {version}.",
        f"{len(rules)} rules, sorted into three tiers",
        f"The {general} general rules run on every text; {len(rules) - general} more are for legal, news and financial writing.",
        f"**{template_pairs:,} swapped pairs**, built from {swapped} pairs of names and labels",
        f"**{len(sym.RED_TEAM):,} more pairs** from red-team reviews",
        f"**{len(sym.KNOWN_LIMITS)} known limits**",
        f"**{len(sym.RETIRED_PAIRS)} retired pairs**",
        f"The Python package is version {biasclear.__version__} and the rules are version {version}",
    ):
        assert phrase in README, f"README should say: {phrase}"


@pytest.mark.parametrize("doc", ["README.md", "CHANGELOG.md", "rules/RULE_CHANGES.md"])
def test_limit_counts_match_the_tests(doc):
    """Known limits and retired pairs are quoted as scripts/site_facts.py counts them; an older count is dated."""
    import test_symmetry as sym

    text = (ROOT / doc).read_text(encoding="utf-8")
    current = {"known limits": len(sym.KNOWN_LIMITS), "retired pairs": len(sym.RETIRED_PAIRS)}
    for what, n in current.items():
        assert re.search(rf"\b{n}\*{{0,2}} {what}\b", text) or re.search(rf"\b{n} {what}\b", text), (
            f"{doc} should give the {what}: {n}"
        )
    for m in re.finditer(r"\b(\d[\d,]*)\*{0,2} (known limits|retired pairs)\b", text):
        if int(m.group(1).replace(",", "")) != current[m.group(2)]:
            assert "(measured 20" in text[m.end():m.end() + 80], f"{doc}: {m.group(0)!r} is neither the current count nor dated"


def test_changelog_quotes_the_symmetry_counts():
    import test_symmetry as sym

    swapped = sum(len(p) for p in sym.ENTITY_PAIRS.values()) + len(sym.LABEL_PAIRS)
    assert f"{swapped} pairs of names and labels, {len(sym.PAIRS):,} template pairs" in CHANGELOG


def _slug(heading: str) -> str:
    return re.sub(r"[^\w\- ]", "", heading.strip().lower()).replace(" ", "-")


def test_readme_links_and_images_resolve():
    require_repo_files("site", "packages/engine", "docs/img", ".github")
    anchors = {_slug(h) for h in re.findall(r"^#{1,6} (.+)$", README, re.MULTILINE)}
    targets = re.findall(r"\]\(([^)\s]+)\)", README) + re.findall(r'(?:src|srcset)="([^"]+)"', README)
    assert targets
    for target in targets:
        if re.match(r"(https?:|mailto:)", target):
            continue
        path, _, fragment = target.partition("#")
        if not path:
            assert fragment in anchors, f"no heading for #{fragment}"
            continue
        assert not path.startswith("/"), f"use a path relative to the repository root: {target}"
        assert (ROOT / path).exists(), f"README links to a missing file: {target}"


def _png_size(path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", data[16:24])


def test_readme_and_social_preview_images():
    require_repo_files("docs/img")
    for name in ("hero.png", "hero-dark.png"):
        assert _png_size(ROOT / "docs" / "img" / name) == _png_size(ROOT / "docs" / "img" / "hero.png")
    card = ROOT / "docs" / "img" / "social-preview.png"
    # GitHub's social preview: 1280x640 recommended, under 1 MB.
    assert _png_size(card) == (1280, 640)
    assert card.stat().st_size < 1_000_000




def _test_names() -> set[str]:
    """Names the symmetry tests and the lint use as inputs: parties, outlets, schools, agencies, faiths."""
    import test_neutrality_lint as lint
    import test_symmetry as sym

    names = set()
    for pairs in sym.ENTITY_PAIRS.values():
        for pair in pairs:
            for name in pair:
                bare = re.sub(r"^the ", "", name)
                if re.search(r"[A-Z]", bare):
                    names.add(bare)
    for word in lint.KNOWN_PROPER_NOUNS - lint.CALENDAR_TERMS:
        names.update({word.capitalize(), word.upper()})
    return names


@pytest.mark.parametrize("doc", ["README.md", "CHANGELOG.md"])
def test_names_no_one_beyond_the_citation(doc):
    text = README if doc == "README.md" else CHANGELOG
    for m in re.finditer(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", text):
        assert m.group(0) == "hello@biasclear.com", m.group(0)
    rest = re.sub(r"```bibtex\n.*?```", "", text, flags=re.DOTALL)
    # The author's name is read from the citation, so this test does not spell it.
    author = re.search(r"```bibtex\n.*?author\s*=\s*\{([^}]*)\}", README, re.DOTALL).group(1)
    for name in re.findall(r"\w+", author):
        assert not re.search(rf"\b{re.escape(name)}\b", rest, re.IGNORECASE), f"{doc} names the author outside the citation"
    # Test inputs (tests/, rules/RULE_CHANGES.md) use made-up names of people,
    # parties, organizations and outlets; the front door and the changelog
    # describe changes by their structure.
    found = sorted(n for n in _test_names() if re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", rest))
    assert not found, f"{doc} names {found}"


def test_repo_settings_fit_github():
    require_repo_files("docs/REPO_SETTINGS.md")
    doc = (ROOT / "docs" / "REPO_SETTINGS.md").read_text(encoding="utf-8")

    def block(label: str) -> str:
        m = re.search(rf"\*\*{label}\*\*[^\n]*\n\n```text\n(.*?)\n```", doc, re.DOTALL)
        assert m, f"docs/REPO_SETTINGS.md has no text block after **{label}**"
        return m.group(1)

    description = block("Description")
    assert "\n" not in description and len(description) < 120
    assert f"**Description** ({len(description)} characters)" in doc
    assert block("Website:") == "https://biasclear.com/"
    topics = block("Topics").split("\n")
    assert 6 <= len(topics) <= 10 and len(set(topics)) == len(topics)
    assert f"**Topics** ({len(topics)})" in doc
    for topic in topics:
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]{0,49}", topic), topic


def test_pypi_readme_links_are_absolute_and_its_example_runs():
    """PyPI shows docs/PYPI_README.md, and a description can't be edited after upload.

    So its links are absolute (a repository-relative link is broken on
    pypi.org), it says nothing that stops being true once the package is on
    PyPI ("coming with the first release"), and its example prints what it
    shows.
    """
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r'^readme = "docs/PYPI_README.md"$', pyproject, re.MULTILINE)
    doc = (ROOT / "docs" / "PYPI_README.md").read_text(encoding="utf-8")
    targets = re.findall(r"\]\(([^)\s]+)\)", doc) + re.findall(r'(?:src|srcset)="([^"]+)"', doc)
    assert targets
    for target in targets:
        assert re.match(r"https://(github\.com/biasclear/biasclear|biasclear\.com/)", target), target
    for stale in ("coming", "until then", "not on npm", "from source", "first release"):
        assert stale not in doc.lower(), stale
    m = re.search(r"```python\n(.*?)```\s*```text\n(.*?)```", doc, re.DOTALL)
    assert m
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        exec(compile(m.group(1), "PYPI_README.md", "exec"), {})
    assert out.getvalue() == m.group(2)
    for addr in re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", doc):
        assert addr == "hello@biasclear.com", addr


def test_front_door_points_at_the_site():
    """The README, the PyPI readme and the package's Homepage point at biasclear.com.

    CHANGELOG.md says so, and the PyPI readme and Homepage can't be edited
    after upload, so the old preview address must not come back.
    """
    for name in ("README.md", "docs/PYPI_README.md", "pyproject.toml"):
        assert "github.io" not in (ROOT / name).read_text(encoding="utf-8"), name
    assert "](https://biasclear.com/)" in README
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r'^Homepage = "https://biasclear\.com"$', pyproject, re.MULTILINE)
