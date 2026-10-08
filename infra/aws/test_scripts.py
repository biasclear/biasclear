"""Checks on the workflow's shell scripts (infra/aws/ops.sh, summary.sh).

They run against fake `aws`, `curl` and `gh` commands on PATH, so nothing
reaches AWS or GitHub. Each fake logs its arguments and answers from a small
state file. What they check is the scripts' own decisions: which calls are
made with which parameters, when a run stops, and what the owner reads.

    python -m pytest infra/aws/test_scripts.py -q

Needs bash, jq, git and node (the "explain" CI job has them).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
ROOT = HERE.parent.parent

pytestmark = pytest.mark.skipif(
    any(shutil.which(t) is None for t in ("bash", "jq", "git", "node")), reason="needs bash, jq, git and node"
)

FAKE_AWS = r'''
import json, os, sys
state_path = os.environ["FAKE_STATE"]
state = json.load(open(state_path))
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["aws"] + args) + "\n")
def save():
    json.dump(state, open(state_path, "w"))
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
cmd = " ".join(args[:2])
if cmd == "sts assume-role-with-web-identity":
    state["signins"] = state.get("signins", 0) + 1
    save()
    print(json.dumps({"AccessKeyId": "AKIDFAKE", "SecretAccessKey": "secretfake", "SessionToken": "tokenfake"}))
elif cmd == "cloudformation describe-stacks":
    if state.get("describeFails"):
        sys.stderr.write("An error occurred (Throttling): Rate exceeded\n")
        sys.exit(254)
    stack = state.get("stack")
    if stack is None:
        sys.stderr.write("An error occurred (ValidationError): Stack with id biasclear-explain does not exist\n")
        sys.exit(254)
    q = opt("--query", "")
    if "StackStatus" in q:
        print(stack["status"])
        # A change still running: each read moves it one step on ("later").
        if stack.get("later"):
            stack["status"] = stack["later"].pop(0)
            save()
    elif "ParameterKey=='Explain'" in q:
        print(stack["params"].get("Explain", "off"))
    elif "ParameterKey=='Model'" in q:
        print(stack["params"].get("Model", "grok47"))
    elif "Parameters[].ParameterKey" in q:
        print(json.dumps(list(stack["params"].keys())))
    elif "ApiUrl" in q:
        print("https://abc123def4.execute-api.us-east-1.amazonaws.com")
    else:
        print("{}")
elif cmd == "cloudformation delete-stack":
    state["stack"] = None
    save()
elif cmd in ("cloudformation wait",):
    pass
elif cmd == "cloudformation update-stack":
    params = json.load(open(opt("--parameters").replace("file://", "")))
    state.setdefault("updates", []).append(params)
    for p in params:
        if "ParameterValue" in p:
            state["stack"]["params"][p["ParameterKey"]] = p["ParameterValue"]
    save()
elif cmd == "cloudformation deploy":
    i = args.index("--parameter-overrides")
    overrides = []
    for a in args[i + 1:]:
        if a.startswith("--"):
            break
        overrides.append(a)
    state.setdefault("deploys", []).append(overrides)
    params = dict(o.split("=", 1) for o in overrides)
    state["stack"] = {"status": "UPDATE_COMPLETE", "params": params}
    save()
elif cmd == "s3 cp":
    pass
elif cmd == "bedrock get-model-invocation-logging-configuration":
    print(json.dumps(state.get("logging", {})))
elif cmd == "bedrock get-account-data-retention":
    if "--generate-cli-skeleton" in args:
        if state.get("oldCli"):
            sys.exit(2)
        print("{}")
    else:
        region = opt("--region", "us-east-1")
        if region in state.get("retentionReadFails", []):
            sys.exit(254)
        print(json.dumps({"mode": state.get("retentionByRegion", {}).get(region, state.get("retention", "none"))}))
elif cmd == "lambda invoke":
    payload = json.load(open(opt("--payload").replace("file://", "")))
    out = [a for a in args[2:] if not a.startswith("-") and a not in (opt("--function-name"), opt("--cli-binary-format"), opt("--payload"), opt("--cli-read-timeout"), opt("--cli-connect-timeout"), opt("--output"))][-1]
    n = state.get("invokes", 0)
    state["invokes"] = n + 1
    state.setdefault("payloads", []).append(payload)
    save()
    fail_at = state.get("invokeFailAt")
    if fail_at is not None and n >= fail_at:
        sys.stderr.write("An error occurred (ExpiredTokenException): The security token included in the request is expired\n")
        sys.exit(254)
    replies = state.get("replies", [])
    reply = replies[min(n, len(replies) - 1)] if replies else {"status": 200, "body": {}, "evaluation": {}}
    json.dump(reply, open(out, "w"))
    print(json.dumps({"StatusCode": 200, "ExecutedVersion": "$LATEST"}))
else:
    sys.stderr.write("fake aws: unexpected " + cmd + "\n")
    sys.exit(2)
'''

FAKE_CURL = r'''
import json, os, sys
args = sys.argv[1:]
state = json.load(open(os.environ["FAKE_STATE"]))
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["curl"] + [a for a in args if not a.startswith("/dev/fd")]) + "\n")
url = [a for a in args if a.startswith("http")][-1]
def opt(name):
    return args[args.index(name) + 1] if name in args else None
if "audience=sts.amazonaws.com" in url:
    print(json.dumps({"value": "oidc-token"}))
    sys.exit(0)
if url.endswith("/data-retention"):
    region = url.split(".")[1]
    if region in state.get("retentionReadFails", []):
        sys.exit(22)
    print(json.dumps({"mode": state.get("retentionByRegion", {}).get(region, state.get("retention", "none"))}))
    sys.exit(0)
if url.endswith("/v1/explain"):
    posts = state.get("posts", [])
    body = open(opt("--data-binary")[1:]).read()
    n = state.get("postCount", 0)
    state["postCount"] = n + 1
    state.setdefault("postBodies", []).append(json.loads(body))
    json.dump(state, open(os.environ["FAKE_STATE"], "w"))
    status, reply, cors = posts[min(n, len(posts) - 1)]
    open(opt("-o"), "w").write(json.dumps(reply))
    open(opt("-D"), "w").write("HTTP/2 %d\r\ncontent-type: application/json\r\n%s\r\n" % (status, ("access-control-allow-origin: %s\r\n" % cors) if cors else ""))
    sys.stdout.write(str(status))
    sys.exit(0)
sys.stderr.write("fake curl: unexpected " + url + "\n")
sys.exit(2)
'''

FAKE_GH = r'''
import json, os, subprocess, sys
args = sys.argv[1:]
state = json.load(open(os.environ["FAKE_STATE"]))
assert args[0] == "api"
path = args[1]
expr = args[args.index("--jq") + 1]
data = state["gh"].get(path)
if data is None:
    sys.stderr.write("gh: not found " + path + "\n")
    sys.exit(1)
r = subprocess.run(["jq", "-r", expr], input=json.dumps(data), capture_output=True, text=True)
sys.stdout.write(r.stdout)
sys.exit(r.returncode)
'''

FAKE_DATE = r'''
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
t = state.get("clock", 1_800_000_000)
state["clock"] = t + state.get("tick", 0)
json.dump(state, open(os.environ["FAKE_STATE"], "w"))
print(t)
'''


@pytest.fixture
def fake(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, code in (("aws", FAKE_AWS), ("curl", FAKE_CURL), ("gh", FAKE_GH), ("date", FAKE_DATE)):
        script = bin_dir / name
        script.write_text(f"#!/usr/bin/env python3\n{code}")
        script.chmod(0o755)
    state_file = tmp_path / "state.json"
    log_file = tmp_path / "log.jsonl"
    summary_file = tmp_path / "summary.md"
    env_file = tmp_path / "github_env"

    class Fake:
        path = tmp_path

        def state(self, **kw):
            state_file.write_text(json.dumps(kw))

        def read_state(self):
            return json.loads(state_file.read_text())

        def calls(self, prefix=None):
            if not log_file.exists():
                return []
            out = [json.loads(line) for line in log_file.read_text().splitlines()]
            return [c for c in out if prefix is None or c[: len(prefix)] == prefix]

        def summary(self):
            return summary_file.read_text() if summary_file.exists() else ""

        def github_env(self):
            return env_file.read_text() if env_file.exists() else ""

        def run(self, script, *args, cwd=ROOT, extra_env=None):
            env = {
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "HOME": str(tmp_path),
                "FAKE_STATE": str(state_file),
                "FAKE_LOG": str(log_file),
                "GITHUB_STEP_SUMMARY": str(summary_file),
                "GITHUB_ENV": str(env_file),
                "ACCOUNT": "123456789012",
                "ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.example/?x=1",
                "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "request-token",
                "AWS_REGION": "us-east-1",
                **(extra_env or {}),
            }
            return subprocess.run(["bash", str(HERE / script), *args], cwd=cwd, env=env, capture_output=True, text=True)

    return Fake()


def stack(status="UPDATE_COMPLETE", switch="off"):
    return {"status": status, "params": {"Explain": switch, "EvaluationKey": "", "MonthlyCapUsd": "25", "DailyPercent": "10", "Model": "grok47"}}


# ---- ops.sh: before a deploy ---------------------------------------------


def test_prepare_on_a_first_deploy_records_the_switch_as_off(fake):
    fake.state(stack=None)
    r = fake.run("ops.sh", "prepare")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "PREV_SWITCH=off" in fake.github_env()
    assert "first deploy" in fake.summary()


def test_prepare_keeps_the_switch_as_it_is(fake):
    fake.state(stack=stack(switch="on"))
    r = fake.run("ops.sh", "prepare")
    assert r.returncode == 0
    assert "PREV_SWITCH=on" in fake.github_env()


def test_prepare_deletes_an_empty_stack_left_by_a_failed_first_deploy(fake):
    # RT: a ROLLBACK_COMPLETE stack made every later deploy fail.
    fake.state(stack=stack("ROLLBACK_COMPLETE"))
    r = fake.run("ops.sh", "prepare")
    assert r.returncode == 0, r.stdout + r.stderr
    deletes = fake.calls(["aws", "cloudformation", "delete-stack"])
    assert len(deletes) == 1
    assert "arn:aws:iam::123456789012:role/biasclear-explain-cloudformation" in deletes[0]
    assert "PREV_SWITCH=off" in fake.github_env()


@pytest.mark.parametrize("status", ["UPDATE_ROLLBACK_FAILED", "DELETE_FAILED"])
def test_prepare_stops_on_a_stuck_stack_and_says_to_tell_the_pm(fake, status):
    fake.state(stack=stack(status))
    r = fake.run("ops.sh", "prepare")
    assert r.returncode == 1
    assert "stuck" in fake.summary() and "Tell the PM" in fake.summary()
    assert not fake.calls(["aws", "cloudformation", "delete-stack"])


def test_prepare_stops_while_another_change_runs(fake):
    fake.state(stack=stack("UPDATE_IN_PROGRESS"))
    r = fake.run("ops.sh", "prepare")
    assert r.returncode == 1
    assert "still running" in fake.summary()


@pytest.mark.parametrize(
    "logging,retention,want,ok",
    [
        ({}, "none", "none", True),
        ({"loggingConfig": {"s3Config": {"bucketName": "b"}}}, "none", "none", False),
        ({}, "default", "none", False),
        ({}, "default", "default", False),
    ],
)
def test_settings(fake, logging, retention, want, ok):
    fake.state(logging=logging, retention=retention)
    r = fake.run("ops.sh", "settings", want)
    assert (r.returncode == 0) is ok, r.stdout + r.stderr


@pytest.mark.parametrize("region", ["us-east-1", "us-east-2", "us-west-2"])
def test_settings_rejects_retention_drift_in_any_processing_region(fake, region):
    fake.state(logging={}, retention="none", retentionByRegion={region: "aws_review"})
    result = fake.run("ops.sh", "settings", "none")
    assert result.returncode == 1
    assert region in fake.summary()


def test_settings_rejects_an_unreadable_destination(fake):
    fake.state(logging={}, retention="none", retentionReadFails=["us-west-2"])
    result = fake.run("ops.sh", "settings", "none")
    assert result.returncode == 1
    assert "could not read Bedrock retention in us-west-2" in fake.summary()


def test_settings_reads_source_logging_and_every_reviewed_retention_region(fake):
    fake.state(logging={}, retention="none")
    result = fake.run("ops.sh", "settings", "none")
    assert result.returncode == 0, result.stdout + result.stderr
    calls = fake.calls()
    logging = [call for call in calls if call[:3] == ["aws", "bedrock", "get-model-invocation-logging-configuration"]]
    assert len(logging) == 1
    assert logging[0][logging[0].index("--region") + 1] == "us-east-1"
    reads = [call for call in calls if call[:3] == ["aws", "bedrock", "get-account-data-retention"] and "--output" in call]
    assert [call[call.index("--region") + 1] for call in reads] == ["us-east-1", "us-east-2", "us-west-2"]


def test_settings_unknown_selector_stops_before_credentials(fake):
    fake.state(logging={}, retention="none")
    result = fake.run("ops.sh", "settings", "none", extra_env={"MODEL": "unreviewed"})
    assert result.returncode == 1
    assert fake.read_state().get("signins", 0) == 0
    assert fake.calls(["aws"]) == []


def test_settings_old_cli_checks_each_retention_region_with_signed_read_only_get(fake):
    fake.state(logging={}, retention="none", oldCli=True)
    result = fake.run("ops.sh", "settings", "none")
    assert result.returncode == 0, result.stdout + result.stderr
    reads = [call for call in fake.calls(["curl"]) if any(arg.endswith("/data-retention") for arg in call)]
    assert len(reads) == 3
    assert [next(arg for arg in call if arg.endswith("/data-retention")) for call in reads] == [
        f"https://bedrock.{region}.amazonaws.com/data-retention" for region in ("us-east-1", "us-east-2", "us-west-2")
    ]
    assert all("-X" not in call for call in reads)


# ---- ops.sh: deploy ------------------------------------------------------


def smoke_file(tmp_path):
    p = tmp_path / "smoke.json"
    p.write_text(json.dumps({
        "rule": "CONSENSUS_AS_EVIDENCE",
        "notAMark": {"v": 1, "sentence": "The meeting starts at nine."},
        "marked": {"v": 1, "sentence": "Everyone agrees the Harlan plan will cut rents within two years."},
    }))
    z = tmp_path / "explain.zip"
    z.write_bytes(b"zip bytes")
    return z, p


GOOD = {"v": 1, "rule": "CONSENSUS_AS_EVIDENCE", "how": 'The words "Everyone agrees" ask for trust.', "plainer": None, "model": "Claude Sonnet 5", "rules": "x"}


def test_deploy_passes_every_reviewed_default_and_only_then_the_run_s_own_values(fake):
    # RT: parameters left out kept their previous values, so a reviewed change
    # to a default (RetentionMode, the origins, the limits) never reached AWS.
    z, s = smoke_file(fake.path)
    fake.state(stack=stack(switch="off"), posts=[[422, {"v": 1, "error": "invalid"}, None], [200, GOOD, "https://biasclear.com"]],
               replies=[{"status": 200, "body": GOOD, "evaluation": {}}])
    r = fake.run("ops.sh", "deploy", str(z), str(s))
    assert r.returncode == 0, r.stdout + r.stderr
    [overrides] = fake.read_state()["deploys"]
    params = dict(o.split("=", 1) for o in overrides)
    defaults = subprocess.run(["node", str(HERE / "deploy-params.mjs")], capture_output=True, text=True, check=True).stdout.split()
    for d in defaults:
        assert d in overrides
    assert params["Explain"] == "on"
    assert params["CodeKey"].startswith("explain/") and params["CodeKey"].endswith(".zip")
    assert len(params["EvaluationKey"]) == 64
    assert "MonthlyCapUsd" not in params
    # The direct test call carried this run's key.
    assert fake.read_state()["payloads"][0]["key"] == params["EvaluationKey"]
    assert "Explain works end to end" in fake.summary()


def test_deploy_passes_a_typed_cap(fake):
    z, s = smoke_file(fake.path)
    fake.state(stack=stack(), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    r = fake.run("ops.sh", "deploy", str(z), str(s), "7")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "MonthlyCapUsd=7" in fake.read_state()["deploys"][0]


def test_deploy_never_prints_the_api_address(fake):
    # RT: the address went into the public run summary before switch-on.
    z, s = smoke_file(fake.path)
    fake.state(stack=stack(), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    r = fake.run("ops.sh", "deploy", str(z), str(s))
    assert r.returncode == 0
    for text in (r.stdout, r.stderr, fake.summary()):
        assert "abc123def4" not in text
        assert "execute-api" not in text


def test_deploy_says_in_plain_words_when_the_model_needs_another_retention_setting(fake):
    # RT: the guide's fallback promised a message that didn't exist.
    z, s = smoke_file(fake.path)
    fake.state(stack=stack(), posts=[[422, {}, None]], replies=[{"status": 503, "body": {"v": 1, "error": "paused"}, "evaluation": {"code": "E_MODEL_RETENTION"}}])
    r = fake.run("ops.sh", "deploy", str(z), str(s))
    assert r.returncode == 1
    assert "zero data retention" in fake.summary()
    assert "no default or review retention fallback" in fake.summary()


def test_deploy_stops_when_a_non_mark_is_not_refused(fake):
    z, s = smoke_file(fake.path)
    fake.state(stack=stack(), posts=[[200, GOOD, "https://biasclear.com"]])
    r = fake.run("ops.sh", "deploy", str(z), str(s))
    assert r.returncode == 1
    assert "should be refused with 422" in fake.summary()
    assert not fake.read_state().get("invokes")


def test_deploy_refuses_a_cap_out_of_range(fake):
    z, s = smoke_file(fake.path)
    fake.state(stack=stack())
    r = fake.run("ops.sh", "deploy", str(z), str(s), "30")
    assert r.returncode == 1
    assert not fake.calls(["aws", "cloudformation", "deploy"])


# ---- ops.sh: switch, restore, remove -------------------------------------


def test_switch_changes_the_switch_clears_the_key_and_keeps_the_rest(fake):
    fake.state(stack=stack(switch="on"))
    r = fake.run("ops.sh", "switch", "off")
    assert r.returncode == 0, r.stdout + r.stderr
    [params] = fake.read_state()["updates"]
    by_key = {p["ParameterKey"]: p for p in params}
    assert by_key["Explain"] == {"ParameterKey": "Explain", "ParameterValue": "off"}
    assert by_key["EvaluationKey"] == {"ParameterKey": "EvaluationKey", "ParameterValue": ""}
    assert by_key["MonthlyCapUsd"] == {"ParameterKey": "MonthlyCapUsd", "UsePreviousValue": True}
    assert "--use-previous-template" in fake.calls(["aws", "cloudformation", "update-stack"])[0]


def test_resume_refuses_a_selected_model_that_is_not_the_active_stack_model(fake):
    fake.state(stack=stack(switch="off"))
    r = fake.run("ops.sh", "switch", "on", extra_env={"MODEL": "sonnet55"})
    assert r.returncode == 1
    assert "resume model differs" in fake.summary()
    assert fake.read_state()["stack"]["params"]["Explain"] == "off"
    assert not fake.read_state().get("updates")


def test_evaluate_refuses_mismatched_model_without_switching_or_calling(fake):
    req = requests_file(fake.path, 1)
    fake.state(stack=stack(switch="off"))
    r = fake.run("ops.sh", "evaluate", str(req), str(fake.path / "raw.jsonl"), extra_env={"MODEL": "sonnet55"})
    assert r.returncode == 1
    assert "evaluation model differs" in fake.summary()
    assert not fake.read_state().get("updates")
    assert not fake.read_state().get("invokes")


# ---- 306 e: a model change can't reuse consent naming another maker ------


def stack_with(model, switch):
    s = stack(switch=switch)
    s["params"]["Model"] = model
    return s


def consent_of(model):
    return subprocess.run(["node", str(HERE / "model-table.mjs"), "--consent", model], capture_output=True, text=True, check=True).stdout.strip()


def site_config(tmp_path, api, model="grok47", consent=None):
    p = tmp_path / "explain.json"
    p.write_text(json.dumps({"api": api, "rules": [], "retention": "none", "model": model, "consent": consent_of(model) if consent is None else consent}))
    return {"EXPLAIN_SITE_CONFIG": str(p)}


def test_deploy_refuses_another_model_while_explain_is_on(fake):
    # The 306 case: on with Grok, then prepare, deploy MODEL=sonnet55 and restore on left visitors on Sonnet.
    z, s = smoke_file(fake.path)
    fake.state(stack=stack_with("grok47", "on"), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    assert fake.run("ops.sh", "prepare").returncode == 0
    r = fake.run("ops.sh", "deploy", str(z), str(s), extra_env={"MODEL": "sonnet55"})
    assert r.returncode == 1
    assert "Explain is on with Grok 4.7, made by xAI, and this deploy selects Claude Sonnet 5.5, made by Anthropic" in fake.summary()
    assert "Run pause first" in fake.summary()
    assert not fake.read_state().get("deploys")
    assert not fake.calls(["aws", "s3"])
    assert fake.run("ops.sh", "restore", "on").returncode == 0
    assert fake.read_state()["stack"]["params"]["Model"] == "grok47"


def test_deploy_may_change_the_model_while_explain_is_off(fake):
    z, s = smoke_file(fake.path)
    fake.state(stack=stack_with("grok47", "off"), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    r = fake.run("ops.sh", "deploy", str(z), str(s), extra_env={"MODEL": "sonnet55"})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Model=sonnet55" in fake.read_state()["deploys"][0]


def test_deploy_resume_and_evaluate_refuse_a_model_the_published_consent_does_not_name(fake):
    z, s = smoke_file(fake.path)
    site = site_config(fake.path, "https://abc123.execute-api.us-east-1.amazonaws.com", model="grok47")
    req = requests_file(fake.path, 1)
    fake.state(stack=stack_with("sonnet55", "off"))
    for args in (("deploy", str(z), str(s)), ("switch", "on"), ("evaluate", str(req), str(fake.path / "raw.jsonl"))):
        r = fake.run("ops.sh", *args, extra_env={"MODEL": "sonnet55", **site})
        assert r.returncode == 1, args
        assert "the site's consent and privacy text name Grok 4.7, made by xAI, but this run selects Claude Sonnet 5.5, made by Anthropic" in fake.summary()
    assert not fake.calls(["aws"])  # refused before signing in
    assert not fake.read_state().get("updates") and not fake.read_state().get("deploys")


def test_published_consent_binds_only_while_the_site_offers_explain(fake):
    z, s = smoke_file(fake.path)
    fake.state(stack=stack_with("grok47", "off"), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    r = fake.run("ops.sh", "deploy", str(z), str(s), extra_env={"MODEL": "sonnet55", **site_config(fake.path, None, model="grok47")})
    assert r.returncode == 0, r.stdout + r.stderr
    fake.state(stack=stack_with("grok47", "off"))
    r = fake.run("ops.sh", "switch", "on", extra_env={"MODEL": "grok47", **site_config(fake.path, "https://abc123.execute-api.us-east-1.amazonaws.com")})
    assert r.returncode == 0, r.stdout + r.stderr


def test_public_smoke_call_carries_the_selected_model_s_consent_fingerprint(fake):
    # 314 M3: a visitor's request names the consent the page showed; the deploy's public test call does too.
    z, s = smoke_file(fake.path)
    fake.state(stack=stack_with("grok47", "off"), posts=[[422, {}, None], [200, GOOD, "https://biasclear.com"]], replies=[{"status": 200, "body": GOOD}])
    r = fake.run("ops.sh", "deploy", str(z), str(s), extra_env={"MODEL": "sonnet55"})
    assert r.returncode == 0, r.stdout + r.stderr
    bodies = fake.read_state()["postBodies"]
    assert bodies and all(b["consent"] == consent_of("sonnet55") for b in bodies)
    assert consent_of("sonnet55") != consent_of("grok47")
    # The direct (key-authorized) call needs none.
    assert "consent" not in fake.read_state()["payloads"][0]["request"]


def test_published_settings_must_carry_the_model_s_consent_fingerprint(fake):
    api = "https://abc123.execute-api.us-east-1.amazonaws.com"
    fake.state(stack=stack_with("grok47", "off"))
    for consent in ("", consent_of("sonnet55"), "c1-0000000000000000"):
        r = fake.run("ops.sh", "switch", "on", extra_env={"MODEL": "grok47", **site_config(fake.path, api, model="grok47", consent=consent)})
        assert r.returncode == 1, consent
        assert "don't carry the consent fingerprint for Grok 4.7, made by xAI" in fake.summary()
    assert not fake.calls(["aws"])
    r = fake.run("ops.sh", "switch", "on", extra_env={"MODEL": "grok47", **site_config(fake.path, api, model="grok47")})
    assert r.returncode == 0, r.stdout + r.stderr


def test_resume_and_evaluate_reject_unknown_model_before_sign_in(fake):
    req = requests_file(fake.path, 1)
    fake.state(stack=stack(switch="off"))
    for args in [("switch", "on"), ("evaluate", str(req), str(fake.path / "raw.jsonl"))]:
        r = fake.run("ops.sh", *args, extra_env={"MODEL": "unreviewed"})
        assert r.returncode == 1
    assert not fake.calls()


def test_restore_puts_the_first_deploy_back_to_off(fake):
    # RT: the first deploy switched Explain on and left it on.
    fake.state(stack=stack(switch="on"))
    r = fake.run("ops.sh", "restore", "off")
    assert r.returncode == 0
    assert fake.read_state()["stack"]["params"]["Explain"] == "off"
    assert fake.read_state()["stack"]["params"]["EvaluationKey"] == ""


def test_restore_is_quiet_when_there_is_no_service(fake):
    fake.state(stack=stack("ROLLBACK_COMPLETE"))
    r = fake.run("ops.sh", "restore", "off")
    assert r.returncode == 0
    assert "Nothing to switch back" in fake.summary()
    assert not fake.calls(["aws", "cloudformation", "update-stack"])


FAST = {"RESTORE_POLL_SECONDS": "0"}


@pytest.mark.parametrize("running", ["UPDATE_IN_PROGRESS", "CREATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"])
def test_restore_waits_for_a_change_still_running_then_switches_back(fake, running):
    # RT2: a cancelled deploy or evaluation left CloudFormation switching
    # Explain on; restore said "Nothing to switch back" and the run was green.
    s = stack(running, switch="on")
    s["params"]["EvaluationKey"] = "k" * 64
    s["later"] = [running, "UPDATE_COMPLETE"]
    fake.state(stack=s)
    r = fake.run("ops.sh", "restore", "off", extra_env=FAST)
    assert r.returncode == 0, r.stdout + r.stderr
    assert fake.read_state()["stack"]["params"]["Explain"] == "off"
    assert fake.read_state()["stack"]["params"]["EvaluationKey"] == ""
    assert "still running" in fake.summary() and "as it was before this run" in fake.summary()


def test_restore_fails_the_run_when_the_change_never_finishes(fake):
    fake.state(stack=stack("UPDATE_IN_PROGRESS", switch="on"))
    r = fake.run("ops.sh", "restore", "off", extra_env={**FAST, "RESTORE_POLLS": "3"})
    assert r.returncode == 1
    assert 'Run "pause" now' in fake.summary()
    assert not fake.calls(["aws", "cloudformation", "update-stack"])


@pytest.mark.parametrize("status", ["UPDATE_ROLLBACK_FAILED", "DELETE_FAILED"])
def test_restore_fails_the_run_on_a_stuck_stack(fake, status):
    fake.state(stack=stack(status, switch="on"))
    r = fake.run("ops.sh", "restore", "off", extra_env=FAST)
    assert r.returncode == 1
    assert "Tell the PM" in fake.summary()


def test_restore_fails_the_run_when_the_stack_cannot_be_read(fake):
    fake.state(stack=stack(switch="on"))
    # A describe-stacks failure other than "does not exist":
    state = fake.read_state()
    state["describeFails"] = True
    fake.state(**state)
    r = fake.run("ops.sh", "restore", "off", extra_env=FAST)
    assert r.returncode == 1
    assert 'Run "pause" now' in fake.summary()


def test_remove_says_the_count_survives(fake):
    fake.state(stack=stack())
    r = fake.run("ops.sh", "remove")
    assert r.returncode == 0
    assert "spending count stays" in fake.summary()


# ---- ops.sh: evaluate ----------------------------------------------------


def requests_file(tmp_path, n):
    p = tmp_path / "requests.jsonl"
    p.write_text("".join(json.dumps({"id": f"p{i:02d}", "part": "a", "sample": 0, "request": {"v": 1}}) + "\n" for i in range(n)))
    return p


def test_evaluate_stops_with_an_error_when_a_direct_call_fails(fake):
    # RT: an expired session turned every later call into a silent "failed
    # sample", and the run still passed.
    req = requests_file(fake.path, 5)
    out = fake.path / "raw.jsonl"
    fake.state(stack=stack(), invokeFailAt=2, replies=[{"status": 200, "body": GOOD, "evaluation": {}}])
    r = fake.run("ops.sh", "evaluate", str(req), str(out))
    assert r.returncode == 1
    lines = [json.loads(line) for line in out.read_text().splitlines()]
    assert len(lines) == 3
    assert lines[-1] == {"id": "p02", "part": "a", "sample": 0, "invokeFailed": 1}
    assert "direct call 3 of 5" in fake.summary()
    assert fake.read_state()["invokes"] == 3


def test_evaluate_signs_in_again_before_the_hour_is_up(fake):
    req = requests_file(fake.path, 6)
    out = fake.path / "raw.jsonl"
    # Each reading of the clock moves it on by 20 minutes.
    fake.state(stack=stack(), replies=[{"status": 200, "body": GOOD, "evaluation": {}}], tick=1200)
    r = fake.run("ops.sh", "evaluate", str(req), str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert fake.read_state()["signins"] >= 3
    assert len(out.read_text().splitlines()) == 6


def test_evaluate_switches_on_with_a_fresh_key_and_records_the_old_switch(fake):
    req = requests_file(fake.path, 2)
    out = fake.path / "raw.jsonl"
    fake.state(stack=stack(switch="off"), replies=[{"status": 200, "body": GOOD, "evaluation": {}}])
    r = fake.run("ops.sh", "evaluate", str(req), str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "PREV_SWITCH=off" in fake.github_env()
    [params] = fake.read_state()["updates"]
    key = {p["ParameterKey"]: p.get("ParameterValue") for p in params}["EvaluationKey"]
    assert len(key) == 64
    assert all(p["key"] == key for p in fake.read_state()["payloads"])


def test_evaluate_stops_cleanly_when_a_spend_limit_is_reached(fake):
    req = requests_file(fake.path, 5)
    out = fake.path / "raw.jsonl"
    fake.state(stack=stack(), replies=[{"status": 200, "body": GOOD}, {"status": 503, "body": {"v": 1, "error": "paused"}, "evaluation": {"code": "E_HEADROOM"}}])
    r = fake.run("ops.sh", "evaluate", str(req), str(out))
    assert r.returncode == 0
    assert len(out.read_text().splitlines()) == 2
    assert "Stopped after 2 of 5" in fake.summary()


# ---- summary.sh: the last deploy -----------------------------------------


@pytest.fixture
def repo(tmp_path):
    """A small repository: three commits, the last two touching Explain files."""
    d = tmp_path / "repo"
    d.mkdir()
    git = lambda *a: subprocess.run(["git", *a], cwd=d, check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    git("init", "-q", "-b", "main")
    git("config", "user.email", "noreply@example.org")
    git("config", "user.name", "Test")
    (d / "README.md").write_text("x\n")
    git("add", ".")
    git("commit", "-q", "-m", "first")
    first = git("rev-parse", "HEAD")
    (d / "packages/explain/src").mkdir(parents=True)
    (d / "packages/explain/src/app.ts").write_text("x\n")
    git("add", ".")
    git("commit", "-q", "-m", "change the function")
    second = git("rev-parse", "HEAD")
    (d / "infra/aws").mkdir(parents=True)
    (d / "infra/aws/setup.yaml").write_text("x\n")
    git("add", ".")
    git("commit", "-q", "-m", "No Explain files changed since the last deploy ```")
    return d, first, second, git("rev-parse", "HEAD")


BOT = "github-actions[bot]"


def gh_state(deployments):
    """deployments: list of (id, sha, state, run title, branch, aws job conclusion[, overrides]).

    overrides: "creator" and "status_creator" (default github-actions[bot]),
    "run_id" (the run the status points at, default 1000 + id) and "run_sha"
    (that run's commit, default the deployment's)."""
    gh = {"repos/o/r/deployments?environment=explain-aws&per_page=100": [
        {"id": d[0], "sha": d[1], "creator": {"login": (d[6] if len(d) > 6 else {}).get("creator", BOT)}} for d in deployments
    ]}
    for dep in deployments:
        dep_id, _sha, state, title, branch, aws = dep[:6]
        o = dep[6] if len(dep) > 6 else {}
        run_id = o.get("run_id", 1000 + dep_id)
        gh[f"repos/o/r/deployments/{dep_id}/statuses?per_page=1"] = [
            {"state": state, "log_url": f"https://github.com/o/r/actions/runs/{run_id}/job/{run_id * 10}",
             "creator": {"login": o.get("status_creator", BOT)}}
        ]
        if "run_id" in o:
            continue
        gh[f"repos/o/r/actions/runs/{run_id}"] = {
            "display_title": title, "event": "workflow_dispatch", "path": ".github/workflows/explain.yml",
            "head_branch": branch, "head_sha": o.get("run_sha", _sha),
        }
        gh[f"repos/o/r/actions/runs/{run_id}/jobs?per_page=100"] = {"jobs": [{"name": "aws", "conclusion": aws}]}
    return gh


def run_summary(fake, cwd):
    return fake.run("summary.sh", cwd=cwd, extra_env={"ACTION": "deploy", "CAP": "", "REF": "refs/heads/main", "GH_REPO": "o/r", "GH_TOKEN": "x"})


def test_summary_lists_the_explain_files_changed_since_the_last_real_deploy(fake, repo):
    d, first, _second, _third = repo
    fake.state(gh=gh_state([(1, first, "success", "Explain (AWS): deploy", "main", "success")]))
    r = run_summary(fake, d)
    assert r.returncode == 0, r.stdout + r.stderr
    s = fake.summary()
    assert "packages/explain/src/app.ts" in s and "infra/aws/setup.yaml" in s
    assert first[:12] in s
    # A commit subject can't pose as the summary's own words or break out of its block.
    assert "No Explain files changed since the last deploy ???" in s
    assert s.count("```") == 4


def test_summary_ignores_a_deployment_made_through_the_api_that_points_at_an_older_real_run(fake, repo):
    # RT2: a deployment for main's HEAD, created through the REST API, whose
    # status points at an older genuine deploy run, emptied the list.
    d, first, _second, third = repo
    real = (1, first, "success", "Explain (AWS): deploy", "main", "success")
    forged = (2, third, "success", "Explain (AWS): deploy", "main", "success",
              {"creator": "owner", "status_creator": "owner", "run_id": 1001})
    fake.state(gh=gh_state([forged, real]))
    r = run_summary(fake, d)
    assert r.returncode == 0, r.stdout + r.stderr
    s = fake.summary()
    assert first[:12] in s and third[:12] not in s
    assert "packages/explain/src/app.ts" in s and "No Explain files changed since the last deploy (" not in s


@pytest.mark.parametrize("override", [
    {"run_sha": "0" * 40},                     # the deployment's commit isn't its run's commit
    {"creator": "owner"},                      # the deployment wasn't made by GitHub Actions
    {"status_creator": "owner"},               # its success status wasn't set by GitHub Actions
])
def test_summary_ignores_a_deployment_not_bound_to_its_run(fake, repo, override):
    d, _first, _second, third = repo
    fake.state(gh=gh_state([(1, third, "success", "Explain (AWS): deploy", "main", "success", override)]))
    r = run_summary(fake, d)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Could not find the last deploy" in fake.summary()


def test_summary_marks_rule_and_move_name_changes_as_data_the_pm_may_merge(fake, repo):
    d, _first, _second, third = repo
    git = lambda *a: subprocess.run(["git", *a], cwd=d, check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    (d / "rules").mkdir()
    (d / "rules/biasclear-rules.json").write_text("{}\n")
    git("add", ".")
    git("commit", "-q", "-m", "a rule change")
    fake.state(gh=gh_state([(1, third, "success", "Explain (AWS): deploy", "main", "success")]))
    r = run_summary(fake, d)
    assert r.returncode == 0, r.stdout + r.stderr
    s = fake.summary()
    assert "No Explain code changed since the last deploy" in s
    assert "rules/biasclear-rules.json" in s and "The PM may have merged them without you" in s


def test_summary_ignores_a_deploy_run_whose_aws_job_was_skipped_or_off_main(fake, repo):
    # RT: a "deploy" dispatched on another branch finished as a successful run
    # with its aws job skipped, and emptied the list of changes.
    d, first, _second, third = repo
    fake.state(gh=gh_state([
        (3, third, "success", "Explain (AWS): deploy", "main", "skipped"),
        (2, third, "success", "Explain (AWS): deploy", "throwaway", "success"),
        (4, third, "success", "Explain (AWS): pause", "main", "success"),
        (5, third, "failure", "Explain (AWS): deploy", "main", "failure"),
        (1, first, "success", "Explain (AWS): deploy", "main", "success"),
    ]))
    r = run_summary(fake, d)
    assert r.returncode == 0, r.stdout + r.stderr
    s = fake.summary()
    assert "No Explain files changed" not in s.split("```")[0]
    assert "packages/explain/src/app.ts" in s


def test_summary_ignores_a_deploy_of_a_commit_not_on_main(fake, repo):
    d, _first, _second, _third = repo
    fake.state(gh=gh_state([(1, "0" * 40, "success", "Explain (AWS): deploy", "main", "success")]))
    r = run_summary(fake, d)
    assert r.returncode == 0
    assert "Could not find the last deploy" in fake.summary()


def test_summary_says_so_when_it_cannot_find_the_last_deploy(fake, repo):
    d, *_ = repo
    fake.state(gh=gh_state([]))
    r = run_summary(fake, d)
    assert r.returncode == 0
    s = fake.summary()
    assert "Could not find the last deploy" in s
    assert "This is the first deploy." not in s


def test_summary_names_the_selected_model_and_the_consent_stop(fake, repo):
    d, *_ = repo
    fake.state(gh=gh_state([]))
    for action in ("deploy", "resume", "evaluate"):
        r = fake.run("summary.sh", cwd=d, extra_env={"ACTION": action, "CAP": "", "MODEL": "sonnet55", "REF": "refs/heads/main", "GH_REPO": "o/r", "GH_TOKEN": "x"})
        assert r.returncode == 0, r.stdout + r.stderr
        assert "Model: **Claude Sonnet 5.5, made by Anthropic**." in fake.summary()
    assert "changing makers needs a pause and consent that names the new one first" in fake.summary()


def test_summary_warns_when_the_model_is_not_passed(fake, repo):
    d, *_ = repo
    fake.state(gh=gh_state([]))
    r = run_summary(fake, d)
    assert r.returncode == 0
    assert "The model isn't named here" in fake.summary()


def test_summary_refuses_a_cap_out_of_range(fake, repo):
    d, *_ = repo
    fake.state(gh=gh_state([]))
    r = fake.run("summary.sh", cwd=d, extra_env={"ACTION": "deploy", "CAP": "26", "REF": "refs/heads/main", "GH_REPO": "o/r", "GH_TOKEN": "x"})
    assert r.returncode == 1


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="needs shellcheck")
def test_shellcheck():
    subprocess.run(["shellcheck", str(HERE / "ops.sh"), str(HERE / "summary.sh")], check=True)


def test_scripts_are_what_the_workflow_runs():
    wf = (ROOT / ".github/workflows/explain.yml").read_text()
    assert "bash infra/aws/ops.sh" in wf and "bash infra/aws/summary.sh" in wf
    # The approval summary names the model the run selects (306 e).
    summary_step = wf.split("- name: Say what this run will do", 1)[1].split("run: bash infra/aws/summary.sh", 1)[0]
    assert "MODEL: ${{ inputs.model }}" in summary_step
    # The credentialed job installs nothing from npm.
    aws_job = wf.split("\n  aws:\n", 1)[1].split("\n  report:\n", 1)[0]
    code = "\n".join(line for line in aws_job.splitlines() if not line.lstrip().startswith("#"))
    assert "npm" not in code and "node_modules" not in code
    assert "dist/ops.mjs" not in code
    assert "id-token: write" in aws_job
    assert "environment: explain-aws" in aws_job
    # No other job can sign in to AWS or waits in the environment.
    others = wf.split("\n  aws:\n", 1)[0] + wf.split("\n  report:\n", 1)[1]
    others = "\n".join(line for line in others.splitlines() if not line.lstrip().startswith("#"))
    assert "id-token" not in others
    assert "environment:" not in others
    assert "secrets." not in wf



def test_offline_owner_policy_gate_rejects_current_rules_and_accepts_only_proposed_rules(tmp_path):
    # The owner's rule files stay unchanged in this draft. The pre-AWS gate
    # refuses them; the exact proposed patch passes only in a temporary fixture.
    fixture = tmp_path / "owner-policy"
    (fixture / ".github").mkdir(parents=True)
    for name in ("AGENTS.md", ".github/CODEOWNERS"):
        shutil.copyfile(ROOT / name, fixture / name)
    module = (HERE / "readiness.mjs").as_uri()
    def reasons():
        script = f'import {{ownerPolicyStatus}} from "{module}"; process.stdout.write(JSON.stringify(ownerPolicyStatus(process.argv[1])));'
        return json.loads(subprocess.run(["node", "--input-type=module", "-e", script, str(fixture)], capture_output=True, text=True, check=True).stdout)
    assert reasons(), "unchanged policy must refuse live AWS work"
    subprocess.run(["git", "apply", "--unsafe-paths", str(ROOT / "handoff/explain/OWNER-RULES.patch")], cwd=fixture, check=True)
    assert reasons() == []
    for path in ["packages/explain", "infra/aws", "packages/engine", "site/js/explain.js", "site/data/explain.json"]:
        assert path in (HERE / "summary.sh").read_text()

def test_workflow_runs_offline_policy_and_model_gate_before_any_aws_operation():
    workflow = (ROOT / ".github/workflows/explain.yml").read_text().split("\n  aws:\n",1)[1].split("\n  report:\n",1)[0]
    gate = workflow.index("node infra/aws/readiness.mjs")
    assert gate < workflow.index("bash infra/aws/ops.sh")
    assert "node infra/aws/model-table.mjs --check" in workflow
    result = subprocess.run(["node", str(HERE / "readiness.mjs"), "--model", "grok47"], capture_output=True, text=True)
    assert result.returncode == 1
    assert "billed total-output bound is unverified" in result.stderr
