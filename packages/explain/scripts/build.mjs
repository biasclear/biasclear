// Build the deployment zip for the Lambda function, and the workflow's
// helper script.
//
//   dist/index.mjs      the whole function in one ES module: the handler,
//                       the rule engine(s) and the rule pack(s), the move names.
//                       It imports nothing but Node's own modules.
//   dist/explain.zip    index.mjs alone, zipped byte-for-byte reproducibly
//                       (fixed dates and modes), for Lambda (handler index.handler)
//   dist/explain.zip.sha256
//   dist/ops.mjs        the "Explain (AWS)" workflow's helpers (ops/ops.ts)
//
// Usage: node scripts/build.mjs [--previous auto|none|<git ref>]
// (--previous also bundles the previous rules release's engine; see gen-engines.mjs)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import * as esbuild from "esbuild";
import { generateEngines } from "./gen-engines.mjs";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(PACKAGE, "dist");
export const BUNDLE = join(DIST, "index.mjs");
export const ZIP = join(DIST, "explain.zip");
export const OPS = join(DIST, "ops.mjs");
/** The zip must stay small: Lambda's direct upload limit is 50 MB; this is far below. */
export const ZIP_BUDGET = 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip with one file, stored with DEFLATE, a fixed date (1980-01-01 00:00)
 * and fixed permissions (0644), so the same input always gives the same bytes.
 */
export function zipOne(name, data) {
  const nameBytes = new TextEncoder().encode(name);
  const deflated = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE(((0o100644 << 16) >>> 0) >>> 0, 38); // -rw-r--r--
  central.writeUInt32LE(0, 42); // local header offset
  const localSize = local.length + nameBytes.length + deflated.length;
  const centralSize = central.length + nameBytes.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([local, nameBytes, deflated, central, nameBytes, end]);
}

/**
 * The one module that may talk to the network: the signed AWS calls.
 * Every other file in the bundle (the handler, the rule engine from
 * packages/engine, the generated rule pack, the move names) must not name
 * fetch or any other way out, or load code at run time (RT2: the engine and
 * the pack are bundled into the function, and Node 24 has fetch built in).
 */
export const NETWORK_MODULE = "src/aws/transport.ts";
export const NETWORK_WORDS =
  /(?<![\w.$])(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|sendBeacon|globalThis|self|require|importScripts|Reflect|Proxy|WebAssembly)(?![\w$])|(?<![\w.$])global\s*[.[]|\.\s*constructor\b|\bimport\s*\(|\beval\s*\(|\bFunction\s*\(|node:(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|inspector|vm|module)\b|\bprocess\s*\.\s*(?:binding|dlopen)\b/;

/**
 * The inputs, other than NETWORK_MODULE, whose text names a way out. The
 * whole file is read, comments and strings too (stripping comments could be
 * fooled by a "/*" inside a string), and data files as well as code.
 */
export function networkReach(inputs) {
  return inputs.filter((f) => f !== NETWORK_MODULE && NETWORK_WORDS.test(readFileSync(join(PACKAGE, f), "utf8")));
}

export async function build(previous = "none") {
  const versions = generateEngines(previous);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const common = {
    absWorkingDir: PACKAGE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "none",
    logLevel: "warning",
    charset: "utf8",
    // Nothing outside the bundle but Node's own modules: no AWS SDK, no npm package.
    packages: "bundle",
  };
  const fn = await esbuild.build({ ...common, entryPoints: ["src/index.ts"], outfile: BUNDLE, metafile: true });
  await esbuild.build({ ...common, entryPoints: ["ops/ops.ts"], outfile: OPS });
  const imports = new Set();
  for (const out of Object.values(fn.metafile.outputs)) for (const i of out.imports) imports.add(i.path);
  const foreign = [...imports].filter((p) => !p.startsWith("node:"));
  if (foreign.length > 0) throw new Error(`the bundle imports something outside Node: ${foreign.join(", ")}`);
  const reach = networkReach(Object.keys(fn.metafile.inputs));
  if (reach.length > 0) throw new Error(`code outside src/aws/transport.ts can reach the network: ${reach.join(", ")}`);

  const code = readFileSync(BUNDLE);
  const zip = zipOne("index.mjs", code);
  if (zip.length > ZIP_BUDGET) throw new Error(`explain.zip is ${zip.length} bytes; the budget is ${ZIP_BUDGET}`);
  writeFileSync(ZIP, zip);
  const sha = createHash("sha256").update(zip).digest("hex");
  writeFileSync(`${ZIP}.sha256`, `${sha}  explain.zip\n`);
  return { versions, sha, bytes: zip.length, bundleBytes: code.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--previous");
  const previous = i >= 0 ? process.argv[i + 1] : process.env.EXPLAIN_PREVIOUS ?? "none";
  build(previous).then(
    (r) => {
      console.log(`rules ${r.versions.join(", ")}`);
      console.log(`dist/index.mjs: ${(r.bundleBytes / 1024).toFixed(1)} KB`);
      console.log(`dist/explain.zip: ${(r.bytes / 1024).toFixed(1)} KB, sha256 ${r.sha}`);
    },
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
