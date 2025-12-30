import fs from "node:fs/promises";
import path from "node:path";
import { getPrompt, listPrompts } from "./langfuseApi";
import {
  buildPromptPath,
  formatPromptFile,
  listPromptFiles,
  mergeFrontMatter,
  normalizeLabels,
  readPromptFile,
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

async function collectExistingFrontMatter(dir: string) {
  const existing = new Map<
    string,
    { extra: Record<string, unknown>; hasExtends: boolean }
  >();
  try {
    const files = await listPromptFiles(dir);
    for (const filePath of files) {
      try {
        const prompt = await readPromptFile(filePath);
        const hasExtends = prompt.extends.length > 0;
        existing.set(prompt.name, {
          extra: prompt.extraFrontMatter,
          hasExtends,
        });
      } catch (error) {
        console.warn(`Skipping ${filePath}, unable to parse.`);
      }
    }
  } catch (error) {
    return existing;
  }
  return existing;
}

async function main() {
  const dir = parseFlagValue("--dir") ?? "prompts";
  const label =
    parseFlagValue("--label") ??
    process.env.LANGFUSE_PROMPT_LABEL ??
    "production";
  const limit = Number.parseInt(parseFlagValue("--limit") ?? "100", 10) || 100;
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");

  await fs.mkdir(dir, { recursive: true });
  const existingExtras = await collectExistingFrontMatter(dir);

  let page = 1;
  let totalPages = 1;
  const promptNames: string[] = [];

  while (page <= totalPages) {
    const response = await listPrompts({ label, page, limit });
    response.data.forEach((item) => promptNames.push(item.name));
    totalPages = response.meta.totalPages;
    page += 1;
  }

  if (promptNames.length === 0) {
    console.log("No prompts returned from Langfuse.");
    return;
  }

  for (const name of promptNames) {
    const prompt = await getPrompt({ name, label });
    const existing = existingExtras.get(name);
    if (existing?.hasExtends && !force) {
      console.log(`Skip ${name}, local prompt uses extends.`);
      continue;
    }
    const extra = existing?.extra ?? {};
    const baseFrontMatter: Record<string, unknown> = {
      name: prompt.name,
      type: prompt.type,
      version: prompt.version,
      labels: normalizeLabels(prompt.labels),
      tags: prompt.tags,
      config: prompt.config ?? {},
      commitMessage: prompt.commitMessage ?? undefined,
    };

    if (prompt.type === "chat") {
      baseFrontMatter.messages = prompt.prompt;
    }

    const frontMatter = mergeFrontMatter(extra, baseFrontMatter);
    const content = prompt.type === "text" ? String(prompt.prompt) : "";

    const filePath = buildPromptPath(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const output = formatPromptFile(frontMatter, content);

    if (dryRun) {
      console.log(`Would write ${filePath}`);
      continue;
    }

    await fs.writeFile(filePath, output, "utf8");
    console.log(`Pulled ${name} -> ${filePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
