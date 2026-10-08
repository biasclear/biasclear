import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { CheckError, refuse } from "../src/contracts.mjs";
import { registryFromExplainSource } from "../src/registry-import.mjs";

const args = process.argv.slice(2);
try {
  if (args.length !== 6 || args[0] !== "--source" || args[2] !== "--source-commit" || args[4] !== "--output" ||
      !isAbsolute(args[1]) || !isAbsolute(args[5])) refuse("E_IMPORT_ARGUMENTS");
  const registry = registryFromExplainSource(await readFile(args[1], "utf8"), args[3]);
  await writeFile(args[5], `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx", mode: 0o600 });
} catch (err) {
  process.stderr.write(`${err instanceof CheckError ? err.code : "E_REGISTRY_IMPORT_FAILED"}\n`);
  process.exitCode = 1;
}
