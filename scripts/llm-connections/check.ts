import { getLangfuseClient } from "../langfuse/client";
import {
  compareStringArrays,
  listConnectionFiles,
  normalizeRemoteConnection,
  readConnectionFile,
  resolveConnectionForCheck,
} from "./shared";

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const dir = parseFlagValue("--dir") ?? "langfuse/llm-connections";
  const envFilter =
    parseFlagValue("--env") ?? process.env.LLM_CONNECTIONS_ENV ?? undefined;

  const files = await listConnectionFiles(dir);
  if (files.length === 0) {
    console.log(`No LLM connection files found in ${dir}.`);
    return;
  }

  const client = getLangfuseClient();
  const limit = 100;
  const remoteConnections = await client.api.llmConnections.list({
    limit,
  });
  let page = 1;
  let totalPages = remoteConnections.meta.totalPages;
  const remoteMap = new Map(
    remoteConnections.data.map((item) => [item.provider, item]),
  );

  while (page < totalPages) {
    page += 1;
    const response = await client.api.llmConnections.list({ page, limit });
    response.data.forEach((item) => remoteMap.set(item.provider, item));
    totalPages = response.meta.totalPages;
  }

  let hasDiff = false;

  for (const filePath of files) {
    const localFile = await readConnectionFile(filePath);
    const local = resolveConnectionForCheck(localFile, envFilter);
    if (!local) {
      continue;
    }

    const remote = remoteMap.get(local.provider);
    if (!remote) {
      hasDiff = true;
      console.log(`${local.provider}: missing in Langfuse`);
      continue;
    }

    const normalizedRemote = normalizeRemoteConnection(remote);
    const issues: string[] = [];

    if (local.adapter !== normalizedRemote.adapter) {
      issues.push(
        `adapter mismatch (local ${local.adapter}, remote ${normalizedRemote.adapter})`,
      );
    }

    if ((local.baseURL ?? "") !== (normalizedRemote.baseURL ?? "")) {
      issues.push(
        `baseURL mismatch (local ${local.baseURL ?? "(empty)"}, remote ${normalizedRemote.baseURL ?? "(empty)"})`,
      );
    }

    if (local.withDefaultModels !== normalizedRemote.withDefaultModels) {
      issues.push(
        `withDefaultModels mismatch (local ${local.withDefaultModels}, remote ${normalizedRemote.withDefaultModels})`,
      );
    }

    if (
      !compareStringArrays(local.customModels, normalizedRemote.customModels)
    ) {
      issues.push(
        `customModels mismatch (local ${local.customModels.join(", ") || "(none)"}, remote ${normalizedRemote.customModels.join(", ") || "(none)"})`,
      );
    }

    if (
      !compareStringArrays(
        local.extraHeaderKeys,
        normalizedRemote.extraHeaderKeys,
      )
    ) {
      issues.push(
        `extra headers mismatch (local ${local.extraHeaderKeys.join(", ") || "(none)"}, remote ${normalizedRemote.extraHeaderKeys.join(", ") || "(none)"})`,
      );
    }

    if (
      JSON.stringify(local.config ?? {}) !==
      JSON.stringify(normalizedRemote.config ?? {})
    ) {
      issues.push("config mismatch");
    }

    if (issues.length > 0) {
      hasDiff = true;
      console.log(`${local.provider}: ${issues.join("; ")}`);
    }
  }

  if (hasDiff) {
    process.exit(1);
  }

  console.log("All LLM connections match Langfuse.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
