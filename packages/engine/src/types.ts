/** A value accepted as `domain`. `undefined` or `null` means `"general"`. */
export type Domain = "general" | "legal" | "media" | "financial" | "all";

/** The domain a rule belongs to. */
export type RuleDomain = "general" | "legal" | "media" | "financial";

/** Persistent Influence Theory tier: 1 ideological, 2 psychological, 3 institutional. */
export type Tier = 1 | 2 | 3;

export type Severity = "low" | "moderate" | "high" | "critical";

export interface ScanOptions {
  /**
   * `"general"` (the default) runs the general rules only; `"legal"`,
   * `"media"` or `"financial"` add that domain's rules; `"all"` runs every rule.
   */
  domain?: Domain | null | undefined;
}

/** One structural move the text makes. */
export interface Move {
  ruleId: string;
  name: string;
  tier: Tier;
  domain: RuleDomain;
  severity: Severity;
  /** UTF-16 index (a JavaScript string index) where the match starts. */
  start: number;
  /** UTF-16 index just past the match. `match === text.slice(start, end)`. */
  end: number;
  match: string;
}

/** Number of moves per tier. */
export interface TierCounts {
  "1": number;
  "2": number;
  "3": number;
}

export interface ScanResult {
  /** `rules_version` of the rule pack that ran. */
  rulesVersion: string;
  /** SHA-256 of the rule pack in RFC 8785 canonical JSON (hex). Equal to Python's `rules_hash`. */
  rulesHash: string;
  /** Moves sorted by start, then longest first, then pack order. */
  moves: Move[];
  counts: TierCounts;
}

export type RegexFlags = "" | "i" | "s" | "is";

export interface RulePackTier {
  name: string;
  alias: string;
  description: string;
}

export interface RulePackRule {
  id: string;
  name: string;
  description: string;
  pit_tier: Tier;
  domain: RuleDomain;
  severity: Severity;
  principle: "Truth" | "Justice" | "Clarity" | "Agency" | "Identity";
  indicators: string[];
  min_matches: number;
  suppress_if_cited: boolean;
  flags: RegexFlags;
}

/** The rule pack, as described by rules/schema.json. */
export interface RulePack {
  schema_version: string;
  rules_version: string;
  tiers: Record<"1" | "2" | "3", RulePackTier>;
  citation_suppression: {
    window: number;
    flags: RegexFlags;
    patterns: string[];
  };
  rules: RulePackRule[];
}
