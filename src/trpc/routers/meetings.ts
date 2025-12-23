import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getMeetingHistoryService,
  listRecentMeetingsForGuildService,
} from "../../services/meetingHistoryService";
import {
  ensureBotInGuild,
  ensureUserInGuild,
} from "../../services/guildAccessService";
import { config } from "../../services/configService";
import {
  fetchJsonFromS3,
  getSignedObjectUrl,
} from "../../services/storageService";
import {
  isDiscordApiError,
  listGuildChannels,
} from "../../services/discordService";
import type { Participant } from "../../types/participants";
import { authedProcedure, router } from "../trpc";

type TranscriptSegment = {
  userId: string;
  username?: string;
  displayName?: string;
  serverNickname?: string;
  tag?: string;
  startedAt: string;
  text?: string;
};

type TranscriptPayload = {
  generatedAt?: string;
  segments?: TranscriptSegment[];
  text?: string;
};

type ChatEntry = {
  type: "message" | "join" | "leave";
  user: Participant;
  channelId: string;
  content?: string;
  timestamp: string;
};

type MeetingEvent = {
  id: string;
  type: "voice" | "chat" | "presence" | "bot";
  time: string;
  speaker?: string;
  text: string;
};

const list = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      limit: z.number().min(1).max(100).optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const accessCheck = await ensureUserInGuild(
      ctx.user.accessToken,
      input.serverId,
    );
    if (accessCheck === null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
      });
    }
    if (!accessCheck) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Guild access required",
      });
    }

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
    );

    let channels: Array<{ id: string; name: string; type: number }> = [];
    try {
      channels = await listGuildChannels(input.serverId);
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
        id: meeting.channelId_timestamp,
        meetingId: meeting.meetingId,
        channelId: meeting.channelId,
        channelName: channelMap.get(meeting.channelId) ?? meeting.channelId,
        timestamp: meeting.timestamp,
        duration: meeting.duration,
        tags: meeting.tags ?? [],
        notes: meeting.notes ?? "",
        notesChannelId: meeting.notesChannelId,
        notesMessageId: meeting.notesMessageIds?.[0],
        audioAvailable: Boolean(meeting.audioS3Key),
        transcriptAvailable: Boolean(meeting.transcriptS3Key),
      })),
    };
  });

const detail = authedProcedure
  .input(
    z.object({
      serverId: z.string(),
      meetingId: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const accessCheck = await ensureUserInGuild(
      ctx.user.accessToken,
      input.serverId,
    );
    if (accessCheck === null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Discord rate limited. Please retry.",
      });
    }
    if (!accessCheck) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Guild access required",
      });
    }

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

    const meetingStart = Date.parse(history.timestamp);
    const events: MeetingEvent[] = [];
    let counter = 0;
    const formatElapsed = (seconds: number) => {
      const safe = Math.max(0, Math.floor(seconds));
      const hours = Math.floor(safe / 3600);
      const minutes = Math.floor((safe % 3600) / 60);
      const secs = safe % 60;
      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      }
      return `${minutes}:${String(secs).padStart(2, "0")}`;
    };
    const speakerName = (participant?: Participant, fallback?: string) =>
      participant?.serverNickname ||
      participant?.displayName ||
      participant?.username ||
      participant?.tag ||
      fallback ||
      "Unknown";

    const transcriptSegments = transcriptPayload?.segments ?? [];
    if (transcriptSegments.length > 0) {
      for (const segment of transcriptSegments) {
        if (!segment.text) continue;
        const startedAt = Date.parse(segment.startedAt);
        const elapsed = Number.isFinite(startedAt)
          ? (startedAt - meetingStart) / 1000
          : 0;
        events.push({
          id: `voice-${counter++}`,
          type: "voice",
          time: formatElapsed(elapsed),
          speaker:
            segment.serverNickname ||
            segment.displayName ||
            segment.username ||
            segment.tag ||
            "Unknown",
          text: segment.text,
        });
      }
    } else if (!transcript.trim()) {
      events.push({
        id: `bot-${counter++}`,
        type: "bot",
        time: formatElapsed(0),
        speaker: "Chronote",
        text: "Transcript unavailable.",
      });
    }

    for (const entry of chatEntries ?? []) {
      const startedAt = Date.parse(entry.timestamp);
      const elapsed = Number.isFinite(startedAt)
        ? (startedAt - meetingStart) / 1000
        : 0;
      if (entry.type === "message") {
        if (!entry.content) continue;
        events.push({
          id: `chat-${counter++}`,
          type: "chat",
          time: formatElapsed(elapsed),
          speaker: speakerName(entry.user),
          text: entry.content,
        });
      } else {
        events.push({
          id: `presence-${counter++}`,
          type: "presence",
          time: formatElapsed(elapsed),
          speaker: speakerName(entry.user),
          text:
            entry.type === "join" ? "joined the channel" : "left the channel",
        });
      }
    }

    if (history.notesChannelId) {
      events.push({
        id: `bot-${counter++}`,
        type: "bot",
        time: formatElapsed(history.duration),
        speaker: "Chronote",
        text: "Meeting summary posted to Discord.",
      });
    }

    events.sort((a, b) => {
      const toSeconds = (time: string) => {
        const parts = time.split(":").map(Number);
        if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
      };
      return toSeconds(a.time) - toSeconds(b.time);
    });

    const audioUrl = history.audioS3Key
      ? await getSignedObjectUrl(history.audioS3Key)
      : undefined;

    return {
      meeting: {
        id: history.channelId_timestamp,
        meetingId: history.meetingId,
        channelId: history.channelId,
        timestamp: history.timestamp,
        duration: history.duration,
        tags: history.tags ?? [],
        notes: history.notes ?? "",
        notesChannelId: history.notesChannelId,
        notesMessageId: history.notesMessageIds?.[0],
        transcript,
        audioUrl,
        attendees:
          history.participants?.map((participant) =>
            speakerName(participant, participant.username ?? participant.tag),
          ) ??
          history.attendees ??
          [],
        events,
      },
    };
  });

export const meetingsRouter = router({
  list,
  detail,
});
