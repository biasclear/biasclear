// The Lambda entry point: `index.handler` in the deployment zip.
//
// Everything the function needs is read once per instance: its settings
// from the environment (infra/aws/explain.yaml sets them), the bundled rule
// engines and move names, and its in-memory state. It makes no call until a
// request arrives.

import { randomBytes } from "node:crypto";
import { createHandler } from "./app.js";
import { fetchTransport } from "./aws/transport.js";
import { readConfig } from "./config.js";
import { bundledEngines } from "./engines.js";
import { consoleSink } from "./log.js";
import { bundledMoves } from "./moves.js";
import { PROMPT_MODE } from "./prompt.js";
import { newState } from "./state.js";

const config = readConfig(process.env);

export const handler = createHandler({
  config,
  transport: fetchTransport({ region: config?.region ?? "us-east-1", env: process.env, now: Date.now }),
  now: Date.now,
  randomBytes: (n) => randomBytes(n),
  engines: bundledEngines(),
  moves: bundledMoves(),
  promptMode: PROMPT_MODE,
  sink: consoleSink,
  state: newState(),
});
