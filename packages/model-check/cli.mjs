import { readFile } from "node:fs/promises";
import { CheckError, importQuestionDraft, refuse } from "./src/contracts.mjs";
import { createReplayStub, runModelCheck } from "./src/offline.mjs";

try {
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
  await runModelCheck({ mode: "offline", registry: await json(options["--registry"]),
    modelIds: options["--models"].split(","), questionSet,
    approval: options["--approval"] ? await json(options["--approval"]) : undefined,
    adapter: createReplayStub(await json(options["--fixtures"])), artifactDirectory: options["--artifacts"],
    domain: options["--domain"] ?? "general" });
} catch (err) {
  process.stderr.write(`${err instanceof CheckError ? err.code : "E_MODEL_CHECK_FAILED"}\n`);
  process.exitCode = 1;
}
