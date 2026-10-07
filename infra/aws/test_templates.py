"""Checks on the two Explain templates (SPEC §16, "the template" and "the IAM").

Run with cfn-lint installed (it reads CloudFormation's short tags):

    python -m pytest infra/aws/test_templates.py -q

The repository's main pytest run (tests/) does not collect this file; the
"explain" CI job runs it next to cfn-lint.
"""

from __future__ import annotations

import fnmatch
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from cfnlint.decode import decode

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
TAGS = {"project": "biasclear", "feature": "explain"}
ORIGINS = {"https://biasclear.github.io", "https://biasclear.com"}


def load(name: str) -> dict:
    template, errors = decode(str(HERE / name))
    assert not errors, errors
    return json.loads(json.dumps(template))


SERVICE = load("explain.yaml")
SETUP = load("setup.yaml")


def resources(t: dict, rtype: str | None = None) -> dict:
    return {k: v for k, v in t["Resources"].items() if rtype is None or v["Type"] == rtype}


def one(t: dict, rtype: str) -> dict:
    found = list(resources(t, rtype).values())
    assert len(found) == 1, f"expected one {rtype}, found {len(found)}"
    return found[0]["Properties"]


def statements(role: dict) -> list[dict]:
    out = []
    for policy in role["Properties"].get("Policies", []):
        out.extend(policy["PolicyDocument"]["Statement"])
    return out


def as_list(x):
    return x if isinstance(x, list) else [x]


def tag_map(props: dict, key: str = "Tags") -> dict:
    tags = props.get(key)
    if isinstance(tags, dict):
        return tags
    return {t["Key"]: t["Value"] for t in tags or []}


# ---- the service stack --------------------------------------------------


