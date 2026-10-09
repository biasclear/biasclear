import { readFile } from "node:fs/promises";
import { CheckError, importQuestionDraft, refuse } from "./src/contracts.mjs";

try {
  let implementation;
  try { implementation = await import("./src/offline.mjs"); }
  catch (err) {
    // Only the missing engine bundle gets this code; unrelated import failures stay generic.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && err.url === new URL("../engine/dist/index.js", import.meta.url).href) refuse("E_ENGINE_NOT_BUILT");
    throw err;
  }
  const { createReplayStub, runModelCheck } = implementation;
  const args = process.argv.slice(2);
  const allowed = new Set(["--mode", "--registry", "--models", "--questions", "--approval", "--fixtures", "--artifacts", "--domain"]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) refuse("E_CLI_ARGUMENTS");
    options[args[i]] = args[i + 1];
  }
  if ((options["--mode"] ?? "offline") !== "offline") refuse("E_OFFLINE_ONLY");
  if (!["--registry", "--models", "--questions", "--fixtures", "--artifacts"].every(k => Object.hasOwn(options, k))) refuse("E_CLI_ARGUMENTS");
  const json = async path => JSON.parse(await readFile(path, "utf8"));
  const questionBytes = await readFile(options["--questions"]);
  const questionDocument = JSON.parse(questionBytes.toString("utf8"));
  const questionSet = questionDocument.status === "unapproved-draft" ? importQuestionDraft(questionDocument, questionBytes) : questionDocument;
  const report = await runModelCheck({ mode: "offline", registry: await json(options["--registry"]),
    modelIds: options["--models"].split(","), questionSet,
    approval: options["--approval"] ? await json(options["--approval"]) : undefined,
    adapter: createReplayStub(await json(options["--fixtures"])), artifactDirectory: options["--artifacts"],
    domain: options["--domain"] ?? "general" });
  if (!report.complete) {
    process.stderr.write("E_RUN_INCOMPLETE\n");
    process.exitCode = 2;
  }
} catch (err) {
  process.stderr.write(`${err instanceof CheckError ? err.code : "E_MODEL_CHECK_FAILED"}\n`);
  process.exitCode = 1;
}
