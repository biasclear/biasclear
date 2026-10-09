// The rule engines the function bundles, keyed by rules version (SPEC §4
// steps 4 and 5). The first is the repository's own engine; a deploy build
// may add the one from the rules release before it (scripts/gen-engines.mjs).

import { ENGINE_MODULES } from "./generated/engines.js";

export type Domain = "general" | "legal" | "media" | "financial" | "all";
export const DOMAINS: readonly Domain[] = ["general", "legal", "media", "financial", "all"];

export interface Mark {
  ruleId: string;
  start: number;
  end: number;
}

export interface EngineBuild {
  rulesVersion: string;
  ruleIds: ReadonlySet<string>;
  /** Runs the engine. Throws (a RangeError or TypeError from the engine) on bad input. */
  scan(text: string, domain: Domain): Mark[];
}

export interface EngineRegistry {
  /** The current rules version: the one the prompt's move names follow. */
  current: string;
  builds: ReadonlyMap<string, EngineBuild>;
}

/** The part of an engine module this function uses. */
export interface EngineModule {
  scan(text: string, options?: { domain?: Domain | null | undefined }): { rulesVersion: string; moves: Mark[] };
  rulePack(): { rules_version: string; rules: Array<{ id: string }> };
}

export function buildFromModule(mod: EngineModule): EngineBuild {
  const pack = mod.rulePack();
  return {
    rulesVersion: pack.rules_version,
    ruleIds: new Set(pack.rules.map((r) => r.id)),
    scan: (text, domain) =>
      mod.scan(text, { domain }).moves.map((m) => ({ ruleId: m.ruleId, start: m.start, end: m.end })),
  };
}

export function makeRegistry(builds: EngineBuild[]): EngineRegistry {
  const first = builds[0];
  if (first === undefined) throw new Error("no engine");
  const map = new Map<string, EngineBuild>();
  for (const b of builds) {
    if (map.has(b.rulesVersion)) throw new Error("two engines with one rules version");
    map.set(b.rulesVersion, b);
  }
  return { current: first.rulesVersion, builds: map };
}

let bundled: EngineRegistry | undefined;

/** The engines built into this bundle. */
export function bundledEngines(): EngineRegistry {
  bundled ??= makeRegistry((ENGINE_MODULES as readonly EngineModule[]).map(buildFromModule));
  return bundled;
}
