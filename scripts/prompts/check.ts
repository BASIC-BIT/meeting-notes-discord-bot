import { getPrompt } from "./langfuseApi";
import {
  compareChatMessages,
  compareLabelArrays,
  compareStringArrays,
  listPromptFiles,
  normalizePromptText,
  readPromptFileResolved,
  ChatMessage,
} from "./shared";

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const dir = parseFlagValue("--dir") ?? "prompts";
  const label =
    parseFlagValue("--label") ??
    process.env.LANGFUSE_PROMPT_LABEL ??
    "production";

  const files = await listPromptFiles(dir);
  if (files.length === 0) {
    console.log(`No prompt files found in ${dir}.`);
    return;
  }

  let hasDiff = false;

  for (const filePath of files) {
    const local = await readPromptFileResolved(filePath, dir);
    if (local.fragment) {
      continue;
    }
    const remote = await getPrompt({ name: local.name, label });

    const issues: string[] = [];
    if (local.type !== remote.type) {
      issues.push(`type mismatch (local ${local.type}, remote ${remote.type})`);
    }

    if (
      local.labels.length > 0 &&
      !compareLabelArrays(local.labels, remote.labels)
    ) {
      issues.push(
        `labels mismatch (local ${local.labels.join(", ")}, remote ${remote.labels.join(", ")})`,
      );
    }

    if (
      local.tags.length > 0 &&
      !compareStringArrays(local.tags, remote.tags)
    ) {
      issues.push(
        `tags mismatch (local ${local.tags.join(", ")}, remote ${remote.tags.join(", ")})`,
      );
    }

    if (
      JSON.stringify(local.config ?? {}) !== JSON.stringify(remote.config ?? {})
    ) {
      issues.push("config mismatch");
    }

    if (local.type === "chat") {
      const match = compareChatMessages(
        local.prompt as ChatMessage[],
        remote.prompt as ChatMessage[],
      );
      if (!match) {
        issues.push("chat prompt mismatch");
      }
    } else {
      const localText = normalizePromptText(local.prompt as string);
      const remoteText = normalizePromptText(remote.prompt as string);
      if (localText !== remoteText) {
        issues.push("text prompt mismatch");
      }
    }

    if (issues.length > 0) {
      hasDiff = true;
      console.log(`${local.name}: ${issues.join("; ")}`);
    }
  }

  if (hasDiff) {
    process.exit(1);
  }
  console.log("All prompts match Langfuse.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
