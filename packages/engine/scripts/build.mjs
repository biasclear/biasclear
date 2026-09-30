// Build dist/: an ES module, one minified IIFE bundle for browsers, and type
// declarations. Both bundles hold the whole rule pack, read from
// rules/biasclear-rules.json by gen-pack.mjs. Prints each file's size, raw and
// gzipped, and fails if the browser bundle is over its budget.
//
// Usage: node scripts/build.mjs

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";
import { generate } from "./gen-pack.mjs";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(PACKAGE, "dist");
export const ESM_FILE = join(DIST, "index.js");
export const IIFE_FILE = join(DIST, "biasclear.iife.min.js");
/** Gzipped size budget for the browser bundle, rule pack included. */
export const GZIP_BUDGET = 60 * 1024;

export function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

async function main() {
  const { hash, rulesVersion } = generate();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const common = {
    absWorkingDir: PACKAGE,
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "neutral",
    target: "es2020",
    legalComments: "none",
    logLevel: "warning",
  };
  await esbuild.build({ ...common, format: "esm", outfile: ESM_FILE });
  await esbuild.build({
    ...common,
    format: "iife",
    globalName: "BiasClear",
    minify: true,
    outfile: IIFE_FILE,
  });

  const require = createRequire(import.meta.url);
  const tsc = join(require.resolve("typescript/package.json"), "..", "bin", "tsc");
  const types = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: PACKAGE,
    stdio: "inherit",
  });
  if (types.status !== 0) throw new Error("tsc could not write the type declarations");

  console.log(`rules ${rulesVersion}, rules hash ${hash}`);
  for (const file of [ESM_FILE, IIFE_FILE]) {
    const raw = readFileSync(file).length;
    const gz = gzipSize(file);
    console.log(`${file.slice(PACKAGE.length)}: ${(raw / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzipped`);
  }
  const gz = gzipSize(IIFE_FILE);
  if (gz > GZIP_BUDGET) {
    throw new Error(`browser bundle is ${gz} bytes gzipped; the budget is ${GZIP_BUDGET}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
