import { config } from "../services/configService";
import {
  getAskConversation,
  listAskConversations,
  listAskMessages,
  listAskConversationShares,
  getAskConversationShare,
  writeAskConversation,
  writeAskMessage,
  writeAskConversationShare,
  deleteAskConversationShare,
} from "../db";
import type {
  AskConversation,
  AskMessage,
  AskSharedConversation,
} from "../types/ask";
import type {
  AskConversationRecord,
  AskMessageRecord,
  AskConversationShareRecord,
} from "../types/db";
import { getMockStore } from "./mockStore";

const buildPartitionKey = (userId: string, guildId: string) =>
  `USER#${userId}#GUILD#${guildId}`;

const toConversation = (record: AskConversationRecord): AskConversation => ({
  id: record.conversationId,
  title: record.title,
  summary: record.summary,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  visibility: record.visibility,
  sharedAt: record.sharedAt,
  sharedByUserId: record.sharedByUserId,
  sharedByTag: record.sharedByTag,
});

const toMessage = (record: AskMessageRecord): AskMessage => ({
  id: record.messageId,
  role: record.role,
  text: record.text,
  createdAt: record.createdAt,
  sourceMeetingIds: record.sourceMeetingIds,
});

const toSharedConversation = (
  record: AskConversationShareRecord,
): AskSharedConversation => ({
  conversationId: record.conversationId,
  title: record.title,
  summary: record.summary,
  updatedAt: record.updatedAt,
  sharedAt: record.sharedAt,
  ownerUserId: record.ownerUserId,
  ownerTag: record.ownerTag,
});

export type AskConversationRepository = {
  listConversations: (
    userId: string,
    guildId: string,
  ) => Promise<AskConversation[]>;
  listSharedConversations: (
    guildId: string,
  ) => Promise<AskSharedConversation[]>;
  getConversation: (
    userId: string,
    guildId: string,
    conversationId: string,
  ) => Promise<AskConversation | undefined>;
  getSharedConversation: (
    guildId: string,
    conversationId: string,
  ) => Promise<AskSharedConversation | undefined>;
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
  writeSharedConversation: (
    record: AskConversationShareRecord,
  ) => Promise<void>;
  deleteSharedConversation: (
    guildId: string,
    conversationId: string,
  ) => Promise<void>;
};

const realRepository: AskConversationRepository = {
  async listConversations(userId, guildId) {
    const records = await listAskConversations(userId, guildId);
    return records.map(toConversation);
  },
  async listSharedConversations(guildId) {
    const records = await listAskConversationShares(guildId);
    return records.map(toSharedConversation);
  },
  async getConversation(userId, guildId, conversationId) {
    const record = await getAskConversation(userId, guildId, conversationId);
    return record ? toConversation(record) : undefined;
  },
  async getSharedConversation(guildId, conversationId) {
    const record = await getAskConversationShare(guildId, conversationId);
    return record ? toSharedConversation(record) : undefined;
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
      visibility: conversation.visibility,
      sharedAt: conversation.sharedAt,
      sharedByUserId: conversation.sharedByUserId,
      sharedByTag: conversation.sharedByTag,
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
  async writeSharedConversation(record) {
    await writeAskConversationShare(record);
  },
  async deleteSharedConversation(guildId, conversationId) {
    await deleteAskConversationShare(guildId, conversationId);
  },
};

const mockRepository: AskConversationRepository = {
  async listConversations(userId, guildId) {
    const key = buildPartitionKey(userId, guildId);
    return getMockStore().askConversationsByKey.get(key) ?? [];
  },
  async listSharedConversations(guildId) {
    return getMockStore().askSharesByGuild.get(guildId) ?? [];
  },
  async getConversation(userId, guildId, conversationId) {
    const key = buildPartitionKey(userId, guildId);
    const conversations = getMockStore().askConversationsByKey.get(key) ?? [];
    return conversations.find((conv) => conv.id === conversationId);
  },
  async getSharedConversation(guildId, conversationId) {
    const shares = getMockStore().askSharesByGuild.get(guildId) ?? [];
    return shares.find((conv) => conv.conversationId === conversationId);
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
  async writeSharedConversation(record) {
    const store = getMockStore();
    const shares = store.askSharesByGuild.get(record.guildId) ?? [];
    const updated = shares.filter(
      (item) => item.conversationId !== record.conversationId,
    );
    updated.unshift(toSharedConversation(record));
    store.askSharesByGuild.set(record.guildId, updated);
  },
  async deleteSharedConversation(guildId, conversationId) {
    const store = getMockStore();
    const shares = store.askSharesByGuild.get(guildId) ?? [];
    store.askSharesByGuild.set(
      guildId,
      shares.filter((item) => item.conversationId !== conversationId),
    );
  },
};

export function getAskConversationRepository(): AskConversationRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
