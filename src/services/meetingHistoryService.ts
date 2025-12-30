import type { MeetingHistory, SuggestionHistoryEntry } from "../types/db";
import type { MeetingStatus } from "../types/meetingLifecycle";
import { getMeetingHistoryRepository } from "../repositories/meetingHistoryRepository";

export async function writeMeetingHistoryService(history: MeetingHistory) {
  await getMeetingHistoryRepository().write(history);
}

export async function getMeetingHistoryService(
  guildId: string,
  channelIdTimestamp: string,
) {
  return getMeetingHistoryRepository().get(guildId, channelIdTimestamp);
}

export async function listRecentMeetingsForGuildService(
  guildId: string,
  limit?: number,
) {
  return getMeetingHistoryRepository().listRecentByGuild(guildId, limit);
}

export async function listMeetingsForGuildInRangeService(
  guildId: string,
  startTimestamp: string,
  endTimestamp: string,
) {
  return getMeetingHistoryRepository().listByGuildTimestampRange(
    guildId,
    startTimestamp,
    endTimestamp,
  );
}

export async function listRecentMeetingsForChannelService(
  guildId: string,
  channelId: string,
  limit?: number,
) {
  return getMeetingHistoryRepository().listRecentByChannel(
    guildId,
    channelId,
    limit,
  );
}

export async function updateMeetingNotesService(params: {
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
}) {
  return getMeetingHistoryRepository().updateNotes(params);
}

export async function updateMeetingTagsService(
  guildId: string,
  channelIdTimestamp: string,
  tags?: string[],
) {
  await getMeetingHistoryRepository().updateTags(
    guildId,
    channelIdTimestamp,
    tags,
  );
}

export async function updateMeetingStatusService(params: {
  guildId: string;
  channelId_timestamp: string;
  status: MeetingStatus;
}) {
  return getMeetingHistoryRepository().updateStatus(
    params.guildId,
    params.channelId_timestamp,
    params.status,
  );
}
