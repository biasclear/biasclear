// The built files (npm run build writes dist/ first; npm test does both) and
// the engine's purity: no network, no DOM or other host globals, no eval.
//
// Three layers:
// - tsconfig.json compiles src/ against ECMAScript only (lib ES2022, no
//   types), so a reference to window, document, fetch, crypto or process
//   does not compile;
// - the source is scanned for those names and for eval, Function and import();
// - the browser bundle runs in an empty VM context (only ECMAScript
//   built-ins) with code generation from strings turned off, so eval and
//   new Function would throw.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { ESM_FILE, GZIP_BUDGET, IIFE_FILE, gzipSize } from "../scripts/build.mjs";
import { scan as scanSource } from "../src/index.js";
import type { ScanResult } from "../src/types.js";
import { PACKAGE, SLOW, readPack } from "./helpers.js";

const SAMPLES = [
  "Everyone agrees we must act now. Either we pass this bill or the economy collapses.",
  `Studies show (Smith et al., 2024) that sleep helps.${" It was a quiet afternoon.".repeat(6)} Experts say it works.`,
  "\u{1F642}\u{1F642} It is widely known that the vast majority of experts agree.",
  "It is well-settled law that this claim is plainly meritless. Critics claimed it; they insisted.",
];

beforeAll(() => {
  if (!existsSync(ESM_FILE) || !existsSync(IIFE_FILE)) {
    throw new Error("dist/ is missing: run `npm run build` (or `npm test`, which builds first)");
  }
});

/** Run the IIFE bundle in a fresh context that has only ECMAScript built-ins. */
function sandbox(): object {
  const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  runInContext(readFileSync(IIFE_FILE, "utf8"), context);
  return context;
}

describe("dist/", () => {
  it("keeps the browser bundle under the gzip budget, rule pack included", () => {
    const gz = gzipSize(IIFE_FILE);
    console.log(`dist/biasclear.iife.min.js: ${(gz / 1024).toFixed(1)} KB gzipped (budget ${GZIP_BUDGET / 1024} KB)`);
    expect(gz).toBeLessThan(GZIP_BUDGET);
  });

  it("matches the size table and the budget in README.md", () => {
    // The README quotes the build's own numbers (scripts/build.mjs prints them),
    // so they are checked here against the files the build wrote.
    const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
    const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
    for (const file of [ESM_FILE, IIFE_FILE]) {
      const name = `dist/${file.split(/[\\/]/).pop() ?? ""}`;
      const row = readme.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, `README.md has no size row for ${name}`).toBeDefined();
      const cells = (row ?? "").split("|").map((c) => c.trim());
      expect(cells.slice(3, 5)).toEqual([kb(readFileSync(file).length), kb(gzipSize(file))]);
    }
    const gz = gzipSize(IIFE_FILE);
    expect(readme).toContain(`what \`scripts/build.mjs\` prints for rules version ${readPack().rules_version}`);
    expect(readme).toContain(
      `budget is ${GZIP_BUDGET / 1024} KB gzipped (\`GZIP_BUDGET\` in \`scripts/build.mjs\`), and it uses ` +
        `${kb(gz)}, ${Math.round((gz / GZIP_BUDGET) * 100)}% of it.`,
    );
  });

  it("exports the API from the ES module", async () => {
    const mod = (await import(ESM_FILE)) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(["DOMAINS", "MAX_INPUT_CHARS", "prepare", "rulePack", "scan"]);
  }, SLOW);

  it("gives the same results from the ES module, the IIFE bundle and the source", async () => {
    const mod = (await import(ESM_FILE)) as { scan: typeof scanSource };
    const context = sandbox() as { input?: string };
    for (const text of SAMPLES) {
      context.input = text;
      const fromIife = JSON.parse(
        runInContext('JSON.stringify(BiasClear.scan(input, { domain: "all" }))', context) as string,
      ) as ScanResult;
      const fromEsm = mod.scan(text, { domain: "all" });
      expect(fromEsm.moves.length).toBeGreaterThan(0);
      expect(fromEsm).toEqual(scanSource(text, { domain: "all" }));
      expect(fromIife).toEqual(fromEsm);
    }
  }, SLOW);

  it("runs where there is no fetch, no DOM and no eval", () => {
    const context = sandbox();
    const globals = runInContext(
      "['fetch','XMLHttpRequest','WebSocket','window','document','navigator','crypto','process','require','setTimeout'].filter((n) => typeof globalThis[n] !== 'undefined')",
      context,
    );
    expect(globals).toEqual([]);
    expect(() => runInContext("eval('1')", context)).toThrow(/Code generation from strings disallowed/);
    expect(() => runInContext("new Function('return 1')", context)).toThrow(/Code generation from strings disallowed/);
    expect(runInContext("BiasClear.scan('Everyone agrees.').moves[0].ruleId", context)).toBe("CONSENSUS_AS_EVIDENCE");
  }, SLOW);
});

describe("source", () => {
  // Names used as globals; a property (`x.name`, `name:`) doesn't count.
  const FORBIDDEN =
    /(?<![.\w$])(?:eval|Function|import\s*\(|require|fetch|XMLHttpRequest|WebSocket|EventSource|navigator|document|window|self|globalThis|process|crypto|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|postMessage|Worker|importScripts)\b(?!\s*\??:)/g;

  /** Source code with comments and string literals removed. */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
      .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""');
  }

  it("uses no host globals, eval, Function or dynamic import", () => {
    const dir = join(PACKAGE, "src");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const found = files.flatMap((f) => [...code(join(dir, f)).matchAll(FORBIDDEN)].map((m) => `${f}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it("declares no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg["dependencies"]).toBeUndefined();
    expect(pkg["peerDependencies"]).toBeUndefined();
    expect(pkg["optionalDependencies"]).toBeUndefined();
    expect(Object.keys(pkg["devDependencies"] as object).sort()).toEqual(["esbuild", "typescript", "vitest"]);
  });
});
