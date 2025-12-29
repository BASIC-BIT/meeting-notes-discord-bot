import { config } from "../services/configService";
import {
  getMeetingHistory as getMeetingHistoryRecord,
  getMeetingsForGuildInRange,
  getRecentMeetingsForChannel,
  getRecentMeetingsForGuild,
  updateMeetingNotes,
  updateMeetingStatus,
  updateMeetingTags,
  writeMeetingHistory,
} from "../db";
import type { MeetingHistory, SuggestionHistoryEntry } from "../types/db";
import { getMockStore } from "./mockStore";

export type MeetingHistoryRepository = {
  write: (history: MeetingHistory) => Promise<void>;
  get: (
    guildId: string,
    channelIdTimestamp: string,
  ) => Promise<MeetingHistory | undefined>;
  listRecentByGuild: (
    guildId: string,
    limit?: number,
  ) => Promise<MeetingHistory[]>;
  listByGuildTimestampRange: (
    guildId: string,
    startTimestamp: string,
    endTimestamp: string,
  ) => Promise<MeetingHistory[]>;
  listRecentByChannel: (
    guildId: string,
    channelId: string,
    limit?: number,
  ) => Promise<MeetingHistory[]>;
  updateNotes: (params: {
    guildId: string;
    channelId_timestamp: string;
    notes: string;
    notesVersion: number;
    editedBy: string;
    summarySentence?: string;
    summaryLabel?: string;
    suggestion?: SuggestionHistoryEntry;
    expectedPreviousVersion?: number;
    metadata?: { notesMessageIds?: string[]; notesChannelId?: string };
  }) => Promise<boolean>;
  updateStatus: (
    guildId: string,
    channelIdTimestamp: string,
    status: "in_progress" | "processing" | "complete",
  ) => Promise<void>;
  updateTags: (
    guildId: string,
    channelIdTimestamp: string,
    tags?: string[],
  ) => Promise<void>;
};

const realRepository: MeetingHistoryRepository = {
  write: writeMeetingHistory,
  get: getMeetingHistoryRecord,
  listRecentByGuild: getRecentMeetingsForGuild,
  listByGuildTimestampRange: getMeetingsForGuildInRange,
  listRecentByChannel: getRecentMeetingsForChannel,
  updateNotes: (params) =>
    updateMeetingNotes(
      params.guildId,
      params.channelId_timestamp,
      params.notes,
      params.notesVersion,
      params.editedBy,
      params.summarySentence,
      params.summaryLabel,
      params.suggestion,
      params.expectedPreviousVersion,
      params.metadata,
    ),
  updateStatus: updateMeetingStatus,
  updateTags: updateMeetingTags,
};

const mockRepository: MeetingHistoryRepository = {
  async write(history) {
    const store = getMockStore();
    const existing = store.meetingHistoryByGuild.get(history.guildId) ?? [];
    const idx = existing.findIndex(
      (item) => item.channelId_timestamp === history.channelId_timestamp,
    );
    if (idx >= 0) {
      existing[idx] = history;
    } else {
      existing.push(history);
    }
    store.meetingHistoryByGuild.set(history.guildId, existing);
  },
  async get(guildId, channelIdTimestamp) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    return items.find(
      (item) => item.channelId_timestamp === channelIdTimestamp,
    );
  },
  async listRecentByGuild(guildId, limit = 10) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    return [...items]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  },
  async listRecentByChannel(guildId, channelId, limit = 5) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    return items
      .filter((item) => item.channelId === channelId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  },
  async listByGuildTimestampRange(guildId, startTimestamp, endTimestamp) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    return items.filter((item) => {
      if (!item.timestamp) return false;
      return item.timestamp >= startTimestamp && item.timestamp <= endTimestamp;
    });
  },
  async updateNotes(params) {
    const items =
      getMockStore().meetingHistoryByGuild.get(params.guildId) ?? [];
    const idx = items.findIndex(
      (item) => item.channelId_timestamp === params.channelId_timestamp,
    );
    if (idx === -1) return false;
    const now = new Date().toISOString();
    const existing = items[idx];
    items[idx] = {
      ...existing,
      notes: params.notes,
      summarySentence: params.summarySentence ?? existing.summarySentence,
      summaryLabel: params.summaryLabel ?? existing.summaryLabel,
      notesVersion: params.notesVersion,
      notesLastEditedBy: params.editedBy,
      notesLastEditedAt: now,
      updatedAt: now,
      notesMessageIds:
        params.metadata?.notesMessageIds ?? existing.notesMessageIds,
      notesChannelId:
        params.metadata?.notesChannelId ?? existing.notesChannelId,
    };
    getMockStore().meetingHistoryByGuild.set(params.guildId, items);
    return true;
  },
  async updateTags(guildId, channelIdTimestamp, tags) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    const idx = items.findIndex(
      (item) => item.channelId_timestamp === channelIdTimestamp,
    );
    if (idx === -1) return;
    items[idx] = { ...items[idx], tags: tags ?? [] };
    getMockStore().meetingHistoryByGuild.set(guildId, items);
  },
  async updateStatus(guildId, channelIdTimestamp, status) {
    const items = getMockStore().meetingHistoryByGuild.get(guildId) ?? [];
    const idx = items.findIndex(
      (item) => item.channelId_timestamp === channelIdTimestamp,
    );
    if (idx === -1) return;
    items[idx] = {
      ...items[idx],
      status,
      updatedAt: new Date().toISOString(),
    };
    getMockStore().meetingHistoryByGuild.set(guildId, items);
  },
};

export function getMeetingHistoryRepository(): MeetingHistoryRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
