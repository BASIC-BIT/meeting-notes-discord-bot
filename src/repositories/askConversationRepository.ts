import { config } from "../services/configService";
import {
  getAskConversation,
  listAskConversations,
  listAskMessages,
  writeAskConversation,
  writeAskMessage,
} from "../db";
import type { AskConversation, AskMessage } from "../types/ask";
import type { AskConversationRecord, AskMessageRecord } from "../types/db";
import { getMockStore } from "./mockStore";

const buildPartitionKey = (userId: string, guildId: string) =>
  `USER#${userId}#GUILD#${guildId}`;

const toConversation = (record: AskConversationRecord): AskConversation => ({
  id: record.conversationId,
  title: record.title,
  summary: record.summary,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const toMessage = (record: AskMessageRecord): AskMessage => ({
  id: record.messageId,
  role: record.role,
  text: record.text,
  createdAt: record.createdAt,
  sourceMeetingIds: record.sourceMeetingIds,
});

export type AskConversationRepository = {
  listConversations: (
    userId: string,
    guildId: string,
  ) => Promise<AskConversation[]>;
  getConversation: (
    userId: string,
    guildId: string,
    conversationId: string,
  ) => Promise<AskConversation | undefined>;
  listMessages: (
    userId: string,
    guildId: string,
    conversationId: string,
  ) => Promise<AskMessage[]>;
  writeConversation: (
    userId: string,
    guildId: string,
    conversation: AskConversation,
  ) => Promise<void>;
  writeMessage: (
    userId: string,
    guildId: string,
    conversationId: string,
    message: AskMessage,
  ) => Promise<void>;
};

const realRepository: AskConversationRepository = {
  async listConversations(userId, guildId) {
    const records = await listAskConversations(userId, guildId);
    return records.map(toConversation);
  },
  async getConversation(userId, guildId, conversationId) {
    const record = await getAskConversation(userId, guildId, conversationId);
    return record ? toConversation(record) : undefined;
  },
  async listMessages(userId, guildId, conversationId) {
    const records = await listAskMessages(userId, guildId, conversationId);
    return records.map(toMessage);
  },
  async writeConversation(userId, guildId, conversation) {
    const record: AskConversationRecord = {
      pk: buildPartitionKey(userId, guildId),
      sk: `CONV#${conversation.id}`,
      type: "conversation",
      conversationId: conversation.id,
      guildId,
      userId,
      title: conversation.title,
      summary: conversation.summary,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
    await writeAskConversation(record);
  },
  async writeMessage(userId, guildId, conversationId, message) {
    const record: AskMessageRecord = {
      pk: buildPartitionKey(userId, guildId),
      sk: `MSG#${conversationId}#${message.createdAt}#${message.id}`,
      type: "message",
      conversationId,
      messageId: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      sourceMeetingIds: message.sourceMeetingIds,
    };
    await writeAskMessage(record);
  },
};

const mockRepository: AskConversationRepository = {
  async listConversations(userId, guildId) {
    const key = buildPartitionKey(userId, guildId);
    return getMockStore().askConversationsByKey.get(key) ?? [];
  },
  async getConversation(userId, guildId, conversationId) {
    const key = buildPartitionKey(userId, guildId);
    const conversations = getMockStore().askConversationsByKey.get(key) ?? [];
    return conversations.find((conv) => conv.id === conversationId);
  },
  async listMessages(userId, guildId, conversationId) {
    const key = `${buildPartitionKey(userId, guildId)}#${conversationId}`;
    return getMockStore().askMessagesByConversation.get(key) ?? [];
  },
  async writeConversation(userId, guildId, conversation) {
    const store = getMockStore();
    const key = buildPartitionKey(userId, guildId);
    const conversations = store.askConversationsByKey.get(key) ?? [];
    const updated = conversations.filter((item) => item.id !== conversation.id);
    updated.unshift(conversation);
    store.askConversationsByKey.set(key, updated);
  },
  async writeMessage(userId, guildId, conversationId, message) {
    const store = getMockStore();
    const key = `${buildPartitionKey(userId, guildId)}#${conversationId}`;
    const messages = store.askMessagesByConversation.get(key) ?? [];
    messages.push(message);
    store.askMessagesByConversation.set(key, messages);
  },
};

export function getAskConversationRepository(): AskConversationRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
