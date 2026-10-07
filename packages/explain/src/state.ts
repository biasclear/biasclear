// What one Lambda instance remembers between requests, in memory only. It is
// lost when the instance ends, and never written anywhere.

import type { Code } from "./codes.js";

export const SETTINGS_INTERVAL_MS = 15 * 60 * 1000;
export const OVER_LIMIT_MAX = 10_000;

export interface InstanceState {
  /** Until this time (ms), answer "paused" without touching DynamoDB (SPEC §8, "The pause flag"). */
  pausedUntil: number;
  /** When the account settings are next read (SPEC §4 step 2). */
  nextSettingsCheck: number;
  /** Concurrent invocations await the same unfinished privacy check. */
  settingsCheck?: Promise<Code | undefined> | undefined;
  /** Today's salt, once made or read (SPEC §9). */
  salt: { day: string; bytes: Uint8Array } | undefined;
  /** Connection hashes over a limit, and when that limit resets (ms). */
  overLimit: Map<string, number>;
}

export function newState(): InstanceState {
  return { pausedUntil: 0, nextSettingsCheck: 0, salt: undefined, overLimit: new Map() };
}

/** Remembers a hash that is over a limit, keeping at most OVER_LIMIT_MAX entries. */
export function rememberOverLimit(state: InstanceState, hash: string, until: number, now: number): void {
  if (!state.overLimit.has(hash) && state.overLimit.size >= OVER_LIMIT_MAX) {
    for (const [h, t] of state.overLimit) if (t <= now) state.overLimit.delete(h);
    while (state.overLimit.size >= OVER_LIMIT_MAX) {
      const oldest = state.overLimit.keys().next();
      if (oldest.done) break;
      state.overLimit.delete(oldest.value);
    }
  }
  state.overLimit.delete(hash);
  state.overLimit.set(hash, until);
}

export function isOverLimit(state: InstanceState, hash: string, now: number): boolean {
  const until = state.overLimit.get(hash);
  if (until === undefined) return false;
  if (until <= now) {
    state.overLimit.delete(hash);
    return false;
  }
  return true;
}
