"""Copy the canonical rule pack into the Python package.

``rules/biasclear-rules.json`` is the one file people edit and review. The
Python package ships a byte-identical copy at
``src/biasclear/data/biasclear-rules.json`` so that installed, editable and
source-tree runs all find it. ``tests/test_schema.py`` fails if they differ.

Usage:
    python scripts/sync_rules.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "rules" / "biasclear-rules.json"
TARGET = ROOT / "src" / "biasclear" / "data" / "biasclear-rules.json"


def main() -> int:
    shutil.copyfile(SOURCE, TARGET)
    print(f"copied {SOURCE.relative_to(ROOT)} -> {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
