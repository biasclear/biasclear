import { bytesDigest, digest, frozenCopy, refuse } from "./contracts.mjs";

/** Parse the marked JSON literal in the single Explain table; never execute source code. */
export function registryFromExplainSource(source, commit) {
  if (typeof source !== "string" || !/^[a-f0-9]{40}$/.test(commit)) refuse("E_REGISTRY_SOURCE");
  const match = /\/\/ BEGIN_REVIEWED_MODEL_TABLE\nconst MODEL_TABLE = ([\s\S]*?);\n\/\/ END_REVIEWED_MODEL_TABLE/.exec(source);
  const defaultId = /export const DEFAULT_MODEL_ID = "([^"]+)";/.exec(source)?.[1];
  let models;
  try { models = JSON.parse(match?.[1] ?? ""); } catch { refuse("E_REGISTRY_SOURCE"); }
  if (!defaultId || !Object.hasOwn(models, defaultId)) refuse("E_REGISTRY_SOURCE");
  const table = { models, defaultId, defaultKey: models[defaultId].key };
  return frozenCopy({ schema: 1, kind: "explain-reviewed-registry", provenance: {
    repository: "biasclear/biasclear", path: "packages/explain/src/models.ts", commit, sourceSha256: bytesDigest(source),
  }, table, tableSha256: digest(table) });
}