class TestService:
    def test_region_is_pinned(self):
        assert SERVICE["Rules"]["OnlyUsEast1"]["Assertions"][0]["Assert"] == {
            "Fn::Equals": [{"Ref": "AWS::Region"}, "us-east-1"]
        }

    def test_creates_no_iam_and_no_function_url(self):
        types = {r["Type"] for r in SERVICE["Resources"].values()}
        assert not {t for t in types if t.startswith("AWS::IAM::")}
        assert "AWS::Lambda::Url" not in types
        assert types == {
            "AWS::Logs::LogGroup",
            "AWS::Logs::MetricFilter",
            "AWS::CloudWatch::Alarm",
            "AWS::Lambda::Function",
            "AWS::ApiGatewayV2::Api",
            "AWS::ApiGatewayV2::Integration",
            "AWS::ApiGatewayV2::Route",
            "AWS::ApiGatewayV2::Stage",
            "AWS::Lambda::Permission",
        }

    def test_kill_switch_is_off_by_default(self):
        p = SERVICE["Parameters"]["Explain"]
        assert p["AllowedValues"] == ["on", "off"]
        assert p["Default"] == "off"

    def test_cap_defaults_and_bounds(self):
        cap = SERVICE["Parameters"]["MonthlyCapUsd"]
        assert (cap["Default"], cap["MinValue"], cap["MaxValue"]) == (25, 1, 25)
        assert SERVICE["Parameters"]["DailyPercent"]["Default"] == 10

    def test_prices_are_bound_to_the_single_reviewed_table(self):
        assert "InputPricePerMillion" not in SERVICE["Parameters"]
        assert "OutputPricePerMillion" not in SERVICE["Parameters"]
        env = one(SERVICE, "AWS::Lambda::Function")["Environment"]["Variables"]
        assert env["EXPLAIN_PRICE_IN"] == {"Fn::FindInMap": ["ReviewedModels", {"Ref": "Model"}, "InputPrice"]}
        assert env["EXPLAIN_PRICE_OUT"] == {"Fn::FindInMap": ["ReviewedModels", {"Ref": "Model"}, "OutputPrice"]}
        assert SERVICE["Parameters"]["RetentionMode"]["AllowedValues"] == ["none"]

    def test_swappable_models_have_one_allowlisted_stack_parameter(self):
        p = SERVICE["Parameters"]["Model"]
        assert p["AllowedValues"] == ["grok47", "sonnet55", "sol61"]
        assert p["Default"] == "grok47"
        assert "ModelId" not in SETUP["Parameters"] and "InferenceProfileId" not in SETUP["Parameters"]
        ids = [SERVICE["Mappings"]["ReviewedModels"][key]["InvocationId"] for key in p["AllowedValues"]]
        assert ids == ["us.xai.grok-4.7", "us.anthropic.claude-sonnet-5-5", "us.openai.gpt-6.1-sol"]
        out = subprocess.run(["node", str(HERE / "model-table.mjs"), "--check"], capture_output=True, text=True)
        assert out.returncode == 0, out.stderr

    def test_cors_allows_only_the_two_origins(self):
        cors = one(SERVICE, "AWS::ApiGatewayV2::Api")["CorsConfiguration"]
        assert cors["AllowMethods"] == ["POST"]
        assert cors["AllowHeaders"] == ["content-type"]
        assert cors["AllowCredentials"] is False
        for value in SERVICE["Parameters"]["AllowedOrigins"]["AllowedValues"]:
            assert set(value.split(",")) <= ORIGINS
        # RT: biasclear.github.io is shared by every Pages site of the
        # organization, so the default is the site's own domain alone.
        assert SERVICE["Parameters"]["AllowedOrigins"]["Default"] == "https://biasclear.com"

    def test_one_route(self):
        route = one(SERVICE, "AWS::ApiGatewayV2::Route")
        assert route["RouteKey"] == "POST /v1/explain"
        assert route["AuthorizationType"] == "NONE"

    def test_throttle_and_no_access_logs(self):
        stage = one(SERVICE, "AWS::ApiGatewayV2::Stage")
        assert stage["DefaultRouteSettings"]["ThrottlingRateLimit"] == {"Ref": "ThrottleRatePerSecond"}
        assert stage["DefaultRouteSettings"]["ThrottlingBurstLimit"] == {"Ref": "ThrottleBurst"}
        assert SERVICE["Parameters"]["ThrottleRatePerSecond"]["Default"] == 2
        assert SERVICE["Parameters"]["ThrottleBurst"]["Default"] == 5
        assert "AccessLogSettings" not in stage
        assert stage["DefaultRouteSettings"]["DetailedMetricsEnabled"] is False

    def test_function_settings(self):
        fn = one(SERVICE, "AWS::Lambda::Function")
        assert fn["Runtime"] == "nodejs24.x"
        assert fn["Architectures"] == ["arm64"]
        assert fn["Handler"] == "index.handler"
        assert fn["Timeout"] < 30
        assert fn["TracingConfig"] == {"Mode": "PassThrough"}
        assert "Layers" not in fn
        assert fn["LoggingConfig"]["LogGroup"] == {"Ref": "LogGroup"}
        env = fn["Environment"]["Variables"]
        assert "AWS_LAMBDA_EXEC_WRAPPER" not in env
        assert fn["Role"] == {"Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/biasclear-explain-function"}

    def test_environment_matches_what_the_function_reads(self):
        env = set(one(SERVICE, "AWS::Lambda::Function")["Environment"]["Variables"])
        config = (ROOT / "packages/explain/src/config.ts").read_text()
        read = set(re.findall(r"env\.(EXPLAIN_[A-Z0-9_]+)", config))
        assert env == read

    def test_reserved_concurrency_is_optional(self):
        fn = one(SERVICE, "AWS::Lambda::Function")
        assert fn["ReservedConcurrentExecutions"] == {
            "Fn::If": ["HasReservedConcurrency", {"Ref": "ReservedConcurrency"}, {"Ref": "AWS::NoValue"}]
        }
        assert SERVICE["Parameters"]["ReservedConcurrency"]["Default"] == 0

    def test_the_counters_outlive_the_service_stack(self):
        # RT: the month's spend count lived in this stack's table, so remove +
        # deploy in the same month started a fresh $25. The table is now in
        # the setup stack, and the function finds it by name.
        assert not resources(SERVICE, "AWS::DynamoDB::Table")
        env = one(SERVICE, "AWS::Lambda::Function")["Environment"]["Variables"]
        assert env["EXPLAIN_TABLE"] == one(SETUP, "AWS::DynamoDB::Table")["TableName"] == "biasclear-explain"

    def test_evaluation_key_is_hidden_and_shaped(self):
        p = SERVICE["Parameters"]["EvaluationKey"]
        assert p["NoEcho"] is True
        assert p["Default"] == ""
        assert p["AllowedPattern"] == "^([0-9a-f]{64})?$"
        env = one(SERVICE, "AWS::Lambda::Function")["Environment"]["Variables"]
        assert env["EXPLAIN_EVAL_KEY"] == {"Ref": "EvaluationKey"}

    def test_every_parameter_the_deploy_does_not_set_has_a_default(self):
        # RT: parameters a deploy leaves out keep their previous value, so the
        # workflow passes every default (deploy-params.mjs) on every deploy.
        for name, p in SERVICE["Parameters"].items():
            if name == "CodeKey":
                continue
            assert "Default" in p, name

    @pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
    def test_deploy_params_reads_exactly_the_decoded_defaults(self):
        out = subprocess.run(
            ["node", str(HERE / "deploy-params.mjs")], capture_output=True, text=True, check=True
        ).stdout.split()
        want = [
            f"{name}={p['Default']}"
            for name, p in SERVICE["Parameters"].items()
            if name not in {"Explain", "MonthlyCapUsd", "CodeKey", "EvaluationKey", "Model"}
        ]
        assert out == want
        for name in ("RetentionMode", "AllowedOrigins", "Model"):
            got = subprocess.run(
                ["node", str(HERE / "deploy-params.mjs"), "--get", name], capture_output=True, text=True, check=True
            ).stdout.strip()
            assert got == str(SERVICE["Parameters"][name]["Default"])

    def test_logs_kept_seven_days(self):
        lg = one(SERVICE, "AWS::Logs::LogGroup")
        assert lg["RetentionInDays"] == 7
        assert lg["LogGroupName"] == "/biasclear/explain"

    def test_billing_anomaly_is_visible_without_actions_or_notifications(self):
        metric = one(SERVICE, "AWS::Logs::MetricFilter")
        assert metric["LogGroupName"] == {"Ref": "LogGroup"}
        assert metric["FilterName"] == "biasclear-explain-billing-anomaly"
        for condition in ["$.overrun = 1", "$.billedBoundViolated = 1", "$.pausePersisted = 0", "$.pausePersisted = 1", '$.code = "E_SETTLE"']:
            assert condition in metric["FilterPattern"]
        assert metric["MetricTransformations"] == [{"MetricNamespace": "BiasClear/Explain", "MetricName": "BillingAnomaly", "MetricValue": "1", "DefaultValue": 0, "Unit": "Count"}]
        alarm = one(SERVICE, "AWS::CloudWatch::Alarm")
        assert alarm["AlarmName"] == "biasclear-explain-billing-anomaly"
        assert alarm["Namespace"] == "BiasClear/Explain" and alarm["MetricName"] == "BillingAnomaly"
        assert alarm["Threshold"] == 1 and alarm["Period"] == 60 and alarm["EvaluationPeriods"] == 1
        assert alarm["TreatMissingData"] == "notBreaching" and alarm["ActionsEnabled"] is False
        for field in ["AlarmActions", "OKActions", "InsufficientDataActions"]:
            assert alarm[field] == []

    def test_only_this_accounts_api_may_invoke_for_its_one_route(self):
        # RT: IAM can't pin SourceArn or SourceAccount on CloudFormation's
        # AddPermission, so this test is the fence: exactly this account, this
        # API, this route. Any widening fails here.
        perm = one(SERVICE, "AWS::Lambda::Permission")
        assert perm == {
            "Action": "lambda:InvokeFunction",
            "FunctionName": {"Ref": "Function"},
            "Principal": "apigateway.amazonaws.com",
            "SourceAccount": {"Ref": "AWS::AccountId"},
            "SourceArn": {
                "Fn::Sub": "arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*/POST/v1/explain"
            },
        }

    def test_everything_taggable_is_tagged(self):
        for name, r in resources(SERVICE).items():
            if r["Type"] in {"AWS::ApiGatewayV2::Integration", "AWS::ApiGatewayV2::Route", "AWS::Lambda::Permission", "AWS::Logs::MetricFilter"}:
                continue  # these types carry no tags
            assert tag_map(r["Properties"]) == TAGS, name

    def test_clean_delete(self):
        for r in resources(SERVICE, "AWS::Logs::LogGroup").values():
            assert r.get("DeletionPolicy") == "Delete"


