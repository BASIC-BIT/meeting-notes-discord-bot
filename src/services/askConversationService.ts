import { v4 as uuid } from "uuid";
import { answerQuestionService } from "./askService";
import { getAskConversationRepository } from "../repositories/askConversationRepository";
import type { AskConversation, AskMessage } from "../types/ask";
import { nowIso } from "../utils/time";

const DEFAULT_TITLE = "New question";

const truncate = (text: string, maxLen: number) =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

const summarize = (text: string) =>
  truncate(text.replace(/\s+/g, " ").trim(), 160);

const buildConversation = (
  userId: string,
  guildId: string,
  conversationId?: string,
): AskConversation => {
  const now = nowIso();
  return {
    id: conversationId ?? uuid(),
    title: DEFAULT_TITLE,
    summary: "",
    createdAt: now,
    updatedAt: now,
  };
};

export async function listAskConversations(userId: string, guildId: string) {
  const repo = getAskConversationRepository();
  const conversations = await repo.listConversations(userId, guildId);
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAskConversationWithMessages(
  userId: string,
  guildId: string,
  conversationId: string,
) {
  const repo = getAskConversationRepository();
  const conversation = await repo.getConversation(
    userId,
    guildId,
    conversationId,
  );
  if (!conversation) {
    return undefined;
  }
  const messages = await repo.listMessages(userId, guildId, conversationId);
  return {
    conversation,
    messages,
  };
}

export async function renameAskConversation(
  userId: string,
  guildId: string,
  conversationId: string,
  title: string,
) {
  const repo = getAskConversationRepository();
  const existing = await repo.getConversation(userId, guildId, conversationId);
  if (!existing) {
    return undefined;
  }
  const updated: AskConversation = {
    ...existing,
    title,
    updatedAt: nowIso(),
  };
  await repo.writeConversation(userId, guildId, updated);
  return updated;
}

export async function askWithConversation(params: {
  userId: string;
  guildId: string;
  question: string;
  conversationId?: string;
  channelId?: string;
  tags?: string[];
  scope?: "guild" | "channel";
}) {
  const repo = getAskConversationRepository();
  const { userId, guildId, question, conversationId, channelId, tags, scope } =
    params;
  const existing = conversationId
    ? await repo.getConversation(userId, guildId, conversationId)
    : undefined;
  const conversation =
    existing ?? buildConversation(userId, guildId, conversationId);
  const priorMessages = existing
    ? await repo.listMessages(userId, guildId, conversation.id)
    : [];
  if (!existing) {
    await repo.writeConversation(userId, guildId, conversation);
  }

  const userMessage: AskMessage = {
    id: uuid(),
    role: "user",
    text: question,
    createdAt: nowIso(),
  };
  await repo.writeMessage(userId, guildId, conversation.id, userMessage);

  const history = priorMessages.slice(-10).map((message) => ({
    role: message.role,
    text: message.text,
  }));

  const { answer, sourceMeetingIds } = await answerQuestionService({
    guildId,
    channelId: channelId ?? "",
    question,
    tags,
    scope,
    history,
  });

  const replyMessage: AskMessage = {
    id: uuid(),
    role: "chronote",
    text: answer,
    createdAt: nowIso(),
    sourceMeetingIds,
  };
  await repo.writeMessage(userId, guildId, conversation.id, replyMessage);

  const shouldUpdateTitle =
    conversation.title === DEFAULT_TITLE ||
    conversation.title.trim().length === 0;
  const updatedConversation: AskConversation = {
    ...conversation,
    title: shouldUpdateTitle ? truncate(question, 80) : conversation.title,
    summary: summarize(answer) || conversation.summary,
    updatedAt: nowIso(),
  };
  await repo.writeConversation(userId, guildId, updatedConversation);

  return {
    conversationId: conversation.id,
    answer,
    sourceMeetingIds,
    conversation: updatedConversation,
    messages: [userMessage, replyMessage],
  };
}
