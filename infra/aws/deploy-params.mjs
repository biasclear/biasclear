// The service stack's parameters for one deploy, read from the reviewed
// defaults in infra/aws/explain.yaml.
//
// CloudFormation keeps a parameter's previous value when an update leaves it
// out, so a reviewed change to a default would never reach AWS. The deploy
// workflow therefore passes every parameter from this list on every deploy.
// It sets five itself: Explain (the switch keeps its value), MonthlyCapUsd
// (kept unless the owner types one), CodeKey (the new build) and
// EvaluationKey (drawn at random for each run), Model (owner-selected reviewed key).
//
// Usage (Node's own modules only, so the workflow's AWS job can run it from
// the checkout with no installed packages):
//   node infra/aws/deploy-params.mjs              one Key=Value per line
//   node infra/aws/deploy-params.mjs --get Name   one default's value
//
// Exit codes: 0 done, 1 the template can't be read as expected, 2 bad usage.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TEMPLATE = fileURLToPath(new URL("./explain.yaml", import.meta.url));
/** Set by the workflow itself, never from a default. */
export const SET_BY_WORKFLOW = ["Explain", "MonthlyCapUsd", "CodeKey", "EvaluationKey", "Model"];
/** A value that can go on a command line as one word. */
const SAFE = /^[A-Za-z0-9.,:/_-]*$/;

/** Every parameter's Default in the template's Parameters section, as text, in order. */
export function templateDefaults(yaml) {
  const section = /^Parameters:\n((?:(?: {2}.*)?\n)+)/m.exec(yaml);
  if (!section) throw new Error("explain.yaml has no Parameters section");
  const out = new Map();
  const entries = section[1].split(/^(?= {2}[A-Za-z0-9]+:\s*$)/m);
  for (const entry of entries) {
    const name = /^ {2}([A-Za-z0-9]+):\s*$/m.exec(entry);
    if (!name) continue;
    const def = /^ {4}Default: *(.*?)\s*$/m.exec(entry);
    if (!def) {
      out.set(name[1], undefined);
      continue;
    }
    let value = def[1];
    if (/^"(.*)"$/.test(value)) value = value.slice(1, -1);
    else if (/^'(.*)'$/.test(value)) value = value.slice(1, -1);
    out.set(name[1], value);
  }
  if (out.size === 0) throw new Error("explain.yaml has no parameters");
  return out;
}

/** The Key=Value pairs a deploy passes from the defaults. */
export function deployParams(yaml) {
  const pairs = [];
  for (const [name, value] of templateDefaults(yaml)) {
    if (SET_BY_WORKFLOW.includes(name)) continue;
    if (value === undefined) throw new Error(`parameter ${name} has no Default`);
    if (!SAFE.test(value)) throw new Error(`parameter ${name} has a Default that isn't one plain word`);
    pairs.push(`${name}=${value}`);
  }
  return pairs;
}

function main() {
  const args = process.argv.slice(2);
  const yaml = readFileSync(TEMPLATE, "utf8");
  if (args.length === 0) {
    for (const p of deployParams(yaml)) process.stdout.write(`${p}\n`);
    return 0;
  }
  if (args.length === 2 && args[0] === "--get") {
    const value = templateDefaults(yaml).get(args[1]);
    if (value === undefined || !SAFE.test(value)) return 1;
    process.stdout.write(`${value}\n`);
    return 0;
  }
  process.stderr.write("Usage: node infra/aws/deploy-params.mjs [--get Name]\n");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let code;
  try {
    code = main();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    code = 1;
  }
  process.exit(code);
}
