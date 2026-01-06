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
