import { mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({ entryPoints: ["eval/dry-run.ts"], outfile: "dist/eval-dry-run.mjs", bundle: true,
  platform: "node", format: "esm", target: "node22", packages: "bundle", logLevel: "warning" });
