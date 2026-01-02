import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getMeetingHistoryService,
  listRecentMeetingsForGuildService,
  updateMeetingArchiveService,
} from "../../services/meetingHistoryService";
import { ensureBotInGuild } from "../../services/guildAccessService";
import { config } from "../../services/configService";
import { buildMeetingTimelineEventsFromHistory } from "../../services/meetingTimelineService";
import {
  fetchJsonFromS3,
  getSignedObjectUrl,
} from "../../services/storageService";
import { isDiscordApiError } from "../../services/discordService";
import { listGuildChannelsCached } from "../../services/discordCacheService";
import type { ChatEntry } from "../../types/chat";
import type { MeetingEvent } from "../../types/meetingTimeline";
import type { Participant } from "../../types/participants";
import type { TranscriptPayload } from "../../types/transcript";
import { MEETING_STATUS } from "../../types/meetingLifecycle";
import { manageGuildProcedure, router } from "../trpc";

const resolveParticipantLabel = (participant: Participant) =>
  participant.serverNickname ||
  participant.displayName ||
  participant.username ||
  participant.tag ||
  "Unknown";

const list = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      limit: z.number().min(1).max(100).optional(),
      archivedOnly: z.boolean().optional(),
    }),
  )
  .query(async ({ input }) => {
    const botCheck = await ensureBotInGuild(input.serverId);
    if (botCheck === null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
      });
    }
    if (!botCheck) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bot is not in that guild",
      });
    }

    const limit = input.limit ?? config.ask.maxMeetings;
    const meetings = await listRecentMeetingsForGuildService(
      input.serverId,
      limit,
      { archivedOnly: input.archivedOnly },
    );

    let channels: Array<{ id: string; name: string; type: number }> = [];
    try {
      channels = await listGuildChannelsCached(input.serverId);
    } catch (err) {
      if (isDiscordApiError(err) && err.status === 429) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Discord rate limited. Please retry.",
        });
      }
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Unable to fetch guild channels",
      });
    }
    const channelMap = new Map(
      channels.map((channel) => [channel.id, channel.name]),
    );

    return {
      meetings: meetings.map((meeting) => ({
        status: meeting.status ?? MEETING_STATUS.COMPLETE,
        id: meeting.channelId_timestamp,
        meetingId: meeting.meetingId,
        channelId: meeting.channelId,
        channelName: channelMap.get(meeting.channelId) ?? meeting.channelId,
        timestamp: meeting.timestamp,
        duration:
          meeting.status === MEETING_STATUS.IN_PROGRESS ||
          meeting.status === MEETING_STATUS.PROCESSING ||
          ((meeting.status === null || meeting.status === undefined) &&
            meeting.duration === 0)
            ? Math.max(
                0,
                Math.floor((Date.now() - Date.parse(meeting.timestamp)) / 1000),
              )
            : meeting.duration,
        tags: meeting.tags ?? [],
        notes: meeting.notes ?? "",
        summarySentence: meeting.summarySentence,
        summaryLabel: meeting.summaryLabel,
        notesChannelId: meeting.notesChannelId,
        notesMessageId: meeting.notesMessageIds?.[0],
        audioAvailable: Boolean(meeting.audioS3Key),
        transcriptAvailable: Boolean(meeting.transcriptS3Key),
        archivedAt: meeting.archivedAt,
        archivedByUserId: meeting.archivedByUserId,
      })),
    };
  });

const detail = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      meetingId: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const history = await getMeetingHistoryService(
      input.serverId,
      input.meetingId,
    );
    if (!history) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
    }

    const transcriptPayload = history.transcriptS3Key
      ? await fetchJsonFromS3<TranscriptPayload>(history.transcriptS3Key)
      : undefined;
    const transcript = transcriptPayload?.text ?? "";

    let chatEntries: ChatEntry[] | undefined;
    if (history.chatS3Key) {
      chatEntries = await fetchJsonFromS3<ChatEntry[]>(history.chatS3Key);
    }
    const events: MeetingEvent[] = buildMeetingTimelineEventsFromHistory({
      history,
      transcriptPayload,
      chatEntries,
    });

    const audioUrl = history.audioS3Key
      ? await getSignedObjectUrl(history.audioS3Key)
      : undefined;

    return {
      meeting: {
        status: history.status ?? MEETING_STATUS.COMPLETE,
        id: history.channelId_timestamp,
        meetingId: history.meetingId,
        channelId: history.channelId,
        timestamp: history.timestamp,
        duration:
          history.status === MEETING_STATUS.IN_PROGRESS ||
          history.status === MEETING_STATUS.PROCESSING ||
          ((history.status === null || history.status === undefined) &&
            history.duration === 0)
            ? Math.max(
                0,
                Math.floor((Date.now() - Date.parse(history.timestamp)) / 1000),
              )
            : history.duration,
        tags: history.tags ?? [],
        notes: history.notes ?? "",
        summarySentence: history.summarySentence,
        summaryLabel: history.summaryLabel,
        notesChannelId: history.notesChannelId,
        notesMessageId: history.notesMessageIds?.[0],
        transcript,
        audioUrl,
        archivedAt: history.archivedAt,
        archivedByUserId: history.archivedByUserId,
        attendees:
          history.participants?.map((participant) =>
            resolveParticipantLabel(participant),
          ) ??
          history.attendees ??
          [],
        events,
      },
    };
  });

const setArchived = manageGuildProcedure
  .input(
    z.object({
      serverId: z.string(),
      meetingId: z.string(),
      archived: z.boolean(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const ok = await updateMeetingArchiveService({
      guildId: input.serverId,
      channelId_timestamp: input.meetingId,
      archived: input.archived,
      archivedByUserId: ctx.user.id,
    });
    if (!ok) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
    }
    return { ok: true };
  });

export const meetingsRouter = router({
  list,
  detail,
  setArchived,
});
