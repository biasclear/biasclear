"""``python -m biasclear``: read UTF-8 text on stdin, print the scan as JSON."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional, Sequence

from . import __version__
from ._engine import DOMAINS, MAX_INPUT_CHARS, rule_pack, scan


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m biasclear",
        description="Read UTF-8 text on stdin and print the structural moves it makes, as JSON.",
    )
    parser.add_argument(
        "--domain",
        choices=DOMAINS,
        default=None,
        help="add a domain's rules to the general rules ('all' runs every rule)",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"biasclear {__version__} (rules {rule_pack()['rules_version']})",
    )
    args = parser.parse_args(argv)

    # Read bytes and decode them as strict UTF-8 ourselves, so the result
    # doesn't depend on the locale or on Python's stdin error handler (which
    # can be surrogateescape), and line endings reach scan() unchanged.
    # A UTF-8 character is at most 4 bytes, so more bytes than this means
    # more characters than the limit.
    max_bytes = 4 * MAX_INPUT_CHARS
    data = sys.stdin.buffer.read(max_bytes + 1)
    text: Optional[str] = None
    if len(data) <= max_bytes:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            print(f"biasclear: could not decode stdin: {exc}", file=sys.stderr)
            return 2
    if text is None or len(text) > MAX_INPUT_CHARS:
        print(
            f"biasclear: input is longer than {MAX_INPUT_CHARS} characters",
            file=sys.stderr,
        )
        return 2

    result = scan(text, domain=args.domain)
    sys.stdout.write(json.dumps(result, indent=2, ensure_ascii=True) + "\n")
    return 0
