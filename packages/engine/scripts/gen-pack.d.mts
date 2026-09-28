// Types for gen-pack.mjs, which the tests import.
export declare const PACK_PATH: string;
export declare function canonicalJson(value: unknown): string;
export declare function generate(): { hash: string; rulesVersion: string; out: string };
