import fs from "node:fs/promises";
import path from "node:path";
import { getLangfuseClient } from "../langfuse/client";
import {
  buildConnectionPath,
  collectExistingConnectionExtras,
  formatConnectionFile,
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
  const rawLimit =
    Number.parseInt(parseFlagValue("--limit") ?? "100", 10) || 100;
  const limit = Math.min(Math.max(rawLimit, 1), 100);
  const dryRun = hasFlag("--dry-run");

  await fs.mkdir(dir, { recursive: true });
  const existing = await collectExistingConnectionExtras(dir);

  const client = getLangfuseClient();
  let page = 1;
  let totalPages = 1;
  const connections = [];

  while (page <= totalPages) {
    const response = await client.api.llmConnections.list({ page, limit });
    connections.push(...response.data);
    totalPages = response.meta.totalPages;
    page += 1;
  }

  if (connections.length === 0) {
    console.log("No LLM connections returned from Langfuse.");
    return;
  }

  for (const connection of connections) {
    const filePath = buildConnectionPath(dir, connection.provider);
    const output = formatConnectionFile({
      connection,
      existing: existing.get(connection.provider),
    });

    if (dryRun) {
      console.log(`Would write ${filePath}`);
      continue;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, output, "utf8");
    console.log(`Pulled ${connection.provider} -> ${filePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
