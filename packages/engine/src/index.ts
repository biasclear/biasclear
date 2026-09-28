/**
 * BiasClear: a rule-based persuasion linter built on Persistent Influence
 * Theory. It names the structural moves a text makes. It points at
 * structure, never at people, and it is not a fact-checker.
 *
 *     import { scan } from "@biasclear/engine";
 *     scan("Everyone agrees this is right.").moves.map((m) => m.ruleId);
 *     // ["CONSENSUS_AS_EVIDENCE"]
 */

export { DOMAINS, MAX_INPUT_CHARS, prepare, rulePack, scan } from "./engine.js";
export type {
  Domain,
  Move,
  RuleDomain,
  RulePack,
  RulePackRule,
  RulePackTier,
  RegexFlags,
  ScanOptions,
  ScanResult,
  Severity,
  Tier,
  TierCounts,
} from "./types.js";
