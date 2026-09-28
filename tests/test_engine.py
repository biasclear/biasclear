"""Behavior of scan() and the CLI beyond v1 parity."""

from __future__ import annotations

import doctest
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

import biasclear
from biasclear import DOMAINS, MAX_INPUT_CHARS, scan
from biasclear import _cli, _engine

TEXT = "Everyone agrees we must act now. Either we pass this bill or the economy collapses."


# The ReDoS guards measure the best of three runs, as the TypeScript guard
# does, so one slow moment on a shared CI machine does not fail the check.
# The blow-ups they guard against took seconds to minutes; linear scans of
# these inputs take well under a second.
TIME_LIMIT = 3.0


def _best_of_three(fn) -> float:
    import time

    best = float("inf")
    for _ in range(3):
        start = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - start)
        if best < TIME_LIMIT / 10:
            break
    return best

def test_result_shape():
    result = scan(TEXT)
    assert list(result) == ["rules_version", "rules_hash", "moves", "counts"]
    assert re.fullmatch(r"[0-9a-f]{64}", result["rules_hash"])
    assert list(result["counts"]) == ["1", "2", "3"]
    assert sum(result["counts"].values()) == len(result["moves"])
    for move in result["moves"]:
        assert list(move) == ["rule_id", "name", "tier", "domain", "severity", "start", "end", "match"]
        assert move["match"] == TEXT[move["start"]:move["end"]]
        assert result["counts"][str(move["tier"])] > 0


def test_deterministic():
    assert scan(TEXT, "all") == scan(TEXT, "all")


def test_moves_are_sorted_by_start_then_longest():
    moves = scan(TEXT, "all")["moves"]
    keys = [(m["start"], m["start"] - m["end"]) for m in moves]
    assert keys == sorted(keys)


def test_none_means_general():
    assert scan(TEXT) == scan(TEXT, "general")


def test_domain_rules_only_run_when_asked():
    text = "It is well-settled law that this claim is plainly meritless."
    assert scan(text)["moves"] == []
    legal = {m["rule_id"] for m in scan(text, "legal")["moves"]}
    assert {"LEGAL_SETTLED_DISMISSAL", "LEGAL_MERIT_DISMISSAL"} <= legal
    assert scan(text, "media")["moves"] == []
    assert {m["rule_id"] for m in scan(text, "all")["moves"]} == legal


def test_unknown_domain_is_an_error():
    with pytest.raises(ValueError):
        scan(TEXT, "auto")
    assert "auto" not in DOMAINS


def test_input_cap():
    assert MAX_INPUT_CHARS == 200_000
    assert scan("a" * MAX_INPUT_CHARS)["moves"] == []
    with pytest.raises(ValueError):
        scan("a" * (MAX_INPUT_CHARS + 1))


def test_text_must_be_str():
    with pytest.raises(TypeError):
        scan(b"Everyone agrees.")  # type: ignore[arg-type]


def test_empty_text():
    assert scan("")["moves"] == []
    assert scan("")["counts"] == {"1": 0, "2": 0, "3": 0}


def test_offsets_are_code_points():
    text = "\U0001F642 Everyone agrees."
    move = scan(text)["moves"][0]
    assert (move["start"], move["end"]) == (2, 17)
    assert move["match"] == "Everyone agrees"


def _fake_engine(monkeypatch, rules):
    real = _engine._engine()
    fake = real._replace(rules=tuple(
        _engine._Rule(order=i, id=rid, name=rid, tier=tier, domain="general", severity="low",
                      indicators=tuple(re.compile(p) for p in patterns),
                      min_matches=1, suppress_if_cited=False)
        for i, (rid, tier, patterns) in enumerate(rules)
    ))
    monkeypatch.setattr(_engine, "_engine", lambda: fake)


def test_overlaps_within_a_rule_keep_the_earliest_then_longest(monkeypatch):
    _fake_engine(monkeypatch, [("R", 1, [r"ab", r"abc", r"bcd", r"d"])])
    moves = scan("abcd")["moves"]
    assert [(m["start"], m["end"]) for m in moves] == [(0, 3), (3, 4)]


def test_different_rules_may_overlap(monkeypatch):
    _fake_engine(monkeypatch, [("R1", 1, [r"abc"]), ("R2", 2, [r"bc"])])
    moves = scan("abcd")["moves"]
    assert [(m["rule_id"], m["start"], m["end"]) for m in moves] == [("R1", 0, 3), ("R2", 1, 3)]
    assert scan("abcd")["counts"] == {"1": 1, "2": 1, "3": 0}


def test_zero_length_matches_are_never_reported_or_counted(monkeypatch):
    _fake_engine(monkeypatch, [("EMPTY", 1, [r"\b", r"x*"])])
    assert scan("some words here")["moves"] == []


