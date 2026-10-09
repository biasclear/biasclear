"""Offline model evidence/selector tests. No AWS API or external transport."""
from pathlib import Path
import json
import subprocess
import pytest

HERE = Path(__file__).resolve().parent

def node(code):
    return subprocess.run(["node", "--input-type=module", "-e", code], cwd=HERE.parent.parent, capture_output=True, text=True)

def test_reviewed_regions_cli_never_guesses_a_selector():
    for key in ["grok47", "sonnet55", "sol61"]:
        r = subprocess.run(["node", str(HERE / "model-table.mjs"), "--regions", key], capture_output=True, text=True)
        assert r.returncode == 0 and r.stdout == "us-east-1\nus-east-2\nus-west-2\n"
    r = subprocess.run(["node", str(HERE / "model-table.mjs"), "--regions", "unknown"], capture_output=True, text=True)
    assert r.returncode != 0 and not r.stdout

def test_every_live_model_is_blocked_on_its_missing_evidence():
    r = node('import {modelTable} from "./infra/aws/model-table.mjs"; import {modelReadiness} from "./infra/aws/readiness.mjs"; process.stdout.write(JSON.stringify(Object.values(modelTable().models).map(m=>({key:m.key,reasons:modelReadiness(m.key)}))));')
    assert r.returncode == 0, r.stderr
    for entry in json.loads(r.stdout):
        assert "Converse billed reasoning accounting is unverified" in entry["reasons"]
        assert "model-specific input token framing bound is unverified" in entry["reasons"]

@pytest.mark.parametrize("mutation", [
    'table["us.xai.grok-4.7"].reasoningAccounting.state="maybe"',
    'delete table["us.xai.grok-4.7"].reasoningAccounting.checkedOn',
    'table["us.xai.grok-4.7"].inputTokenBound.state="yes"',
    'table["us.xai.grok-4.7"].inputTokenBound.framingTokens=-1',
    'delete table["us.xai.grok-4.7"].source.priceCheckedOn',
    'table["us.xai.grok-4.7"].destinationRegions=["us-east-1","eu-west-1","us-west-2"]',
])
def test_parser_rejects_incomplete_or_unreviewed_evidence(mutation):
    code = '''import {readFileSync} from "node:fs";
import {modelTable,MODEL_SOURCE} from "./infra/aws/model-table.mjs";
const source=readFileSync(MODEL_SOURCE,"utf8");
const start=source.indexOf("const MODEL_TABLE = ")+"const MODEL_TABLE = ".length;
const end=source.indexOf(";\\n// END_REVIEWED_MODEL_TABLE",start);
const table=JSON.parse(source.slice(start,end));
''' + mutation + ''';
try {modelTable(source.slice(0,start)+JSON.stringify(table)+source.slice(end)); process.exitCode=1;} catch {process.stdout.write("rejected");}'''
    r=node(code)
    assert r.returncode == 0 and r.stdout == "rejected", r.stderr
