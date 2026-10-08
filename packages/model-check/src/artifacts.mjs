import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { refuse } from "./contracts.mjs";

export async function prepareArtifactDirectory(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory)) refuse("E_EXPLICIT_ARTIFACT_DIRECTORY_REQUIRED");
  try { await mkdir(directory, { recursive: false, mode: 0o700 }); }
  catch { refuse("E_ARTIFACT_DIRECTORY_UNAVAILABLE"); }
}
function fence(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(s => s.length));
  const delimiter = "`".repeat(longest + 1);
  return `${delimiter}\n${text}\n${delimiter}`;
}
function cell(value) {
  // JSON escapes preserve the literal value; code spans prevent GFM URL autolinking as well.
  const text = JSON.stringify(value).replace(/[&<>|*_[\]()!~\u202a-\u202e\u2066-\u2069]/gu,
    c => `\\u${c.codePointAt(0).toString(16).padStart(4, "0")}`);
  const delimiter = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map(s => s.length)) + 1);
  return `${delimiter} ${text} ${delimiter}`;
}
function markdown(report, modelId, rows) {
  const lines = ["# Model Check — offline synthetic record", "", report.warning, "", "Actual cost: $0. All ledger amounts and usage estimates below are simulated.", "",
    fence(JSON.stringify({ modelId, runHash: report.runHash, startedAt: report.startedAt,
      engine: report.engine, complete: report.complete }, null, 2)), ""];
  lines.push("| Question ID / position | Exact question | Raw final text blocks | Engine findings / exact spans | Response / scan status |",
    "|---|---|---|---|---|");
  for (const row of rows) lines.push(`| ${cell({ id: row.question.id, position: row.question.position ?? null, kind: row.question.kind ?? null })} | ${cell(row.question.text)} | ${cell(row.finalTextBlocks)} | ${cell(row.scans)} | ${cell({ response: row.responseStatus, code: row.code ?? null, scans: row.scans.map(s => s.status) })} |`);
  lines.push("");
  for (const row of rows) {
    lines.push(`## ${row.question.id}`, "", "Question (exact text):", "", fence(row.question.text), "",
      "Request and status:", "", fence(JSON.stringify({ requestedAt: row.requestedAt, respondedAt: row.respondedAt,
        elapsedMs: row.elapsedMs, settings: row.settings, route: row.route, responseStatus: row.responseStatus,
        code: row.code ?? null, usageStatus: row.usageStatus, simulatedCost: row.simulatedCost,
        questionMetadata: row.question, billingEvidence: row.billingEvidence }, null, 2)), "");
    if (row.finalTextBlocks.length === 0) lines.push("No final text was returned. This is not a successful zero-mark answer.", "");
    for (const block of row.finalTextBlocks) {
      lines.push(`Final text block ${block.blockIndex} (JSON string preserving exact text):`, "", fence(JSON.stringify(block.text)), "", "Structural scan (offsets refer to this block only):", "",
        fence(JSON.stringify(row.scans.find(s => s.blockIndex === block.blockIndex), null, 2)), "");
    }
  }
  return lines.join("\n");
}
export async function writeArtifacts(directory, report) {
  try {
    for (const modelId of report.modelIds) {
      const key = report.registry.table.models[modelId].key;
      const rows = report.rows.filter(r => r.modelId === modelId);
      const metadata = { ...report, rows }; // Retains original set, registry, approval, and engine fingerprint.
      await writeFile(join(directory, `${key}.json`), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, `${key}.md`), markdown(report, modelId, rows), { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(directory, "run.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch { refuse("E_ARTIFACT_WRITE_FAILED"); }
}
