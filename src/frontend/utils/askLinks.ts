import { format } from "date-fns";
import { resolveNowMs } from "./now";
import type { AskConversation, AskMessage } from "../../types/ask";

export type ListMode = "mine" | "shared" | "archived";

export const formatTime = (value: string) => format(new Date(value), "HH:mm");
export const formatUpdated = (value: string) =>
  format(new Date(value), "MMM d");
export const truncate = (text: string, maxLen: number) =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

export const resolveListMode = (value: string | null): ListMode => {
  if (value === "shared") return "shared";
  if (value === "archived") return "archived";
  return "mine";
};

export const buildAskUrl = (options: {
  origin: string;
  serverId: string;
  conversationId: string;
  listMode: ListMode;
  messageId?: string | null;
}) => {
  const { origin, serverId, conversationId, listMode, messageId } = options;
  const url = new URL(
    `/portal/server/${serverId}/ask/${conversationId}`,
    origin,
  );
  url.searchParams.set("list", listMode);
  if (messageId) {
    url.searchParams.set("messageId", messageId);
  }
  return url.toString();
};

export const buildPublicAskUrl = (options: {
  origin: string;
  serverId: string;
  conversationId: string;
  messageId?: string | null;
}) => {
  const { origin, serverId, conversationId, messageId } = options;
  const url = new URL(`/share/ask/${serverId}/${conversationId}`, origin);
  if (messageId) {
    url.searchParams.set("messageId", messageId);
  }
  return url.toString();
};

const resolveNowIso = () => new Date(resolveNowMs()).toISOString();

export const buildThinkingMessage = (): AskMessage => ({
  id: "thinking",
  role: "chronote",
  text: "Thinking...",
  createdAt: resolveNowIso(),
});

const hasOptimisticMessage = (
  base: AskMessage[],
  optimisticMessages: AskMessage[],
) =>
  base === optimisticMessages ||
  base.some(
    (msg) => msg.role === "user" && msg.text === optimisticMessages[0]?.text,
  );

export const buildDisplayMessages = (options: {
  activeConversation: AskConversation | null;
  activeId: string | null;
  activeMessages: AskMessage[];
  optimisticMessages: AskMessage[];
  isPending: boolean;
}) => {
  const {
    activeConversation,
    activeId,
    activeMessages,
    optimisticMessages,
    isPending,
  } = options;
  const base =
    activeConversation || activeId ? activeMessages : optimisticMessages;
  const pending =
    isPending && optimisticMessages.length > 0 ? [buildThinkingMessage()] : [];

  if (!optimisticMessages.length) {
    return [...base, ...pending];
  }

  if (hasOptimisticMessage(base, optimisticMessages)) {
    return [...base, ...pending];
  }

  return [...base, ...optimisticMessages, ...pending];
};
