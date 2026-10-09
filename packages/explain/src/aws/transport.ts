// One signed HTTPS call to an AWS service. The only file in src/ that calls
// fetch (test/lint.test.ts checks this). There are no retries: a retried
// model call could be billed twice (SPEC §5), and a failed counter write
// fails closed.

import { credentialsFromEnv, sign, type Credentials } from "./sigv4.js";

export interface AwsCall {
  /** Signing name. */
  service: "dynamodb" | "bedrock" | "lambda";
  host: string;
  /** Explicit endpoint region for reviewed regional privacy reads; otherwise the source region. */
  region?: string;
  method: "GET" | "POST";
  /** Path as sent, segments already URI-encoded. */
  path: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface AwsReply {
  status: number;
  /** Lowercased names. */
  headers: Record<string, string>;
  body: string;
}

export type Transport = (call: AwsCall) => Promise<AwsReply>;

/** A call that got no HTTP answer. Its message is one of three fixed words. */
export class TransportError extends Error {
  readonly kind: "timeout" | "network" | "credentials";
  constructor(kind: "timeout" | "network" | "credentials") {
    super(kind);
    this.kind = kind;
    this.name = "TransportError";
  }
}

export interface FetchTransportOptions {
  region: string;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl?: typeof fetch;
}

export function fetchTransport(options: FetchTransportOptions): Transport {
  const doFetch = options.fetchImpl ?? fetch;
  return async (call) => {
    const credentials: Credentials | undefined = credentialsFromEnv(options.env);
    if (credentials === undefined) throw new TransportError("credentials");
    const headers = sign({
      method: call.method,
      host: call.host,
      path: call.path,
      headers: call.headers,
      body: call.body,
      service: call.service,
      region: call.region ?? options.region,
      credentials,
      date: new Date(options.now()),
    });
    delete headers.host; // fetch sets it from the URL
    const signal = AbortSignal.timeout(call.timeoutMs);
    try {
      const res = await doFetch(`https://${call.host}${call.path}`, {
        method: call.method,
        headers,
        ...(call.method === "POST" ? { body: call.body } : {}),
        signal,
        redirect: "error",
        cache: "no-store",
      });
      const body = await res.text();
      const out: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        out[name.toLowerCase()] = value;
      });
      return { status: res.status, headers: out, body };
    } catch (err) {
      const name = (err as { name?: unknown } | null)?.name;
      throw new TransportError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }
  };
}
