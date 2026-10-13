import { z } from "zod";
import { ChatPromptClient, TextPromptClient } from "@langfuse/client";
import { getLangfuseClient, isLangfuseEnabled } from "./langfuseClient";

const base = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  version: z.number().int().positive(),
});
export const savedPromptSchema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("text"), template: z.string() }).strict(),
  base
    .extend({
      type: z.literal("chat"),
      template: z.array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
]);
export type SavedRecordingPrompt = z.infer<typeof savedPromptSchema>;
export async function snapshotRecordingPrompt(
  name: string,
  type: "text" | "chat",
  label: string,
): Promise<SavedRecordingPrompt> {
  const client = getLangfuseClient();
  if (!isLangfuseEnabled() || !client)
    throw new Error("Recording prompt unavailable");
  const options = {
    label,
    cacheTtlSeconds: 0,
    maxRetries: 0,
    fetchTimeoutMs: 5000,
  };
  const prompt =
    type === "chat"
      ? await client.prompt.get(name, { ...options, type: "chat" })
      : await client.prompt.get(name, options);
  // Only reusable template data, never provider config or a live SDK instance.
  const template =
    type === "chat" && Array.isArray(prompt.prompt)
      ? prompt.prompt.map((message) =>
          "role" in message
            ? { role: message.role, content: message.content }
            : message,
        )
      : prompt.prompt;
  return savedPromptSchema.parse({
    name: prompt.name,
    version: prompt.version,
    label,
    type,
    template,
  });
}
export function compileSavedPrompt(
  saved: SavedRecordingPrompt,
  variables: Record<string, string>,
) {
  const metadata = {
    name: saved.name,
    version: saved.version,
    labels: [saved.label],
    tags: [],
  };
  return saved.type === "chat"
    ? new ChatPromptClient({
        ...metadata,
        type: "chat",
        prompt: saved.template,
      }).compile(variables)
    : new TextPromptClient({
        ...metadata,
        type: "text",
        prompt: saved.template,
      }).compile(variables);
}
