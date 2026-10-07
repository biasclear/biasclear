"""Print a built wheel's runtime requirements, one per line (none today).

Extras such as ``test`` are left out. CI feeds the output to pip-audit.

Usage:
    python scripts/wheel_requirements.py dist/biasclear-*.whl
"""

from __future__ import annotations

import sys
import zipfile
from email.parser import Parser


def runtime_requirements(wheel_path: str) -> list[str]:
    with zipfile.ZipFile(wheel_path) as wheel:
        name = next(n for n in wheel.namelist() if n.endswith(".dist-info/METADATA"))
        metadata = Parser().parsestr(wheel.read(name).decode("utf-8"))
    return [r for r in metadata.get_all("Requires-Dist") or [] if "extra ==" not in r]


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    for requirement in runtime_requirements(argv[0]):
        print(requirement)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
