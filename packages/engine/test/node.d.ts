// The few Node and Web APIs the tests use, typed by hand so the package
// needs no @types/node. The engine itself compiles against ECMAScript only
// (tsconfig.json), so none of this is visible to src/.

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: "utf8"): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}

declare module "node:vm" {
  interface ContextOptions {
    codeGeneration?: { strings?: boolean; wasm?: boolean };
  }
  export function createContext(sandbox?: object, options?: ContextOptions): object;
  export function runInContext(code: string, context: object): unknown;
}

declare module "node:zlib" {
  export function gzipSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
}

interface ImportMeta {
  readonly url: string;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
}

declare class TextEncoder {
  encode(input: string): Uint8Array;
}

declare const crypto: {
  readonly subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
  };
};

declare const console: {
  log(...values: unknown[]): void;
};

declare const performance: {
  now(): number;
};
