// UTC calendar keys and boundaries. Every limit and counter uses UTC days.

export const DAY_MS = 86_400_000;

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** Start of the next UTC day, in ms. */
export function nextDayStart(ms: number): number {
  return (Math.floor(ms / DAY_MS) + 1) * DAY_MS;
}

export function seconds(ms: number): number {
  return Math.floor(ms / 1000);
}
