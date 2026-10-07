// AWS Signature Version 4 for the few JSON calls this function makes
// (DynamoDB, Bedrock, Lambda). Written out here, with node:crypto, so the
// function needs no AWS SDK: the tested bytes are the deployed bytes, and the
// zip has no dependencies (SPEC §5, "Client settings"). test/sigv4.test.ts
// checks it against signatures made by botocore, AWS's own Python signer.
//
// The credentials are the function role's temporary credentials, which the
// Lambda runtime puts in the environment. No key is stored anywhere.

import { createHash, createHmac } from "node:crypto";

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface SignInput {
  method: string;
  host: string;
  /** The request path as sent, each segment already URI-encoded. */
  path: string;
  /** Headers besides host and the x-amz-* ones this function adds. */
  headers: Record<string, string>;
  body: string;
  /** Signing name: "dynamodb", "bedrock" or "lambda". */
  service: string;
  region: string;
  credentials: Credentials;
  date: Date;
}

/** RFC 3986 encoding, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: string | Uint8Array, data: string): Uint8Array {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The canonical URI: for every service but S3, each segment of the (already encoded) path is encoded again. */
export function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

/** Returns every header to send: the caller's, plus host, x-amz-date, the session token and authorization. */
export function sign(input: SignInput): Record<string, string> {
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v;
  headers.host = input.host;
  headers["x-amz-date"] = stamp;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${(headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/** The function role's credentials, from the variables the Lambda runtime sets. */
export function credentialsFromEnv(env: Record<string, string | undefined>): Credentials | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN };
}
