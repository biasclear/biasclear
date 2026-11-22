"""The Claude plugin in plugins/biasclear/: its shape, its copy and its output.

The plugin carries a copy of the engine and of the rule pack. These tests fail
if that copy drifts from src/biasclear, if the plugin breaks a rule of the
Claude plugin directory that can be checked offline, or if its script stops
returning the engine's own marks.
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from biasclear import DOMAINS, MAX_INPUT_CHARS, rule_pack, scan

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "biasclear"
SKILL = PLUGIN / "skills" / "biasclear"
SCRIPT = SKILL / "scripts" / "biasclear_scan.py"

pytestmark = pytest.mark.skipif(
    not PLUGIN.is_dir(), reason="the Claude plugin is in the repository, not the sdist"
)

NAME = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
SAMPLE = (
    "Experts agree this is the only safe choice. Act now before it is too late! "
    "Everyone knows the other side is lying."
)


def run_script(*args: str, text: str | None = None, script: Path = SCRIPT, env: dict | None = None,
               isolated: bool = True) -> subprocess.CompletedProcess:
    command = [sys.executable] + (["-I"] if isolated else []) + [str(script), *args]
    return subprocess.run(
        command,
        input=None if text is None else text.encode("utf-8"),
        capture_output=True,
        timeout=120,
        check=False,
        env=env,
    )


def frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").split("\n")
    assert lines[0] == "---", "SKILL.md must open with front matter"
    end = lines.index("---", 1)
    fields = {}
    for line in lines[1:end]:
        key, sep, value = line.partition(":")
        assert sep and key.strip() == key and key, f"unexpected front matter line: {line!r}"
        fields[key] = value.strip()
    return fields


def tampered_copy(tmp_path: Path) -> Path:
    copy = tmp_path / "biasclear"
    shutil.copytree(SKILL, copy)
    return copy


# The plugin's shape --------------------------------------------------------


def test_manifest():
    card = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert NAME.match(card["name"])
    assert card["name"] not in {"claude", "anthropic", "official", "plugin", "mcp", "test"}
    for key in ("version", "description", "license", "homepage", "repository"):
        assert isinstance(card[key], str) and card[key]
    assert card["author"]["name"]
    assert card["license"] == "Apache-2.0 AND CC-BY-4.0"
    assert card["homepage"].startswith("https://")
    assert card["network"] == {"hosts": []}
    assert (PLUGIN / card["icon"]).is_file()


def test_skill_front_matter():
    fields = frontmatter(SKILL / "SKILL.md")
    # Outside Claude Code, uploads accept only these keys.
    assert set(fields) <= {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
    assert fields["name"] == SKILL.name
    assert NAME.match(fields["name"]) and "claude" not in fields["name"] and "anthropic" not in fields["name"]
    assert 0 < len(fields["description"]) <= 1024
    assert "<" not in fields["description"] and ">" not in fields["description"]
    assert fields["license"] == "Apache-2.0 AND CC-BY-4.0"


def test_marketplace_lists_the_plugin():
    market = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))
    (entry,) = market["plugins"]
    assert entry["name"] == "biasclear"
    assert (ROOT / entry["source"] / ".claude-plugin" / "plugin.json").is_file()


def test_readme_and_licenses():
    readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
    prose = re.sub(r"```.*?```", "", readme, flags=re.S)
    assert len(prose.split()) >= 40
    assert "Python 3.9 or newer" in readme
    assert (PLUGIN / "LICENSE").read_bytes() == (ROOT / "LICENSE").read_bytes()
    assert (SKILL / "rules" / "LICENSE").read_bytes() == (ROOT / "rules" / "LICENSE").read_bytes()


def test_directory_file_rules():
    files = [p for p in PLUGIN.rglob("*") if p.is_file()]
    assert len(files) < 512
    for path in files:
        assert not path.is_symlink(), path
        assert path.name not in {".DS_Store", "Thumbs.db", "desktop.ini"}, path
        assert "__pycache__" not in path.parts, path
        assert path.stat().st_size < 256 * 1024, f"{path} is over 256 KiB"
        assert not re.search(r'[<>:"|?*]', path.name), path


def test_plugin_texts_name_no_one():
    import test_readme

    texts = [
        PLUGIN / "README.md", SKILL / "SKILL.md", PLUGIN / ".claude-plugin" / "plugin.json",
        ROOT / ".claude-plugin" / "marketplace.json", SCRIPT,
    ]
    author = re.search(r"```bibtex\n.*?author\s*=\s*\{([^}]*)\}", test_readme.README, re.DOTALL).group(1)
    names = test_readme._test_names()
    for path in texts:
        text = path.read_text(encoding="utf-8")
        for word in re.findall(r"\w+", author):
            assert not re.search(rf"\b{re.escape(word)}\b", text, re.IGNORECASE), f"{path.name} names the author"
        found = sorted(n for n in names if re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", text))
        assert not found, f"{path.name} names {found}"


def test_code_runs_on_python_39():
    # Many computers' python3 is 3.9; the plugin promises it.
    for path in (SCRIPT, SKILL / "engine" / "biasclear" / "_engine.py", SKILL / "engine" / "biasclear" / "__init__.py"):
        ast.parse(path.read_text(encoding="utf-8"), str(path), feature_version=(3, 9))


# The copy ------------------------------------------------------------------


def test_copy_matches_source():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "sync_claude_plugin.py"), "--check"],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_pack_manifest_records_the_bundled_pack():
    recorded = json.loads((SKILL / "rules" / "PACK.json").read_text(encoding="utf-8"))
    assert recorded["rules_hash"] == scan("")["rules_hash"]
    assert recorded["rules_version"] == rule_pack()["rules_version"]


def test_script_constants_match_the_engine():
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    values = {
        node.targets[0].id: ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id in {"DOMAINS", "MAX_CHARS"}
    }
    assert values == {"DOMAINS": DOMAINS, "MAX_CHARS": MAX_INPUT_CHARS}


# The script's output -------------------------------------------------------


@pytest.mark.parametrize("domain", [None, "media", "all"])
def test_script_returns_the_engines_marks(tmp_path, domain):
    source = tmp_path / "input.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    args = ["--file", str(source)] + ([] if domain is None else ["--domain", domain])
    result = run_script(*args)
    assert result.returncode == 0, result.stderr.decode()
    report = json.loads(result.stdout.decode("utf-8"))
    expected = scan(SAMPLE, domain=domain)
    assert report["rules_hash"] == expected["rules_hash"]
    assert [(m["rule_id"], m["start"], m["end"], m["text"]) for m in report["marks"]] == [
        (m["rule_id"], m["start"], m["end"], m["match"]) for m in expected["moves"]
    ]
    assert report["mark_count"] == len(expected["moves"]) > 0
    assert report["move_count"] == len(report["moves"]) == len({m["rule_id"] for m in expected["moves"]})
    assert all(move["what_it_does"] for move in report["moves"].values())
    # No severity label anywhere in what the plugin shows: it is unmeasured.
    assert "severity" not in result.stdout.decode("utf-8")
    assert report["reminders"]


def test_script_reads_stdin_and_handles_empty_text():
    report = json.loads(run_script(text=SAMPLE).stdout)
    assert report["mark_count"] == len(scan(SAMPLE)["moves"])
    empty = run_script(text="")
    assert empty.returncode == 0
    assert json.loads(empty.stdout)["mark_count"] == 0


def test_script_writes_utf8_on_any_console():
    text = "Typical Ωmegans. Everyone knows Ω is best."
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    result = run_script(text=text, env=env)
    assert result.returncode == 0, result.stderr.decode()
    report = json.loads(result.stdout.decode("utf-8"))
    assert [m["text"] for m in report["marks"]] == [m["match"] for m in scan(text)["moves"]]


def test_script_refuses_bad_input(tmp_path):
    too_long = run_script(text="a" * (MAX_INPUT_CHARS + 1))
    assert too_long.returncode == 2 and b"longer than" in too_long.stderr
    bad = tmp_path / "bad.txt"
    bad.write_bytes(b"\xff\xfe not utf-8")
    not_utf8 = run_script("--file", str(bad))
    assert not_utf8.returncode == 2 and b"UTF-8" in not_utf8.stderr
    missing = run_script("--file", str(tmp_path / "nope.txt"))
    assert missing.returncode == 2 and b"could not read" in missing.stderr


def test_script_refuses_a_changed_pack_before_running_it(tmp_path):
    copy = tampered_copy(tmp_path)
    shard = copy / "rules" / "rules-01.json"
    rules = json.loads(shard.read_text(encoding="utf-8"))
    rules[0]["indicators"] = ["(a+)+$"]  # catastrophic if it ever ran
    shard.write_text(json.dumps(rules), encoding="utf-8")
    result = run_script(text="a" * 40 + "!", script=copy / "scripts" / "biasclear_scan.py")
    assert result.returncode == 2 and b"fingerprint" in result.stderr


@pytest.mark.parametrize("damage", ["missing shard", "broken shard", "broken manifest"])
def test_script_refuses_a_damaged_pack(tmp_path, damage):
    copy = tampered_copy(tmp_path)
    if damage == "missing shard":
        (copy / "rules" / "rules-02.json").unlink()
    elif damage == "broken shard":
        (copy / "rules" / "rules-02.json").write_text("[{", encoding="utf-8")
    else:
        (copy / "rules" / "PACK.json").write_text("{}", encoding="utf-8")
    result = run_script(text=SAMPLE, script=copy / "scripts" / "biasclear_scan.py")
    assert result.returncode == 2 and b"missing or damaged" in result.stderr


def test_script_writes_nothing(tmp_path):
    # Not isolated (-I), as Claude may run it, and with a bytecode cache prefix
    # set. Python may cache its own startup modules there before the script's
    # first line runs; no compiled copy of the plugin's code may land anywhere,
    # and no temporary file may be left.
    cache = tmp_path / "pycache"
    scratch = tmp_path / "tmp"
    cache.mkdir()
    scratch.mkdir()
    env = dict(os.environ, PYTHONPYCACHEPREFIX=str(cache), TMPDIR=str(scratch))
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    result = run_script(text=SAMPLE, env=env, isolated=False)
    assert result.returncode == 0, result.stderr.decode()
    plugin_parts = PLUGIN.resolve().parts[1:]
    ours = [p for p in cache.rglob("*") if p.relative_to(cache).parts[: len(plugin_parts)] == plugin_parts]
    assert ours == []
    assert not [p for p in cache.rglob("*.pyc") if p.parent.name == "biasclear"]
    assert list(scratch.rglob("*")) == []
    assert not any(PLUGIN.rglob("__pycache__"))
