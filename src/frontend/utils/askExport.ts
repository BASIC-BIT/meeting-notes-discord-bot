import type { AskConversation, AskMessage } from "../../types/ask";

export type AskThreadExport = {
  exportedAt: string;
  serverId: string;
  conversation: AskConversation;
  messages: AskMessage[];
};

export const buildAskThreadExport = (options: {
  serverId: string;
  conversation: AskConversation;
  messages: AskMessage[];
  exportedAt?: string;
}): AskThreadExport => ({
  exportedAt: options.exportedAt ?? new Date().toISOString(),
  serverId: options.serverId,
  conversation: options.conversation,
  messages: options.messages,
});

export const normalizeAskExportMessages = (messages: AskMessage[]) =>
  messages
    .filter((message) => message.id !== "thinking")
    .map((message) => ({
      ...message,
      rawText: message.rawText ?? message.text,
    }));

export const buildAskExportFileName = (options: {
  title: string;
  exportedAt: string;
  extension: "json" | "txt";
}) => {
  const safeTitle = options.title.trim().replace(/[^\w-]+/g, "_");
  const date = options.exportedAt.slice(0, 10);
  return `${safeTitle || "ask-thread"}-${date}.${options.extension}`;
};

export const downloadAskExport = (
  contents: string,
  filename: string,
  type: string,
) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const formatAskThreadText = (options: {
  conversation: AskConversation;
  messages: AskMessage[];
  exportedAt?: string;
}) => {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const lines: string[] = [
    `Conversation: ${options.conversation.title}`,
    `Exported: ${exportedAt}`,
    "",
  ];
  for (const message of options.messages) {
    const roleLabel = message.role === "user" ? "You" : "Chronote";
    lines.push(`[${message.createdAt}] ${roleLabel}:`, message.text, "");
  }
  return lines.join("\n").trim();
};
