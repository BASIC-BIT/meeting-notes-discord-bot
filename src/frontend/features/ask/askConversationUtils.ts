import type { AskConversation, AskMessage } from "../../../types/ask";
import { truncate, type ListMode } from "../../utils/askLinks";

const ASK_TITLE_MAX_LENGTH = 48;

export const buildConversationListUpdate =
  (conversation: AskConversation) =>
  (prev?: { conversations: AskConversation[] } | null) => {
    const existing = prev?.conversations ?? [];
    const updated = existing.filter((conv) => conv.id !== conversation.id);
    return { conversations: [conversation, ...updated] };
  };

export const buildConversationDetailUpdate =
  (conversation: AskConversation) =>
  (prev?: { messages: AskMessage[] } | null) => ({
    conversation,
    messages: prev?.messages ?? [],
  });

export const mergeAskMessages = (
  existing: AskMessage[],
  incoming: AskMessage[],
) => {
  const merged: AskMessage[] = [];
  const seen = new Set<string>();
  for (const message of [...existing, ...incoming]) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    merged.push(message);
  }
  return merged;
};

export const buildConversationMessagesUpdate =
  (conversation: AskConversation, incoming: AskMessage[]) =>
  (prev?: { messages: AskMessage[] } | null) => ({
    conversation,
    messages: mergeAskMessages(prev?.messages ?? [], incoming),
  });

export const buildOptimisticUserMessage = (
  question: string,
  createdAt: string,
): AskMessage => ({
  id: `optimistic-${createdAt}`,
  role: "user",
  text: question,
  createdAt,
});

export const buildOptimisticConversation = (
  question: string,
  createdAt: string,
): AskConversation => ({
  id: "pending",
  title: truncate(question, ASK_TITLE_MAX_LENGTH),
  summary: "",
  createdAt,
  updatedAt: createdAt,
});

export const canSubmitAsk = (options: {
  selectedGuildId: string | null;
  question: string;
  listMode: ListMode;
  askAccessAllowed: boolean;
  isArchived: boolean;
}) => {
  if (!options.selectedGuildId) return false;
  if (!options.question) return false;
  if (options.listMode !== "mine") return false;
  if (!options.askAccessAllowed) return false;
  if (options.isArchived) return false;
  return true;
};
