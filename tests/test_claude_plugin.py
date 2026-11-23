"""The Claude plugin in plugins/biasclear/: its shape, its copy and its output.

The plugin carries a copy of the engine and of the rule pack. These tests fail
if that copy drifts from src/biasclear, if the plugin breaks a rule of the
Claude plugin directory that can be checked offline, or if its script stops
returning the engine's own marks.
"""

from __future__ import annotations

import ast
import importlib.util
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


def load_sync():
    spec = importlib.util.spec_from_file_location("sync_claude_plugin", ROOT / "scripts" / "sync_claude_plugin.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def semver_key(version: str) -> tuple:
    """SemVer precedence: build metadata ignored, a release above its pre-releases."""
    core = version.partition("+")[0]
    main, _, pre = core.partition("-")
    numbers = tuple(int(x) for x in main.split("."))
    if not pre:
        return (numbers, 1, ())
    return (numbers, 0, tuple((0, int(i), "") if i.isdigit() else (1, 0, i) for i in pre.split(".")))


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
    assert (PLUGIN / card["icon"]).is_file()
    # The directory accepts other fields, such as "network", only from
    # Verified organizations (its validation of 2026-11-21).
    assert set(card) <= {
        "name", "displayName", "version", "description", "author",
        "homepage", "repository", "license", "keywords", "icon",
    }


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


def test_plugin_holds_only_expected_files():
    # A stray file would ship with the plugin; the directory lists what it holds.
    sync = load_sync()
    expected = {p.relative_to(PLUGIN).as_posix() for p in sync.planned_files()} | set(sync.HAND_WRITTEN)
    found = {p.relative_to(PLUGIN).as_posix() for p in PLUGIN.rglob("*") if p.is_file() or p.is_symlink()}
    assert found == expected


def test_directory_file_rules():
    entries = list(PLUGIN.rglob("*"))
    assert not [p for p in entries if p.is_symlink()]  # dangling links included
    files = [p for p in entries if p.is_file()]
    assert len(files) < 512
    for path in files:
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


def test_plugin_version_changes_with_rules_and_files():
    # Claude Code updates an installed plugin when its version string changes.
    sync = load_sync()
    rules = ["2.0.0a5", "2.0.0a6", "2.0.0b1", "2.0.0rc1", "2.0.0", "2.0.1a5", "2.1.0a5"]
    packages = ["2.0.0a1", "2.0.0b1", "2.0.0rc1", "2.0.0", "2.0.1"]
    for versions in (
        [sync.plugin_version("2.0.0a1", r, "0" * 64) for r in rules],
        [sync.plugin_version(p, "2.0.0a5", "0" * 64) for p in packages],
    ):
        assert all(semver_key(a) < semver_key(b) for a, b in zip(versions, versions[1:])), versions
    assert sync.plugin_version("2.0.0a1", "2.0.0a5", "a" * 64) != sync.plugin_version("2.0.0a1", "2.0.0a5", "b" * 64)
    card = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert re.fullmatch(
        r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
        r"(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?"
        r"(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?",
        card["version"],
    ), card["version"]


def plugin_copy(tmp_path: Path) -> Path:
    for part in ("src", "rules", "plugins", "scripts"):
        shutil.copytree(ROOT / part, tmp_path / part, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(ROOT / "LICENSE", tmp_path / "LICENSE")
    return tmp_path


@pytest.mark.parametrize("change", [
    "SKILL.md", "biasclear_scan.py", "README.md", "icon.png", "plugin.json description",
    "engine source", "rule text", "rules version",
])
def test_any_plugin_change_changes_the_version(tmp_path, change):
    root = plugin_copy(tmp_path)
    sync_script = [sys.executable, str(root / "scripts" / "sync_claude_plugin.py")]
    plugin = root / "plugins" / "biasclear"
    skill = plugin / "skills" / "biasclear"
    card_path = plugin / ".claude-plugin" / "plugin.json"
    pack_path = root / "src" / "biasclear" / "data" / "biasclear-rules.json"
    assert subprocess.run(sync_script + ["--check"], capture_output=True, check=False).returncode == 0
    before = json.loads(card_path.read_text(encoding="utf-8"))["version"]
    if change == "plugin.json description":
        card = json.loads(card_path.read_text(encoding="utf-8"))
        card["description"] += " Changed."
        card_path.write_text(json.dumps(card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    elif change in ("rule text", "rules version"):
        pack = json.loads(pack_path.read_text(encoding="utf-8"))
        if change == "rule text":  # same rules_version, so only the files hash can move
            pack["rules"][-1]["description"] += " Changed."
        else:
            pack["rules_version"] += "1"
        pack_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        path = {
            "SKILL.md": skill / "SKILL.md",
            "biasclear_scan.py": skill / "scripts" / "biasclear_scan.py",
            "README.md": plugin / "README.md",
            "icon.png": plugin / "assets" / "icon.png",
            "engine source": root / "src" / "biasclear" / "_engine.py",
        }[change]
        path.write_bytes(path.read_bytes() + b"\n")
    result = subprocess.run(sync_script + ["--check"], capture_output=True, text=True, check=False)
    assert result.returncode == 1 and "plugin.json" in result.stdout, result.stdout
    subprocess.run(sync_script, capture_output=True, check=True)
    assert json.loads(card_path.read_text(encoding="utf-8"))["version"] != before


def test_check_reports_strays_anywhere_and_write_keeps_hand_placed_ones(tmp_path):
    root = plugin_copy(tmp_path)
    sync_script = [sys.executable, str(root / "scripts" / "sync_claude_plugin.py")]
    skill = root / "plugins" / "biasclear" / "skills" / "biasclear"
    (skill / "scripts" / "helper.py").write_text("x = 1\n", encoding="utf-8")
    (skill / "rules" / "stray.json").write_text("[]\n", encoding="utf-8")
    check = subprocess.run(sync_script + ["--check"], capture_output=True, text=True, check=False)
    assert check.returncode == 1 and "helper.py" in check.stdout and "stray.json" in check.stdout, check.stdout
    write = subprocess.run(sync_script, capture_output=True, text=True, check=False)
    assert write.returncode == 1 and "helper.py" in write.stdout, write.stdout
    assert (skill / "scripts" / "helper.py").exists()
    assert not (skill / "rules" / "stray.json").exists()


def test_check_refuses_a_symlink_even_at_an_expected_path(tmp_path):
    root = plugin_copy(tmp_path)
    link = root / "plugins" / "biasclear" / "skills" / "biasclear" / "rules" / "LICENSE"
    link.unlink()
    link.symlink_to(root / "rules" / "LICENSE")
    check = subprocess.run([sys.executable, str(root / "scripts" / "sync_claude_plugin.py"), "--check"],
                           capture_output=True, text=True, check=False)
    assert check.returncode == 1 and "LICENSE" in check.stdout, check.stdout


def test_sync_names_a_missing_hand_written_file(tmp_path):
    root = plugin_copy(tmp_path)
    (root / "plugins" / "biasclear" / "README.md").unlink()
    check = subprocess.run([sys.executable, str(root / "scripts" / "sync_claude_plugin.py"), "--check"],
                           capture_output=True, text=True, check=False)
    assert check.returncode == 1 and "missing hand-written plugin files: README.md" in check.stderr, check.stderr


def test_plugin_version_refuses_leading_zeros():
    sync = load_sync()
    for package, rules in (("2.0.0a01", "2.0.0a5"), ("2.0.0a1", "2.0.0a05"), ("02.0.0", "2.0.0a5"), ("2.0.0a1", "2.00.0")):
        with pytest.raises(SystemExit):
            sync.plugin_version(package, rules, "0" * 64)


def test_skill_quotes_the_real_limits():
    # Claude repeats these numbers to people.
    skill = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    assert f"{MAX_INPUT_CHARS:,} characters" in skill
    build_site = (ROOT / "scripts" / "build-site.mjs").read_text(encoding="utf-8")
    ui_max = int(re.search(r"export const UI_MAX = ([\d_]+);", build_site).group(1).replace("_", ""))
    assert f"{ui_max:,} characters" in skill


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
    # Windows writes piped output in the console's code page unless told not to.
    text = "Typical Ωmegans! Everyone knows Ω is best."
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    result = run_script(text=text, env=env, isolated=False)  # -I would ignore PYTHONIOENCODING
    assert result.returncode == 0, result.stderr.decode()
    report = json.loads(result.stdout.decode("utf-8"))
    assert [m["text"] for m in report["marks"]] == [m["match"] for m in scan(text)["moves"]]
    assert any("Ω" in m["text"] for m in report["marks"])


def test_output_starts_with_the_counts_and_ends_with_one_mark_per_line():
    out = run_script(text=SAMPLE).stdout.decode("utf-8")
    report = json.loads(out)
    assert list(report)[:7] == ["tool", "rules_version", "rules_hash", "domain", "characters", "mark_count", "move_count"]
    assert list(report)[-1] == "marks"
    mark_lines = [line for line in out.splitlines() if line.startswith('  {"text": ')]
    assert [json.loads(line.rstrip(",")) for line in mark_lines] == report["marks"]
    assert max(len(line) for line in out.splitlines()) < 1000


def test_marks_stay_on_one_line_for_any_line_splitter():
    # str.splitlines() also breaks at U+2028, U+2029 and NEL, which \s matches.
    text = "Everyone\x85agrees this is right. Either we act\u2028now or we lose everything."
    out = run_script(text=text).stdout.decode("utf-8")
    report = json.loads(out)
    assert any("\x85" in m["text"] or "\u2028" in m["text"] for m in report["marks"])
    mark_lines = [line for line in out.splitlines() if line.startswith('  {"text": ')]
    assert [json.loads(line.rstrip(",")) for line in mark_lines] == report["marks"]


def test_script_drops_a_leading_byte_order_mark(tmp_path):
    # Notepad and other Windows tools start UTF-8 files with a byte-order mark.
    source = tmp_path / "bom.txt"
    text = "Everyone agrees this is the only safe choice. Act now!"
    source.write_bytes(b"\xef\xbb\xbf" + text.encode("utf-8"))
    report = json.loads(run_script("--file", str(source)).stdout)
    assert report["characters"] == len(text)
    assert [(m["rule_id"], m["start"], m["end"]) for m in report["marks"]] == [
        (m["rule_id"], m["start"], m["end"]) for m in scan(text)["moves"]
    ]


def test_byte_order_mark_counts_toward_no_limit_and_no_error_offset(tmp_path):
    bom = b"\xef\xbb\xbf"
    # The limit is in characters: a mark plus the longest text still fits.
    longest = tmp_path / "longest.txt"
    longest.write_bytes(bom + "\U0001F600".encode("utf-8") * MAX_INPUT_CHARS)
    full = run_script("--file", str(longest))
    assert full.returncode == 0, full.stderr.decode()
    assert json.loads(full.stdout)["characters"] == MAX_INPUT_CHARS
    # A bad byte is named by its place in the file, mark included.
    bad = tmp_path / "bad.txt"
    bad.write_bytes(bom + b"ab\xff")
    refused = run_script("--file", str(bad))
    assert refused.returncode == 2 and b"at byte 5" in refused.stderr, refused.stderr.decode()


def test_script_loads_the_engine_without_touching_sys_path():
    # With a folder on sys.path, a stray file there could be imported in place
    # of a module the engine uses.
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    uses = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr == "path"
        and isinstance(node.value, ast.Name) and node.value.id == "sys"
    ]
    assert uses == []
    assert any(isinstance(node, ast.Attribute) and node.attr == "spec_from_file_location" for node in ast.walk(tree))


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


@pytest.mark.parametrize(
    "damage", [
        "missing shard", "broken shard", "deeply nested shard", "broken manifest",
        "missing engine file", "engine that fails on import",
    ]
)
def test_script_refuses_a_damaged_pack_or_engine(tmp_path, damage):
    copy = tampered_copy(tmp_path)
    if damage == "missing shard":
        (copy / "rules" / "rules-02.json").unlink()
    elif damage == "broken shard":
        (copy / "rules" / "rules-02.json").write_text("[{", encoding="utf-8")
    elif damage == "deeply nested shard":
        (copy / "rules" / "rules-02.json").write_text("[" * 200_000 + "]" * 200_000, encoding="utf-8")
    elif damage == "broken manifest":
        (copy / "rules" / "PACK.json").write_text("{}", encoding="utf-8")
    elif damage == "missing engine file":
        (copy / "engine" / "biasclear" / "_engine.py").unlink()
    else:
        (copy / "engine" / "biasclear" / "_engine.py").write_text("raise RuntimeError('damaged')\n", encoding="utf-8")
    result = run_script(text=SAMPLE, script=copy / "scripts" / "biasclear_scan.py")
    assert result.returncode == 2 and b"missing or damaged" in result.stderr, result.stderr.decode()


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
