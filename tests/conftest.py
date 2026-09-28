from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PACK_PATH = ROOT / "rules" / "biasclear-rules.json"
PACKAGE_PACK_PATH = ROOT / "src" / "biasclear" / "data" / "biasclear-rules.json"
SCHEMA_PATH = ROOT / "rules" / "schema.json"
GOLDEN_PATH = ROOT / "tests" / "golden" / "v1_parity.json"
V2_GOLDEN_PATH = ROOT / "tests" / "golden" / "v2_parity.json"


def require_repo_files(*paths: str) -> None:
    """Skip a test that reads files only the repository has, not the sdist.

    The sdist ships the Python package, the rules, the tests and the Python
    scripts; the site, the TypeScript engine, the images and the GitHub
    settings stay in the repository, where these tests always run.
    """
    missing = [p for p in paths if not (ROOT / p).exists()]
    if missing:
        pytest.skip("needs the repository checkout, not the sdist: " + ", ".join(missing))


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def pack() -> dict:
    return load_json(PACK_PATH)


@pytest.fixture(scope="session")
def golden() -> dict:
    return load_json(GOLDEN_PATH)


@pytest.fixture(scope="session")
def v2_golden() -> dict:
    return load_json(V2_GOLDEN_PATH)
