import { fileURLToPath } from "node:url";
// The hand-written SigV4 signer against signatures made by botocore, AWS's
// own Python signer (test/fixtures/make_sigv4_vectors.py made the file).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalUri, credentialsFromEnv, sign, uriEncode } from "../src/aws/sigv4.js";
import { fetchTransport, TransportError } from "../src/aws/transport.js";

interface Vector {
  name: string;
  service: string;
  method: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  scope: string;
  signedHeaders: string;
  signature: string;
  amzDate: string;
}

const file = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/sigv4-vectors.json", import.meta.url)), "utf8")) as {
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
  date: string;
  region: string;
  cases: Vector[];
};

describe("SigV4", () => {
  for (const v of file.cases) {
    it(`matches botocore: ${v.name}`, () => {
      const headers = sign({
        method: v.method,
        host: v.host,
        path: v.path,
        headers: v.headers,
        body: v.body,
        service: v.service,
        region: file.region,
        credentials: file.credentials,
        date: new Date(file.date),
      });
      expect(headers["x-amz-date"]).toBe(v.amzDate);
      expect(headers.authorization).toBe(
        `AWS4-HMAC-SHA256 Credential=${file.credentials.accessKeyId}/${v.scope}, SignedHeaders=${v.signedHeaders}, Signature=${v.signature}`,
      );
      expect(headers["x-amz-security-token"]).toBe(file.credentials.sessionToken);
    });
  }

  it("encodes each path segment again for the canonical URI", () => {
    expect(uriEncode("a:b c*")).toBe("a%3Ab%20c%2A");
    expect(canonicalUri("/model/anthropic.claude-haiku-4-5-20251001-v1%3A0/invoke")).toBe(
      "/model/anthropic.claude-haiku-4-5-20251001-v1%253A0/invoke",
    );
  });

  it("reads the role's temporary credentials from the environment, and nothing else", () => {
    expect(credentialsFromEnv({})).toBeUndefined();
    expect(credentialsFromEnv({ AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_SESSION_TOKEN: "c" })).toEqual({
      accessKeyId: "a",
      secretAccessKey: "b",
      sessionToken: "c",
    });
  });
});

describe("the fetch transport", () => {
  const env = { AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_SESSION_TOKEN: "c" };
  const call = {
    service: "dynamodb" as const,
    host: "dynamodb.us-east-1.amazonaws.com",
    method: "POST" as const,
    path: "/",
    headers: { "content-type": "application/x-amz-json-1.0" },
    body: "{}",
    timeoutMs: 1000,
  };

  it("sends one signed HTTPS request, with no retry and no redirects", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const t = fetchTransport({
      region: "us-east-1",
      env,
      now: () => Date.UTC(2026, 9, 5),
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response("{}", { status: 400, headers: { "x-amzn-requestid": "r" } });
      }) as typeof fetch,
    });
    const r = await t(call);
    expect(r.status).toBe(400);
    expect(r.headers["x-amzn-requestid"]).toBe("r");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://dynamodb.us-east-1.amazonaws.com/");
    expect(seen[0]!.init.redirect).toBe("error");
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=a\/20261005\/us-east-1\/dynamodb\/aws4_request/);
    expect(headers["x-amz-security-token"]).toBe("c");
  });

  it("turns failures into fixed kinds, never the underlying message", async () => {
    const failing = (err: unknown) =>
      fetchTransport({
        region: "us-east-1",
        env,
        now: Date.now,
        fetchImpl: (async () => {
          throw err;
        }) as unknown as typeof fetch,
      });
    const timeout = Object.assign(new Error("secret text"), { name: "TimeoutError" });
    await expect(failing(timeout)(call)).rejects.toMatchObject({ kind: "timeout", message: "timeout" });
    await expect(failing(new Error("secret text"))(call)).rejects.toMatchObject({ kind: "network", message: "network" });
    const noCreds = fetchTransport({ region: "us-east-1", env: {}, now: Date.now, fetchImpl: fetch });
    await expect(noCreds(call)).rejects.toBeInstanceOf(TransportError);
  });
});
