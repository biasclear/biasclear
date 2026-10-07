import { fileURLToPath } from "node:url";
// Source rules that keep text out of logs and the function self-contained
// (SPEC §10, "How no text reaches a log"; AGENTS.md on dependencies).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("../", import.meta.url));

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(pkg, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (name === "generated" || name === "node_modules") return [];
    return statSync(join(pkg, rel)).isDirectory() ? files(rel, ext) : ext.test(name) ? [rel] : [];
  });
}

const src = files("src", /\.ts$/).filter((f) => !f.endsWith(".d.ts"));
const read = (f: string) => readFileSync(join(pkg, f), "utf8");
/** The source with comments removed, so a comment that names a thing doesn't count as using it. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("the function's source", () => {
  it("writes logs from one module only", () => {
    const users = src.filter((f) => /\bconsole\s*\./.test(code(f)));
    expect(users).toEqual(["src/log.ts"]);
  });

  it("makes network calls from one module only", () => {
    const users = src.filter((f) => /(?<![\w.$])fetch(?![\w$])/.test(code(f)));
    expect(users).toEqual(["src/aws/transport.ts"]);
  });

  it("never reads an error's message or stack", () => {
    for (const f of src) {
      expect(code(f), f).not.toMatch(/\b(?:err|error|e)\s*\.\s*(?:message|stack)\b/);
      expect(code(f), f).not.toMatch(/\.stack\b/);
    }
  });

  it("reads the environment in the entry point only", () => {
    const users = src.filter((f) => /\bprocess\s*\.\s*env\b/.test(code(f)));
    expect(users).toEqual(["src/index.ts"]);
  });

  it("never evaluates strings as code", () => {
    for (const f of src) expect(code(f), f).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/);
  });

  it("never asks Bedrock for tracing or guardrail traces", () => {
    for (const f of src) expect(code(f).toLowerCase(), f).not.toMatch(/x-amzn-bedrock-trace|guardrail|streaming|invoke-with-response-stream/);
  });

  it("has no invisible or direction-changing characters in any source file", () => {
    const all = [...files("src", /\.ts$/), ...files("test", /\.ts$/), ...files("ops", /\.ts$/), ...files("scripts", /\.m?js$/)];
    for (const f of all) {
      expect(read(f), f).not.toMatch(/[\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/u);
    }
  });
});

describe("the package", () => {
  it("has no runtime dependencies, and the same build tools as the engine", () => {
    const own = JSON.parse(read("package.json")) as Record<string, unknown>;
    const engine = JSON.parse(readFileSync(join(pkg, "../engine/package.json"), "utf8")) as Record<string, unknown>;
    expect(own.dependencies).toBeUndefined();
    expect(own.optionalDependencies).toBeUndefined();
    expect(own.devDependencies).toEqual(engine.devDependencies);
  });
});
