// Every value the function can put in a response's "error" field or in a log
// line's "code" field. They are fixed strings: nothing from a request, a
// model reply or an error message is ever logged or returned in their place.

/** The "error" field of an error response, and what the site shows for it (SITE_CONTRACT.md). */
export const ERRORS = ["paused", "busy", "limit", "rules", "no_answer", "invalid"] as const;
export type ErrorName = (typeof ERRORS)[number];

/** The "outcome" field of a log line. */
export const OUTCOMES = [
  "ok",
  "paused",
  "busy",
  "limit",
  "rules",
  "no_answer",
  "invalid",
  "forbidden",
  "preflight",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The "code" field of a log line: why a request ended the way it did. */
export const CODES = [
  // configuration and switches
  "E_CONFIG",
  "E_EVAL_KEY",
  "E_SWITCH_OFF",
  "E_PAUSE_FLAG",
  // account privacy settings (SPEC §4 step 2)
  "E_SETTINGS_LOGGING_ON",
  "E_SETTINGS_RETENTION",
  "E_SETTINGS_READ",
  // shape (SPEC §3, §4 step 3)
  "E_METHOD",
  "E_ROUTE",
  "E_ORIGIN",
  "E_CONTENT_TYPE",
  "E_BODY_SIZE",
  "E_BODY_ENCODING",
  "E_PARSE",
  "E_SHAPE",
  "E_SENTENCE",
  "E_SPAN",
  "E_DOMAIN",
  "E_RULE_UNKNOWN",
  // rules version and the mark (SPEC §4 steps 4 and 5)
  "E_RULES_VERSION",
  "E_RULE_RETIRED",
  "E_NOT_A_MARK",
  "E_ENGINE",
  // spend (SPEC §8)
  "E_TOO_COSTLY",
  "E_HEADROOM",
  "E_RESERVE_MONTH",
  "E_RESERVE_DAY",
  "E_DDB",
  "E_SETTLE",
  "E_BILLING_PAUSE",
  "E_PROVIDER_BOUND",
  // not enough of the invocation left for the model and the stop records (314 M1)
  "E_DEADLINE",
  // per-connection limits (SPEC §9)
  "E_ADDRESS",
  "E_SALT",
  "E_RATE_SHORT",
  "E_RATE_DAILY",
  "E_RATE_LISTED",
  // the model call (SPEC §8 step 7)
  "E_MODEL_THROTTLED",
  "E_MODEL_DENIED",
  "E_MODEL_NOT_FOUND",
  "E_MODEL_VALIDATION",
  "E_MODEL_ROUTE",
  "E_MODEL_RETENTION",
  "E_MODEL_QUOTA",
  "E_MODEL_TIMEOUT",
  "E_MODEL_NETWORK",
  "E_MODEL_ERROR",
  "E_MODEL_NO_USAGE",
  // the answer's checks (SPEC §7, checks 1 to 10; output.ts)
  "E_OUT_STOP",
  "E_OUT_SHAPE",
  "E_OUT_PLAIN_TEXT",
  "E_OUT_HOW",
  "E_OUT_PLAINER_LENGTH",
  "E_OUT_NAMES",
  "E_OUT_SIDES",
  "E_OUT_BRAND",
  "E_OUT_VERDICT",
  "E_OUT_POINTS",
  "E_OUT_ECHO",
  "E_OUT_SAME_SENTENCE",
  // anything else
  "E_INTERNAL",
] as const;
export type Code = (typeof CODES)[number];

/** Why a rewrite was dropped (SPEC §7, checks 11 and 12), for the log's "plainer" field. */
export const PLAINER_STATES = ["kept", "off", "P_SPEAKER", "P_CERTAINTY", "P_CLAIM", "P_MOVE"] as const;
export type PlainerState = (typeof PLAINER_STATES)[number];

/**
 * An error the function throws on purpose. Its message is always the fixed
 * code, never text from input, so even an accidental log of it is safe.
 */
export class CodedError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
    this.name = "CodedError";
  }
}
