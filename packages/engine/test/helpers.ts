import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RulePack } from "../src/types.js";

export const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
export const ROOT = join(PACKAGE, "..", "..");
export const PACK_PATH = join(ROOT, "rules", "biasclear-rules.json");
export const GOLDEN_DIR = join(ROOT, "tests", "golden");

/**
 * Timeout for tests that scan many texts or compile the whole pack. They take
 * one to three seconds on a laptop, near vitest's 5-second default on a busy
 * CI runner, so they get room to spare (vitest.config.mjs sets the same for
 * every test).
 */
export const SLOW = 30_000;

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readPack(): RulePack {
  return readJson<RulePack>(PACK_PATH);
}

export interface GoldenCase {
  src: string;
  text: string;
  /** [rule_id, start, end] for domain "all", in code points. */
  moves: Array<[string, number, number]>;
  note?: string;
  native_js_differs?: boolean;
}

export interface GoldenFile {
  name: string;
  cases: GoldenCase[];
}

/** Every golden file: tests/golden/*.json. */
export function goldenFiles(): GoldenFile[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, cases: readJson<{ cases: GoldenCase[] }>(join(GOLDEN_DIR, name)).cases }));
}

/** UTF-16 index of each code point index of `text`, 0..length inclusive. */
export function codePointToUnit(text: string): number[] {
  const map: number[] = [];
  let unit = 0;
  for (const ch of text) {
    map.push(unit);
    unit += ch.length;
  }
  map.push(unit);
  return map;
}