def test_citation_suppression():
    assert {m["rule_id"] for m in scan("Studies show that sleep helps.")["moves"]} == {
        "CLAIM_WITHOUT_CITATION"
    }
    assert scan("Studies show (Smith et al., 2024) that sleep helps.")["moves"] == []


def test_a_citation_counts_when_any_part_of_it_is_in_reach():
    # The window is 120 characters on each side of the claim. A citation that
    # starts or ends inside it counts, however long the name inside it is; one
    # wholly outside does not.
    name = "Center for " * 20 + "Studies"
    after = "Studies show that " + "sleep " * 17 + "(" + name + ", 2020)."
    before = "(" + name + ", 2020) " + "sleep " * 17 + "and studies show that sleep helps."
    assert scan(after)["moves"] == []
    assert scan(before)["moves"] == []
    far_after = "Studies show that " + "sleep " * 21 + "(" + name + ", 2020)."
    far_before = "(" + name + ", 2020) " + "sleep " * 21 + "and studies show that sleep helps."
    assert [m["rule_id"] for m in scan(far_after)["moves"]] == ["CLAIM_WITHOUT_CITATION"]
    assert [m["rule_id"] for m in scan(far_before)["moves"]] == ["CLAIM_WITHOUT_CITATION"]


@pytest.mark.parametrize("dash", ["\u2014", "\u2013"])
def test_citation_lookup_is_linear_on_dash_joined_names(dash):
    # Rules version 2.0.0a3: a name token in a citation no longer takes a
    # dash that the separator between names also takes, so a chain of
    # dash-joined names can be split one way only. Before, 30 tokens took
    # minutes (a ReDoS).
    scan("Studies show it works (Smith, 2024).")  # compile the rules first
    for claim in ("Studies show it works (", "Experts say it works ("):
        text = claim + dash.join(["A"] * 2000)
        assert _best_of_three(lambda: scan(text)) < TIME_LIMIT
        moves = scan(text)["moves"]
        assert [m["rule_id"] for m in moves] == ["CLAIM_WITHOUT_CITATION"]
    # dash-joined sources still read as a citation
    assert scan("Studies show it works (Smith" + dash + "Jones, 2024).")["moves"] == []


@pytest.mark.parametrize("unit", ["\u00e9", "\u00e9 ", "\u00e9, ", "A\u2019", "A\u2018", "\u738b "])
def test_citation_lookup_is_linear_on_non_ascii_names(unit):
    # Rules version 2.0.0a3, merged with the red team's fifth round: a
    # citation's name may hold any character outside ASCII, and each one has
    # one way to be read. In the fifth round's patterns a non-ASCII letter or
    # a curly quote could be read by either of two alternatives, so a run of
    # them could be read 2^n ways (a ReDoS).
    scan("Studies show it works (Smith, 2024).")  # compile the rules first
    for claim in ("Studies show it works (", "Experts say it works ("):
        text = claim + unit * 2000
        assert _best_of_three(lambda: scan(text)) < TIME_LIMIT
        moves = scan(text)["moves"]
        assert [m["rule_id"] for m in moves] == ["CLAIM_WITHOUT_CITATION"]
    # names in any script still read as citations
    assert scan("Studies show it works (\u00c9lan Voss 2019).")["moves"] == []
    assert scan("Studies show it works (\u738b\u2019s team, 12).")["moves"] == []


@pytest.mark.parametrize("mark", ["\u2019", "'", "&", "."])
def test_award_names_are_read_in_linear_time(mark):
    # Rules version 2.0.0a3: CREDENTIAL_AS_PREMISE read an award name before
    # "-winning" or "winner" from every word boundary inside a long run of
    # name characters, so 20,000 characters took seconds. The name now holds
    # up to 40 characters.
    scan("An award-winning chef says so.")  # compile the rules first
    text = "(" + ("A" + mark) * 10_000
    assert _best_of_three(lambda: scan(text, "all")) < TIME_LIMIT


# Sentence ends with a closing mark, quoted dialogue and bare whitespace.
SENTENCE_ENDS = ["A?\u201d ", "A.) ", "Dr.) ", "A.\" ", "\u201cWhy?\u201d \u201cYes.\u201d \u201cIs it done?\u201d ",
                 " ", "\n", "\t", "\u00a0"]


