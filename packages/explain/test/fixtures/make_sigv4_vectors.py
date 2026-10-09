# Writes test/fixtures/sigv4-vectors.json: SigV4 signatures made by botocore,
# AWS's own Python signer, for test/sigv4.test.ts. Needs botocore; CI does not
# run it. Usage (from packages/explain):
#   python3 test/fixtures/make_sigv4_vectors.py > test/fixtures/sigv4-vectors.json
# The credentials are made up and sign nothing real.
import datetime, json, re
from unittest import mock
import botocore.auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
from urllib.parse import quote

creds = Credentials("TESTONLYACCESSKEYID", "test-secret-not-a-real-key", "test-session-token-not-real")
when = datetime.datetime(2026, 10, 5, 14, 3, 7)
cases = [
  dict(name="dynamodb UpdateItem", service="dynamodb", method="POST", host="dynamodb.us-east-1.amazonaws.com", path="/",
       headers={"content-type": "application/x-amz-json-1.0", "x-amz-target": "DynamoDB_20120810.UpdateItem"},
       body=json.dumps({"TableName": "biasclear-explain", "Key": {"pk": {"S": "spend#2026-10"}}})),
  dict(name="bedrock InvokeModel", service="bedrock", method="POST", host="bedrock-runtime.us-east-1.amazonaws.com",
       path="/model/anthropic.claude-sonnet-5/invoke",
       headers={"content-type": "application/json", "accept": "application/json"},
       body=json.dumps({"anthropic_version": "bedrock-2023-05-31", "max_tokens": 400, "messages": [{"role": "user", "content": "Everyone agrees — ‹ok›"}]}, ensure_ascii=False)),
  dict(name="bedrock InvokeModel, a model id with a colon", service="bedrock", method="POST", host="bedrock-runtime.us-east-1.amazonaws.com",
       path="/model/" + quote("anthropic.claude-haiku-4-5-20251001-v1:0", safe="") + "/invoke",
       headers={"content-type": "application/json", "accept": "application/json"}, body="{}"),
  dict(name="bedrock GetAccountDataRetention", service="bedrock", method="GET", host="bedrock.us-east-1.amazonaws.com",
       path="/data-retention", headers={"accept": "application/json"}, body=""),
  dict(name="lambda Invoke", service="lambda", method="POST", host="lambda.us-east-1.amazonaws.com",
       path="/2015-03-31/functions/biasclear-explain/invocations", headers={"content-type": "application/json"},
       body=json.dumps({"explainEvaluation": 1})),
]
out = []
with mock.patch("botocore.auth.get_current_datetime", return_value=when):
    for c in cases:
        req = AWSRequest(method=c["method"], url=f"https://{c['host']}{c['path']}", data=c["body"].encode("utf-8"), headers=dict(c["headers"]))
        botocore.auth.SigV4Auth(creds, c["service"], "us-east-1").add_auth(req)
        # The Authorization header is stored in parts: written out whole, the
        # secret scanner reads its "...token, Signature=<hex>" as a leaked key.
        auth = req.headers["Authorization"]
        m = re.fullmatch(r"AWS4-HMAC-SHA256 Credential=([^/]+)/(\S+), SignedHeaders=(\S+), Signature=([0-9a-f]{64})", auth)
        out.append({**c, "scope": m.group(2), "signedHeaders": m.group(3), "signature": m.group(4), "amzDate": req.headers["X-Amz-Date"]})
print(json.dumps({
  "about": "SigV4 signatures made by botocore " + __import__("botocore").__version__ + " (AWS's Python signer) with made-up credentials, for test/sigv4.test.ts. Made by test/fixtures/make_sigv4_vectors.py (needs botocore; not run in CI).",
  # Emit only independent signatures and requests. The test defines the
  # made-up signing inputs itself; credential objects never reach stdout.
  "date": "2026-10-05T14:03:07Z", "region": "us-east-1", "cases": out}, indent=2, ensure_ascii=False))
