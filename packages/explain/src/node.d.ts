// The few Node APIs this package uses, typed by hand so it needs no
// @types/node. Web platform APIs (fetch, AbortSignal, TextEncoder, console)
// come from the "DOM" lib in tsconfig.json.

declare module "node:crypto" {
  interface Hmac {
    update(data: string | Uint8Array, encoding?: "utf8"): Hmac;
    digest(): Uint8Array;
    digest(encoding: "hex"): string;
  }
  interface Hash {
    update(data: string | Uint8Array, encoding?: "utf8"): Hash;
    digest(): Uint8Array;
    digest(encoding: "hex"): string;
  }
  export function createHmac(algorithm: "sha256", key: string | Uint8Array): Hmac;
  export function createHash(algorithm: "sha256"): Hash;
  export function randomBytes(size: number): Uint8Array;
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; size: number };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:child_process" {
  interface SpawnSyncResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }
  export function spawnSync(
    command: string,
    args: string[],
    options: { cwd?: string; encoding: "utf8"; env?: Record<string, string | undefined> },
  ): SpawnSyncResult;
}

declare module "node:zlib" {
  export function inflateRawSync(data: Uint8Array): Uint8Array;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: string[];
  exitCode: number | undefined;
  readonly stdout: { write(chunk: string): boolean };
  readonly stderr: { write(chunk: string): boolean };
};

interface ImportMeta {
  readonly url: string;
}
