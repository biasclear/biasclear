import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NEUTRAL_SET } from "../src/contracts.mjs";
import { prepareArtifactDirectory, writeArtifacts } from "../src/artifacts.mjs";

const MODEL_ID = "us.fixture.artifact";
const BIDI_CONTROLS = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069];
const EXTRA_CONTROLS = [0x0000, 0x0008, 0x001f, 0x007f, 0x0085, 0x009f, 0x200b, 0xfeff,
  0x2028, 0x2029, 0xe0001, 0xe0020];
const unicodeEscape = code => Array.from({ length: String.fromCodePoint(code).length }, (_, i) =>
  `\\u${String.fromCodePoint(code).charCodeAt(i).toString(16).padStart(4, "0")}`).join("");
const displayedEscape = code => {
  const character = String.fromCodePoint(code), json = JSON.stringify(character).slice(1, -1);
  return json === character ? unicodeEscape(code) : json;
};

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), "biasclear-artifact-regression-"));
  try { return await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function artifactReport(text) {
  const row = { modelId: MODEL_ID, question: NEUTRAL_SET.questions[0], requestedAt: "2026-10-08T12:00:00.000Z",
    respondedAt: "2026-10-08T12:00:00.000Z", elapsedMs: 1, processingElapsedMs: 2,
    settings: { inferenceConfig: { maxTokens: 400 } }, route: { region: "us-east-1" },
    responseStatus: "answer", usageStatus: "reported-synthetic", simulatedCost: { kind: "synthetic-usage-estimate" },
    billingEvidence: { liveBlockReason: "Synthetic fixture" }, finalTextBlocks: [{ blockIndex: 0, text }],
    scans: [{ blockIndex: 0, status: "scanned", moves: [{ match: text, start: 0, end: text.length }] }] };
  return { schema: 1, warning: "Synthetic-only artifact test.", modelIds: [MODEL_ID],
    registry: { kind: "synthetic-unit-registry", provenance: { source: "Synthetic unit fixture" },
      table: { models: { [MODEL_ID]: { key: "artifact" } } } },
    approval: { kind: "built-in-neutral-fixtures", authenticated: false, verificationNote: "not-applicable" },
    sourceDraftStatusMeaning: "No archived draft was run.", runHash: "0".repeat(64),
    startedAt: "2026-10-08T12:00:00.000Z", engine: { declaredBaseRevision: "Synthetic fixture" },
    complete: true, actualCostUsd: 0, rows: [row] };
}

function fencedValues(markdown) {
  const lines = markdown.split("\n"), values = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^`{3,}$/.test(lines[i])) continue;
    const delimiter = lines[i], body = [];
    while (++i < lines.length && lines[i] !== delimiter) body.push(lines[i]);
    assert.ok(i < lines.length, "fence must have a matching close");
    values.push(JSON.parse(body.join("\n")));
  }
  return values;
}

test("Markdown escapes all bidi and Unicode controls in cells and JSON fences while raw JSON stays exact", () => withTemp(async directory => {
  const codes = [...BIDI_CONTROLS, ...EXTRA_CONTROLS];
  const raw = `Synthetic ${codes.map(code => String.fromCodePoint(code)).join(" ")}\r\nnext\tline`;
  const report = artifactReport(raw), artifacts = join(directory, "new-output");
  await prepareArtifactDirectory(artifacts);
  await writeArtifacts(artifacts, report);
  assert.equal(await readFile(join(artifacts, "run.json"), "utf8"), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(JSON.parse(await readFile(join(artifacts, "artifact.json"), "utf8")).rows[0].finalTextBlocks[0].text, raw);
  const markdown = await readFile(join(artifacts, "artifact.md"), "utf8");
  const tableRows = markdown.split("\n").filter(line => line.startsWith("|"));
  assert.equal(tableRows.length, 3); // Header, divider and one answer, including U+2028/2029 payloads.
  const answerCell = tableRows[2];
  for (const code of codes) {
    assert.ok(answerCell.includes(displayedEscape(code)), `table escapes U+${code.toString(16)}`);
    assert.equal(markdown.includes(String.fromCodePoint(code)), false, `no raw U+${code.toString(16)}`);
  }
  assert.doesNotMatch(markdown, /[\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.doesNotMatch(markdown.replaceAll("\n", ""), /\p{Cc}/u);
  const values = fencedValues(markdown);
  assert.equal(values.find(value => typeof value === "string" && value.startsWith("Synthetic ")), raw);
  assert.ok(values.some(value => value?.moves?.[0]?.match === raw));
  for (const code of codes) assert.ok(markdown.includes(displayedEscape(code)));
  const metadata = values[0];
  assert.deepEqual(metadata.approval, report.approval);
  assert.equal(metadata.registryKind, "synthetic-unit-registry");
  assert.deepEqual(metadata.registryProvenance, report.registry.provenance);
  assert.equal(metadata.sourceDraftStatusMeaning, report.sourceDraftStatusMeaning);
  assert.ok(values.some(value => value?.processingElapsedMs === 2));
}));

async function cliCopy(directory, engineSource, { includeOffline = true, artifactSource } = {}) {
  const packageRoot = join(directory, "packages", "model-check"), sourceRoot = join(packageRoot, "src");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await copyFile(new URL("../cli.mjs", import.meta.url), join(packageRoot, "cli.mjs"));
  for (const name of ["contracts.mjs", ...(includeOffline ? ["offline.mjs"] : [])])
    await copyFile(new URL(`../src/${name}`, import.meta.url), join(sourceRoot, name));
  if (artifactSource !== undefined) await writeFile(join(sourceRoot, "artifacts.mjs"), artifactSource);
  else await copyFile(new URL("../src/artifacts.mjs", import.meta.url), join(sourceRoot, "artifacts.mjs"));
  if (engineSource !== undefined) {
    const engineRoot = join(directory, "packages", "engine", "dist");
    await mkdir(engineRoot, { recursive: true });
    await writeFile(join(engineRoot, "index.js"), engineSource);
  }
  return join(packageRoot, "cli.mjs");
}

function cliResult(cli, args = []) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}
function fixedFailure(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${code}\n`);
}

