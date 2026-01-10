import { getLangfuseClient } from "../langfuse/client";
import {
  listConnectionFiles,
  readConnectionFile,
  resolveConnectionForPush,
} from "./shared";

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const dir = parseFlagValue("--dir") ?? "langfuse/llm-connections";
  const envFilter =
    parseFlagValue("--env") ?? process.env.LLM_CONNECTIONS_ENV ?? undefined;
  const dryRun = hasFlag("--dry-run");

  const files = await listConnectionFiles(dir);
  if (files.length === 0) {
    console.log(`No LLM connection files found in ${dir}.`);
    return;
  }

  const client = getLangfuseClient();

  for (const filePath of files) {
    const file = await readConnectionFile(filePath);
    const request = resolveConnectionForPush(file, envFilter);
    if (!request) {
      console.log(`Skip ${file.provider}, not in ${envFilter}.`);
      continue;
    }

    if (dryRun) {
      console.log(`Would upsert ${file.provider} (${file.adapter}).`);
      continue;
    }

    const result = await client.api.llmConnections.upsert(request);
    console.log(`Upserted ${result.provider} (${result.adapter}).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
