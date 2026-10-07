// The move names and one-line descriptions the prompt uses. They come from
// data/moves.json, a byte-identical copy of site/data/moves.json (the words
// the visitor sees next to the mark); test/prompt.test.ts checks the copy.
// Nothing in a request can change them.

import movesJson from "../data/moves.json";

export interface MoveText {
  name: string;
  short: string;
}

export type MovesTable = ReadonlyMap<string, MoveText>;

export function movesFrom(json: unknown): MovesTable {
  const moves = (json as { moves?: Record<string, { name?: unknown; short?: unknown }> }).moves;
  if (moves === undefined || typeof moves !== "object") throw new Error("moves.json has no moves");
  const table = new Map<string, MoveText>();
  for (const [id, m] of Object.entries(moves)) {
    if (typeof m.name !== "string" || typeof m.short !== "string") throw new Error("moves.json entry is malformed");
    table.set(id, { name: m.name, short: m.short });
  }
  return table;
}

let bundled: MovesTable | undefined;

export function bundledMoves(): MovesTable {
  bundled ??= movesFrom(movesJson);
  return bundled;
}