@pytest.mark.parametrize("unit", SENTENCE_ENDS)
def test_sentence_ends_and_whitespace_are_read_in_linear_time(unit):
    # Rules version 2.0.0a4: INSTITUTIONAL_POSITION_AS_SETTLED started a
    # sentence after '?\u201d ' while its sentence body read the same '?' as
    # mid-sentence, so every start ran to the end of the text (20,000
    # characters of '?\u201d ' took 16 s), and MEDIA_EMOTIONAL_LEAD split
    # leading whitespace two ways (20,000 spaces took over a minute).
    scan("The agency has concluded that it works.", "all")  # compile the rules first
    text = (unit * (20_000 // len(unit) + 1))[:20_000]
    assert _best_of_three(lambda: scan(text, "all")) < TIME_LIMIT


def test_leading_whitespace_before_a_long_first_sentence_is_linear():
    text = " " * 15_000 + "The plan is sound and people like it. " * 100
    assert _best_of_three(lambda: scan(text, "all")) < TIME_LIMIT
    # the lead is still read after leading whitespace
    assert [m["rule_id"] for m in scan("   Shocking news today: the plan failed.", "media")["moves"]] == [
        "MEDIA_EMOTIONAL_LEAD"
    ]


def test_min_matches():
    assert scan("Critics claimed it was late.", "media")["moves"] == []
    moves = scan("Critics claimed it was late, and they insisted it was rushed.", "media")["moves"]
    assert [m["rule_id"] for m in moves] == ["MEDIA_ASYMMETRIC_ATTRIBUTION"] * 2


def test_module_docstring_example():
    assert doctest.testmod(biasclear).failed == 0


def run_cli(monkeypatch, capsys, stdin: str | bytes, *args: str):
    data = stdin.encode("utf-8") if isinstance(stdin, str) else stdin
    # A lenient text layer, like the one some platforms give stdin: the CLI
    # must read the bytes underneath and decode them strictly itself.
    stream = io.TextIOWrapper(io.BytesIO(data), encoding="utf-8", errors="surrogateescape")
    monkeypatch.setattr("sys.stdin", stream)
    code = _cli.main(list(args))
    out, err = capsys.readouterr()
    return code, out, err


def test_cli_prints_the_scan_as_json(monkeypatch, capsys):
    code, out, err = run_cli(monkeypatch, capsys, TEXT)
    assert code == 0 and err == ""
    assert json.loads(out) == scan(TEXT)


def test_cli_domain(monkeypatch, capsys):
    code, out, _ = run_cli(monkeypatch, capsys, "This is plainly meritless.", "--domain", "legal")
    assert code == 0
    assert [m["rule_id"] for m in json.loads(out)["moves"]] == ["LEGAL_MERIT_DISMISSAL"]


@pytest.mark.parametrize("stdin", [
    "a" * (MAX_INPUT_CHARS + 1),
    "\u00e9" * (MAX_INPUT_CHARS + 1),  # two bytes each: over the limit in characters
    b"a" * (4 * MAX_INPUT_CHARS + 1),  # over the byte ceiling, rejected before decoding
], ids=["ascii", "two-byte", "byte-ceiling"])
def test_cli_rejects_long_input(monkeypatch, capsys, stdin):
    code, out, err = run_cli(monkeypatch, capsys, stdin)
    assert code == 2 and out == "" and "longer than" in err


def test_cli_accepts_input_at_the_limit(monkeypatch, capsys):
    text = "\U0001F600" * MAX_INPUT_CHARS  # four bytes each: exactly at both limits
    code, _, err = run_cli(monkeypatch, capsys, text)
    assert code == 0 and err == ""


def test_cli_rejects_invalid_utf8(monkeypatch, capsys):
    code, out, err = run_cli(monkeypatch, capsys, b"\xff bad")
    assert code == 2 and out == "" and "could not decode stdin" in err


def test_cli_rejects_invalid_utf8_whatever_the_locale(tmp_path):
    """The exit status doesn't depend on how Python sets up stdin."""
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(Path(biasclear.__file__).resolve().parent.parent),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8:surrogateescape",
        "LC_ALL": "C",
    }
    if "SYSTEMROOT" in os.environ:  # Windows needs it to start Python
        env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
    proc = subprocess.run(
        [sys.executable, "-B", "-s", "-m", "biasclear"],
        input=b"Everyone agrees. \xff bad", cwd=tmp_path, env=env,
        capture_output=True, timeout=120,
    )
    assert proc.returncode == 2, proc.stdout
    assert proc.stdout == b""
    assert b"could not decode stdin" in proc.stderr


def test_cli_keeps_line_endings(monkeypatch, capsys):
    text = "Some say it works.\r\nEveryone agrees we must act now.\r\n"
    code, out, _ = run_cli(monkeypatch, capsys, text)
    assert code == 0
    assert json.loads(out) == scan(text)


def test_cli_version(monkeypatch, capsys):
    with pytest.raises(SystemExit) as exc:
        run_cli(monkeypatch, capsys, "", "--version")
    assert exc.value.code == 0
    assert biasclear.__version__ in capsys.readouterr().out


@pytest.mark.parametrize("text", [
    ("some say " * 30000)[:MAX_INPUT_CHARS],
    ("x" * 250 + "however, " * 30000)[:MAX_INPUT_CHARS],
    ('"abc" ' * 40000)[:MAX_INPUT_CHARS],
])
def test_pathological_input_finishes(text):
    """A loose guard against catastrophic backtracking (about 1 s locally)."""
    import time

    start = time.perf_counter()
    scan(text, "all")
    assert time.perf_counter() - start < 30