# ---- the setup stack (all of the IAM) -----------------------------------


def role(name: str) -> dict:
    return SETUP["Resources"][name]


def allows(stmts: list[dict]) -> list[dict]:
    return [s for s in stmts if s["Effect"] == "Allow"]


class TestSetupIam:
    def test_region_is_pinned(self):
        assert "OnlyUsEast1" in SETUP["Rules"]

    def test_no_allow_is_a_service_wildcard(self):
        for name, r in resources(SETUP, "AWS::IAM::Role").items():
            for s in allows(statements(r)):
                for action in as_list(s["Action"]):
                    assert "*" not in action, f"{name}: {action}"

    def test_wildcard_resources_only_where_nothing_narrower_exists(self):
        allowed_star = {
            "bedrock:GetModelInvocationLoggingConfiguration",
            "bedrock:GetAccountDataRetention",
            "logs:DescribeResourcePolicies",
        }
        for name, r in resources(SETUP, "AWS::IAM::Role").items():
            for s in allows(statements(r)):
                if s["Resource"] == "*":
                    assert set(as_list(s["Action"])) <= allowed_star, name

    def test_function_role_is_exactly_the_spec(self):
        stmts = statements(role("FunctionRole"))
        by_sid = {s["Sid"]: s for s in stmts}
        expected = {"grok47": "xai.grok-4.7", "sonnet55": "anthropic.claude-sonnet-5-5", "sol61": "openai.gpt-6.1-sol"}
        for key, base in expected.items():
            profile_arn = {"Fn::Sub": f"arn:${{AWS::Partition}}:bedrock:us-east-1:${{AWS::AccountId}}:inference-profile/us.{base}"}
            profile = by_sid[f"Profile{key}"]
            assert profile["Action"] == ["bedrock:InvokeModel", "bedrock:GetInferenceProfile"]
            assert profile["Resource"] == profile_arn
            model = by_sid[f"Model{key}ThroughItsProfileOnly"]
            assert model["Action"] == "bedrock:InvokeModel"
            assert model["Resource"] == [{"Fn::Sub": f"arn:${{AWS::Partition}}:bedrock:{region}::foundation-model/{base}"}
                for region in ["us-east-1", "us-east-2", "us-west-2"]]
            assert model["Condition"] == {"StringEquals": {"bedrock:InferenceProfileArn": profile_arn}}
            assert all("bedrock:*" not in resource["Fn::Sub"] for resource in model["Resource"])
        assert sorted(by_sid["TheCounters"]["Action"]) == [
            "dynamodb:ConditionCheckItem",
            "dynamodb:DeleteItem",
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
        ]
        assert by_sid["TheCounters"]["Resource"] == {"Fn::GetAtt": ["Table", "Arn"]}
        assert sorted(by_sid["TheLogGroup"]["Action"]) == ["logs:CreateLogStream", "logs:PutLogEvents"]
        assert by_sid["TheLogGroup"]["Resource"]["Fn::Sub"].endswith(":log-group:/biasclear/explain:*")
        actions = {a for s in stmts for a in as_list(s["Action"])}
        assert not {a for a in actions if "Stream" in a and a.startswith("bedrock:")}
        assert not {a for a in actions if a.startswith(("aws-marketplace:", "bedrock:Put", "bedrock-mantle:", "iam:"))}
        assert len(stmts) == 10

    def test_privacy_reads_are_exact_and_region_scoped(self):
        for name in ["FunctionRole", "DeployRole"]:
            reads = [s for s in statements(role(name)) if any(a in {
                "bedrock:GetModelInvocationLoggingConfiguration", "bedrock:GetAccountDataRetention"
            } for a in as_list(s["Action"]))]
            assert sorted(a for s in reads for a in as_list(s["Action"])) == [
                "bedrock:GetAccountDataRetention", "bedrock:GetModelInvocationLoggingConfiguration"]
            assert len(reads) == 2
            for s in reads:
                assert s["Effect"] == "Allow" and s["Resource"] == "*"
                expected_regions = "us-east-1" if s["Action"] == "bedrock:GetModelInvocationLoggingConfiguration" else ["us-east-1", "us-east-2", "us-west-2"]
                assert s["Condition"] == {"StringEquals": {"aws:RequestedRegion": expected_regions}}

    def test_alarm_permissions_are_only_on_the_named_alarm_and_log_group(self):
        by_sid = {s["Sid"]: s for s in statements(role("CloudFormationRole"))}
        alarm = by_sid["TheBillingAnomalyAlarm"]
        assert sorted(as_list(alarm["Action"])) == ["cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:PutMetricAlarm", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
        assert alarm["Resource"] == {"Fn::Sub": "arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:biasclear-explain-billing-anomaly"}
        log = by_sid["TheLogGroup"]
        assert {"logs:PutMetricFilter", "logs:DeleteMetricFilter", "logs:DescribeMetricFilters"} <= set(log["Action"])
        assert all("log-group:/biasclear/explain" in r["Fn::Sub"] for r in log["Resource"])

    def test_github_login_is_pinned_to_the_repository_and_environment(self):
        trust = role("DeployRole")["Properties"]["AssumeRolePolicyDocument"]["Statement"]
        assert len(trust) == 1
        cond = trust[0]["Condition"]["StringEquals"]
        assert cond["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
        assert cond["token.actions.githubusercontent.com:sub"] == {
            "Fn::Sub": "repo:${GitHubOwner}@${GitHubOwnerId}/${GitHubRepository}@${GitHubRepositoryId}:environment:${GitHubEnvironment}"
        }
        assert trust[0]["Action"] == "sts:AssumeRoleWithWebIdentity"
        assert "StringLike" not in trust[0]["Condition"]

    def test_deploy_role_changes_the_stack_only_through_cloudformations_role(self):
        stmts = allows(statements(role("DeployRole")))
        for s in stmts:
            acts = set(as_list(s["Action"]))
            if acts & {"cloudformation:CreateChangeSet", "cloudformation:UpdateStack", "cloudformation:DeleteStack", "cloudformation:CreateStack"}:
                assert s["Condition"]["StringEquals"]["cloudformation:RoleArn"] == {
                    "Fn::GetAtt": ["CloudFormationRole", "Arn"]
                }
            if any(a.startswith("cloudformation:") for a in acts):
                assert s["Resource"]["Fn::Sub"].endswith(":stack/biasclear-explain/*")
            if "iam:PassRole" in acts:
                assert s["Condition"]["StringEquals"]["iam:PassedToService"] == "cloudformation.amazonaws.com"
        all_actions = {a for s in stmts for a in as_list(s["Action"])}
        assert "cloudformation:CreateStack" not in all_actions
        assert not {a for a in all_actions if a.startswith("iam:") and a != "iam:PassRole"}
        assert not {a for a in all_actions if a.startswith("lambda:") and a != "lambda:InvokeFunction"}

    def test_cloudformation_role_has_no_iam_no_table_and_no_function_url(self):
        stmts = statements(role("CloudFormationRole"))
        actions = {a for s in allows(stmts) for a in as_list(s["Action"])}
        assert not {a for a in actions if a.startswith("iam:") and a != "iam:PassRole"}
        assert not {a for a in actions if a.startswith("dynamodb:")}
        deny = [s for s in stmts if s["Effect"] == "Deny"]
        assert deny and set(deny[0]["Action"]) == {"lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig"}
        for s in allows(stmts):
            acts = set(as_list(s["Action"]))
            if "lambda:AddPermission" in acts:
                assert acts == {"lambda:AddPermission"}
                assert s["Condition"]["StringEquals"]["lambda:Principal"] == "apigateway.amazonaws.com"
            if "iam:PassRole" in acts:
                assert s["Resource"] == {"Fn::GetAtt": ["FunctionRole", "Arn"]}
                assert s["Condition"]["StringEquals"]["iam:PassedToService"] == "lambda.amazonaws.com"
            if any(a.startswith("lambda:") for a in acts):
                assert s["Resource"]["Fn::Sub"].endswith(":function:biasclear-explain")

    def test_budgets_role_attaches_only_the_deny_policy(self):
        stmts = statements(role("BudgetsActionRole"))
        assert len(stmts) == 1
        s = stmts[0]
        assert set(s["Action"]) == {"iam:AttachRolePolicy", "iam:DetachRolePolicy"}
        assert s["Resource"] == {"Fn::GetAtt": ["FunctionRole", "Arn"]}
        assert s["Condition"]["ArnEquals"]["iam:PolicyARN"] == {"Ref": "DenyBedrockPolicy"}
        trust = role("BudgetsActionRole")["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]
        assert trust["Principal"] == {"Service": "budgets.amazonaws.com"}
        assert trust["Condition"]["StringEquals"]["aws:SourceAccount"] == {"Ref": "AWS::AccountId"}

    def test_deny_policy_denies_all_bedrock(self):
        doc = one(SETUP, "AWS::IAM::ManagedPolicy")["PolicyDocument"]["Statement"]
        assert doc == [
            {"Sid": "NoBedrockAtAll", "Effect": "Deny", "Action": ["bedrock:*", "bedrock-mantle:*"], "Resource": "*"}
        ]

    def test_deny_policy_covers_every_model_action_the_function_may_take(self):
        # RT: a route change (for example to bedrock-mantle) must not leave the
        # budget's stop denying nothing.
        denied = as_list(one(SETUP, "AWS::IAM::ManagedPolicy")["PolicyDocument"]["Statement"][0]["Action"])
        for s in allows(statements(role("FunctionRole"))):
            for action in as_list(s["Action"]):
                if action.split(":")[0].startswith("bedrock"):
                    assert any(fnmatch.fnmatchcase(action, d) for d in denied), action


class TestSetupBudget:
    def test_budget_ignores_credits_and_refunds(self):
        b = one(SETUP, "AWS::Budgets::Budget")
        assert b["Budget"]["CostTypes"] == {"IncludeCredit": False, "IncludeRefund": False}
        assert b["Budget"]["TimeUnit"] == "MONTHLY"
        assert b["Budget"]["BudgetLimit"]["Amount"] == {"Ref": "MonthlyBudgetUsd"}
        assert SETUP["Parameters"]["MonthlyBudgetUsd"]["Default"] == 30
        notes = {
            (n["Notification"]["NotificationType"], n["Notification"]["Threshold"])
            for n in b["NotificationsWithSubscribers"]
        }
        assert notes == {("ACTUAL", 50), ("ACTUAL", 100), ("FORECASTED", 100)}

    def test_actions_take_the_model_away_at_100_and_again_at_150_percent(self):
        # RT: a reversed budget action isn't checked again that month, so a
        # second one at 150% is the last stop after a mid-month reversal.
        actions = [r["Properties"] for r in resources(SETUP, "AWS::Budgets::BudgetsAction").values()]
        assert sorted(a["ActionThreshold"]["Value"] for a in actions) == [100, 150]
        for a in actions:
            assert a["ActionType"] == "APPLY_IAM_POLICY"
            assert a["ApprovalModel"] == "AUTOMATIC"
            assert a["NotificationType"] == "ACTUAL"
            assert a["ActionThreshold"]["Type"] == "PERCENTAGE"
            assert a["Definition"]["IamActionDefinition"] == {
                "PolicyArn": {"Ref": "DenyBedrockPolicy"},
                "Roles": [{"Ref": "FunctionRole"}],
            }
            assert a["ExecutionRoleArn"] == {"Fn::GetAtt": ["BudgetsActionRole", "Arn"]}

    def test_build_bucket_is_private_and_keeps_build_files(self):
        # RT: with a 30-day expiry, a failed update after a long gap could not
        # roll back to the zip the function was running.
        b = one(SETUP, "AWS::S3::Bucket")
        assert all(b["PublicAccessBlockConfiguration"].values())
        for rule in b["LifecycleConfiguration"]["Rules"]:
            assert "ExpirationInDays" not in rule and "ExpirationDate" not in rule
        assert b["OwnershipControls"]["Rules"][0]["ObjectOwnership"] == "BucketOwnerEnforced"

    def test_the_counters_table_keeps_nothing_longer_than_its_ttl(self):
        t = one(SETUP, "AWS::DynamoDB::Table")
        assert t["TableName"] == "biasclear-explain"
        assert t["TimeToLiveSpecification"] == {"AttributeName": "ttl", "Enabled": True}
        assert t["PointInTimeRecoverySpecification"] == {"PointInTimeRecoveryEnabled": False}
        assert "StreamSpecification" not in t
        assert "KinesisStreamSpecification" not in t
        assert t["DeletionProtectionEnabled"] is False
        assert t["BillingMode"] == "PAY_PER_REQUEST"
        r = SETUP["Resources"]["Table"]
        assert r["DeletionPolicy"] == "Delete"

    def test_everything_taggable_is_tagged(self):
        for name, r in resources(SETUP).items():
            props = r["Properties"]
            if r["Type"] in {"AWS::IAM::ManagedPolicy", "AWS::S3::BucketPolicy"}:
                continue  # these types carry no tags
            key = "ResourceTags" if r["Type"].startswith("AWS::Budgets::") else "Tags"
            assert tag_map(props, key) == TAGS, name


@pytest.mark.parametrize("name", ["explain.yaml", "setup.yaml"])
def test_no_secret_shaped_values(name):
    text = (HERE / name).read_text()
    assert not re.search(r"(A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}", text)
    assert "SecretAccessKey" not in text
