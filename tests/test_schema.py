"""The rule pack is valid, bundled unchanged, and hashed canonically."""

from __future__ import annotations

import hashlib
import json
import re

import jsonschema

import biasclear
from biasclear import rule_pack, scan
from conftest import PACK_PATH, PACKAGE_PACK_PATH, ROOT, SCHEMA_PATH, load_json


def test_schema_is_valid_json_schema():
    jsonschema.Draft202012Validator.check_schema(load_json(SCHEMA_PATH))


def test_pack_matches_schema(pack):
    validator = jsonschema.Draft202012Validator(load_json(SCHEMA_PATH))
    errors = sorted(validator.iter_errors(pack), key=lambda e: list(e.path))
    assert not errors, [f"{list(e.path)}: {e.message}" for e in errors]


def test_schema_rejects_an_unknown_field(pack):
    broken = json.loads(json.dumps(pack))
    broken["rules"][0]["weight"] = 3
    validator = jsonschema.Draft202012Validator(load_json(SCHEMA_PATH))
    assert list(validator.iter_errors(broken))


def test_rule_ids_are_unique(pack):
    ids = [r["id"] for r in pack["rules"]]
    assert len(ids) == len(set(ids))


def test_package_bundles_the_canonical_pack_byte_for_byte():
    assert PACKAGE_PACK_PATH.read_bytes() == PACK_PATH.read_bytes(), (
        "src/biasclear/data/biasclear-rules.json differs from rules/biasclear-rules.json; "
        "run: python scripts/sync_rules.py"
    )


def test_installed_package_reads_the_same_pack(pack):
    assert rule_pack() == pack


def test_rules_hash_is_sha256_of_canonical_json(pack):
    canonical = json.dumps(pack, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    result = scan("")
    assert result["rules_hash"] == expected
    assert result["rules_version"] == pack["rules_version"]


def test_pack_holds_no_floats(pack):
    """Keeps the canonical form (and so rules_hash) identical across languages."""
    def walk(value):
        if isinstance(value, float):
            raise AssertionError(f"float in pack: {value}")
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(pack)


def test_package_version_matches_pyproject():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    version = re.search(r'^version = "([^"]+)"$', text, re.MULTILINE).group(1)
    assert biasclear.__version__ == version


def test_pyproject_declares_no_runtime_dependencies():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r"^dependencies = \[\]$", text, re.MULTILINE)
