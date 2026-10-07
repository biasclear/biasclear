"""Importing biasclear, scanning, and running the CLI touch nothing outside
the process: no files written, no network, no subprocesses, no logging.

The check runs in a fresh interpreter with an audit hook installed before
biasclear is imported, in an empty temporary working directory.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import biasclear

GUARD = r'''
import io, json, os, runpy, sys

WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
BLOCKED = (
    "socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn", "os.spawn",
    "os.fork", "os.forkpty", "os.kill", "os.mkdir", "os.remove", "os.rmdir", "os.rename",
    "os.symlink", "os.link", "os.truncate", "os.chmod", "os.chown", "os.utime",
    "os.putenv", "os.unsetenv", "shutil.", "urllib.", "http.", "ftplib.", "smtplib.",
    "poplib.", "imaplib.", "nntplib.", "telnetlib.", "ctypes.", "sqlite3.", "webbrowser.",
)
events = []

def hook(event, args):
    if event == "open":
        path, mode, flags = args
        writes = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
            isinstance(flags, int) and flags & WRITE_FLAGS)
        if writes:
            events.append(f"open for writing: {path!r}")
            raise PermissionError("blocked by test")
    elif event.startswith(BLOCKED):
        events.append(event)
        raise PermissionError(f"{event} blocked by test")

sys.addaudithook(hook)

import socket
def no_network(*args, **kwargs):
    events.append("socket use")
    raise PermissionError("network blocked by test")
socket.socket = no_network
socket.create_connection = no_network
socket.getaddrinfo = no_network

TEXT = "Everyone agrees we must act now. Studies show it. " * 50
import biasclear
result = biasclear.scan(TEXT, domain="all")

real_stdin, real_stdout = sys.stdin, sys.stdout
sys.stdin = io.TextIOWrapper(io.BytesIO(TEXT.encode("utf-8")), encoding="utf-8")
sys.stdout = io.StringIO()
try:
    runpy.run_module("biasclear", run_name="__main__", alter_sys=True)
    code = None
except SystemExit as exc:
    code = exc.code
cli_out = sys.stdout.getvalue()
sys.stdin, sys.stdout = real_stdin, real_stdout

print(json.dumps({
    "events": events,
    "moves": len(result["moves"]),
    "cli_code": code,
    "cli_moves": len(json.loads(cli_out)["moves"]),
    "logging_imported": "logging" in sys.modules,
}))
'''


def run_guarded(script: str, cwd: Path) -> subprocess.CompletedProcess:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(Path(biasclear.__file__).resolve().parent.parent),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    if "SYSTEMROOT" in os.environ:  # Windows needs it to start Python
        env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
    return subprocess.run(
        [sys.executable, "-B", "-s", "-c", script],
        cwd=cwd, env=env, capture_output=True, text=True, timeout=120,
    )


def test_no_files_no_network_no_logging(tmp_path: Path):
    proc = run_guarded(GUARD, tmp_path)
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout.strip().splitlines()[-1])
    assert report["events"] == []
    assert report["moves"] > 0
    assert report["cli_code"] == 0
    assert report["cli_moves"] == report["moves"]
    assert report["logging_imported"] is False
    assert list(tmp_path.iterdir()) == []


def test_guard_would_catch_a_write(tmp_path: Path):
    """The audit hook itself works: a write attempt is recorded and blocked."""
    probe = GUARD.replace(
        "import biasclear\n",
        "import biasclear\ntry:\n    open('probe.txt', 'w')\nexcept PermissionError:\n    pass\n",
        1,
    )
    proc = run_guarded(probe, tmp_path)
    report = json.loads(proc.stdout.strip().splitlines()[-1])
    assert any("probe.txt" in e for e in report["events"])
    assert list(tmp_path.iterdir()) == []