test("an unbuilt engine produces only E_ENGINE_NOT_BUILT without absolute paths or a stack", () => withTemp(async directory => {
  const cli = await cliCopy(directory);
  fixedFailure(cliResult(cli), "E_ENGINE_NOT_BUILT");
}));

test("other import failures are not misclassified as an unbuilt engine", () => withTemp(async directory => {
  const absentOffline = await cliCopy(join(directory, "no-offline"), undefined, { includeOffline: false });
  fixedFailure(cliResult(absentOffline), "E_MODEL_CHECK_FAILED");
  const missingDependency = await cliCopy(join(directory, "no-artifact-dependency"),
    'export const scan = () => {}; export const MAX_INPUT_CHARS = 100; export const DOMAINS = [];\n',
    { artifactSource: 'import "./missing-dependency.mjs";\n' });
  fixedFailure(cliResult(missingDependency), "E_MODEL_CHECK_FAILED");
  const brokenEngine = await cliCopy(join(directory, "broken-engine"), 'export const scan = ;\n');
  fixedFailure(cliResult(brokenEngine), "E_MODEL_CHECK_FAILED");
  const engineThrows = await cliCopy(join(directory, "engine-throws"),
    'export const scan = () => {}; export const MAX_INPUT_CHARS = 100; export const DOMAINS = []; throw new Error("synthetic import failure");\n');
  fixedFailure(cliResult(engineThrows), "E_MODEL_CHECK_FAILED");
}));

test("built-engine CLI keeps fixed argument and mode failures", () => {
  const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  fixedFailure(cliResult(cli), "E_CLI_ARGUMENTS");
  fixedFailure(cliResult(cli, ["--mode", "live"]), "E_OFFLINE_ONLY");
});
