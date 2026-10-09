import { bytesDigest, digest, frozenCopy, refuse } from "./contracts.mjs";

// The reviewed source declares the JSON literal at top level. This conservative
// prefix check refuses nesting and comment/string decoys. Content pins remain
// the authority; this is not a general TypeScript parser.
function topLevelPrefix(source) {
  let state = "code", quote = "", escaped = false, depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === "line") { if (c === "\n") state = "code"; continue; }
    if (state === "block") { if (c === "*" && next === "/") { state = "code"; i++; } continue; }
    if (state === "string") {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) state = "code";
      continue;
    }
    if (c === "/" && next === "/") { state = "line"; i++; }
    else if (c === "/" && next === "*") { state = "block"; i++; }
    else if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; }
    else if ("{([".includes(c)) depth++;
    else if ("})]".includes(c) && --depth < 0) return false;
  }
  return state === "code" && depth === 0;
}

/** Parse source without execution. The operator asserts the commit; startup pins content. */
export function registryFromExplainSource(sourceBytes, commit) {
  if (!(typeof sourceBytes === "string" || sourceBytes instanceof Uint8Array) ||
      typeof sourceBytes === "string" && !sourceBytes.isWellFormed() || !/^[a-f0-9]{40}$/.test(commit)) refuse("E_REGISTRY_SOURCE");
  const bytes = Buffer.from(sourceBytes);
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { refuse("E_REGISTRY_SOURCE"); }
  if ((source.match(/BEGIN_REVIEWED_MODEL_TABLE/g) ?? []).length !== 1 ||
      (source.match(/END_REVIEWED_MODEL_TABLE/g) ?? []).length !== 1 ||
      (source.match(/\bexport\s+const\s+DEFAULT_MODEL_ID\b/g) ?? []).length !== 1) refuse("E_REGISTRY_SOURCE");
  const match = /^\/\/ BEGIN_REVIEWED_MODEL_TABLE\r?\nconst MODEL_TABLE = ([\s\S]*?);\r?\n\/\/ END_REVIEWED_MODEL_TABLE[ \t]*$/m.exec(source);
  const defaultId = /^export const DEFAULT_MODEL_ID = "([^"]+)";[ \t]*$/m.exec(source)?.[1];
  if (!match || !topLevelPrefix(source.slice(0, match.index))) refuse("E_REGISTRY_SOURCE");
  let models;
  try { models = JSON.parse(match?.[1] ?? ""); } catch { refuse("E_REGISTRY_SOURCE"); }
  if (!defaultId || !Object.hasOwn(models, defaultId)) refuse("E_REGISTRY_SOURCE");
  const table = { models, defaultId, defaultKey: models[defaultId].key };
  return frozenCopy({ schema: 1, kind: "explain-reviewed-registry", provenance: {
    repository: "biasclear/biasclear", path: "packages/explain/src/models.ts", commit,
    sourceSha256: bytesDigest(bytes), commitVerification: "operator-asserted",
  }, table, tableSha256: digest(table) });
}
